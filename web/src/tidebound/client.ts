import { actions, base64Encode, base64Decode, baseEncode, baseDecode, createTransaction, decodeTransaction, decodeSignedTransaction, encodeTransaction, PublicKey, teraToGas, type AccessKeyViewRaw, type JsonRpcProvider } from "near-api-js";
import type { RecoverableAccountAdapter } from "../account/adapter";
import { isPlayerAccount } from "../account/names";
import { replayOuting } from "../outing/engine";
import { CONTENT_VERSION, RULES_VERSION, type ExpeditionTranscript, type PlayerBinding } from "./domain";
import { assertTideboundContent, type SupportedContent } from "./protocol";
import { validateNativeIntent } from "../../../services/relayer/src/auth/sign";
import { assertNativeAffordable } from "./affordability";

export interface MintEvidence { id:string;token_id:string;maker:string;origin_claim_id:string;motif:"crest"|"moth";input_hash:string;rules_version:string;content_version:string }
export interface CraftItem { mint:MintEvidence;finish:"original"|"harbor_polish";appearance_version:number;finish_used:boolean }
export interface Journey {
  revision:number;banked:string[];lit:boolean;signaled:boolean;lens_claim:string|null;moth_claim:string|null;
  credit:"unclaimed"|"available"|"reserved"|"consumed";workshop_salvage:number;bram_budget:number;shells:number;burned_shells:number;commission_fulfilled:boolean;
  craft:{evidence:MintEvidence;pet_id:string;state:"reserved"|"recovery-required"|"confirmed"|"failed-safe";attempt:number}|null;
  polish:{state:string}|null;placement:{item_id:string;socket:"porch"|"dock"}|null;
}
export interface ChainSnapshot { readAt:string;binding:PlayerBinding;journey:Journey;checkpointHash:string;pets:{token_id:string}[];items:CraftItem[];nextItemIndex:number|null }
export interface PendingNative { operationId:string;hash:string;method:string;receiver:string;transaction:string;signedTransaction?:string;state:"prepared"|"signed"|"submitted" }
function check(value:unknown,message:string):asserts value {if(!value)throw Error(message)}
const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
/** A FINAL label alone cannot settle an incomplete or contradictory receipt graph. */
function finalReceiptFailure(value:unknown,expected:{hash:string;signer:string;receiver:string}):boolean {
  const message="The original receipt graph is incomplete or uncertain. Keep its original pending action.";
  check(record(value)&&value.final_execution_status==="FINAL"&&record(value.transaction)&&value.transaction.hash===expected.hash&&value.transaction.signer_id===expected.signer&&value.transaction.receiver_id===expected.receiver,message);
  check(record(value.transaction_outcome)&&value.transaction_outcome.id===expected.hash&&record(value.transaction_outcome.outcome),message);
  const origin=value.transaction_outcome.outcome;
  check(origin.executor_id===expected.signer&&Array.isArray(origin.receipt_ids)&&Array.isArray(value.receipts_outcome),message);
  type Node={executor:string;children:string[];status:Record<string,unknown>};
  const nodes=new Map<string,Node>();
  const status=(s:unknown):Record<string,unknown>=>{check(record(s)&&Object.keys(s).length===1,message);check(typeof s.SuccessValue==="string"||record(s.Failure)&&Object.keys(s.Failure).length>0||typeof s.SuccessReceiptId==="string"&&s.SuccessReceiptId.length>0,message);return s;};
  const outer=status(value.status),initial=status(origin.status);
  for(const raw of value.receipts_outcome){
    check(record(raw)&&typeof raw.id==="string"&&raw.id.length>0&&!nodes.has(raw.id)&&record(raw.outcome),message);
    const o=raw.outcome;check(typeof o.executor_id==="string"&&Array.isArray(o.receipt_ids)&&o.receipt_ids.every(id=>typeof id==="string"&&id.length>0)&&new Set(o.receipt_ids).size===o.receipt_ids.length,message);
    nodes.set(raw.id,{executor:o.executor_id,children:o.receipt_ids,status:status(o.status)});
  }
  if("Failure"in initial){check("Failure"in outer&&origin.receipt_ids.length===0&&nodes.size===0,message);return true;}
  check(typeof initial.SuccessReceiptId==="string"&&origin.receipt_ids.length===1&&origin.receipt_ids[0]===initial.SuccessReceiptId&&nodes.get(initial.SuccessReceiptId)?.executor===expected.receiver,message);
  const seen=new Set<string>();
  function visit(id:string){check(!seen.has(id),message);const node=nodes.get(id);check(node,message);seen.add(id);for(const child of node.children)visit(child);}
  visit(initial.SuccessReceiptId);check(seen.size===nodes.size,message);
  function terminal(s:Record<string,unknown>,path=new Set<string>()):Record<string,unknown>{
    if(!("SuccessReceiptId"in s))return s;
    const id=s.SuccessReceiptId;check(typeof id==="string"&&!path.has(id)&&nodes.has(id),message);path.add(id);return terminal(nodes.get(id)!.status,path);
  }
  const result=terminal(initial);for(const node of nodes.values())terminal(node.status);
  check("Failure"in result?"Failure"in outer:typeof outer.SuccessValue==="string"&&outer.SuccessValue===result.SuccessValue,message);
  return "Failure"in result||[...nodes.values()].some(node=>"Failure"in node.status);
}
const hashId=(id:unknown):id is string=>typeof id==="string" && /^[a-f0-9]{64}$/.test(id);
const tokenId=(id:unknown):id is string=>typeof id==="string" && /^lantern:[a-f0-9]{64}$/.test(id);
const accountId=(id:unknown):id is string=>typeof id==="string" && id.length<=64 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(id);
function validMint(m:MintEvidence) {
  return m && hashId(m.id) && tokenId(m.token_id) && accountId(m.maker) && hashId(m.origin_claim_id) &&
    ["crest","moth"].includes(m.motif) && hashId(m.input_hash) && m.rules_version===RULES_VERSION && [CONTENT_VERSION,"first_light_v2"].includes(m.content_version);
}
export function parseJourney(value:unknown):Journey {
  const j=value as Journey;
  const validOperation=(op:unknown)=>op===null || !!op && typeof op==="object" &&
    ["reserved","recovery-required","confirmed","failed-safe"].includes((op as {state:string}).state) &&
    Number.isInteger((op as {attempt:number}).attempt) && (op as {attempt:number}).attempt>=1;
  check(j && Number.isSafeInteger(j.revision) && j.revision>=0 && Array.isArray(j.banked) && j.banked.length<=5 &&
    j.banked.every(i=>["lens","moth","chart","salvage","vane"].includes(i)) && new Set(j.banked).size===j.banked.length &&
    typeof j.lit==="boolean" && typeof j.signaled==="boolean" && ["unclaimed","available","reserved","consumed"].includes(j.credit) &&
    [0,1].includes(j.workshop_salvage) && [j.bram_budget,j.shells,j.burned_shells].every(n=>n===0 || n===12) &&
    typeof j.commission_fulfilled==="boolean" && [j.lens_claim,j.moth_claim].every(id=>id===null || hashId(id)) &&
    validOperation(j.craft) && validOperation(j.polish),"The saved journey has an unsupported format. Keep the original preview.");
  check(j.banked.includes("lens")===!!j.lens_claim && j.banked.includes("moth")===!!j.moth_claim &&
    (!j.lit || !!j.lens_claim) && (!j.signaled || (j.lit && j.banked.includes("vane"))) &&
    (j.credit==="unclaimed")===!j.lens_claim &&
    (!j.craft || (validMint(j.craft.evidence) && accountId(j.craft.pet_id) && j.craft.evidence.origin_claim_id===(j.craft.evidence.motif==="crest" ? j.lens_claim:j.moth_claim))) &&
    (j.credit!=="reserved" || ["reserved","recovery-required"].includes(j.craft?.state??"")) && (j.credit!=="consumed" || j.craft?.state==="confirmed") &&
    (j.craft?.state!=="confirmed" || j.credit==="consumed") &&
    (!j.placement || (tokenId(j.placement.item_id) && ["porch","dock"].includes(j.placement.socket))) &&
    j.bram_budget+j.shells+j.burned_shells+(["reserved","recovery-required"].includes(j.polish?.state??"") ? 12:0)===(j.lens_claim ? 12:0) &&
    (!j.commission_fulfilled || (j.workshop_salvage===0 && j.bram_budget===0)),"The saved journey violates the finite chapter rules. Refresh the canonical account.");
  return j;
}
export function claimInput(snapshot:ChainSnapshot,transcript:ExpeditionTranscript,operationId:string) {
  check(JSON.stringify(snapshot.journey.banked)===JSON.stringify(transcript.banked),"This outing began from a different checkpoint. Keep it as a private preview and start from the saved harbor.");
  const run=replayOuting(transcript.tool,transcript.banked,transcript.actions,transcript.area);
  check(run?.outcome==="returned" && run.cargo.length>0,"Only a legal returned discovery can be saved on NEAR.");
  check(snapshot.pets[0],"Adopt Mochi in this testnet harbor before saving an outing.");
  return {token_id:snapshot.pets[0].token_id,operation_id:operationId,expected_revision:snapshot.journey.revision,initial_checkpoint_hash:snapshot.checkpointHash,rules_version:RULES_VERSION,content_version:CONTENT_VERSION,tool:transcript.tool,commands:transcript.actions,area:transcript.area};
}

