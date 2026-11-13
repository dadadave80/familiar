import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {isAbsolute,join} from "node:path";
import {actions,base64Decode,base64Encode,baseDecode,baseEncode,createTransaction,decodeTransaction,encodeTransaction,JsonRpcProvider,KeyPairSigner,type AccessKeyViewRaw} from "near-api-js";
import {UnknownTransactionError} from "near-api-js/rpc-errors";
import {UPGRADE,assertDeployEnvelope,assertPreserved,assertUpgradePhase,submitUpgradeOnce,capture,quotes,loadCandidates,reviewDirectory,writePrivate,privateJSON,checkedKey,requireNoExecutionJournal,type UpgradeStep,type Snapshot,type Journal,type Review} from "./upgrade-tidebound-v2";
import {assertCodeOnlyUpgrade,verifyFinalOutcome} from "./tidebound-live";

export const PREPARED_ITEMS="HeE8Nt8NNDPRjmTqRdJXxNWmceND86QHzELhLb9Hx9HF";
export const REVIEW_SHA="bc31f49cf0ba464536006b04cabec0c9883c0f8cf6372f1156ab1894d045b542";
const RPC="https://test.rpc.fastnear.com",SPECS="/Users/dadadave/.codex/specs/familiar-tidebound-2026-11-12";
const json=(value:unknown)=>JSON.stringify(value,(_key,v)=>typeof v==="bigint"?v.toString():v,2)+"\n";
const hash=(value:Uint8Array)=>baseEncode(createHash("sha256").update(value).digest());
export interface PreparedProof {hash:string;unknownHash:string;account:string;permission:unknown;nonce:bigint;transactionNonce:bigint;originalBlockHash:string;returnedOriginalBlockHash:string;originalHeight:number;finalHash:string;finalHeight:number;accessHash:string;accessHeight:number;validity:number}
export function parseContinuationArguments(args:readonly string[]) {
 assert(args.every(a=>a.startsWith("--review-dir=")||a===`--items=${PREPARED_ITEMS}`||a==="--live"||a===`--approve=${REVIEW_SHA}`)&&new Set(args.map(a=>a.split("=")[0])).size===args.length,"Only this prepared Items hash and original review may be continued; no reset, replacement or generic resume.");
 const directory=args.find(a=>a.startsWith("--review-dir="))?.slice(13),live=args.includes("--live");
 assert(directory&&isAbsolute(directory)&&args.includes(`--items=${PREPARED_ITEMS}`));assert(live===args.includes(`--approve=${REVIEW_SHA}`),"Live continuation requires the exact original review SHA; default is read-only.");return {directory,live};
}
export function assertPreparedJournal(value:unknown):asserts value is Journal {
 const j=value as Journal;assert(j&&j.version===1&&j.kind==="private-two-contract-v2-execution"&&j.network==="testnet"&&j.root===UPGRADE.root&&j.reviewSha256===REVIEW_SHA&&j.status==="stopped-review-required");
 assert(!j.continuations?.length&&Array.isArray(j.steps)&&j.steps.length===1,"This exact prepared-only stop may be continued once; never reset a journal.");
 const s=j.steps[0]!;assert(s.name==="items"&&s.account===UPGRADE.items&&s.hash===PREPARED_ITEMS&&s.state==="prepared"&&typeof s.transaction==="string"&&typeof s.signedTransaction==="string"&&!s.outcome);
 assert(Array.isArray(j.observations)&&j.observations.some(o=>o&&typeof o==="object"&&"label" in o&&o.label==="stop"&&/429/.test(JSON.stringify(o))),"The original reviewed429 stop history must remain.");
}
export function assertUnusedPreparedProof(p:PreparedProof) {
 assert.equal(p.hash,PREPARED_ITEMS);assert.equal(p.unknownHash,PREPARED_ITEMS);assert.equal(p.account,UPGRADE.items);assert.equal(p.permission,"FullAccess");assert(p.nonce>=0n&&p.nonce+1n===p.transactionNonce,"The original signing nonce was consumed, superseded or cannot be proved unused.");
 assert.equal(p.originalBlockHash,p.returnedOriginalBlockHash);assert.equal(p.accessHash,p.finalHash);assert.equal(p.accessHeight,p.finalHeight);
 assert([p.originalHeight,p.finalHeight,p.accessHeight,p.validity].every(Number.isSafeInteger)&&p.originalHeight>=0&&p.finalHeight>=p.originalHeight&&p.validity>0&&p.finalHeight-p.originalHeight<=p.validity,"Original signed bytes expired or block/validity evidence is incomplete. Never replace their nonce.");
}
/** One queue for ALL fetches, including Promise.all view helpers. No retry on429 or other errors. */
export class RpcPacer {
 private tail:Promise<unknown>=Promise.resolve();
 constructor(private readonly delay=250,private readonly sleep:(ms:number)=>Promise<unknown>=ms=>Bun.sleep(ms)){assert(Number.isSafeInteger(delay)&&delay>=0);}
 run<T>(work:()=>Promise<T>):Promise<T>{const result=this.tail.then(async()=>{await this.sleep(this.delay);return work();});this.tail=result.then(()=>undefined,()=>undefined);return result;}
}
async function withPacedRpc<T>(work:()=>Promise<T>) {
 const original=globalThis.fetch,pacer=new RpcPacer();
 globalThis.fetch=Object.assign(async(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{
  const url=new URL(input instanceof Request?input.url:String(input));assert.equal(url.href,new URL(RPC).href,"Continuation RPC is fixed to the reviewed testnet endpoint.");
  return pacer.run(()=>original(input,{...init,redirect:"error"}));
 },{preconnect:original.preconnect});
 try{return await work();}finally{globalThis.fetch=original;}
}
export async function submitPreparedItems(step:UpgradeStep,continuation:Record<string,unknown>,submit:()=>Promise<unknown>,persist:()=>Promise<void>) {
 assert(step.name==="items"&&step.hash===PREPARED_ITEMS&&step.state==="prepared"&&continuation.stage==="approved");
 continuation.stage="resumed-submitted";step.state="submitted";await persist();
 try{return await submit();}catch(error){continuation.stage="uncertain";step.state="uncertain";await persist();throw error;}
}
function boundedQuotes(snapshot:Snapshot,review:Review) {
 const q=quotes(snapshot);for(const name of ["items","root"] as const)assert(q[name].required<=BigInt(review.quotes[name].required),"Current conservative quote exceeds the original exact reviewed amount. Stop without new funding.");return q;
}
type Resolution={kind:"unsubmitted";snapshot:Snapshot;proof:PreparedProof}|{kind:"final";snapshot:Snapshot;outcome:unknown};
export async function captureAfterFinalItems(outcome:unknown,baseline:Snapshot,read:()=>Promise<Snapshot>,checkBudget:(snapshot:Snapshot)=>unknown) {
 verifyFinalOutcome(outcome,{hash:PREPARED_ITEMS,signer:UPGRADE.items,receiver:UPGRADE.items});assertCodeOnlyUpgrade(outcome.transaction.actions,UPGRADE.candidates.items.codeHash);
 // The receipt may become FINAL after the earlier snapshot. Only a newly captured phase1
 // snapshot can accompany positive evidence; a stale pre-submission view is never used here.
 const current=await read();assertUpgradePhase(current,1);assertPreserved(baseline,current);checkBudget(current);return current;
}
async function resolvePrepared(provider:JsonRpcProvider,step:UpgradeStep,review:Review,codes:Awaited<ReturnType<typeof loadCandidates>>):Promise<Resolution> {
 assertDeployEnvelope(step,UPGRADE.candidates.items,codes.items);const tx=decodeTransaction(base64Decode(step.transaction));
 const snapshot=await capture(provider);assertPreserved(review.baseline,snapshot);boundedQuotes(snapshot,review);
 let unknown=false;
 try{
  const outcome=await provider.viewTransactionStatusWithReceipts({txHash:PREPARED_ITEMS,accountId:UPGRADE.items,waitUntil:"NONE"});
  const current=await captureAfterFinalItems(outcome,review.baseline,()=>capture(provider),s=>boundedQuotes(s,review));return {kind:"final",snapshot:current,outcome};
 }catch(error){if(error instanceof UnknownTransactionError&&error.txHash===PREPARED_ITEMS)unknown=true;else throw error;}
 assert(unknown);assertUpgradePhase(snapshot,0);
 const originalBlockHash=baseEncode(new Uint8Array(tx.blockHash)),original=await provider.viewBlock({blockId:originalBlockHash}),access=await provider.query<AccessKeyViewRaw>({request_type:"view_access_key",account_id:UPGRADE.items,public_key:tx.publicKey.toString(),block_id:snapshot.block.hash});
 assert(typeof access.nonce==="number"&&Number.isSafeInteger(access.nonce)&&access.nonce>=0);
 const validity=(snapshot.protocol as {chain_id:string;transaction_validity_period:number});assert.equal(validity.chain_id,"testnet");
 const proof:PreparedProof={hash:step.hash,unknownHash:PREPARED_ITEMS,account:UPGRADE.items,permission:access.permission,nonce:BigInt(access.nonce),transactionNonce:tx.nonce,originalBlockHash,returnedOriginalBlockHash:original.header.hash,originalHeight:original.header.height,finalHash:snapshot.block.hash,finalHeight:snapshot.block.height,accessHash:access.block_hash,accessHeight:access.block_height,validity:validity.transaction_validity_period};assertUnusedPreparedProof(proof);
 return {kind:"unsubmitted",snapshot,proof};
}
async function main(){
 const options=parseContinuationArguments(process.argv.slice(2)),directory=await reviewDirectory(options.directory),reviewPath=join(directory,"v2-upgrade-review.json"),journalPath=join(directory,"v2-upgrade-execution.json"),fencePath=join(SPECS,"v2-upgrade-execution-lock.json"),continuationFence=join(SPECS,"v2-upgrade-prepared-items-continuation-lock.json");
 const saved=await privateJSON(reviewPath);assert.equal(saved.sha256,REVIEW_SHA);const review=saved.value as Review;assert.deepEqual(review.policy,UPGRADE);assertUpgradePhase(review.baseline,0);
 const original=await privateJSON(journalPath),journal=original.value;assertPreparedJournal(journal);const fence=(await privateJSON(fencePath)).value as Record<string,unknown>;assert(fence.kind==="permanent-v2-upgrade-execution-fence"&&fence.reviewPath===reviewPath&&fence.reviewSha256===REVIEW_SHA&&fence.journalPath===journalPath&&fence.startedAt===journal.startedAt);
 if(options.live)await requireNoExecutionJournal(continuationFence);
 const codes=await loadCandidates(),provider=new JsonRpcProvider({url:RPC},{retries:1}),step=journal.steps[0]!,resolution=await resolvePrepared(provider,step,review,codes);
 if(!options.live){console.info(json({mode:"READ_ONLY_EXACT_ENVELOPE_RESOLUTION",reviewSHA:REVIEW_SHA,itemsHash:PREPARED_ITEMS,disposition:resolution.kind==="final"?"EXACT_ITEMS_ALREADY_FINAL_ROOT_NOT_SIGNED":"EXACT_ITEMS_UNKNOWN_UNUSED_VALID_SAME_BYTES_ELIGIBLE",block:resolution.snapshot.block,...(resolution.kind==="unsubmitted"?{proof:resolution.proof}:{}),signatures:0,submissions:0,journalWritten:false,oldStopRetained:true,pacingMs:250}));return;}
 // Verify configured control before submitting Items; no fresh transaction signature exists yet.
 const key=checkedKey(),originalTx=decodeTransaction(base64Decode(step.transaction));assert.equal(key.getPublicKey().toString(),originalTx.publicKey.toString());
 const rootAccess=await provider.query<AccessKeyViewRaw>({request_type:"view_access_key",account_id:UPGRADE.root,public_key:key.getPublicKey().toString(),block_id:resolution.snapshot.block.hash});assert(rootAccess.permission==="FullAccess"&&rootAccess.block_hash===resolution.snapshot.block.hash&&rootAccess.block_height===resolution.snapshot.block.height);
 const continuation:Record<string,unknown>={kind:"exact-prepared-Items429-continuation",stage:"approved",startedAt:new Date().toISOString(),originalStatus:journal.status,originalJournalSha256:original.sha256,originalItemsHash:PREPARED_ITEMS,originalTransactionSha256:createHash("sha256").update(step.transaction).digest("hex"),originalSignedEnvelopeSha256:createHash("sha256").update(step.signedTransaction).digest("hex"),originalStopCount:journal.observations.length,resolution:resolution.kind,...(resolution.kind==="unsubmitted"?{proof:resolution.proof}:{})};
 await writePrivate(continuationFence,{kind:"permanent-exact-prepared-continuation-fence",reviewSHA:REVIEW_SHA,itemsHash:PREPARED_ITEMS,journalPath,startedAt:continuation.startedAt},true);
 journal.continuations=[continuation];journal.status="reviewed-continuation-in-progress";const persist=()=>writePrivate(journalPath,journal);await persist();
 try{
  let outcome:unknown;
  if(resolution.kind==="final"){outcome=resolution.outcome;continuation.stage="existing-positive-final-evidence";}
  else {
   // Re-prove the SAME envelope immediately before its one authorized HTTP submission.
   const fresh=await resolvePrepared(provider,step,review,codes);
   if(fresh.kind==="final"){outcome=fresh.outcome;continuation.stage="arrived-positive-final-evidence";}
   else {continuation.proofBeforeSubmission=fresh.proof;await persist();const durable=(await privateJSON(journalPath)).value as Journal;assert.equal(durable.steps[0]?.transaction,step.transaction);assert.equal(durable.steps[0]?.signedTransaction,step.signedTransaction);assert.equal(durable.steps[0]?.hash,PREPARED_ITEMS);outcome=await submitPreparedItems(step,continuation,()=>provider.sendTransactionUntil(assertDeployEnvelope(step,UPGRADE.candidates.items,codes.items),"FINAL"),persist);}
  }
  step.outcome=outcome;await persist();verifyFinalOutcome(outcome,{hash:PREPARED_ITEMS,signer:UPGRADE.items,receiver:UPGRADE.items});assertCodeOnlyUpgrade(outcome.transaction.actions,UPGRADE.candidates.items.codeHash);step.state="final";await persist();
  const afterItems=await capture(provider);step.after=afterItems;await persist();assertUpgradePhase(afterItems,1);assertPreserved(review.baseline,afterItems);boundedQuotes(afterItems,review);continuation.stage="items-final-code-state-verified";await persist();
  // Root receives its first transaction signature ONLY after the exact Items receipt and state readback.
  assert.equal(journal.steps.length,1);const before=await capture(provider);assertUpgradePhase(before,1);assertPreserved(review.baseline,before);const q=boundedQuotes(before,review),artifact=UPGRADE.candidates.root;
  const access=await provider.query<AccessKeyViewRaw>({request_type:"view_access_key",account_id:UPGRADE.root,public_key:key.getPublicKey().toString(),block_id:before.block.hash});assert(access.permission==="FullAccess"&&access.block_hash===before.block.hash&&access.block_height===before.block.height&&Number.isSafeInteger(access.nonce)&&access.nonce>=0);
  const tx=createTransaction(UPGRADE.root,key.getPublicKey(),UPGRADE.root,BigInt(access.nonce)+1n,[actions.deployContract(codes.root)],baseDecode(before.block.hash)),signed=(await new KeyPairSigner(key).signTransaction(tx)).signedTransaction;
  const rootStep:UpgradeStep={name:"root",account:UPGRADE.root,hash:hash(encodeTransaction(tx)),transaction:base64Encode(encodeTransaction(tx)),signedTransaction:base64Encode(signed.encode()),state:"prepared",prepayment:q.root};assertDeployEnvelope(rootStep,artifact,codes.root);journal.steps.push(rootStep);continuation.stage="root-original-envelope-prepared";await persist();
  const fresh=await capture(provider);assertUpgradePhase(fresh,1);assertPreserved(review.baseline,fresh);boundedQuotes(fresh,review);
  const nonce=await provider.query<AccessKeyViewRaw>({request_type:"view_access_key",account_id:UPGRADE.root,public_key:key.getPublicKey().toString(),block_id:fresh.block.hash});assert(nonce.permission==="FullAccess"&&nonce.block_hash===fresh.block.hash&&nonce.block_height===fresh.block.height&&nonce.nonce===access.nonce);
  const validity=(fresh.protocol as {transaction_validity_period:number}).transaction_validity_period;assert(Number.isSafeInteger(validity)&&validity>0&&fresh.block.height>=before.block.height&&fresh.block.height-before.block.height<=validity);
  const durable=(await privateJSON(journalPath)).value as Journal;assert.equal(durable.steps.at(-1)?.signedTransaction,rootStep.signedTransaction);assert.equal(durable.steps.at(-1)?.hash,rootStep.hash);
  const rootOutcome=await submitUpgradeOnce(rootStep,()=>provider.sendTransactionUntil(assertDeployEnvelope(rootStep,artifact,codes.root),"FINAL"),persist);rootStep.outcome=rootOutcome;await persist();verifyFinalOutcome(rootOutcome,{hash:rootStep.hash,signer:UPGRADE.root,receiver:UPGRADE.root});assertCodeOnlyUpgrade(rootOutcome.transaction.actions,artifact.codeHash);rootStep.state="final";await persist();
  const afterRoot=await capture(provider);rootStep.after=afterRoot;await persist();assertUpgradePhase(afterRoot,2);assertPreserved(review.baseline,afterRoot);continuation.stage="complete";journal.status="complete";await persist();
  console.info(json({status:"complete",reviewSHA:REVIEW_SHA,itemsHash:PREPARED_ITEMS,rootHash:rootStep.hash,finalBlock:afterRoot.block,originalStopRetained:true,pacingMs:250,note:"Exact original Items signed bytes; one new Root code-only action after final Items proof. No initialization, funding, migration or state restoration."}));
 }catch(error){journal.status="stopped-review-required";continuation.stoppedAt=new Date().toISOString();continuation.error=error instanceof Error?{name:error.name,message:error.message.slice(0,500)}:{name:"UnknownError"};await persist();throw Error("Exact continuation stopped. Preserve both execution fences, every historical stop and signed bytes; no retry or replacement nonce is permitted.",{cause:error});}
}
if(import.meta.main)await withPacedRpc(main);
