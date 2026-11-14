// One honest Season 2 day on live testnet with a fresh faucet account: register, dock the
// Beacon Court rope route, sell what docked, buy one reed back. Testnet only; the key never leaves memory.
// Usage: bun --no-env-file scripts/season-live.ts   (works on odd days, which are first_light_v2)
// If the faucet rate-limits, pass the root key (bun --env-file=.env.tidebound ...) and root funds a 0.3 NEAR sub-account instead.
import { mkdir } from "node:fs/promises";
import { Account, actions, JsonRpcProvider, KeyPair, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";

const SEASON = "season.familiar-game.testnet";
const ROUTE = ["step:north", "step:north", "step:west", "wait", "wait", "step:east", "reel:lens", "step:east", "step:west", "step:east", "take:moth", "step:west", "step:east", "step:south", "step:west", "step:south", "return"];
const rpc = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
if ((await rpc.getNetworkId()) !== "testnet") throw new Error("Refusing a non-testnet RPC.");
const view = async <T,>(method: string, args: Record<string, unknown> = {}): Promise<T> => {
  const value = await rpc.callFunction({ contractId: SEASON, method, args });
  if (value === undefined) throw new Error(`${method} returned nothing`);
  return value as unknown as T;
};

const today = await view<{ day: number; content_version: string }>("get_today");
if (today.content_version !== "first_light_v2") throw new Error(`Day ${today.day} is ${today.content_version}; run on an odd (Beacon Court) day.`);
const day = today.day;

const key = KeyPair.fromRandom("ed25519");
let id = `familiar-season-player-${Date.now().toString(36)}.testnet`;
const made = Bun.spawn(["near", "account", "create-account", "sponsor-by-faucet-service", id, "use-manually-provided-public-key", key.getPublicKey().toString(), "network-config", "testnet", "create"], { stdout: "ignore", stderr: "ignore" });
if ((await made.exited) !== 0) {
  const rootKey = process.env.ROOT_PRIVATE_KEY as KeyPairString | undefined;
  if (process.env.NEAR_ROOT !== "familiar-game.testnet" || !rootKey) throw new Error("Faucet account creation failed and no root key was supplied.");
  id = `qa-season-${Date.now().toString(36)}.familiar-game.testnet`;
  await new Account("familiar-game.testnet", rpc, rootKey).signAndSendTransaction({ receiverId: id, actions: [actions.createAccount(), actions.transfer(nearToYocto("0.3")), actions.addFullAccessKey(key.getPublicKey())], waitUntil: "FINAL" });
  console.info(`faucet busy; root created ${id} with 0.3 NEAR`);
}
for (let i = 0; i < 20; i++) { try { await rpc.viewAccount({ accountId: id }); break; } catch { await Bun.sleep(1500); } }
const player = new Account(id, rpc, key.toString() as KeyPairString);

const evidence: object[] = [];
async function call(method: string, args: object, tgas: number, deposit = 0n) {
  const r = await player.callFunctionRaw({ contractId: SEASON, methodName: method, args, gas: teraToGas(tgas), deposit, waitUntil: "FINAL" });
  const burnt = [r.transaction_outcome, ...r.receipts_outcome].reduce((s, o) => s + BigInt(o.outcome.gas_burnt), 0n);
  const status = r.status as { SuccessValue?: string; Failure?: unknown };
  const value = status.SuccessValue !== undefined ? JSON.parse(Buffer.from(status.SuccessValue, "base64").toString() || "null") : null;
  const line = { method, hash: r.transaction.hash, tgasBurnt: Number(burnt) / 1e12, ok: status.Failure === undefined, value };
  evidence.push(line);
  console.info(`${method}: ${line.ok ? "ok" : "FAILED"} ${line.tgasBurnt.toFixed(3)} Tgas https://testnet.nearblocks.io/txns/${r.transaction.hash}`);
  if (!line.ok) throw new Error(`${method} failed: ${JSON.stringify(status.Failure)}`);
  return value;
}

const minimum = BigInt(await view<string>("storage_minimum"));
await call("storage_deposit", {}, 30, minimum);
const mint = await call("claim_daily", { rules_version: "tidebound_h1_v1", content_version: "first_light_v2", tool: "rope", area: "beacon", commands: ROUTE }, 30);
for (const good of ["glass", "reed"]) {
  const now = (await view<{ goods: { good: string; sell_price: number }[] }>("get_shelf")).goods.find(g => g.good === good)!;
  await call("sell", { good, qty: 1, min_price: now.sell_price }, 30);
}
const after = await view<{ goods: { good: string; buy_price: number }[] }>("get_shelf");
await call("buy", { good: "reed", qty: 1, max_price: after.goods.find(g => g.good === "reed")!.buy_price }, 30);
const account = await view("get_account", { account_id: id });

await mkdir(".data", { recursive: true });
await Bun.write(`.data/season-live-${day}.json`, JSON.stringify({ network: "testnet", season: SEASON, day, player: id, mint, account, transactions: evidence }, null, 2));
console.info("mint:", JSON.stringify(mint), "\naccount:", JSON.stringify(account));
