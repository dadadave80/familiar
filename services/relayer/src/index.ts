import type { KeyPairString } from "near-api-js";
import { createApp } from "./app";
import { createBackend, type AccountBackendConfig } from "./chain";
import { createPrivyBridge } from "./auth/privy";

if (process.env.NEAR_NETWORK && process.env.NEAR_NETWORK !== "testnet")
  throw new Error("Familiar runs on testnet only.");
const enabled=process.env.TIDEBOUND_ENABLED==="true";
const provider=process.env.ACCOUNT_PROVIDER??"near-auth";
if(provider!=="near-auth"&&provider!=="privy")throw Error("Unknown ACCOUNT_PROVIDER; refusing a silent legacy sponsorship fallback.");
if (enabled && provider==="near-auth" && !process.env.NEAR_AUTH_CLIENT_ID)
  throw new Error("Tidebound mode requires its public NEAR_AUTH_CLIENT_ID; refusing a silent legacy sponsorship fallback.");
if((process.env.PRIVY_APP_ID&&!process.env.PRIVY_APP_SECRET)||(!process.env.PRIVY_APP_ID&&process.env.PRIVY_APP_SECRET)||
  (provider==="privy"&&(!process.env.PRIVY_APP_ID||!process.env.PRIVY_APP_SECRET)))throw Error("Privy requires its server app configuration; refusing a silent legacy sponsorship fallback.");
const root = process.env.NEAR_ROOT ?? "";
const key = process.env.RELAYER_PRIVATE_KEY;
const origins = (process.env.WEB_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173").split(",");
const account:AccountBackendConfig|undefined=enabled ? provider==="privy"
  ? {provider:"privy",items:`items.${root}`,origins}
  : {provider:"near-auth",clientId:process.env.NEAR_AUTH_CLIENT_ID!,items:`items.${root}`,origins} : undefined;
const privy=provider==="privy" ? createPrivyBridge({appId:process.env.PRIVY_APP_ID!,appSecret:process.env.PRIVY_APP_SECRET!}):undefined;
const backend =
  root && key && process.env.RELAYER_ID && (provider!=="privy"||enabled)
    ? createBackend(
        root,
        process.env.RELAYER_ID,
        key as KeyPairString,
        process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
        account,
      )
    : undefined;
const app = createApp(
  {
    root,
    origins,
  },
  backend,
  privy,
);
const server = Bun.serve({
  port: Number(process.env.RELAYER_PORT ?? 3037),
  fetch: app.fetch,
});
console.info(
  `Post Office listening on ${server.port}; ${backend ? "testnet configured" : "awaiting testnet configuration"}.`,
);
