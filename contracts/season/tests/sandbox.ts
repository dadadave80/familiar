import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Account, JsonRpcProvider, KeyPair, actions, baseEncode, getTransactionLastResult, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";

const rpcUrl = process.env.SANDBOX_RPC!;
assert.match(rpcUrl, /^http:\/\/(127\.0\.0\.1|localhost):\d+/);
const provider = new JsonRpcProvider({ url: rpcUrl });
const sponsor = new Account(process.env.SANDBOX_ROOT!, provider, process.env.SANDBOX_SECRET as KeyPairString);
assert.equal(sponsor.accountId, "testnet");

const wasm = async (name: string) => new Uint8Array(await Bun.file(`contracts/target/deploy/familiar_${name}.wasm`).arrayBuffer());
const hash = (bytes: Uint8Array) => baseEncode(createHash("sha256").update(bytes).digest());
async function create(parent: Account, prefix: string, funds: `${number}` = "12") {
  const key = KeyPair.fromRandom("ed25519"), id = `${prefix}.${parent.accountId}`;
  await parent.createAccount({ newAccountId: id, publicKey: key.getPublicKey(), nearToTransfer: nearToYocto(funds) });
  return new Account(id, provider, key.toString());
}
const view = (contractId: string, method: string, args: Record<string, unknown> = {}): Promise<any> =>
  provider.callFunction({ contractId, method, args, blockQuery: { finality: "final" } });

type Gas = { total: bigint; receipts: { executor: string; burnt: bigint }[] };
/** Signs one function call; throws on any failed receipt; returns the last value and gas burnt. */
async function exec(account: Account, contractId: string, methodName: string, args: Record<string, unknown> = {}, gasT = 100, deposit = 0n) {
  const outcome: any = await account.signAndSendTransaction({
    receiverId: contractId,
    actions: [actions.functionCall(methodName, args, teraToGas(gasT), deposit)],
    waitUntil: "FINAL",
  });
  for (const r of outcome.receipts_outcome) {
    if (typeof r.outcome.status === "object" && "Failure" in r.outcome.status) throw new Error(JSON.stringify(r.outcome.status.Failure));
  }
  const receipts = outcome.receipts_outcome.map((r: any) => ({ executor: r.outcome.executor_id as string, burnt: BigInt(r.outcome.gas_burnt) }));
  const total = BigInt(outcome.transaction_outcome.outcome.gas_burnt) + receipts.reduce((s: bigint, r: { burnt: bigint }) => s + r.burnt, 0n);
  return { value: getTransactionLastResult(outcome) as any, gas: { total, receipts } as Gas };
}
const tgas = (g: bigint) => `${(Number(g) / 1e12).toFixed(3)} Tgas`;
const gasLog: string[] = [];
function logGas(label: string, gas: Gas) {
  const line = `${label}: total ${tgas(gas.total)} [${gas.receipts.map(r => `${r.executor} ${tgas(r.burnt)}`).join(", ")}]`;
  gasLog.push(line);
  console.log(`GAS ${line}`);
}
async function rejects(promise: Promise<unknown>, pattern: RegExp, label: string) {
  try {
    await promise;
  } catch (error) {
    const text = error instanceof Error ? `${error.message} ${JSON.stringify((error as any).cause ?? "")}` : String(error);
    assert.match(text, pattern, `${label}: wrong failure: ${text}`);
    console.log(`PASS ${label}: refused with ${text.match(pattern)![0]}`);
    return;
  }
  assert.fail(`${label}: expected failure ${pattern}`);
}
async function relay(player: Account, receiverId: string, method: string, args: Record<string, unknown> = {}, gasT = 180) {
  const { signedDelegate } = await player.createSignedMetaTransaction({ receiverId, actions: [actions.functionCall(method, args, teraToGas(gasT), 0n)], blockHeightTtl: 120 });
  const result: any = await sponsor.signAndSendTransaction({ receiverId: player.accountId, actions: [actions.signedDelegate(signedDelegate)], waitUntil: "FINAL" });
  for (const r of result.receipts_outcome) {
    if (typeof r.outcome.status === "object" && "Failure" in r.outcome.status) throw new Error(JSON.stringify(r.outcome.status.Failure));
  }
  let terminal = result.receipts_outcome.find((r: any) => r.outcome.executor_id === receiverId);
  while (terminal && typeof terminal.outcome.status === "object" && "SuccessReceiptId" in terminal.outcome.status) {
    terminal = result.receipts_outcome.find((r: any) => r.id === terminal.outcome.status.SuccessReceiptId);
  }
  return getTransactionLastResult({ status: terminal.outcome.status } as any) as any;
}

