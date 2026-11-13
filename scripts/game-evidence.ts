import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { type JsonRpcProvider, nearToYocto, teraToGas, type Transaction } from "near-api-js";
import fixtures from "../contracts/common/fixtures/court.json";
import { replayCourt } from "../web/src/expedition/engine";
import type { BankedItem } from "../web/src/expedition/types";
import { finalReceiptFailure, nativeGas } from "../web/src/tidebound/client";
import { validateNativeIntent } from "../services/relayer/src/auth/sign";

const ROOT = "familiar-game.testnet";
const ITEMS = `items.${ROOT}`;
const RULES = "tidebound_h1_v1";
const CONTENT = "first_light_v2";
const actors = {
  maker: `qa-maker-v2.${ROOT}`,
  pet: `qa-mochi-v2.${ROOT}`,
  holder: `qa-holder-h1.${ROOT}`,
  oldMaker: `qa-maker-h1.${ROOT}`,
  oldPet: `qa-mochi-h1.${ROOT}`,
  relayer: `relayer.${ROOT}`,
};
const recipientStorageCap = nearToYocto("0.002");
const originalOrigin = "8c5cbc6a02e6a0878b90723334c9e2e682e690a76758922ee445225a560072e5";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function recordedRoute(area: "beacon" | "wind", banked: readonly BankedItem[]) {
  const fixture = fixtures.cases.find((c) =>
    c.id === (area === "beacon" ? "beacon-rope-rescue" : "wind-rope-objective")
  );
  assert(fixture);
  const run = replayCourt({ area, tool: "rope", banked }, fixture.commands);
  assert(run && run.outcome === "returned" && run.resolve === 3);
  assert.deepEqual(run.cargo, area === "beacon" ? ["lens", "moth"] : ["vane"]);
  if (area === "wind") assert(run.commands.includes("turn:vane"));
  return run;
}
function recordedMint(origin: string) {
  const id = hash([
      "familiar.craft.v1",
      "testnet",
      ROOT,
      actors.maker,
      "first_light",
      "first_light_craft_credit",
    ]),
    token_id = `lantern:${hash(["familiar.item.v1", "testnet", ITEMS, ROOT, actors.maker, id])}`;
  return {
    id,
    token_id,
    maker: actors.maker,
    origin_claim_id: origin,
    motif: "moth",
    input_hash: hash([
      "familiar.mint.v1",
      "testnet",
      ITEMS,
      ROOT,
      actors.maker,
      id,
      token_id,
      origin,
      "first_light_lantern_v1",
      "moth",
      RULES,
      CONTENT,
    ]),
    rules_version: RULES,
    content_version: CONTENT,
  };
}
const methods: Record<string, string> = {
  "create-maker": "create_named_player",
  adopt: "adopt",
  "first-finds": "tidebound_claim",
  beacon: "tidebound_restore",
  "wind-goal": "tidebound_claim",
  signal: "tidebound_restore",
  commission: "tidebound_commission",
  craft: "tidebound_craft",
  polish: "tidebound_polish",
  "recipient-storage": "storage_deposit",
  gift: "mt_transfer",
  "recipient-place": "tidebound_place",
  "former-holder-place": "tidebound_place",
  "craft-after-gift": "tidebound_craft",
  "v1-original-retry": "tidebound_craft",
};
export function assertGameIntent(tx: Transaction, name: string, makerPublicKey: string) {
  const method = methods[name];
  assert(method, "This step is outside the recorded gameplay acceptance.");
  const call = tx.actions[0]?.functionCall;
  assert(tx.actions.length === 1 && call && call.methodName === method);
  const signer = name === "create-maker"
      ? actors.relayer
      : name === "recipient-place"
      ? actors.holder
      : name === "v1-original-retry"
      ? actors.oldMaker
      : actors.maker,
    receiver = ["recipient-storage", "gift"].includes(name) ? ITEMS : ROOT;
  assert.equal(tx.signerId, signer);
  assert.equal(tx.receiverId, receiver);
  assert.equal(call.gas, name === "create-maker" ? teraToGas(100) : nativeGas(method));
  const args = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(call.args)),
  ) as Record<string, unknown>;
  const sameArgs = (expected: Record<string, unknown>) => assert.deepEqual(args, expected);
  if (name === "create-maker") {
    assert.equal(call.deposit, 0n);
    sameArgs({ public_key: makerPublicKey, username: "qa-maker-v2" });
    return;
  }
  validateNativeIntent(tx, { root: ROOT, items: ITEMS });
  if (name === "adopt") sameArgs({ name: "qa-mochi-v2" });
  if (name === "first-finds" || name === "wind-goal") {
    const area = name === "first-finds" ? "beacon" : "wind",
      run = recordedRoute(area, area === "beacon" ? [] : ["lens", "moth"]);
    assert.equal(args.token_id, actors.pet);
    assert.equal(args.operation_id, `operator-v2:${name}`);
    assert.equal(args.content_version, CONTENT);
    assert.equal(args.rules_version, RULES);
    assert.equal(args.area, area);
    assert.equal(args.tool, "rope");
    assert.deepEqual(args.commands, run.commands);
    assert(/^[a-f0-9]{64}$/.test(args.initial_checkpoint_hash as string));
  }
  if (name === "beacon" || name === "signal") sameArgs({ restoration: name });
  if (name === "commission") sameArgs({});
  if (name === "craft" || name === "craft-after-gift") {
    assert.equal(args.token_id, actors.pet);
    assert.equal(args.motif, "moth");
    assert(/^[a-f0-9]{64}$/.test(args.origin_claim_id as string));
  }
  if (name === "v1-original-retry") {
    sameArgs({ token_id: actors.oldPet, motif: "crest", origin_claim_id: originalOrigin });
  }
  if (name === "recipient-storage") {
    sameArgs({ account_id: actors.holder, registration_only: false });
    assert(call.deposit > 0n && call.deposit <= recipientStorageCap);
  }
  if (name === "gift") {
    sameArgs({
      receiver_id: actors.holder,
      token_id: recordedMint("a".repeat(64)).token_id,
      amount: "1",
      approval: null,
      memo: null,
    });
    assert.equal(call.deposit, 1n);
  }
  if (name === "polish") sameArgs({ item_id: recordedMint("a".repeat(64)).token_id, expected_appearance: 0 });
  if (name === "recipient-place" || name === "former-holder-place") {
    assert.equal(args.item_id, recordedMint("a".repeat(64)).token_id);
    assert.equal(args.socket, name === "recipient-place" ? "porch" : "dock");
  }
}
type Outcome = Awaited<ReturnType<JsonRpcProvider["sendTransactionUntil"]>>;

const failure = (value: unknown): value is { Failure: unknown } =>
  !!value && typeof value === "object" && "Failure" in value;
export function verifyFinalOutcome(
  value: unknown,
  expected: { hash: string; signer: string; receiver: string },
  expectedFailure?: RegExp,
  failureExecutor = expected.receiver,
): asserts value is Outcome {
  const failedGraph = finalReceiptFailure(value, expected);
  const o = value as Outcome;
  assert(o.receipts_outcome?.length, "Full receipt evidence is required.");
  if (!expectedFailure) {
    assert(!failedGraph, "A receipt failed; preserve its evidence and stop.");
    return;
  }
  const failed = o.receipts_outcome.filter((r) => failure(r.outcome.status));
  assert(failed.length > 0, "The specifically expected rejection did not occur.");
  for (const r of failed) {
    assert.equal(r.outcome.executor_id, failureExecutor);
    assert(
      expectedFailure.test(JSON.stringify(r.outcome.status)),
      "An unrelated failure cannot pass a negative ownership test.",
    );
  }
  if (failure(o.status)) assert(expectedFailure.test(JSON.stringify(o.status)));
}
