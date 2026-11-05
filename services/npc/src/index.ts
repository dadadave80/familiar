import { Hono } from "hono";
import { cors } from "hono/cors";
import { Account, JsonRpcProvider, type KeyPairString } from "near-api-js";
import { priceQuote, type Dial } from "./pricing";
import { reason } from "./reasoning";

if (process.env.NEAR_NETWORK && process.env.NEAR_NETWORK !== "testnet")
  throw new Error("Bram runs on testnet only.");
const root = process.env.NEAR_ROOT;
const npcId = process.env.NPC_ID;
const key = process.env.NPC_PRIVATE_KEY;
const provider = new JsonRpcProvider({
  url: process.env.NEAR_RPC_URL ?? "https://rpc.testnet.near.org",
});
if (
  (root && !root.endsWith(".testnet")) ||
  (npcId && !npcId.endsWith(".testnet"))
)
  throw new Error("Testnet account IDs are required.");
const npc =
  root && npcId && key
    ? new Account(npcId, provider, key as KeyPairString)
    : undefined;
type Quote = {
  item: string;
  bid: string;
  ask: string;
  max_qty: string;
  stock?: string;
  last?: string;
};
let state: {
  quotes: Quote[];
  tooltip: string;
  dial: Dial;
  lastTick: string | null;
  source: "script" | "llm";
  available: boolean;
} = {
  quotes: [],
  tooltip: "The oven is warming up. Check back in a moment.",
  dial: "steady",
  lastTick: null,
  source: "script",
  available: false,
};
let ticking = false;
async function tick() {
  if (!npc || !root || ticking) return;
  ticking = true;
  try {
    if ((await provider.getNetworkId()) !== "testnet")
      throw new Error("Refusing a non-testnet RPC.");
    const observation = await provider.callFunction<{
      quotes: Quote[];
      balance: string;
    }>({
      contractId: `market.${root}`,
      method: "get_npc",
      args: {},
      blockQuery: { finality: "final" },
    });
    if (!observation) throw new Error("Missing market observation.");
    const reasoning = await reason(
      state.dial,
      process.env.NEAR_AI_API_KEY && process.env.NEAR_AI_MODEL
        ? { key: process.env.NEAR_AI_API_KEY, model: process.env.NEAR_AI_MODEL }
        : undefined,
    );
    const quotes = observation.quotes.map((q) => {
      const next = priceQuote({
        last: BigInt(q.last ?? q.bid),
        stock: BigInt(q.stock ?? "10"),
        dial: reasoning.dial,
      });
      return {
        item: q.item,
        bid: next.bid.toString(),
        ask: next.ask.toString(),
        max_qty: next.max_qty.toString(),
      };
    });
    const synced = await npc.callFunction({
      contractId: `market.${root}`,
      methodName: "set_quotes",
      args: { quotes },
      gas: 60_000_000_000_000n,
      waitUntil: "FINAL",
    });
    if (synced !== true)
      throw new Error("Market inventory could not be reconciled.");
    state = {
      quotes,
      ...reasoning,
      lastTick: new Date().toISOString(),
      available: true,
    };
  } catch {
    state = { ...state, available: false };
    console.warn(
      "Bram could not update the market; previous confirmed quotes remain in effect.",
    );
  } finally {
    ticking = false;
  }
}
const app = new Hono();
app.use("*", cors());
app.get("/health", (c) =>
  c.json(
    { ready: Boolean(npc) && state.available, lastTick: state.lastTick },
    npc && state.available ? 200 : 503,
  ),
);
app.get("/v1/npc/bram", (c) => c.json(state));
const server = Bun.serve({
  port: Number(process.env.NPC_PORT ?? 3038),
  fetch: app.fetch,
});
console.info(
  `Bram listening on ${server.port}; ${npc ? "testnet configured" : "awaiting restricted testnet key"}.`,
);
void tick();
setInterval(() => void tick(), 60_000);
