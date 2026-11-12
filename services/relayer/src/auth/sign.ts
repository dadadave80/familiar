import { base64Decode, base64Encode, decodeTransaction, encodeTransaction, KeyType, type Transaction } from "near-api-js";
import { validateAuthRequest } from "../../../../web/src/account/signing-request";
import { accountId } from "../relay";
import { ACTION_LIMIT, isTool } from "../../../../web/src/outing/engine";

export interface AuthSigningContext { root:string; items:string; clientId:string; origin:string; origins:readonly string[] }
function check(value:unknown):asserts value { if (!value) throw new Error("ERR_AUTH_REQUEST"); }
const bounded=(value:unknown,max=128):value is string=>typeof value === "string" && value.length > 0 && value.length <= max;
const revision=(value:unknown)=>Number.isInteger(value) && Number(value)>=0 && Number(value)<=0xffffffff;
function fields(args:Record<string,unknown>,names:string[]) { check(Object.keys(args).length===names.length && names.every(n=>Object.hasOwn(args,n))); }
/** This allowlist grants no account authority and performs no RPC. */
export function validateNativeIntent(tx:Transaction,context:Pick<AuthSigningContext,"root"|"items">) {
  check(accountId(context.root) && context.root.endsWith(".testnet") && context.items===`items.${context.root}`);
  check(accountId(tx.signerId) && tx.signerId.endsWith(`.${context.root}`) && /^p-[0-9]+$/.test(tx.signerId.slice(0,-context.root.length-1)));
  check(tx.publicKey.keyType===KeyType.ED25519 && tx.nonce>0n && tx.actions.length===1 && tx.nonceIndex===undefined);
  const action=tx.actions[0]!;
  if("transfer" in action) { check(tx.receiverId===tx.signerId && action.transfer?.deposit===0n); return; }
  check("functionCall" in action && Object.keys(action).length === 1);
  const call=action.functionCall;
  check(call);
  check(call.gas>0n && call.gas<=280000000000000n && call.args.length<=8192);
  const args:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(new Uint8Array(call.args)));
  check(args && typeof args==="object" && !Array.isArray(args));
  const a=args as Record<string,unknown>;
  if(tx.receiverId===context.items) {
    if(call.methodName==="storage_deposit") {
      fields(a,["account_id","registration_only"]);
      check(accountId(a.account_id) && a.registration_only===true && call.deposit>0n && call.deposit<=8n*10n**22n);
      return;
    }
    check(call.methodName==="mt_transfer" && call.deposit===1n);
    fields(a,["receiver_id","token_id","amount","approval","memo"]);
    check(accountId(a.receiver_id) && a.receiver_id!==tx.signerId && bounded(a.token_id) && a.amount==="1" && a.approval===null && a.memo===null);
    return;
  }
  check(tx.receiverId===context.root && call.deposit===0n);
  const token=(value:unknown)=>bounded(value,64) && accountId(value) && value.endsWith(`.${context.root}`);
  switch(call.methodName) {
    case "adopt": fields(a,["name"]); check(typeof a.name==="string" && /^[a-z0-9][a-z0-9-]{0,22}[a-z0-9]$/.test(a.name)); break;
    case "tidebound_claim": {
      fields(a,["token_id","operation_id","expected_revision","initial_checkpoint_hash","rules_version","content_version","tool","commands","area"]);
      check(token(a.token_id) && bounded(a.operation_id) && revision(a.expected_revision) && bounded(a.initial_checkpoint_hash) && a.rules_version==="tidebound_h1_v1" && a.content_version==="first_light_v1" && isTool(a.tool) && (a.area==="beacon" || a.area==="wind"));
      check(Array.isArray(a.commands) && a.commands.length<=ACTION_LIMIT && a.commands.every(c=>typeof c==="string" && /^(wait|return|turn:vane|move:(left|center|right)|lure:(left|center|right)|take:(lens|moth|chart|salvage|vane)|reel:(lens|salvage|vane))$/.test(c)));
      break;
    }
    case "tidebound_craft": fields(a,["token_id","motif","origin_claim_id"]); check(token(a.token_id) && (a.motif==="crest" || a.motif==="moth") && bounded(a.origin_claim_id)); break;
    case "tidebound_commission": case "tidebound_reconcile": case "tidebound_retry_operation": case "tidebound_cancel_polish": fields(a,[]); break;
    case "tidebound_polish": fields(a,["item_id","expected_appearance"]); check(bounded(a.item_id) && revision(a.expected_appearance)); break;
    case "tidebound_restore": fields(a,["restoration"]); check(a.restoration==="beacon" || a.restoration==="signal"); break;
    case "tidebound_place": fields(a,["item_id","socket","expected_revision"]); check(bounded(a.item_id) && (a.socket==="porch" || a.socket==="dock") && revision(a.expected_revision)); break;
    default: throw new Error("ERR_AUTH_METHOD");
  }
}
export function validateSigningRequest(value:unknown,context:AuthSigningContext) {
  check(context.clientId && context.origins.includes(context.origin));
  check(context.clientId!=="np8paqIpMWmNbzT4xAvOOapZBjsOpptl" || context.origin==="http://localhost:3000");
  check(value && typeof value==="object");
  const body=value as {transaction?:unknown;response?:unknown};
  check(typeof body.transaction==="string" && body.transaction.length<=12000);
  const bytes=base64Decode(body.transaction);
  check(base64Encode(bytes)===body.transaction);
  const transaction=decodeTransaction(bytes);
  check(base64Encode(encodeTransaction(transaction))===body.transaction);
  validateNativeIntent(transaction,context);
  const response=body.response as {user?:{userId?:unknown};publicKey?:unknown};
  check(response && typeof response.user?.userId==="string" && response.publicKey===transaction.publicKey.toString());
  const identity={userId:response.user.userId,publicKey:transaction.publicKey.toString(),clientId:context.clientId};
  const request=validateAuthRequest(body.response,bytes,identity);
  return {request,transaction,publicKey:identity.publicKey,userId:identity.userId};
}
