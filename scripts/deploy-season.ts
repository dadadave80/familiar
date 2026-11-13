// Deploys the Season 2 contract to season.familiar-game.testnet. Testnet only.
// Usage: bun --env-file=.env.tidebound scripts/deploy-season.ts <expected-code-hash>
// Root only creates the account (0.05 NEAR) so live adoption and crafting keep their reserve;
// a fresh faucet account pays for code storage. No key value is ever printed.
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { Account, actions, baseEncode, JsonRpcProvider, KeyPair, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";

const ROOT = "familiar-game.testnet";
const SEASON = `season.${ROOT}`;
const expected = process.argv[2];
if (process.env.NEAR_NETWORK !== "testnet" || process.env.NEAR_ROOT !== ROOT) throw new Error(`Needs NEAR_NETWORK=testnet and NEAR_ROOT=${ROOT}.`);
const secret = process.env.ROOT_PRIVATE_KEY as KeyPairString | undefined;
if (!secret) throw new Error("Missing ROOT_PRIVATE_KEY; no key value was printed.");
const rpc = new JsonRpcProvider({ url: "https://test.rpc.fastnear.com" });
if ((await rpc.getNetworkId()) !== "testnet") throw new Error("Refusing a non-testnet RPC.");

const code = new Uint8Array(await Bun.file("contracts/target/deploy/familiar_season.wasm").arrayBuffer());
const codeHash = baseEncode(createHash("sha256").update(code).digest());
if (codeHash !== expected) throw new Error(`Built wasm ${codeHash} is not the expected ${expected}.`);

const evidence: { step: string; account: string; hash: string }[] = [];
await mkdir(".data", { recursive: true });
async function record(step: string, account: string, result: Awaited<ReturnType<Account["signAndSendTransaction"]>>) {
  evidence.push({ step, account, hash: result.transaction.hash });
  await Bun.write(".data/season-deploy-evidence.json", JSON.stringify({ network: "testnet", season: SEASON, codeHash, transactions: evidence }, null, 2));
  console.info(`${step}: https://testnet.nearblocks.io/txns/${result.transaction.hash}`);
}
const balance = async (id: string) => {
  try { return (await rpc.viewAccount({ accountId: id })).amount; }
  catch (e) { if (/UNKNOWN_ACCOUNT|does not exist/i.test(String(e))) return null; throw e; }
};

const root = new Account(ROOT, rpc, secret);
const rootKey = KeyPair.fromString(secret).getPublicKey();
if ((await balance(SEASON)) === null)
  await record("create_account", SEASON, await root.signAndSendTransaction({ receiverId: SEASON, actions: [actions.createAccount(), actions.transfer(nearToYocto("0.05")), actions.addFullAccessKey(rootKey)], waitUntil: "FINAL" }));

const need = nearToYocto("3");
const have = (await balance(SEASON)) ?? 0n;
if (have < need) {
  const funderId = `familiar-season-fund-${Date.now().toString(36)}.testnet`;
  const funderKey = KeyPair.fromRandom("ed25519");
  const p = Bun.spawn(["near", "account", "create-account", "sponsor-by-faucet-service", funderId, "use-manually-provided-public-key", funderKey.getPublicKey().toString(), "network-config", "testnet", "create"], { stdout: "inherit", stderr: "inherit" });
  if ((await p.exited) !== 0) throw new Error("Faucet account creation failed.");
  for (let i = 0; i < 20 && !(await balance(funderId)); i++) await Bun.sleep(1500);
  const funder = new Account(funderId, rpc, funderKey.toString() as KeyPairString);
  await record("fund_from_faucet_account", SEASON, await funder.signAndSendTransaction({ receiverId: SEASON, actions: [actions.transfer(need - have)], waitUntil: "FINAL" }));
}

const season = new Account(SEASON, rpc, secret);
const state = await rpc.viewAccount({ accountId: SEASON });
if (state.code_hash === codeHash) console.info("Code already deployed.");
else if (state.code_hash === "11111111111111111111111111111111")
  await record("deploy_and_init", SEASON, await season.signAndSendTransaction({ receiverId: SEASON, actions: [actions.deployContract(code), actions.functionCall("new", { root: ROOT }, teraToGas(50), 0n)], waitUntil: "FINAL" }));
else throw new Error(`${SEASON} already runs other code ${state.code_hash}; not overwriting.`);

const after = await rpc.viewAccount({ accountId: SEASON });
if (after.code_hash !== codeHash) throw new Error(`Deployed code ${after.code_hash} does not match ${codeHash}.`);
console.info(`${SEASON} runs ${after.code_hash}; shelf:`, JSON.stringify(await rpc.callFunction({ contractId: SEASON, method: "get_shelf", args: {} })));
