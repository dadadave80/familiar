import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { KeyType, PublicKey } from "near-api-js";
import { Quota, STAMPS } from "./relay";
import { validName } from "../../../web/src/rules";
import { UsernameError, usernameErrors, type UsernameAvailability } from "../../../web/src/account/names";
import { PrivyBridgeError, type PrivyService } from "./auth/privy";
import type { NoteRelay } from "./sealed-note";

export type RelayResult = {
  hash: string;
  receiptSentenceKey: string;
  value?: unknown;
};
export type Backend = {
  accountProvider?: "near-auth"|"privy";
  ready?(): Promise<boolean>;
  authSign?(value:unknown, origin:string): Promise<unknown>;
  guest(publicKey: string, username?:string): Promise<string>;
  usernameAvailable?(username:string):Promise<UsernameAvailability>;
  relay(encoded: string): Promise<RelayResult>;
};
export function createApp(
  config: { origins: string[]; root: string },
  backend?: Backend,
  privy?: PrivyService,
  notes?: NoteRelay,
) {
  const app = new Hono();
  const guests = new Quota(200, 86_400_000, 1);
  const keys = new Quota(4, 3_600_000);
  const names = new Quota(120,60_000,1);
  const privyRequests = new Quota(120,60_000,1);
  app.use(
    "*",
    cors({
      origin: config.origins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Client-Pub-Key", "X-Model-Pub-Key"],
    }),
  );
  app.use("*", async (c, next) => {
    const origin = c.req.header("origin");
    if (origin && !config.origins.includes(origin))
      return c.json(
        { error: "This Post Office serves a different town." },
        403,
      );
    await next();
  });
  app.use(
    "/v1/*",
    bodyLimit({
      maxSize: 16_384,
      onError: (c) => c.json({ error: "That letter is too large." }, 413),
    }),
  );
  app.get("/health", async (c) => {
    const ready = backend
      ? await (backend.ready?.() ?? Promise.resolve(true)).catch(() => false)
      : false;
    return c.json(
      { ready, network: "testnet", root: config.root },
      ready ? 200 : 503,
    );
  });
  // These two routes remain available for an isolated recovery spike with no game contracts.
  app.use("/v1/privy/*",async(c,next)=>{
    const origin=c.req.header("origin");
    if(!origin||!config.origins.includes(origin))return c.json({code:"ERR_AUTH_ORIGIN",error:"Sign in from the configured Familiar address."},403);
    if(!privy)return c.json({code:"AUTH_UNAVAILABLE",error:"Recoverable sign-in is not connected at this address."},503);
    const authorization=c.req.header("authorization");
    if(!authorization||authorization.length>16_391||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(authorization))
      return c.json({code:"ERR_PRIVY_SESSION",error:"Sign in again to verify your session."},401);
    if(!privyRequests.take("all"))return c.json({code:"QUOTA",error:"Account checks are busy. Try again shortly."},429);
    await next();
  });
  app.post("/v1/privy/wallet",async c=>{
    const body:unknown=await c.req.json().catch(()=>null);
    if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).length!==1||!("create" in body)||typeof body.create!=="boolean")
      return c.json({code:"ERR_PRIVY_BODY",error:"Choose restore or explicit wallet creation."},400);
    return c.json({wallet:await privy!.wallet(c.req.header("authorization")!.slice(7),body.create)});
  });
  app.post("/v1/privy/player",async c=>{
    const body:unknown=await c.req.json().catch(()=>null);
    if(!body||typeof body!=="object"||Array.isArray(body)||Object.keys(body).length!==1||!("username" in body)||typeof body.username!=="string"||!validName(body.username))
      throw new UsernameError("ERR_USERNAME_INVALID");
    if(!backend||backend.accountProvider!=="privy")return c.json({code:"AUTH_UNAVAILABLE",error:"The compatible game harbor is not connected. Your wallet remains unchanged."},503);
    // Only the server-verified user's existing canonical key may request a player. This never creates a wallet.
    const wallet=await privy!.wallet(c.req.header("authorization")!.slice(7),false);
    if(!wallet)return c.json({code:"ERR_PRIVY_WALLET_REQUIRED",error:"Create your recoverable wallet explicitly before creating a player."},409);
    if(!keys.take(wallet.publicKey)||!guests.take("all"))return c.json({error:STAMPS,code:"QUOTA"},429);
    const accountId=await backend.guest(wallet.publicKey,body.username);
    return c.json({accountId,root:config.root,network:"testnet"});
  });
  // Exact encrypted bytes; only plain routing/budget fields are checked. Message content is never decoded or logged.
  app.post("/v1/privy/note",async c=>{
    const startedAt=Date.now();
    if(!notes)return c.json({code:"NOTE_DISABLED",error:"Mochi's sealed note is not enabled for this harbor."},503);
    const bytes=new Uint8Array(await c.req.arrayBuffer());
    const wallet=await privy!.wallet(c.req.header("authorization")!.slice(7),false);
    if(!wallet)return c.json({code:"ERR_PRIVY_WALLET_REQUIRED",error:"Create your recoverable wallet explicitly before asking for a note."},409);
    const result=await notes.write({startedAt,walletPublicKey:wallet.publicKey,bytes,clientPublicKey:c.req.header("x-client-pub-key"),modelPublicKey:c.req.header("x-model-pub-key")});
    return c.json(result.body as Record<string,unknown>,result.status as 200);
  });
  app.use("/v1/*", async (c, next) => {
    if (!backend)
      return c.json(
        {
          error:
            "The Post Office is resting. Your pet is safe; try again shortly.",
          code: "OFFLINE",
        },
        503,
      );
    await next();
  });
  app.get("/v1/player-name/:username",async c=>{
    const username=c.req.param("username");
    if(!validName(username))throw new UsernameError("ERR_USERNAME_INVALID");
    if(!backend?.usernameAvailable)return c.json({code:"AUTH_UNAVAILABLE",error:"Username signup is not connected for this harbor."},503);
    if(!names.take("all"))return c.json({code:"QUOTA",error:"Name checks are busy. Try again shortly."},429);
    return c.json(await backend.usernameAvailable(username));
  });
  app.post("/v1/guest", async (c) => {
    if(backend?.accountProvider==="privy")return c.json({code:"ERR_PRIVY_SESSION",error:"Use recoverable sign-in before creating a player."},401);
    const body: unknown = await c.req.json().catch(() => null);
    const publicKey =
      body && typeof body === "object" && "publicKey" in body
        ? body.publicKey
        : null;
    try {
      if (
        typeof publicKey !== "string" ||
        publicKey.length > 60 ||
        PublicKey.fromString(publicKey).keyType !== KeyType.ED25519
      )
        throw new Error();
    } catch {
      return c.json(
        {
          error:
            "Your browser could not make a guest pass. Reload and try again.",
          code: "ERR_PUBLIC_KEY",
        },
        400,
      );
    }
    const username=body && typeof body==="object" && "username" in body ? body.username:undefined;
    if(username!==undefined && (typeof username!=="string" || !validName(username)))throw new UsernameError("ERR_USERNAME_INVALID");
    if (!keys.take(publicKey) || !guests.take("all"))
      return c.json({ error: STAMPS, code: "QUOTA" }, 429);
    const accountId = await backend!.guest(publicKey as string,username as string|undefined);
    return c.json({ accountId, root: config.root, network: "testnet" });
  });
  app.post("/v1/auth/sign", async (c) => {
    const origin = c.req.header("origin");
    if (!origin || !config.origins.includes(origin)) return c.json({code:"ERR_AUTH_ORIGIN",error:"Sign in from the configured Familiar address."},403);
    if (!backend?.authSign) return c.json({code:"AUTH_UNAVAILABLE",error:"Cross-device saving is not connected at this address. Your local preview is safe."},503);
    const body:unknown = await c.req.json().catch(() => null);
    return c.json(await backend.authSign(body,origin));
  });
  app.post("/v1/relay", async (c) => {
    const body: unknown = await c.req.json().catch(() => null);
    const encoded =
      body && typeof body === "object" && "signedDelegate" in body
        ? body.signedDelegate
        : null;
    if (typeof encoded !== "string")
      return c.json(
        {
          error: "That letter has no signature. Try the action again.",
          code: "ERR_ENCODING",
        },
        400,
      );
    return c.json(await backend!.relay(encoded));
  });
  app.onError((error, c) => {
    if(error instanceof PrivyBridgeError){
      const copy={ERR_PRIVY_SESSION:"Sign in again to verify your session.",ERR_PRIVY_OWNER:"This session has no verified signing ownership of that wallet.",ERR_PRIVY_WALLET:"The wallet response could not be verified. Keep the original wallet and check again.",ERR_PRIVY_UNAVAILABLE:"The wallet service is unavailable. No replacement wallet was requested.",ERR_PRIVY_CREATE_UNKNOWN:"The original wallet request is unresolved. Restore it before requesting any new action.",ERR_QUOTA:STAMPS};
      return c.json({code:error.code,error:copy[error.code]},error.code==="ERR_PRIVY_SESSION"?401:error.code==="ERR_PRIVY_OWNER"?403:error.code==="ERR_QUOTA"?429:503);
    }
    const code = error instanceof UsernameError ? error.code:error.message.match(/\bERR_[A-Z_]{1,48}\b/)?.[0];
    if(code && Object.hasOwn(usernameErrors,code))return c.json({code,error:usernameErrors[code as keyof typeof usernameErrors]},400);
    const exhausted =
      code && ["ERR_QUOTA", "ERR_STAMPS", "ERR_DAILY_BUDGET"].includes(code);
    if (code)
      return c.json(
        {
          code: exhausted ? "QUOTA" : code,
          error: exhausted
            ? STAMPS
            : "The Post Office could not deliver that action. Your last confirmed progress is safe.",
        },
        exhausted ? 429 : 400,
      );
    return c.json(
      {
        code: "DELIVERY_UNKNOWN",
        error:
          "Delivery is taking longer than expected. Check your pet before trying again.",
      },
      503,
    );
  });
  return app;
}
