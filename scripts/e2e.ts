import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { confirmedValue } from "../services/relayer/src/outcome";
import { assertStakedPrincipal } from "./staking";
import {
  Account,
  actions,
  base64Encode,
  encodeSignedDelegate,
  JsonRpcProvider,
  KeyPair,
  nearToYocto,
  teraToGas,
  type KeyPairString,
} from "near-api-js";

const base = (process.env.PUBLIC_RELAYER_URL ?? "").replace(/\/$/, "");
const withdraw = process.argv.includes("--withdraw");
if (!withdraw && (await Bun.file(".env.e2e").exists()))
  throw new Error(
    ".env.e2e already exists; preserve that guest and resume it before starting another live run.",
  );
if (!/^https:\/\//.test(base))
  throw new Error(
    "Set PUBLIC_RELAYER_URL to the deployed Post Office HTTPS endpoint. This command never substitutes fixtures or sandbox results.",
  );
const rpc = new JsonRpcProvider({
  url: process.env.NEAR_RPC_URL ?? "https://test.rpc.fastnear.com",
});
if ((await rpc.getNetworkId()) !== "testnet")
  throw new Error("Refusing a non-testnet RPC.");
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      `${data.code ?? response.status}: ${data.error ?? "Post Office unavailable"}`,
    );
  return data;
}
const healthResponse = await fetch(`${base}/health`, {
  signal: AbortSignal.timeout(15_000),
});
const health = (await healthResponse.json()) as {
  root: string;
  network: string;
  ready: boolean;
};
assert(
  healthResponse.ok && health.ready && health.network === "testnet",
  "Public Post Office must pass live readiness",
);
const privateKey = withdraw
  ? process.env.E2E_PRIVATE_KEY
  : KeyPair.fromRandom("ed25519").toString();
if (!privateKey)
  throw new Error(
    "Resume with bun --env-file=.env.e2e scripts/e2e.ts --withdraw.",
  );
const key = KeyPair.fromString(privateKey as KeyPairString);
const pet = withdraw
  ? process.env.E2E_PET_ID!
  : `judge-${crypto.randomUUID().slice(0, 8)}.${health.root}`;
assert(
  pet.endsWith(`.${health.root}`),
  "Saved pet must belong to this testnet deployment",
);
const env = `E2E_PRIVATE_KEY=${key.toString()}\nE2E_PET_ID=${pet}\nPUBLIC_RELAYER_URL=${base}\n`;
if (!withdraw) await writeFile(".env.e2e", env, { flag: "wx", mode: 0o600 });
const guest = withdraw
  ? {
      accountId: await rpc.callFunction<string>({
          contractId: health.root,
          method: "get_player",
          args: { public_key: key.getPublicKey().toString() },
        }),
    }
  : await post<{ accountId: string }>("/v1/guest", {
      publicKey: key.getPublicKey().toString(),
    });
assert(
  guest.accountId,
  "Guest account is not registered yet. Its private pass remains saved.",
);
const player = new Account(guest.accountId, rpc, key.toString());
const config = await rpc.callFunction<{
  items: string;
  pool: string;
  relayer: string;
}>({ contractId: health.root, method: "get_config", args: {} });
assert(config);
const relayerId = config.relayer;
const evidence: { method: string; hash: string }[] = [];
async function call(method: string, args: Record<string, unknown>) {
  const { signedDelegate } = await player.createSignedMetaTransaction({
    receiverId: health.root,
    actions: [actions.functionCall(method, args, teraToGas(280), 0n)],
    blockHeightTtl: 120,
  });
  const delivered = await post<{
    hash: string;
    receiptSentenceKey: string;
    value: unknown;
  }>("/v1/relay", {
    signedDelegate: base64Encode(encodeSignedDelegate(signedDelegate)),
  });
  assert.match(delivered.hash, /^[1-9A-HJ-NP-Za-km-z]{32,64}$/);
  const outcome = await rpc.viewTransactionStatus({
    txHash: delivered.hash,
    accountId: relayerId,
    waitUntil: "FINAL",
  });
  assert.deepEqual(
    confirmedValue(outcome, health.root, method),
    delivered.value,
    "public RPC must independently confirm the relayer response",
  );
  evidence.push({
    method:
      method === "act"
        ? String((args.action as { kind: string }).kind)
        : method,
    hash: delivered.hash,
  });
  console.info(
    `${method}: https://testnet.nearblocks.io/txns/${delivered.hash}`,
  );
  return delivered.value;
}
const act = (action: Record<string, unknown>) =>
  call("act", { token_id: pet, action });
await mkdir(".data", { recursive: true });
if (withdraw) {
  const epoch = await rpc.callFunction<string>({
    contractId: health.root,
    method: "get_epoch",
    args: {},
  });
  const state = await rpc.callFunction<{ unstaking_epoch: string | null }>({
    contractId: pet,
    method: "get_state",
    args: {},
  });
  if (!state?.unstaking_epoch)
    throw new Error("No pending testnet unbonding operation for this pet.");
  if (BigInt(epoch ?? "0") < BigInt(state.unstaking_epoch)) {
    console.info(
      `Real testnet unbonding is pending: epoch ${epoch}, unlock ${state.unstaking_epoch}. No withdrawal was signed.`,
    );
    process.exit(2);
  }
  assert.equal(await act({ kind: "withdraw" }), true);
} else {
  assert.equal(await call("adopt", { name: pet.split(".")[0] }), pet);
  assert.equal(
    (await rpc.viewAccessKeyList({ accountId: pet })).keys.length,
    0,
    "real testnet pet must be keyless",
  );
  assert.equal(await act({ kind: "feed" }), true);
  assert.equal(await act({ kind: "forage", spot: "mill" }), true);
  assert(
    BigInt(
      (await rpc.callFunction<string>({
        contractId: config.items,
        method: "mt_balance_of",
        args: { account_id: pet, token_id: "flour" },
      })) ?? "0",
    ) > 0n,
  );
  if (process.argv.includes("--stake")) {
    assert.equal(
      await act({ kind: "sleep", amount: nearToYocto("0.01").toString() }),
      true,
    );
    assertStakedPrincipal(
      await rpc.callFunction({
        contractId: config.pool,
        method: "get_account",
        args: { account_id: pet },
      }),
      nearToYocto("0.01"),
    );
    assert.equal(await act({ kind: "wake" }), true);
    console.info(
      "Real testnet stake/unstake confirmed. Resume --withdraw after four actual pool epochs; this run does not claim withdrawal passed.",
    );
  }
}
await Bun.write(
  ".data/testnet-e2e.json",
  JSON.stringify(
    {
      network: "testnet",
      root: health.root,
      pet,
      at: new Date().toISOString(),
      evidence,
    },
    null,
    2,
  ),
);
console.info(
  "Requested live checks confirmed; private guest pass retained in ignored .env.e2e. The complete gameplay loop is a separate sandbox check.",
);
