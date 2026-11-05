import { expect, test } from "bun:test";
import { assertQuoteKey } from "./deployment";
test("deployment rejects a broad existing NPC key before funding it", () => {
  const market = "market.familiar.testnet";
  const exact = {
    receiver_id: market,
    method_names: ["set_quotes"],
    allowance: "1000000000000000000000000",
  };
  expect(() => assertQuoteKey({ FunctionCall: exact }, market)).not.toThrow();
  for (const wrong of [
    "FullAccess",
    { FunctionCall: { ...exact, receiver_id: "attacker.testnet" } },
    { FunctionCall: { ...exact, method_names: [] } },
    { FunctionCall: { ...exact, method_names: ["set_quotes", "npc_deposit"] } },
    { FunctionCall: { ...exact, allowance: null } },
    { FunctionCall: { ...exact, allowance: "1000000000000000000000001" } },
  ])
    expect(() => assertQuoteKey(wrong, market)).toThrow();
});