export function nativeGas(method:string):bigint {
  if(method==="adopt")return teraToGas(180);
  if(["tidebound_craft","tidebound_retry_operation"].includes(method))return teraToGas(120);
  if(["tidebound_polish","tidebound_cancel_polish"].includes(method))return teraToGas(100);
  if(["tidebound_place","tidebound_reconcile"].includes(method))return teraToGas(80);
  return teraToGas(50);
}

/** Fixed testnet tuple, native player-funded transactions, and one persisted uncertain action per account. */
export class TideboundClient {
  constructor(readonly root:string,readonly itemsContract:string,readonly provider:JsonRpcProvider,readonly adapter:RecoverableAccountAdapter,private readonly store:Pick<Storage,"getItem"|"setItem"|"removeItem">) {}
  async view<T>(contractId:string,method:string,args:Record<string,unknown>={},blockId?:string):Promise<T> {
    return await this.provider.callFunction({contractId,method,args,blockQuery:blockId?{blockId}:{finality:"final"}}) as unknown as T;
  }
  async verifyStack(contentVersion:SupportedContent=CONTENT_VERSION,blockId?:string) {
    check(this.root.endsWith(".testnet") && this.itemsContract===`items.${this.root}` && await this.provider.getNetworkId()==="testnet","This harbor requires the configured NEAR testnet stack.");
    const [protocol,items]=await Promise.all([
      this.view<unknown>(this.root,"tidebound_protocol",{},blockId),
      this.view<unknown>(this.itemsContract,"craft_protocol",{},blockId),
    ]);
    assertTideboundContent(this.root,protocol,items,contentVersion);
  }
  async snapshot(binding:PlayerBinding,fromIndex=0):Promise<ChainSnapshot> {
    await this.verifyStack();
    check(binding.network==="testnet" && isPlayerAccount(binding.nearAccountId,this.root),"The account belongs to a different harbor.");
    const block=await this.provider.viewBlock({finality:"final"}),blockId=block.header.hash;
    check(typeof blockId==="string"&&baseDecode(blockId).length===32,"The finalized snapshot block could not be verified.");
    const [raw,checkpointHash,pets,inventory]=await Promise.all([
      this.view<unknown>(this.root,"tidebound_journey",{account_id:binding.nearAccountId},blockId),
      this.view<string>(this.root,"tidebound_checkpoint_hash",{account_id:binding.nearAccountId},blockId),
      this.view<{token_id:string}[]>(this.root,"nft_tokens_for_owner",{account_id:binding.nearAccountId,from_index:"0",limit:20},blockId),
      this.view<{items:CraftItem[];next_index:number|null}>(this.itemsContract,"craft_inventory",{account_id:binding.nearAccountId,from_index:fromIndex,limit:32},blockId),
    ]);
    check(/^[a-f0-9]{64}$/.test(checkpointHash) && Array.isArray(pets) && Array.isArray(inventory.items) && inventory.items.length<=32 && (inventory.next_index===null || (Number.isInteger(inventory.next_index) && inventory.next_index>fromIndex)),"The contract snapshot is incomplete.");
    const owned:CraftItem[]=[];
    for(const item of inventory.items) {
      check(validMint(item?.mint) && (item.finish==="original" && !item.finish_used && item.appearance_version===0 || item.finish==="harbor_polish" && item.finish_used===true && item.appearance_version===1),"The item metadata is unsupported.");
      if(item.mint.content_version==="first_light_v2")await this.verifyStack("first_light_v2",blockId);
      // Ownership can change after enumeration; the mutation will check it again atomically.
      if(await this.view<string>(this.itemsContract,"mt_balance_of",{account_id:binding.nearAccountId,token_id:item.mint.token_id},blockId)==="1") owned.push(item);
    }
    return {readAt:new Date().toISOString(),binding,journey:parseJourney(raw),checkpointHash,pets,items:owned,nextItemIndex:inventory.next_index};
  }
  private pendingKey(binding:PlayerBinding) {return `familiar.tidebound.pending.v1:${this.root}:${binding.nearAccountId}`}
  pending(binding:PlayerBinding):PendingNative|null {
    const raw=this.store.getItem(this.pendingKey(binding));if(!raw)return null;
    const p=JSON.parse(raw) as PendingNative;
    check(p && ["prepared","signed","submitted"].includes(p.state) && typeof p.hash==="string" && typeof p.operationId==="string" && typeof p.transaction==="string","A pending action could not be read. Preserve this browser data.");
    return p;
  }
  private async lock<T>(binding:PlayerBinding,work:()=>Promise<T>):Promise<T> {
    check(globalThis.navigator?.locks,"This browser cannot coordinate safe account actions across tabs. Use a browser with Web Locks support.");
    return navigator.locks.request(this.pendingKey(binding),work);
  }
  private async signingBinding(binding:PlayerBinding) {
    const actual=await this.adapter.resolveBinding();
    check(actual?.nearAccountId===binding.nearAccountId && actual.signerPublicKey===binding.signerPublicKey,"The signing identity changed. Reload the saved harbor.");
  }
  private async affordable(transaction:ReturnType<typeof createTransaction>,blockHash?:string) {
    const hash=blockHash??(await this.provider.viewBlock({finality:"final"})).header.hash;
    const [account,protocol,price]=await Promise.all([
      this.provider.viewAccount({accountId:transaction.signerId,blockQuery:{blockId:hash}}),
      this.provider.experimental_protocolConfig({blockId:hash}),
      this.provider.viewGasPrice(hash),
    ]);
    assertNativeAffordable(transaction,account,protocol,price.gas_price);
  }
  async send(binding:PlayerBinding,method:string,args:Record<string,unknown>,options:{receiver?:string;deposit?:bigint}={}) {
    check(!this.pending(binding),"An earlier action needs its original receipt checked before another action.");
    return this.lock(binding,async()=>{
      await this.verifyStack(method==="tidebound_claim"&&args.content_version==="first_light_v2"?"first_light_v2":CONTENT_VERSION);
      check(!this.pending(binding),"An earlier action needs its original receipt checked before another action.");
      await this.signingBinding(binding);
      const key=PublicKey.fromString(binding.signerPublicKey);
      const access=await this.provider.viewAccessKey({accountId:binding.nearAccountId,publicKey:key,finalityQuery:{finality:"final"}});
      const block=await this.provider.viewBlock({finality:"final"});
      const gas = nativeGas(method);
      const tx=createTransaction(binding.nearAccountId,key,options.receiver??this.root,access.nonce+1n,[actions.functionCall(method,args,gas,options.deposit??0n)],baseDecode(block.header.hash));
      validateNativeIntent(tx,{root:this.root,items:this.itemsContract});
      await this.affordable(tx,block.header.hash);
      const hash=baseEncode(new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(encodeTransaction(tx)))));
      this.store.setItem(this.pendingKey(binding),JSON.stringify({operationId:`native:${crypto.randomUUID()}`,hash,method,receiver:tx.receiverId,transaction:base64Encode(encodeTransaction(tx)),state:"prepared"} satisfies PendingNative));
      return this.resumeLocked(binding);
    });
  }
  private async originalTransaction(binding:PlayerBinding,pending:PendingNative) {
    check(binding.network==="testnet" && isPlayerAccount(binding.nearAccountId,this.root),"The account belongs to a different testnet harbor.");
    const tx=decodeTransaction(base64Decode(pending.transaction));
    check(base64Encode(encodeTransaction(tx))===pending.transaction && tx.signerId===binding.nearAccountId && tx.receiverId===pending.receiver &&
      [this.root,this.itemsContract].includes(tx.receiverId) && tx.publicKey.toString()===binding.signerPublicKey &&
      tx.actions.length===1 && tx.actions[0]?.functionCall?.methodName===pending.method,"The original signing context changed.");
    validateNativeIntent(tx,{root:this.root,items:this.itemsContract});
    const call=tx.actions[0]?.functionCall;
    if(call?.methodName==="tidebound_claim"&&JSON.parse(new TextDecoder().decode(new Uint8Array(call.args))).content_version==="first_light_v2")await this.verifyStack("first_light_v2");
    const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(encodeTransaction(tx))));
    check(baseEncode(digest)===pending.hash,"The stored transaction no longer matches its original hash.");
    if(pending.signedTransaction) {
      const signed=decodeSignedTransaction(base64Decode(pending.signedTransaction));
      check(base64Encode(encodeTransaction(signed.transaction))===pending.transaction && signed.signature.ed25519Signature &&
        tx.publicKey.verify(digest,new Uint8Array(signed.signature.ed25519Signature.data)),"The stored signature is invalid.");
    }
    return {tx,digest,hash:pending.hash};
  }
  async resolveExpiredNative(binding:PlayerBinding):Promise<string> {
    return this.lock(binding,async()=>{
      await this.verifyStack();await this.signingBinding(binding);
      const pending=this.pending(binding);if(!pending)return "No native action is pending.";
      const {tx}=await this.originalTransaction(binding,pending);
      const originalHash=baseEncode(new Uint8Array(tx.blockHash));
      const [original,final]=await Promise.all([this.provider.viewBlock({blockId:originalHash}),this.provider.viewBlock({finality:"final"})]);
      check(original.header.hash===originalHash && Number.isSafeInteger(original.header.height) && original.header.height>=0 &&
        Number.isSafeInteger(final.header.height) && final.header.height>=original.header.height && typeof final.header.hash==="string","The original block cannot be verified.");
      const [protocol,access]=await Promise.all([
        this.provider.experimental_protocolConfig({blockId:final.header.hash}),
        // SDK7 viewAccessKey drops block IDs; raw query preserves this exact finalized-block pin.
        this.provider.query<AccessKeyViewRaw>({request_type:"view_access_key",account_id:binding.nearAccountId,public_key:tx.publicKey.toString(),block_id:final.header.hash}),
      ]);
      const validity=protocol.transaction_validity_period;
      check(protocol.chain_id==="testnet" && typeof validity==="number" && Number.isSafeInteger(validity) && validity>0,"The native transaction validity period is unavailable.");
      check(typeof access.nonce==="number" && Number.isSafeInteger(access.nonce) && access.nonce>=0 && access.permission==="FullAccess" &&
        access.block_hash===final.header.hash && access.block_height===final.header.height,"The finalized signing-key state could not be verified.");
      const nonce=BigInt(access.nonce);
      const expired=BigInt(final.header.height)>BigInt(original.header.height)+BigInt(validity);
      if(!expired || nonce>=tx.nonce) {
        if(pending.state==="submitted" || nonce>=tx.nonce)return this.reconcileLocked(binding);
        return "The original transaction is still valid. Resume its same saved bytes; no new action was created.";
      }
      // Pin nonce and validity to the same finalized block before clearing only this local envelope.
      await this.snapshot(binding);await this.signingBinding(binding);
      const current=this.pending(binding);
      check(current?.operationId===pending.operationId && current.hash===pending.hash && current.transaction===pending.transaction,"Another tab changed this pending action.");
      this.store.removeItem(this.pendingKey(binding));
      return "The original native transaction expired without execution under this key. Only its local envelope was cleared after refreshing canonical progress; no new action or ledger release occurred.";
    });
  }
  async resumeNative(binding:PlayerBinding) {return this.lock(binding,()=>this.resumeLocked(binding));}
  private async resumeLocked(binding:PlayerBinding):Promise<string> {
    await this.verifyStack();await this.signingBinding(binding);
    const pending=this.pending(binding);check(pending,"No original action is available to resume.");
    const {tx,hash}=await this.originalTransaction(binding,pending);
    if(pending.state==="submitted") return this.reconcileLocked(binding);
    await this.affordable(tx);
    const signed=pending.signedTransaction ? decodeSignedTransaction(base64Decode(pending.signedTransaction)) : await this.adapter.authorizeNative(tx,pending.operationId);
    check(base64Encode(encodeTransaction(signed.transaction))===pending.transaction,"The signature belongs to a different action.");
    const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(encodeTransaction(tx))));
    check(signed.signature.ed25519Signature && tx.publicKey.verify(digest,new Uint8Array(signed.signature.ed25519Signature.data)),"The stored signature is invalid.");
    check(this.pending(binding)?.operationId===pending.operationId,"Another tab changed the original action. Reconcile before continuing.");
    this.store.setItem(this.pendingKey(binding),JSON.stringify({...pending,state:"signed",signedTransaction:base64Encode(signed.encode())}));
    // Persist the adapter marker before broadcast; failure leaves a resumable signed record.
    this.adapter.markSubmitted(pending.operationId,binding);
    this.store.setItem(this.pendingKey(binding),JSON.stringify({...pending,state:"submitted",signedTransaction:base64Encode(signed.encode())}));
    try {
      const outcome=await this.provider.sendTransactionUntil(signed,"FINAL");
      check(outcome.transaction?.hash===hash,"The node returned a different transaction. Check the original receipt.");
      return await this.reconcileLocked(binding);
    } catch {throw Error("This action may still be executing. Check its original receipt; no new payment or craft has been started.")}
  }
  async reconcileNative(binding:PlayerBinding):Promise<string> {return this.lock(binding,()=>this.reconcileLocked(binding));}
  private async reconcileLocked(binding:PlayerBinding):Promise<string> {
    await this.verifyStack();
    check(binding.network==="testnet" && isPlayerAccount(binding.nearAccountId,this.root),"The account belongs to a different testnet harbor.");
    const pending=this.pending(binding);if(!pending)return "No native action is pending.";
    await this.originalTransaction(binding,pending);
    const outcome=await this.provider.viewTransactionStatusWithReceipts({txHash:pending.hash,accountId:binding.nearAccountId,waitUntil:"FINAL"});
    const failed=finalReceiptFailure(outcome,{hash:pending.hash,signer:binding.nearAccountId,receiver:pending.receiver});
    const current=this.pending(binding);
    check(current?.operationId===pending.operationId&&current.hash===pending.hash&&current.transaction===pending.transaction,"Another tab changed this pending action.");
    this.store.removeItem(this.pendingKey(binding));
    return failed ? "A receipt failed. Canonical progress and item state are read separately below; reserved operations still need reconciliation." : "Transaction finalized. Progress and ownership are read separately below.";
  }
  export(snapshot:ChainSnapshot) { return JSON.stringify({version:1,authority:"near-testnet",network:"testnet",root:this.root,itemContract:this.itemsContract,accountId:snapshot.binding.nearAccountId,lastReadAt:snapshot.readAt,journey:snapshot.journey,items:snapshot.items,contentVersion:CONTENT_VERSION,rulesVersion:RULES_VERSION},null,2); }
}
