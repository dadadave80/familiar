import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import {
  Account,
  actions,
  baseEncode,
  JsonRpcProvider,
  KeyPair,
  nearToYocto,
  teraToGas,
  type KeyPairString,
} from "near-api-js";
import { savings } from "../web/src/near";
import { accountId } from "../services/relayer/src/relay";
import { assertQuoteKey } from "./deployment";

if (process.env.NEAR_NETWORK !== "testnet")
  throw new Error("Deployment accepts NEAR_NETWORK=testnet only.");
const rootId = process.env.NEAR_ROOT;
const rootSecret = process.env.ROOT_PRIVATE_KEY;
const pool = process.env.STAKING_POOL;
if (
  !accountId(rootId) ||
  !rootId.endsWith(".testnet") ||
  rootId.length > 39 ||
  !rootSecret ||
  !pool
)
  throw new Error(
    "Configure project testnet root key and verified STAKING_POOL in .env.",
  );
function devKey(name: string) {
  try {
    const value = process.env[name];
    if (!value) throw new Error();
    return KeyPair.fromString(value as KeyPairString);
  } catch {
    throw new Error(`Missing or invalid ${name}; no key value was printed.`);
  }
}
const rootPair = devKey("ROOT_PRIVATE_KEY"),
  relayerPair = devKey("RELAYER_PRIVATE_KEY"),
  npcAdminPair = devKey("NPC_ADMIN_PRIVATE_KEY"),
  npcPair = devKey("NPC_PRIVATE_KEY");
if (
  process.env.RELAYER_ID !== `relayer.${rootId}` ||
  process.env.NPC_ID !== `bram.${rootId}`
)
  throw new Error("Dev account IDs do not match this root.");
const rpc = new JsonRpcProvider({
  url: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
});
if ((await rpc.getNetworkId()) !== "testnet")
  throw new Error("Refusing a non-testnet RPC.");
const root = new Account(rootId, rpc, rootSecret as KeyPairString);
const wasm = async (name: string) =>
  new Uint8Array(
    await Bun.file(
      `contracts/target/deploy/familiar_${name}.wasm`,
    ).arrayBuffer(),
  );
const names = ["root", "items", "bakery", "market"] as const;
const code: Record<string, Uint8Array> = {};
for (const name of [...names, "pet"]) code[name] = await wasm(name);
const hash = (bytes: Uint8Array) =>
  baseEncode(createHash("sha256").update(bytes).digest());
const rootBalance = await rpc.viewAccount({ accountId: rootId });
const desiredConfig = {
  relayer: `relayer.${rootId}`,
  pet_code_hash: hash(code.pet),
  items: `items.${rootId}`,
  bakery: `bakery.${rootId}`,
  market: `market.${rootId}`,
  pool,
};
const plans = [
  { name: "relayer", amount: nearToYocto("2"), key: relayerPair },
  { name: "bram", amount: nearToYocto("1.2"), key: npcAdminPair },
  ...[1, 2, 3, 4].map((n) => ({
    name: `den-${n}`,
    amount: nearToYocto("0.01"),
    key: rootPair,
  })),
  ...["items", "bakery", "market"].map((name) => ({
    name,
    amount: BigInt(code[name].length) * 10n ** 19n + nearToYocto("0.5"),
    key: rootPair,
  })),
];
const prior = new Map<string, Awaited<ReturnType<typeof exists>>>();
let required = nearToYocto("3");
for (const plan of [{ name: "root", amount: 0n, key: rootPair }, ...plans]) {
  const id = plan.name === "root" ? rootId : `${plan.name}.${rootId}`;
  const info = await exists(id);
  prior.set(id, info);
  if (!info) {
    required += plan.amount;
    continue;
  }
  const access = await rpc.viewAccessKey({
    accountId: id,
    publicKey: plan.key.getPublicKey(),
  });
  if (access.permission !== "FullAccess")
    throw new Error(`Expected project administrative key at ${id}.`);
  if (
    code[plan.name] &&
    info.code_hash !== "11111111111111111111111111111111" &&
    info.code_hash !== hash(code[plan.name])
  )
    throw new Error(`Refusing to overwrite different code at ${id}.`);
  if (
    plan.name !== "root" &&
    info.code_hash === "11111111111111111111111111111111" &&
    info.amount < plan.amount
  )
    required += plan.amount - info.amount;
}
if (rootBalance.code_hash !== "11111111111111111111111111111111") {
  const current = await rpc.callFunction<Record<string, string>>({
    contractId: rootId,
    method: "get_config",
    args: {},
  });
  if (
    !current ||
    Object.entries(desiredConfig).some(([key, value]) => current[key] !== value)
  )
    throw new Error(
      "Existing root configuration does not match this deployment.",
    );
} else required += BigInt(code.root.length) * 10n ** 19n;
if (prior.get(`bram.${rootId}`)) {
  const keys = await rpc.viewAccessKeyList({ accountId: `bram.${rootId}` });
  const quoteKey = keys.keys.find(
    (k) => k.public_key === npcPair.getPublicKey().toString(),
  );
  if (quoteKey)
    assertQuoteKey(quoteKey.access_key.permission, `market.${rootId}`);
}
let globalExists = false;
try {
  const published = await rpc.viewGlobalContractCode({
    identifier: { codeHash: hash(code.pet) },
    blockQuery: { finality: "final" },
  });
  if (hash(published.code) !== hash(code.pet))
    throw new Error("Global code hash mismatch.");
  globalExists = true;
} catch (error) {
  if (
    !(error instanceof Error) ||
    error.name !== "GlobalContractCodeDoesNotExistError"
  )
    throw error;
}
if (!globalExists) required += BigInt(code.pet.length) * 10n ** 20n;
const available =
  rootBalance.amount - BigInt(rootBalance.storage_usage) * 10n ** 19n;
