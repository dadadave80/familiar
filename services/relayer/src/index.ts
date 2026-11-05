import type { KeyPairString } from "near-api-js";
import { createApp } from "./app";
import { createBackend } from "./chain";

if (process.env.NEAR_NETWORK && process.env.NEAR_NETWORK !== "testnet")
  throw new Error("Familiar runs on testnet only.");
const root = process.env.NEAR_ROOT ?? "";
const key = process.env.RELAYER_PRIVATE_KEY;
const backend =
  root && key && process.env.RELAYER_ID
    ? createBackend(
        root,
        process.env.RELAYER_ID,
        key as KeyPairString,
        process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
      )
    : undefined;
const app = createApp(
  {
    root,
    origins: (
      process.env.WEB_ORIGINS ?? "http://127.0.0.1:5173,http://localhost:5173"
    ).split(","),
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
