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

test("Tidebound deployment cannot target legacy state or reuse a mismatched registry",async()=>{
 const {assertIsolatedTidebound,assertTideboundProtocol}=await import("./deployment");
 expect(()=>assertIsolatedTidebound("fresh.testnet","legacy.testnet",true)).not.toThrow();
 expect(()=>assertIsolatedTidebound("legacy.testnet","legacy.testnet",true)).toThrow();
 expect(()=>assertIsolatedTidebound("fresh.testnet","legacy.testnet",false)).toThrow();
 const root={registry:"fresh.testnet",items:"items.fresh.testnet",network:"testnet",rules_version:"tidebound_h1_v1",content_version:"first_light_v1"};
 expect(()=>assertTideboundProtocol("fresh.testnet",root,{registry:"fresh.testnet"})).not.toThrow();
 expect(()=>assertTideboundProtocol("fresh.testnet",null,{registry:"fresh.testnet"})).toThrow();
 expect(()=>assertTideboundProtocol("fresh.testnet",root,{registry:"legacy.testnet"})).toThrow();
});
