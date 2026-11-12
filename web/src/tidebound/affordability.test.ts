import { expect,test } from "bun:test";
import { actions,createTransaction,KeyPair } from "near-api-js";
import { assertNativeAffordable,nativePrepayment } from "./affordability";

const key=KeyPair.fromRandom("ed25519").getPublicKey();
const tx=(method="adopt",deposit=0n)=>createTransaction("player.familiar-game.testnet",key,"familiar-game.testnet",1n,[actions.functionCall(method,{name:"qa-bramble-h1"},180_000_000_000_000n,deposit)],new Uint8Array(32));
const fee=(send_sir:number,send_not_sir:number,execution:number)=>({send_sir,send_not_sir,execution});
// Public protocol88 fee fields measured at finalized testnet block277414830. No network or signing in these tests.
const protocol={chain_id:"testnet",protocol_version:88,runtime_config:{min_gas_purchase_price:"1000000000",storage_amount_per_byte:"10000000000000000000",transaction_costs:{
  action_receipt_creation_config:fee(108059500000,108059500000,108059500000),action_creation_config:{
    function_call_cost:fee(200000000000,200000000000,780000000000),function_call_cost_per_byte:fee(2235934,47683715,2235934),
    transfer_cost:fee(115123062500,115123062500,115123062500),add_key_cost:{full_access_cost:fee(101765125000,101765125000,101765125000)},
  },
}}};
const account=(amount:string)=>({amount,storage_usage:182});
test("native prepayment uses the protocol purchase floor, includes fees/storage, and blocks the observed underfunded adoption",()=>{
  const rejected=account("150000000000000000000000");
  const result=nativePrepayment(tx(),rejected,protocol,"100000000");
  expect(result.purchaseGasPrice).toBe(1_000_000_000n);expect(result.available).toBe(148180000000000000000000n);
  expect(result.required).toBeGreaterThanOrEqual(180919068574859500000000n); // Actual protocol rejection's required balance.
  expect(result.required).toBeLessThan(190000000000000000000000n);
  expect(()=>assertNativeAffordable(tx(),rejected,protocol,"100000000")).toThrow("gas prepayment");
  expect(()=>assertNativeAffordable(tx(),account("250000000000000000000000"),protocol,"100000000")).not.toThrow();
});
test("native prepayment accounts for deposits, higher block prices, transfer/key fees and fails closed on unknown protocol",()=>{
  const normal=nativePrepayment(tx(),account("1000000000000000000000000"),protocol,"100000000");
  expect(nativePrepayment(tx("adopt",8n*10n**22n),account("1000000000000000000000000"),protocol,"100000000").required-normal.required).toBe(8n*10n**22n);
  expect(nativePrepayment(tx(),account("1000000000000000000000000"),protocol,"2000000000").required).toBe(normal.required*2n);
  for(const action of [actions.transfer(10n**23n),actions.addFullAccessKey(key)]){
    const transaction=createTransaction("player.familiar-game.testnet",key,"receiver.familiar-game.testnet",1n,[action],new Uint8Array(32));
    expect(nativePrepayment(transaction,account("1000000000000000000000000"),protocol,"100000000").required).toBeGreaterThan(action.transfer?.deposit??0n);
  }
  for(const value of [null,{...protocol,chain_id:"mainnet"},{...protocol,protocol_version:84},{...protocol,runtime_config:{...protocol.runtime_config,min_gas_purchase_price:undefined}},{...protocol,runtime_config:{...protocol.runtime_config,transaction_costs:{}}}])
    expect(()=>nativePrepayment(tx(),account("1000000000000000000000000"),value,"100000000")).toThrow("could not be verified");
  expect(()=>nativePrepayment(tx(),{amount:"100",storage_usage:Number.MAX_SAFE_INTEGER+1},protocol,"100000000")).toThrow();
});
