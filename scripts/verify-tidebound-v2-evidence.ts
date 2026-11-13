import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { actions, createTransaction, PublicKey, baseDecode, baseEncode, base64Decode, encodeTransaction } from "near-api-js";
import { verifyFinalOutcome } from "./tidebound-live";
import { assertV2QAIntent } from "./tidebound-v2-live";

// Verify the recorded proof without querying the network, reading keys or signing.
const report = JSON.parse(await readFile(new URL("../docs/TIDEBOUND-V2-GAMEPLAY.json", import.meta.url), "utf8"));
assert.equal(report.kind, "independently-verified-live-v2-operator-acceptance");
assert.equal(report.network, "testnet");
assert.equal(report.transactions.length, 15);
assert.equal(new Set(report.transactions.map((entry: { hash: string }) => entry.hash)).size, 15);
const receiptIds = report.transactions.flatMap((entry: { fullFinalOutcome: { receipts_outcome: { id: string }[] } }) => entry.fullFinalOutcome.receipts_outcome.map(receipt => receipt.id));
assert.equal(receiptIds.length, 58);
assert.equal(new Set(receiptIds).size, 58);

for (const entry of report.transactions) {
  const actual = entry.fullFinalOutcome.transaction;
  assert.equal(actual.actions.length, 1);
  const call = actual.actions[0].FunctionCall;
  assert(call);
  const publicKey = PublicKey.fromString(actual.public_key);
  const transaction = createTransaction(
    actual.signer_id, publicKey, actual.receiver_id, BigInt(actual.nonce),
    [actions.functionCall(call.method_name, base64Decode(call.args), BigInt(call.gas), BigInt(call.deposit))],
    baseDecode(entry.recentBlockHash),
  );
  const digest = createHash("sha256").update(encodeTransaction(transaction)).digest();
  assert.equal(baseEncode(digest), entry.hash);
  assert.equal(actual.hash, entry.hash);
  assert(actual.signature.startsWith("ed25519:"));
  assert(publicKey.verify(digest, baseDecode(actual.signature.slice(8))));
  assertV2QAIntent(transaction, entry.name, report.actors.makerPublicKey);
  verifyFinalOutcome(entry.fullFinalOutcome, { hash: entry.hash, signer: entry.signer, receiver: entry.receiver });
}

console.info("Verified 15 canonical hashes/signatures and recorded FINAL receipt graphs offline. No RPC, private keys or signing.");
