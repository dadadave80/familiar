import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { KeyType, PublicKey } from "near-api-js";
import { Quota, STAMPS } from "./relay";

export type RelayResult = {
  hash: string;
  receiptSentenceKey: string;
  value?: unknown;
};
export type Backend = {
  ready?(): Promise<boolean>;
  authSign?(value:unknown, origin:string): Promise<unknown>;
  guest(publicKey: string): Promise<string>;
  relay(encoded: string): Promise<RelayResult>;
};
export function createApp(
  config: { origins: string[]; root: string },
  backend?: Backend,
) {
  const app = new Hono();
  const guests = new Quota(200, 86_400_000, 1);
  const keys = new Quota(4, 3_600_000);
  app.use(
    "*",
    cors({
      origin: config.origins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type"],
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
  app.post("/v1/guest", async (c) => {
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
    if (!keys.take(publicKey) || !guests.take("all"))
      return c.json({ error: STAMPS, code: "QUOTA" }, 429);
    const accountId = await backend!.guest(publicKey as string);
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
    const code = error.message.match(/\bERR_[A-Z_]{1,48}\b/)?.[0];
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
