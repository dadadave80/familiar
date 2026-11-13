import { expect, test } from "bun:test";
import { actions, createTransaction, PublicKey, teraToGas } from "near-api-js";
import { assertGameIntent, verifyFinalOutcome } from "./game-evidence";

const report = await Bun.file(new URL("../docs/FAMILIAR-GAMEPLAY.json", import.meta.url)).json();
const QA_ROOT = "familiar-game.testnet";
const maker = `qa-maker-v2.${QA_ROOT}`;

test("the recorded adoption must use its original actor, method, arguments, gas and deposit", () => {
  const key = PublicKey.fromString(report.actors.makerPublicKey);
  function adopt(signer = maker, method = "adopt", name = "qa-mochi-v2", gas = teraToGas(180), deposit = 0n) {
    return createTransaction(
      signer,
      key,
      QA_ROOT,
      1n,
      [actions.functionCall(method, { name }, gas, deposit)],
      new Uint8Array(32),
    );
  }
  expect(() => assertGameIntent(adopt(), "adopt", key.toString())).not.toThrow();
  const impostors = [
    adopt(`qa-holder-h1.${QA_ROOT}`),
    adopt(maker, "create_named_player"),
    adopt(maker, "adopt", "another-pet"),
    adopt(maker, "adopt", "qa-mochi-v2", teraToGas(179)),
    adopt(maker, "adopt", "qa-mochi-v2", teraToGas(180), 1n),
  ];
  for (const tx of impostors) expect(() => assertGameIntent(tx, "adopt", key.toString())).toThrow();
});

test("the recorded game fixes return commands, personal origin, holder and storage budget", () => {
  const key = PublicKey.fromString(report.actors.makerPublicKey);
  const steps = ["first-finds", "wind-goal", "gift", "v1-original-retry", "recipient-storage"] as const;
  for (const step of steps) {
    const record = report.transactions.find((entry: { name: string }) => entry.name === step);
    const actual = record.fullFinalOutcome.transaction;
    const call = actual.actions[0].FunctionCall;
    const args = JSON.parse(Buffer.from(call.args, "base64").toString("utf8"));
    function transaction(deposit = BigInt(call.deposit)) {
      return createTransaction(actual.signer_id, key, actual.receiver_id, 1n, [
        actions.functionCall(call.method_name, args, BigInt(call.gas), deposit),
      ], new Uint8Array(32));
    }
    expect(() => assertGameIntent(transaction(), step, key.toString())).not.toThrow();
    if (step === "recipient-storage") {
      expect(() => assertGameIntent(transaction(2000000000000000000001n), step, key.toString())).toThrow();
    } else {
      if (step === "first-finds" || step === "wind-goal") args.commands = ["return"];
      else if (step === "v1-original-retry") args.origin_claim_id = "b".repeat(64);
      else args.receiver_id = maker;
      expect(() => assertGameIntent(transaction(), step, key.toString())).toThrow();
    }
  }
});