// ---------- the real Root stack (Root, Items, Bakery, Market, mock pool, global Pet) ----------
const root = await create(sponsor, "familiar", "180");
const [items, bakery, market, pool, bram, ...dens] = await Promise.all(["items", "bakery", "market", "pool", "bram", "den-1", "den-2", "den-3", "den-4"].map(n => create(root, n)));
const petWasm = await wasm("pet");
await sponsor.signAndSendTransaction({ receiverId: sponsor.accountId, actions: [actions.deployGlobalContract(petWasm, "codeHash")], waitUntil: "FINAL" });
for (const [account, name] of [[root, "root"], [items, "items"], [bakery, "bakery"], [market, "market"], [pool, "mock_pool"]] as const) await account.deployContract(await wasm(name));
await exec(items, items.accountId, "new", { registry: root.accountId, bakery: bakery.accountId, market: market.accountId });
await exec(bakery, bakery.accountId, "new", { items: items.accountId });
await exec(market, market.accountId, "new", { registry: root.accountId, items: items.accountId, npc: bram.accountId, dens: dens.map(d => d.accountId) });
await exec(pool, pool.accountId, "new", { owner: pool.accountId });
await exec(root, root.accountId, "new", { relayer: sponsor.accountId, pet_code_hash: hash(petWasm), items: items.accountId, bakery: bakery.accountId, market: market.accountId, pool: pool.accountId });
async function player(username: string, name: string) {
  const key = KeyPair.fromRandom("ed25519");
  const { value: id } = await exec(sponsor, root.accountId, "create_named_player", { public_key: key.getPublicKey().toString(), username });
  const account = new Account(String(id), provider, key.toString());
  await sponsor.transfer({ receiverId: account.accountId, amount: nearToYocto("2") });
  const pet = await relay(account, root.accountId, "adopt", { name });
  assert.equal(pet, `${name}.${root.accountId}`);
  assert.equal((await view(root.accountId, "nft_token", { token_id: pet })).owner_id, account.accountId);
  return { account, pet: String(pet) };
}
const alice = await player("alice", "mochi"), bob = await player("bob", "bramble");
const stranger = await create(sponsor, "stranger", "5");

// ---------- Season on real Wasm ----------
const seasonWasm = await wasm("season");
const seasonHash = hash(seasonWasm);
console.log(`season wasm ${seasonWasm.length} bytes, sha256 ${seasonHash}`);
const season = await create(root, "season", "10");
await season.signAndSendTransaction({ receiverId: season.accountId, actions: [actions.deployContract(seasonWasm)], waitUntil: "FINAL" });
assert.equal((await provider.viewAccount({ accountId: season.accountId, blockQuery: { finality: "final" } })).code_hash, seasonHash);
const S = season.accountId;

// 1. `new` is #[private].
await rejects(exec(stranger, S, "new", { root: root.accountId }), /Method new is private/, "stranger init");
await exec(season, S, "new", { root: root.accountId });
await rejects(exec(season, S, "new", { root: root.accountId }), /The contract has already been initialized/, "second init");
assert.equal(await view(S, "get_root"), root.accountId);

// 2. The ownership callback is #[private].
await rejects(exec(stranger, S, "on_wish_owner", { owner: stranger.accountId, pet: alice.pet, good: "glass", limit: 1, qty: 1 }), /Method on_wish_owner is private/, "direct on_wish_owner");
await rejects(exec(stranger, S, "on_storage_withdraw", { account_id: stranger.accountId, amount: "1" }), /Method on_storage_withdraw is private/, "direct on_storage_withdraw");

// 3/4. Views decode; registration; the daily court.
const minimum = BigInt(await view(S, "storage_minimum"));
assert.equal(minimum, 1250n * 10n ** 19n);
assert.equal(await view(S, "storage_balance_of", { account_id: alice.account.accountId }), null);
await rejects(exec(alice.account, S, "storage_deposit", {}, 30, minimum - 1n), /ERR_STORAGE_DEPOSIT/, "short storage deposit");
for (const who of [alice.account, bob.account]) {
  const { value } = await exec(who, S, "storage_deposit", {}, 30, minimum);
  assert.deepEqual(value, { total: minimum.toString(), available: (850n * 10n ** 19n).toString() });
}
assert.deepEqual(await view(S, "storage_balance_of", { account_id: bob.account.accountId }), { total: minimum.toString(), available: (850n * 10n ** 19n).toString() });