console.info(
  `Testnet preflight: ${rootId}; liquid ${savings(available.toString())}; remaining deployment estimate ${savings(required.toString())} NEAR.`,
);
if (process.argv.includes("--check"))
  process.exit(available >= required ? 0 : 2);
if (available < required)
  throw new Error(
    "Top up this testnet dev account before deployment; no deployment action was signed.",
  );
const validator = (await rpc.viewValidators()).current_validators.find(
  (v) => v.account_id === pool && !v.is_slashed,
);
if (!validator)
  throw new Error(
    "STAKING_POOL is not an active testnet validator. Reverify before deployment.",
  );
await rpc.callFunction({
  contractId: pool,
  method: "get_account_staked_balance",
  args: { account_id: rootId },
});
let evidence: { method: string; account: string; hash: string }[] = [];
if (await Bun.file(".data/deploy-evidence.json").exists()) {
  const previous = await Bun.file(".data/deploy-evidence.json").json();
  if (
    previous.network !== "testnet" ||
    previous.root !== rootId ||
    previous.petHash !== hash(code.pet) ||
    !Array.isArray(previous.transactions)
  )
    throw new Error(
      "Existing deployment evidence belongs to a different build; preserve it before proceeding.",
    );
  evidence = previous.transactions;
}
await mkdir(".data", { recursive: true });
async function record(
  method: string,
  account: string,
  result: Awaited<ReturnType<Account["signAndSendTransaction"]>>,
) {
  evidence.push({ method, account, hash: result.transaction.hash });
  await Bun.write(
    ".data/deploy-evidence.json",
    JSON.stringify(
      {
        network: "testnet",
        root: rootId,
        petHash: hash(code.pet),
        transactions: evidence,
      },
      null,
      2,
    ),
  );
  console.info(
    `${method}: https://testnet.nearblocks.io/txns/${result.transaction.hash}`,
  );
}
async function exists(account: string) {
  try {
    return await rpc.viewAccount({ accountId: account });
  } catch (error) {
    if (/UNKNOWN_ACCOUNT|does not exist/i.test(String(error))) return null;
    throw error;
  }
}
async function ensure(name: string, amount: bigint, secret: string) {
  const id = `${name}.${rootId}`;
  const existing = prior.get(id);
  if (!existing)
    await record(
      "create_account",
      id,
      await root.signAndSendTransaction({
        receiverId: id,
        actions: [
          actions.createAccount(),
          actions.transfer(amount),
          actions.addFullAccessKey(
            KeyPair.fromString(secret as KeyPairString).getPublicKey(),
          ),
        ],
        waitUntil: "FINAL",
      }),
    );
  else if (
    existing.code_hash === "11111111111111111111111111111111" &&
    existing.amount < amount
  )
    await record(
      "fund_account",
      id,
      await root.signAndSendTransaction({
        receiverId: id,
        actions: [actions.transfer(amount - existing.amount)],
        waitUntil: "FINAL",
      }),
    );
  return new Account(id, rpc, secret as KeyPairString);
}
const relayerSecret = process.env.RELAYER_PRIVATE_KEY,
  npcAdminSecret = process.env.NPC_ADMIN_PRIVATE_KEY,
  npcSecret = process.env.NPC_PRIVATE_KEY;
