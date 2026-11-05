import { expect, test } from "bun:test";
import { explorerLink, receiptFor, errorCopy } from "./receipts";

test("every core action has one canonical receipt and only a valid confirmed hash links out", () => {
  for (const action of [
    "adopt",
    "feed",
    "forage",
    "craft",
    "sleep",
    "wake",
    "withdraw",
    "sell_to_npc",
    "buy_from_npc",
    "join_den",
    "list",
    "buy_pet",
    "claim_market",
  ])
    expect(receiptFor(action).sentence.length).toBeGreaterThan(20);
  expect(explorerLink("")).toBeNull();
  expect(explorerLink("javascript:bad")).toBeNull();
  expect(explorerLink("2".repeat(44))).toBe(
    `https://testnet.nearblocks.io/txns/${"2".repeat(44)}`,
  );
  expect(errorCopy("ERR_NOT_OWNER")).toContain("changed");
});
