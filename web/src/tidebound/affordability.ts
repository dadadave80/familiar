import { KeyType, type Transaction } from "near-api-js";

const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
function check(value:unknown):asserts value {if(!value)throw Error("The current testnet gas prepayment could not be verified. Keep the original account and action.");}
function amount(value:unknown):bigint {
  check(typeof value==="bigint"||typeof value==="number"&&Number.isSafeInteger(value)||typeof value==="string"&&/^(0|[1-9][0-9]{0,38})$/.test(value));
  const result=BigInt(value as string|number|bigint);check(result>=0n&&result<2n**128n);return result;
}
/** Conservative prepayment bound, not a quote for the final gas burn. It grants no signing authority. */
export function nativePrepayment(transaction:Transaction,account:unknown,protocol:unknown,blockGasPrice:unknown):{available:bigint;required:bigint;purchaseGasPrice:bigint} {
  check(record(account)&&record(protocol)&&protocol.chain_id==="testnet"&&Number.isSafeInteger(protocol.protocol_version)&&Number(protocol.protocol_version)>=85);
  const runtime=protocol.runtime_config;check(record(runtime)&&record(runtime.transaction_costs));
  const costs=runtime.transaction_costs,actions=costs.action_creation_config;check(record(actions));
  const blockPrice=amount(blockGasPrice),floor=amount(runtime.min_gas_purchase_price),storagePrice=amount(runtime.storage_amount_per_byte);
  check(blockPrice>0n&&floor>0n&&storagePrice>0n&&transaction.actions.length===1&&transaction.publicKey.keyType===KeyType.ED25519);
  const purchaseGasPrice=blockPrice>floor?blockPrice:floor;
  // Charge both send and execution fees at the larger purchase price, and choose the larger send fee.
  // This deliberately overestimates nearcore's mixed burn/purchase pricing rather than underfunding a signature.
  const fee=(value:unknown)=>{check(record(value));const a=amount(value.send_sir),b=amount(value.send_not_sir);return (a>b?a:b)+amount(value.execution);};
  const action=transaction.actions[0]!;let prepaidGas=0n,deposit=0n,actionFee=0n;
  if(action.functionCall){
    const call=action.functionCall;prepaidGas=amount(call.gas);deposit=amount(call.deposit);check(prepaidGas>0n);
    actionFee=fee(actions.function_call_cost)+fee(actions.function_call_cost_per_byte)*BigInt(new TextEncoder().encode(call.methodName).length+call.args.length);
  }else if(action.transfer){deposit=amount(action.transfer.deposit);actionFee=fee(actions.transfer_cost);}
  else if(action.addKey&&action.addKey.accessKey.permission.fullAccess){const add=actions.add_key_cost;check(record(add));actionFee=fee(add.full_access_cost);}
  else check(false);
  const storage=amount(account.storage_usage),available=amount(account.amount)-storage*storagePrice;
  return {available,required:deposit+(prepaidGas+fee(costs.action_receipt_creation_config)+actionFee)*purchaseGasPrice,purchaseGasPrice};
}
export function assertNativeAffordable(...args:Parameters<typeof nativePrepayment>) {
  const result=nativePrepayment(...args);
  if(result.available<result.required)throw Error("This saved account needs more test NEAR for gas prepayment and the attached deposit. No new signature was requested. Keep the same account and original action.");
  return result;
}
