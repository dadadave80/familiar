import { expect, test } from "bun:test";
import { confirmedValue } from "./outcome";
const root = "familiar.testnet";
const value = (value: unknown) => ({
  SuccessValue: btoa(JSON.stringify(value)),
});
const receipt = (id: string, executor_id: string, status: unknown) => ({
  id,
  outcome: { executor_id, status },
});
test("outer delegate success does not confirm an inner action", () => {
  expect(() =>
    confirmedValue(
      { status: { SuccessValue: "" }, receipts_outcome: [] },
      root,
      "act",
    ),
  ).toThrow("ERR_ACTION_FAILED");
});
test("follows returned receipts and ignores detached payout results", () => {
  const outcome = {
    status: { SuccessValue: "" },
    receipts_outcome: [
      receipt("start", root, { SuccessReceiptId: "callback" }),
      receipt("callback", root, value(true)),
      receipt("payout", "seller.testnet", {
        Failure: { error: "transfer rejected" },
      }),
      receipt("detached", root, value(false)),
    ],
  };
  expect(confirmedValue(outcome, root, "buy_pet")).toBe(true);
  expect(
    confirmedValue(
      {
        ...outcome,
        receipts_outcome: [
          receipt("start", root, { SuccessReceiptId: "mint" }),
          receipt("mint", root, value(`mochi.${root}`)),
        ],
      },
      root,
      "adopt",
    ),
  ).toBe(`mochi.${root}`);
});
test("failed returned callback surfaces inner error and missing/cyclic chains reject", () => {
  const failure = {
    status: { SuccessValue: "" },
    receipts_outcome: [
      receipt("start", root, { SuccessReceiptId: "callback" }),
      receipt("pet", `mochi.${root}`, {
        Failure: { error_message: "ERR_FEED_COOLDOWN" },
      }),
      receipt("callback", root, value(false)),
    ],
  };
  expect(() => confirmedValue(failure, root, "act")).toThrow(
    "ERR_FEED_COOLDOWN",
  );
  expect(() =>
    confirmedValue(
      {
        status: { SuccessValue: "" },
        receipts_outcome: [
          receipt("start", root, { SuccessReceiptId: "missing" }),
        ],
      },
      root,
      "act",
    ),
  ).toThrow();
  expect(() =>
    confirmedValue(
      {
        status: { SuccessValue: "" },
        receipts_outcome: [
          receipt("start", root, { SuccessReceiptId: "start" }),
        ],
      },
      root,
      "act",
    ),
  ).toThrow();
  for (const bad of ["Unknown", {}, { SuccessValue: 123 }])
    expect(() =>
      confirmedValue(
        {
          status: { SuccessValue: "" },
          receipts_outcome: [receipt("start", root, bad)],
        },
        root,
        "nft_transfer",
      ),
    ).toThrow();
});
