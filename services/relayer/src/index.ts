import type { KeyPairString } from "near-api-js";
import { createApp } from "./app";
import { createBackend } from "./chain";

if (process.env.NEAR_NETWORK && process.env.NEAR_NETWORK !== "testnet")
  throw new Error("Familiar runs on testnet only.");
if (process.env.TIDEBOUND_ENABLED === "true" && !process.env.NEAR_AUTH_CLIENT_ID)
  throw new Error("Tidebound mode requires its public NEAR_AUTH_CLIENT_ID; refusing a silent legacy sponsorship fallback.");
const root = process.env.NEAR_ROOT ?? "";
const key = process.env.RELAYER_PRIVATE_KEY;
const origins = (process.env.WEB_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173").split(",");
const backend =
  root && key && process.env.RELAYER_ID
    ? createBackend(
        root,
        process.env.RELAYER_ID,
        key as KeyPairString,
        process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
        process.env.TIDEBOUND_ENABLED === "true" && process.env.NEAR_AUTH_CLIENT_ID
          ? {clientId:process.env.NEAR_AUTH_CLIENT_ID,items:`items.${root}`,origins} : undefined,
      )
    : undefined;
const app = createApp(
  {
    root,
    origins,
  },
  backend,
);
const server = Bun.serve({
  port: Number(process.env.RELAYER_PORT ?? 3037),
  fetch: app.fetch,
});
console.info(
  `Post Office listening on ${server.port}; ${backend ? "testnet configured" : "awaiting testnet configuration"}.`,
);