const today = await view(S, "get_today", {});
assert.deepEqual(await view(S, "get_today", { account_id: null }), today);
assert.equal((await view(S, "get_today", { account_id: alice.account.accountId })).minted_today, null);
assert.equal(today.rules_version, "tidebound_h1_v1");
assert.equal(today.area, "beacon");
assert.deepEqual(today.mapping, [["lens", "glass"], ["moth", "reed"], ["chart", "reed"], ["salvage", "reed"], ["vane", null]]);
assert.deepEqual(today.best_haul, today.content_version === "first_light_v1"
  ? [{ tool: "rope", hauls: [[1, 1], [0, 2]] }, { tool: "lantern", hauls: [[1, 2]] }]
  : [{ tool: "rope", hauls: [[1, 1]] }, { tool: "lantern", hauls: [[1, 1]] }]);
const v1 = today.content_version === "first_light_v1";
assert(v1 || today.content_version === "first_light_v2", today.content_version);
console.log(`court day ${today.day}: ${today.content_version}`);
// v1 lantern: lens + chart (Season 1 golden route). v2 rope: lens + moth rescue route.
const route = v1
  ? { tool: "lantern", goods: [1, 1], commands: ["wait", "wait", "lure:left", "take:chart", "move:left", "take:lens", "move:center", "return"] }
  : { tool: "rope", goods: [1, 1], commands: ["step:north", "step:north", "step:west", "wait", "wait", "step:east", "reel:lens", "step:east", "step:west", "step:east", "take:moth", "step:west", "step:east", "step:south", "step:west", "step:south", "return"] };
const claimArgs = (commands: string[], content_version = today.content_version) =>
  ({ rules_version: today.rules_version, content_version, tool: route.tool, area: "beacon", commands });

const other = v1 ? "first_light_v2" : "first_light_v1";
await rejects(exec(alice.account, S, "claim_daily", claimArgs(route.commands, other)), /ERR_WRONG_COURT/, "doctored court: other day's version");
await rejects(exec(alice.account, S, "claim_daily", claimArgs(route.commands.slice(0, -1))), /ERR_RETURN_REQUIRED/, "doctored court: no return");
await rejects(exec(alice.account, S, "claim_daily", { ...claimArgs(route.commands), rules_version: "tidebound_h2" }), /ERR_RULES_VERSION/, "doctored court: rules version");
await rejects(exec(alice.account, S, "claim_daily", { ...claimArgs(route.commands), area: "wind" }), /ERR_REPLAY_CONTEXT/, "doctored court: other area");
await rejects(exec(alice.account, S, "claim_daily", { ...claimArgs(route.commands), commands: "return" }), /Failed to deserialize input from JSON/, "malformed JSON args");
assert.equal((await view(S, "get_account", { account_id: alice.account.accountId })).last_mint, null, "refused claims mint nothing");