if (!relayerSecret || !npcAdminSecret || !npcSecret)
  throw new Error(
    "Missing project dev keys; setup never invents a replacement for existing .env.",
  );
const relayer = await ensure("relayer", nearToYocto("2"), relayerSecret);
const npc = await ensure("bram", nearToYocto("1.2"), npcAdminSecret);
const dens: Account[] = [];
for (let n = 1; n <= 4; n++)
  dens.push(await ensure(`den-${n}`, nearToYocto("0.01"), rootSecret));
if (!globalExists)
  await record(
    "publish_global_pet",
    rootId,
    await root.signAndSendTransaction({
      receiverId: rootId,
      actions: [actions.deployGlobalContract(code.pet, "codeHash")],
      waitUntil: "FINAL",
    }),
  );
const buildingAccounts: Record<string, Account> = {};
for (const name of ["items", "bakery", "market"])
  buildingAccounts[name] = await ensure(
    name,
    BigInt(code[name].length) * 10n ** 19n + nearToYocto("0.5"),
    rootSecret,
  );
const initializers: Record<string, Record<string, unknown>> = {
  items: {
    registry: rootId,
    bakery: `bakery.${rootId}`,
    market: `market.${rootId}`,
  },
  bakery: { items: `items.${rootId}` },
  market: {
    registry: rootId,
    items: `items.${rootId}`,
    npc: npc.accountId,
    dens: dens.map((d) => d.accountId),
  },
  root: {
    relayer: relayer.accountId,
    pet_code_hash: hash(code.pet),
    items: `items.${rootId}`,
    bakery: `bakery.${rootId}`,
    market: `market.${rootId}`,
    pool,
  },
};
for (const name of ["items", "bakery", "market", "root"]) {
  const account = name === "root" ? root : buildingAccounts[name];
  const info = await rpc.viewAccount({ accountId: account.accountId });
  if (info.code_hash !== "11111111111111111111111111111111") {
    if (info.code_hash !== hash(code[name]))
      throw new Error(
        `Refusing to overwrite different code at ${account.accountId}.`,
      );
    console.info(
      `Existing matching contract: ${account.accountId}; initialization is not repeated.`,
    );
    continue;
  }
  await record(
    `deploy_${name}`,
    account.accountId,
    await account.signAndSendTransaction({
      receiverId: account.accountId,
      actions: [
        actions.deployContract(code[name]),
        actions.functionCall("new", initializers[name], teraToGas(80), 0n),
      ],
      waitUntil: "FINAL",
    }),
  );
}
const npcPublic = KeyPair.fromString(npcSecret as KeyPairString).getPublicKey();
const access = await rpc.viewAccessKeyList({ accountId: npc.accountId });
const existingNpcKey = access.keys.find(
  (k) => k.public_key === npcPublic.toString(),
);
if (existingNpcKey)
  assertQuoteKey(existingNpcKey.access_key.permission, `market.${rootId}`);
else
  await record(
    "bram_scoped_key",
    npc.accountId,
    await npc.signAndSendTransaction({
      receiverId: npc.accountId,
      actions: [
        actions.addFunctionCallAccessKey(
          npcPublic,
          `market.${rootId}`,
          ["set_quotes"],
          nearToYocto("1"),
        ),
      ],
      waitUntil: "FINAL",
    }),
  );
const verifiedNpcKey = await rpc.viewAccessKey({
  accountId: npc.accountId,
  publicKey: npcPublic,
});
assertQuoteKey(verifiedNpcKey.permission, `market.${rootId}`);
const npcState = await rpc.callFunction<{ balance: string }>({
  contractId: `market.${rootId}`,
  method: "get_npc",
  args: {},
});
if (npcState?.balance === "0")
  await record(
    "npc_deposit",
    `market.${rootId}`,
    await npc.callFunctionRaw({
      contractId: `market.${rootId}`,
      methodName: "npc_deposit",
      args: {},
      deposit: nearToYocto("1"),
      gas: teraToGas(30),
      waitUntil: "FINAL",
    }),
  );
console.info(
  `Deployed ${rootId}. Verify restricted key read-back and run e2e before claiming a live demo.`,
);