test("only the exact final transaction and specifically expected rejection can settle durable evidence", () => {
  const expected = { hash: "known-hash", signer: maker, receiver: `items.${QA_ROOT}` };
  const success = {
    final_execution_status: "FINAL",
    transaction: { hash: expected.hash, signer_id: maker, receiver_id: expected.receiver },
    status: { SuccessValue: "" },
    transaction_outcome: {
      id: expected.hash,
      outcome: { executor_id: maker, receipt_ids: ["execution"], status: { SuccessReceiptId: "execution" } },
    },
    receipts_outcome: [{
      id: "execution",
      outcome: { executor_id: expected.receiver, receipt_ids: [], status: { SuccessValue: "" } },
    }],
  };
  expect(() => verifyFinalOutcome(success, expected)).not.toThrow();
  const execution = success.receipts_outcome[0]!;
  const missingChild = { ...execution, outcome: { ...execution.outcome, receipt_ids: ["absent-child"] } };
  expect(() => verifyFinalOutcome({ ...success, receipts_outcome: [missingChild] }, expected)).toThrow();
  const orphan = { ...execution, id: "unreachable-sibling" };
  expect(() => verifyFinalOutcome({ ...success, receipts_outcome: [execution, orphan] }, expected)).toThrow();
  expect(() => verifyFinalOutcome({ ...success, status: { SuccessValue: "d3Jvbmc=" } }, expected)).toThrow();
  for (
    const changed of [{ ...success, final_execution_status: "EXECUTED_OPTIMISTIC" }, {
      ...success,
      transaction: { ...success.transaction, hash: "wrong" },
    }, { ...success, transaction: { ...success.transaction, signer_id: `qa-holder-h1.${QA_ROOT}` } }]
  ) expect(() => verifyFinalOutcome(changed, expected)).toThrow();
  const rejection = {
    ...success,
    status: { Failure: { ActionError: "Balance of the sender is insufficient" } },
    receipts_outcome: [{
      id: "execution",
      outcome: {
        executor_id: expected.receiver, receipt_ids: [],
        status: { Failure: { ActionError: "Balance of the sender is insufficient" } },
      },
    }],
  };
  expect(() => verifyFinalOutcome(rejection, expected, /Balance of the sender is insufficient/)).not
    .toThrow();
  expect(() => verifyFinalOutcome(rejection, expected)).toThrow();
  expect(() =>
    verifyFinalOutcome(
      {
        ...rejection,
        receipts_outcome: [{
          id: "execution",
          outcome: {
            executor_id: expected.receiver, receipt_ids: [],
            status: { Failure: { ActionError: "Exceeded the prepaid gas" } },
          },
        }],
      },
      expected,
      /Balance of the sender is insufficient/,
    )
  ).toThrow();
  expect(() => verifyFinalOutcome(success, expected, /ERR_APPEARANCE/)).toThrow();
  const rootPolish = { ...expected, receiver: QA_ROOT };
  const rootPrecheck = {
    ...success,
    transaction: { ...success.transaction, receiver_id: QA_ROOT },
    status: { Failure: { ActionError: "ERR_ITEM" } },
    receipts_outcome: [{
      id: "execution",
      outcome: { executor_id: QA_ROOT, receipt_ids: [], status: { Failure: { ActionError: "ERR_ITEM" } } },
    }],
  };
  expect(() => verifyFinalOutcome(rootPrecheck, rootPolish, /ERR_APPEARANCE/, `items.${QA_ROOT}`)).toThrow();
  const itemFence = {
    ...success,
    transaction: { ...success.transaction, receiver_id: QA_ROOT },
    receipts_outcome: [
      { id: "execution", outcome: { executor_id: QA_ROOT, receipt_ids: ["callback", "item-rejection"], status: { SuccessReceiptId: "callback" } } },
      { id: "callback", outcome: { executor_id: QA_ROOT, receipt_ids: [], status: { SuccessValue: "" } } },
      {
        id: "item-rejection",
        outcome: { executor_id: `items.${QA_ROOT}`, receipt_ids: [], status: { Failure: { ActionError: "ERR_APPEARANCE" } } },
      },
    ],
  };
  expect(() => verifyFinalOutcome(itemFence, rootPolish, /ERR_APPEARANCE/, `items.${QA_ROOT}`)).not.toThrow();
  for (
    const receipts_outcome of [
      [],
      [{ id: "execution", outcome: { executor_id: expected.receiver, receipt_ids: [], status: "Unknown" } }],
      [{ id: "execution", outcome: { executor_id: expected.receiver } }],
      [{
        id: "execution",
        outcome: { executor_id: expected.receiver, receipt_ids: [], status: { SuccessReceiptId: "absent" } },
      }],
      [{
        id: "execution",
        outcome: { executor_id: expected.receiver, receipt_ids: [], status: { SuccessReceiptId: "execution" } },
      }],
      [...success.receipts_outcome, ...success.receipts_outcome],
    ]
  ) expect(() => verifyFinalOutcome({ ...success, receipts_outcome }, expected)).toThrow();
  expect(() => verifyFinalOutcome({ ...success, transaction_outcome: undefined }, expected)).toThrow();
  expect(() =>
    verifyFinalOutcome({
      ...success,
      transaction_outcome: {
        ...success.transaction_outcome,
        outcome: { executor_id: maker, status: { Failure: { ActionError: "transaction failed" } } },
      },
    }, expected)
  ).toThrow();
  expect(() =>
    verifyFinalOutcome(
      {
        ...itemFence,
        receipts_outcome: [...itemFence.receipts_outcome, {
          id: "unknown-sibling",
          outcome: { executor_id: QA_ROOT, receipt_ids: [], status: "Unknown" },
        }],
      },
      rootPolish,
      /ERR_APPEARANCE/,
      `items.${QA_ROOT}`,
    )
  ).toThrow();
});