// 7. Deposits on non-payable methods are rejected before any effect.
await rejects(exec(alice.account, S, "claim_daily", claimArgs(route.commands), 100, 1n), /Method claim_daily doesn't accept deposit/, "deposit on claim_daily");

const shelf0 = await view(S, "get_shelf");
for (const who of [alice, bob]) {
  const { value: mint, gas } = await exec(who.account, S, "claim_daily", claimArgs(route.commands));
  logGas(`claim_daily (${today.content_version}, ${route.tool})`, gas);
  assert.equal(mint.day, today.day);
  assert.deepEqual(mint.goods, route.goods);
  assert.equal(mint.score_bp, Math.floor(mint.value_fp * 10000 / mint.best_fp));
  if (!v1) assert.equal(mint.score_bp, 10000);
  assert.deepEqual((await view(S, "get_account", { account_id: who.account.accountId })).goods, route.goods);
}
await rejects(exec(alice.account, S, "claim_daily", claimArgs(route.commands)), /ERR_ALREADY_MINTED/, "second claim same day");
assert.deepEqual((await view(S, "get_today", { account_id: alice.account.accountId })).minted_today.goods, route.goods);
assert.deepEqual((await view(S, "get_shelf")).goods_minted, [shelf0.goods_minted[0] + 2 * route.goods[0], shelf0.goods_minted[1] + 2 * route.goods[1]]);

// 5. Bram: guards enforced, then honest trades.
for (const [method, args] of [["buy", { good: "glass", qty: 1, max_price: 99 }], ["sell", { good: "glass", qty: 1, min_price: 0 }], ["set_wish", { pet: alice.pet, good: "glass", limit: 1, qty: 1 }], ["cancel_wish", { pet: alice.pet }]] as const) {
  await rejects(exec(alice.account, S, method, args, 100, 1n), new RegExp(`Method ${method} doesn't accept deposit`), `deposit on ${method}`);
}
const glassSell = (await view(S, "get_shelf")).goods[0].sell_price as number;
assert(glassSell > 0);
await rejects(exec(alice.account, S, "sell", { good: "glass", qty: 1, min_price: glassSell + 1 }), /ERR_MIN_PRICE/, "sell below min_price");
await rejects(exec(alice.account, S, "sell", { good: "glass", qty: 2, min_price: 0 }), /ERR_GOODS/, "sell more than held");
await rejects(exec(alice.account, S, "sell", { good: "pearl", qty: 1, min_price: 0 }), /ERR_GOOD/, "unknown good");
for (const who of [alice, bob]) {
  const price = (await view(S, "get_shelf")).goods[0].sell_price;
  const { value: trade, gas } = await exec(who.account, S, "sell", { good: "glass", qty: 1, min_price: price });
  logGas("sell glass x1", gas);
  assert.deepEqual(trade.unit_prices, [price]);
  assert.equal(trade.total, price);
  assert.equal((await view(S, "get_account", { account_id: who.account.accountId })).shells, price);
}
const aliceAfterSell = await view(S, "get_account", { account_id: alice.account.accountId });
assert.deepEqual(aliceAfterSell.goods, [0, route.goods[1]]);
const glassBuy = (await view(S, "get_shelf")).goods[0].buy_price as number;
await rejects(exec(alice.account, S, "buy", { good: "glass", qty: 1, max_price: glassBuy - 1 }), /ERR_MAX_PRICE/, "buy above max_price");
await rejects(exec(alice.account, S, "buy", { good: "glass", qty: 0, max_price: 99 }), /ERR_TRADE_QTY/, "zero-quantity buy");
assert.deepEqual(await view(S, "get_account", { account_id: alice.account.accountId }), aliceAfterSell, "refused trades change nothing");
// Reed is cheapest; Alice buys one reed within her Shells.
const reedBuy = (await view(S, "get_shelf")).goods[1].buy_price as number;
assert(reedBuy <= aliceAfterSell.shells, `reed ${reedBuy} > shells ${aliceAfterSell.shells}`);
{
  const { value: trade, gas } = await exec(alice.account, S, "buy", { good: "reed", qty: 1, max_price: reedBuy });
  logGas("buy reed x1", gas);
  assert.deepEqual(trade.unit_prices, [reedBuy]);
  const after = await view(S, "get_account", { account_id: alice.account.accountId });
  assert.equal(after.shells, aliceAfterSell.shells - reedBuy);
  assert.deepEqual(after.goods, [0, route.goods[1] + 1]);
  assert.deepEqual(after.traded, [1, 1]);
}

// 6. Mochi's wish through the real Root ownership view.
const bobBefore = await view(S, "get_account", { account_id: bob.account.accountId });
assert(bobBefore.shells >= 1);
{
  const { value, gas } = await exec(bob.account, S, "set_wish", { pet: alice.pet, good: "glass", limit: 1, qty: 1 }, 60);
  logGas("set_wish by non-owner (60 Tgas prepaid)", gas);
  assert.equal(value.status, "refused");
  assert.equal(value.reason, "ERR_NOT_OWNER");
  assert.deepEqual(await view(S, "get_account", { account_id: bob.account.accountId }), bobBefore, "non-owner holds no Shells and is charged no storage");
  assert.equal(await view(S, "get_wish", { pet: alice.pet }), null);
  assert.equal(await view(S, "get_postcard", { pet: alice.pet }), null);
  assert.deepEqual(await view(S, "get_wish_queue", { good: "glass" }), []);
}
{
  const { value } = await exec(bob.account, S, "set_wish", { pet: `nobody.${root.accountId}`, good: "glass", limit: 1, qty: 1 }, 60);
  assert.deepEqual([value.status, value.reason], ["refused", "ERR_NOT_OWNER"], "a missing pet token is refused");
  assert.deepEqual(await view(S, "get_account", { account_id: bob.account.accountId }), bobBefore);
}
await rejects(exec(alice.account, S, "set_wish", { pet: alice.pet, good: "glass", limit: 1, qty: 1 }, 59), /ERR_GAS/, "set_wish under 60 Tgas");
await rejects(exec(alice.account, S, "set_wish", { pet: alice.pet, good: "glass", limit: 99, qty: 1 }, 60), /ERR_PURSE_LIMIT/, "purse over 24");

const aliceBeforeWish = await view(S, "get_account", { account_id: alice.account.accountId });
// A limit of 1 Shell cannot fill now, so the wish waits holding its purse.
{
  const { value, gas } = await exec(alice.account, S, "set_wish", { pet: alice.pet, good: "glass", limit: 1, qty: 1 }, 60);
  logGas("set_wish by owner -> waiting (60 Tgas prepaid)", gas);
  assert.equal(value.status, "waiting", JSON.stringify(value));
  assert.equal(value.wish.purse, 1);
  const after = await view(S, "get_account", { account_id: alice.account.accountId });
  assert.equal(after.shells, aliceBeforeWish.shells - 1);
  assert.equal(after.storage_bytes, 400 + 850);
  assert.deepEqual(await view(S, "get_wish_queue", { good: "glass" }), [alice.pet]);
  assert.equal((await view(S, "get_wish", { pet: alice.pet })).owner, alice.account.accountId);
}
await rejects(exec(bob.account, S, "cancel_wish", { pet: alice.pet }), /ERR_NOT_WISH_OWNER/, "stranger cancel_wish");
{
  const { value: card, gas } = await exec(alice.account, S, "cancel_wish", { pet: alice.pet });
  logGas("cancel_wish", gas);
  assert.deepEqual([card.outcome, card.reason, card.refunded, card.paid], ["cancelled", "CANCELLED_BY_OWNER", 1, 0]);
  assert.equal((await view(S, "get_account", { account_id: alice.account.accountId })).shells, aliceBeforeWish.shells, "cancel refunds the purse");
  assert.equal(await view(S, "get_wish", { pet: alice.pet }), null);
  assert.deepEqual(await view(S, "get_wish_queue", { good: "glass" }), []);
  assert.equal((await view(S, "get_postcard", { pet: alice.pet })).outcome, "cancelled");
}
await rejects(exec(alice.account, S, "cancel_wish", { pet: alice.pet }), /ERR_NO_WISH/, "cancel twice");
// Heaviest path: place a waiting wish, then replace it with one that fills on set.
{
  // Alice sells her reed back to fund the purse.
  const held = (await view(S, "get_account", { account_id: alice.account.accountId })).goods[1];
  const { value: trade, gas } = await exec(alice.account, S, "sell", { good: "reed", qty: held, min_price: 1 });
  logGas(`sell reed x${held}`, gas);
  assert.equal(trade.unit_prices.length, held);
}
await exec(alice.account, S, "set_wish", { pet: alice.pet, good: "glass", limit: 1, qty: 1 }, 60);
{
  const reed = (await view(S, "get_shelf")).goods[1].buy_price as number;
  const before = await view(S, "get_account", { account_id: alice.account.accountId });
  assert(before.shells + 1 >= reed, `reed ${reed} > shells ${before.shells + 1}`);
  const { value, gas } = await exec(alice.account, S, "set_wish", { pet: alice.pet, good: "reed", limit: reed, qty: 1 }, 60);
  logGas("set_wish by owner replacing a waiting wish -> filled on set (60 Tgas prepaid)", gas);
  assert.equal(value.status, "filled", JSON.stringify(value));
  assert.deepEqual([value.postcard.reason, value.postcard.unit_prices, value.postcard.paid, value.postcard.refunded], ["FILLED_ON_SET", [reed], reed, 0]);
  const after = await view(S, "get_account", { account_id: alice.account.accountId });
  assert.equal(after.shells, before.shells + 1 - reed);
  assert.equal(after.goods[1], before.goods[1] + 1);
  assert.equal(after.storage_bytes, 400 + 850, "the pet record is charged once");
  assert.equal(await view(S, "get_wish", { pet: alice.pet }), null);
  assert.deepEqual(await view(S, "get_wish_queue", { good: "glass" }), []);
  assert.equal((await view(S, "get_postcard", { pet: alice.pet })).outcome, "filled");
}

// Conservation across the till, players and purses.
const shelf = await view(S, "get_shelf");
const accounts = await Promise.all([alice, bob].map(w => view(S, "get_account", { account_id: w.account.accountId })));
assert.equal(shelf.till + accounts.reduce((s, a) => s + a.shells, 0), shelf.shells_minted, "Shells conserved");
for (const g of [0, 1]) assert.equal(shelf.goods[g].stock + accounts.reduce((s, a) => s + a.goods[g], 0), shelf.goods_minted[g], "goods conserved");

console.log(`PASS season sandbox on real Wasm ${seasonHash} against real Root ${hash(await wasm("root"))}`);
for (const line of gasLog) console.log(`GAS ${line}`);
