// `make judge`: read-only checks of Familiar's NEAR claims against live testnet.
// No keys, no signing, no .env. Every line it prints comes from a public RPC response.
const RPC = process.env.JUDGE_RPC ?? "https://test.rpc.fastnear.com";
const ROOT = process.env.JUDGE_ROOT ?? "familiar-game.testnet";
const ITEMS = `items.${ROOT}`;
const PLAYER = `qa-maker-h1.${ROOT}`;

type Key = { public_key: string; access_key: { permission: "FullAccess" | { FunctionCall: { receiver_id: string; method_names: string[] } } } };

async function rpc(params: Record<string, unknown>) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "judge", method: "query", params: { finality: "final", ...params } }) });
  const body = await res.json() as { result?: any; error?: { message?: string; data?: unknown } };
  if (body.error || body.result?.error) throw new Error(`${params.request_type} ${params.account_id}: ${JSON.stringify(body.error ?? body.result.error)}`);
  return body.result;
}
const account = (account_id: string) => rpc({ request_type: "view_account", account_id });
const keys = async (account_id: string) => (await rpc({ request_type: "view_access_key_list", account_id })).keys as Key[];
async function view(account_id: string, method_name: string, args: object = {}) {
  const r = await rpc({ request_type: "call_function", account_id, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") });
  return JSON.parse(Buffer.from(r.result).toString());
}
const perm = (k: Key) => k.access_key.permission === "FullAccess" ? "FullAccess" : `FunctionCall ${k.access_key.permission.FunctionCall.receiver_id} [${k.access_key.permission.FunctionCall.method_names.join(", ") || "any method"}]`;

let failed = 0;
const check = (ok: boolean, line: string) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  ${line}`); };
const note = (line: string) => console.log(`NOTE  ${line}`);

console.log(`Familiar judge — ${ROOT} via ${RPC}\n`);

console.log("SELF  Mochi has no access keys and runs code pinned by hash");
const config = await view(ROOT, "get_config");
const pinned = config.pet_code_hash;
check(typeof pinned === "string" && /^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(pinned), `${ROOT} get_config.pet_code_hash = ${pinned}`);
const supply = Number(await view(ROOT, "nft_total_supply"));
const pets: string[] = [];
for (let i = 0; i < supply; i += 50) pets.push(...(await view(ROOT, "nft_tokens", { from_index: String(i), limit: 50 })).map((t: { token_id: string }) => t.token_id));
check(supply > 0 && pets.length === supply, `${ROOT} has ${supply} pets; checking every one`);
for (const pet of pets) {
  const [a, k, token] = await Promise.all([account(pet), keys(pet), view(ROOT, "nft_token", { token_id: pet })]);
  check(k.length === 0, `${pet} has ${k.length} access keys`);
  check(typeof pinned === "string" && a.global_contract_hash === pinned && a.code_hash === "11111111111111111111111111111111", `${pet} runs global code ${a.global_contract_hash} (no local code)`);
  check(token?.owner_id !== undefined, `${pet} papers on ${ROOT}: owned by ${token?.owner_id}`);
}

console.log("\nREFEREE  Ledger state left by replayed courts (the replay rule itself is source, checked by make break)");
const protocol = await view(ROOT, "tidebound_protocol");
note(`rules ${protocol.rules_version}, content ${protocol.content_version}, items ${protocol.items}`);
const journey = await view(ROOT, "tidebound_journey", { account_id: PLAYER });
check(journey.claims.length > 0, `${PLAYER} has ${journey.claims.length} accepted claims: ${journey.claims.map((c: { id: string }) => c.id).join(", ")}`);
check(journey.commission_fulfilled && journey.shells + journey.burned_shells === 12, `${PLAYER} was granted 12 Shells once (${journey.shells} held, ${journey.burned_shells} spent)`);
note("This is a snapshot of state, not proof of the deployed code: deployed root code is reported below and does not match the HEAD build recorded in docs/FAMILIAR-GAMEPLAY.json.");
note("Replay proves the steps are legal and bring Mochi home, not that a person played them; see docs/THREAT-MODEL.md.");

console.log("\nKEY  What the player's key can do (reported, not claimed)");
for (const k of await keys(PLAYER)) note(`${PLAYER} ${k.public_key.slice(0, 16)}… ${perm(k)}`);
note("Who holds the key (Privy) is not visible on chain; it comes from the source (web/src/account/privy-adapter.ts). The method limit is in Familiar's signer (services/relayer/src/auth/sign.ts), not on chain.");

console.log("\nSEASON  Season 2 shelf runs the reviewed code (state only; no trade claimed)");
const SEASON = `season.${ROOT}`;
const SEASON_CODE = process.env.JUDGE_SEASON_CODE ?? "3FbynwMm2uWs8bahXSCoqDdrKsEJ1on6rR1C277hXNzy";
const seasonAccount = await account(SEASON);
check(seasonAccount.code_hash === SEASON_CODE, `${SEASON} runs ${seasonAccount.code_hash} (built by scripts/build-contracts.sh on feat/season-two)`);
const shelf = await view(SEASON, "get_shelf");
note(`Bram's till ${shelf.till} Shells; ${shelf.goods.map((g: { good: string; stock: number; buy_price: number }) => `${g.good} ${g.stock} @ ${g.buy_price}`).join(", ")}`);

console.log("\nADMIN  Keys that still control the stack (disclosed)");
for (const id of [ROOT, ITEMS, `season.${ROOT}`]) {
  const [a, k] = await Promise.all([account(id), keys(id)]);
  note(`${id} code ${a.code_hash}; keys: ${k.map(x => `${x.public_key.slice(0, 16)}… ${perm(x)}`).join("; ")}`);
}

console.log(`\n${failed ? `${failed} check(s) failed` : "All checks passed"}.`);
process.exit(failed ? 1 : 0);

export {};
