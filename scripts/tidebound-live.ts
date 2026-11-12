import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {lstat,mkdir,readFile,rename,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {actions,base64Decode,base64Encode,baseDecode,baseEncode,createTransaction,decodeSignedTransaction,decodeTransaction,encodeTransaction,JsonRpcProvider,KeyPair,KeyPairSigner,nearToYocto,teraToGas,type AccessKeyViewRaw,type KeyPairString,type SignedTransaction,type Transaction} from "near-api-js";
import {AccountDoesNotExistError,UnknownTransactionError} from "near-api-js/rpc-errors";
import {nativeGas,parseJourney,type CraftItem,type MintEvidence,type Journey} from "../web/src/tidebound/client";
import {assertTideboundProtocol} from "../web/src/tidebound/protocol";
import {replayOuting} from "../web/src/outing/engine";
import {validateNativeIntent} from "../services/relayer/src/auth/sign";
import {confirmedValue} from "../services/relayer/src/outcome";
import {nativePrepayment} from "../web/src/tidebound/affordability";
import {quoteItemStorage} from "../web/src/tidebound/storage";

export const QA_ROOT="familiar-game.testnet";
export const REVIEWED_REJECTION="GEM4htbgzFsALXdG6xYCprBtZgYUDdmTygQ9aSUKi2ng";
export const POST_DOCK_CHECKPOINT="AyyT5Rx8DK7v5prNnAQo1HjLrs2ZR7WSsiMdAyuZLBrH";
export const POST_DOCK_STEPS=["create-maker","fund-maker","adopt-maker","create-holder","fund-holder","adopt-holder","reviewed-recovery-topup-holder","add-operator-second-key","maker-lens-moth","known-final-claim-retry","restore-beacon","maker-wind-vane","restore-signal","commission-once","known-final-commission-retry","reviewed-recovery-maker-float","concurrent-craft-primary","concurrent-craft-second-key","known-final-craft-retry","polish-once","known-final-polish-retry","place-porch","place-dock"] as const;
export const POST_DOCK_HASHES=["2iBMq6sAdhZuobiuyvAv4AfBW7QEhebwMseLXB4R4Ar8","5qA9KSkLf5FJifwGBxhoJvuM1jbp2B1FKTJx3xvLCEd6","5of2VGobpHPJaWSmD9rUUtxif4jMnibC1wNDXQ7yhziz","HFRJhXXVYoG1T3Cxr1Rgc6HjADh6diGYEL55KSeCouTa","Fw3Cgyw3Hq7YNnWT4KXhGoNqhUA9WzGfjdwWNL4TBptS",REVIEWED_REJECTION,"7hdyHcrqbGudJAtixihMqpxE6DjU7igCAzcsFP9883bg","9NiJE1wgMMf3zjUEjTEHsaN6fTTnD2DT9UxKJCWFHWA","B3xbiWA3CKQpAe2z5H15h7XUco9rvkPbCqYRQtMdn6DJ","4D7LTzMqhmaW5feyNBGQ3oTHoZh1rfdAHoDY4UuXR5rh","Gt6ZX8aU6BZioeqmSsDREppu87yCpoELrJdHQSY15KDT","8mFPpLVagoSYmrrnncuk9uZ8CDrMKHrSk7ZB1kM3c5sk","iAQZXKTGMd6TCaLaGM2odKVGbzUECVmEoU2hzf4iGWY","BSxXUqX2wmEC5cHeXYRrxKKrhHDG4YjNaW4ErEmmDNhh","7PfRtHAoJct8CHRYEt4mwGHwgYMmmyGKZnoRbXPZKugR","AxEHmp8tyc3AiZs6AXtrMULNpm1WMuDjYceg7wBmYCRq","4iH2TrYYHfZauUUjaENC8sWxKdwXbW4U6PEVLdhvKvHo","4RziqTc7uyh5nRMYp5Aez2kHRLNTsi9bPQ7NEtt75sTH","9fgvs5RzKtP4hTSoG691RP4813pPiSXLgDJi3rB4v23u","FZaNh7ApXg4WJNNh7RpwNAkNkqiwmTToHRRFgKjMNmyg","AJPN4KKBA15ZDkyE45QTHHMVU1M2Es1g96HzDmC1Judv","EJRUiKLfvHcbmoteQAzSz1bXhSC3SkjnxhCj6cSKexDA",POST_DOCK_CHECKPOINT] as const;
const ORIGINAL_ROOT_HASH="9tLpC99keMSufRQX9bXhxVjDNw5Yys68t54ezUpZr61q";
const ITEMS=`items.${QA_ROOT}`,RPC="https://test.rpc.fastnear.com",POOL="kiln.pool.f863973.m0";
const names={maker:"qa-maker-h1",holder:"qa-holder-h1"} as const;
const pets={maker:`qa-mochi-h1.${QA_ROOT}`,holder:`qa-bramble-h1.${QA_ROOT}`} as const;
const topups={maker:nearToYocto("0.20"),holder:nearToYocto("0.10")};
const KEY_FILE=".data/tidebound-h1-qa-keys.json",EVIDENCE_FILE=".data/tidebound-h1-qa-evidence.json";
const RULES="tidebound_h1_v1",CONTENT="first_light_v1";
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const bytesHash=(bytes:Uint8Array)=>baseEncode(createHash("sha256").update(bytes).digest());
type Outcome=Awaited<ReturnType<JsonRpcProvider["sendTransactionUntil"]>>;
type Action=Transaction["actions"][number];
type Actor={role:"root"|"relayer"|"maker"|"maker-device"|"holder";account:string;key:KeyPair};
type PrivateQA={version:1;kind:"operator-QA-not-Privy";network:"testnet";root:string;keys:{maker:string;makerDevice:string;holder:string}};
type Artifact={name:string;bytes:number;codeHash:string};
type Step={name:string;signer:string;receiver:string;method:string;hash:string;transaction:string;signedTransaction:string;state:"prepared"|"submitted"|"final"|"uncertain";expectedFailure?:string;outcome?:unknown;prepayment?:unknown};
type Evidence={version:number;kind:string;network:string;root:string;startedAt:string;status:string;artifacts:Artifact[];accounts:{maker:string;holder:string};publicKeys:{maker:string;makerDevice:string;holder:string};extraNativeTopupCapYocto:string;factoryEndowmentCapYocto?:string;steps:Step[];checks:{label:string;value:unknown}[];limits:string[];reviews?:Record<string,unknown>[];continuations?:Record<string,unknown>[]};
export interface ResumeProof {hash:string;binding:string;permission:unknown;nonce:bigint;originalNonce:bigint;unknownTransactionHash:string;petNFTAbsent:boolean;petAccountAbsent:boolean;originalHash:string;returnedOriginalHash:string;finalHash:string;accessBlockHash:string;accountBlockHash:string;finalHeight:number;accessHeight:number;originalHeight:number;validity:number}

export function parseLiveArguments(args:readonly string[]) {
  const reviewed=args.length===3&&args[0]==="--live"&&args[1]===`--resume-known-rejection=${REVIEWED_REJECTION}`&&/^--root-upgrade=[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(args[2]!);
  const postDock=args.length===2&&args[0]==="--live"&&args[1]===`--continue-post-dock=${POST_DOCK_CHECKPOINT}`;
  assert(args.length===0 || args.length===1&&args[0]==="--live" || reviewed || postDock,"Use --live alone, the exact reviewed rejection and Root-upgrade receipt, or the exact post-dock checkpoint; no reset or generic resume is allowed.");
  return args.length>0;
}
export function assertResumeProof(p:ResumeProof) {
  assert.equal(p.hash,REVIEWED_REJECTION);assert.equal(p.unknownTransactionHash,REVIEWED_REJECTION);
  assert.equal(p.binding,`${names.holder}.${QA_ROOT}`);assert.equal(p.permission,"FullAccess");assert(p.nonce>=0n&&p.nonce+1n===p.originalNonce,"Original nonce may not have been consumed or superseded.");
  assert(p.petNFTAbsent&&p.petAccountAbsent,"The original adoption must still be absent.");
  assert.equal(p.originalHash,p.returnedOriginalHash);assert.equal(p.accessBlockHash,p.finalHash);assert.equal(p.accountBlockHash,p.finalHash);assert.equal(p.accessHeight,p.finalHeight);
  assert([p.finalHeight,p.originalHeight,p.validity].every(Number.isSafeInteger)&&p.originalHeight>=0&&p.validity>0&&p.finalHeight>=p.originalHeight&&p.finalHeight-p.originalHeight<=p.validity,"An expired or unverifiable original transaction is never re-signed.");
}
export function reviewedTopup(amount:bigint) {
  assert(amount>=0n);const target=nearToYocto("0.25"),additional=amount<target?target-amount:0n;
  assert(additional<=nearToYocto("0.10"),"The single reviewed recovery top-up exceeds 0.10 testNEAR.");return additional;
}
export function assertConcurrentPrepayment(available:bigint,required:bigint[]) {
  assert(required.length===2&&required.every(value=>value>0n));
  assert(available>required.reduce((sum,value)=>sum+value,0n)+nearToYocto("0.004"),"The shared QA account cannot fund BOTH simultaneous native reservations.");
}
export function reviewedMakerFloat(available:bigint,required:bigint[]) {
  assert(required.length===2&&required.every(value=>value>0n));
  const minimum=required.reduce((sum,value)=>sum+value,0n)+nearToYocto("0.004");
  if(available>minimum)return 0n;
  const additional=minimum+nearToYocto("0.02")-available;
  assert(additional>0n&&additional<=nearToYocto("0.10"),"The single reviewed maker float exceeds 0.10 testNEAR.");return additional;
}
export function assertCodeOnlyUpgrade(value:unknown,expectedCodeHash:string) {
  assert(Array.isArray(value)&&value.length===1,"The reviewed upgrade must contain exactly one action.");
  const action=value[0];assert(action&&typeof action==="object"&&Object.keys(action).length===1&&"DeployContract" in action,"The reviewed upgrade must be code-only, without new/init/migration actions.");
  const deploy=action.DeployContract;assert(deploy&&typeof deploy==="object"&&Object.keys(deploy).length===1&&"code" in deploy&&typeof deploy.code==="string","Malformed deployment action.");
  // nearcore ActionView replaces deployed bytecode with its SHA256 digest, serialized as base64.
  // https://github.com/near/nearcore/blob/master/core/primitives/src/views.rs (From<Action>)
  const codeHash=base64Decode(deploy.code);
  assert(codeHash.length===32&&base64Encode(codeHash)===deploy.code,"The RPC deployment code must be a canonical base64 SHA256 digest.");
  assert.equal(baseDecode(expectedCodeHash).length,32);assert.equal(baseEncode(codeHash),expectedCodeHash);
}
/** Decode bytes only; the QA policy and shared native allowlist still authorize the parsed fields. */
export function qaFunctionArgs(value:unknown):Record<string,unknown> {
  assert(value instanceof Uint8Array||Array.isArray(value)&&value.every(byte=>Number.isInteger(byte)&&byte>=0&&byte<=255),"Function arguments must be SDK bytes, never a JSON/base64 string fallback.");
  assert(value.length<=8192);const bytes=new Uint8Array(value);
  const parsed:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  assert(parsed&&typeof parsed==="object"&&!Array.isArray(parsed),"Function arguments must be an object.");return parsed as Record<string,unknown>;
}
export function assertExactQAAction(tx:Transaction,expected:Action) {
  // Constructed SDK actions have enum tags; decoded Borsh actions do not. Compare canonical bytes.
  const intended=createTransaction(tx.signerId,tx.publicKey,tx.receiverId,tx.nonce,[expected],new Uint8Array(tx.blockHash));
  assert.equal(base64Encode(encodeTransaction(tx)),base64Encode(encodeTransaction(intended)),"The QA action differs from its exact reviewed intent.");
}
export function qaStorageDeposit(value:unknown) {
  const quote=quoteItemStorage(value,null);assert(quote.deposit===nearToYocto("0.02"),"Storage bounds exceed the existing 0.02 testNEAR QA budget.");return quote.deposit;
}
export function assertPostDockJournal(value:unknown):asserts value is Evidence {
  const p=value as Evidence;
  assert(p&&p.version===1&&p.kind==="operator-controlled-QA-not-Privy-recovery"&&p.network==="testnet"&&p.root===QA_ROOT&&p.status==="stopped-review-required");
  assert(p.reviews?.length===1&&!p.continuations?.length,"This exact post-dock continuation may be attempted only once.");
  assert(p.reviews[0]?.originalHash===REVIEWED_REJECTION);assert(Array.isArray(p.steps));
  assert.deepEqual(p.steps.map(s=>s.name),POST_DOCK_STEPS);assert(p.steps.every(s=>s.state==="final"));
  assert.deepEqual(p.steps.map(s=>s.hash),POST_DOCK_HASHES,"The continuation requires every original checkpoint receipt, without substitution.");
  assert.equal(new Set(p.steps.map(s=>s.hash)).size,p.steps.length);assert.equal(p.steps.at(-1)?.hash,POST_DOCK_CHECKPOINT);
}
export function assertPostDockState(makerValue:unknown,holderValue:unknown,itemValue:unknown,supply:string,makerBalance:string,holderBalance:string) {
  const j=parseJourney(makerValue),minted=assertCanonicalCraft(j,itemValue,supply,`${names.maker}.${QA_ROOT}`);
  assert.equal(j.revision,11);assert.deepEqual(j.banked,["lens","moth","vane"]);assert(j.lit&&j.signaled&&j.commission_fulfilled);
  assert.equal(j.workshop_salvage,0);assert.equal(j.bram_budget,0);assert.equal(j.shells,0);assert.equal(j.burned_shells,12);assert.equal(j.polish?.state,"confirmed");
  assert.deepEqual(j.placement,{item_id:minted.mint.token_id,socket:"dock"});assert.equal(minted.finish,"harbor_polish");assert.equal(minted.finish_used,true);assert.equal(minted.appearance_version,1);
  assert.equal(makerBalance,"1");assert.equal(holderBalance,"0");assertNoInheritedAchievement(holderValue);
  const holder=parseJourney(holderValue);assert.equal(holder.revision,0);assert.equal(holder.placement,null);return minted;
}
export function expectedMint(maker:string,origin:string):MintEvidence {
  const id=digest(["familiar.craft.v1","testnet",QA_ROOT,maker,"first_light","first_light_craft_credit"]);
  const token_id=`lantern:${digest(["familiar.item.v1","testnet",ITEMS,QA_ROOT,maker,id])}`;
  return {id,token_id,maker,origin_claim_id:origin,motif:"crest",input_hash:digest(["familiar.mint.v1","testnet",ITEMS,QA_ROOT,maker,id,token_id,origin,"first_light_lantern_v1","crest",RULES,CONTENT]),rules_version:RULES,content_version:CONTENT};
}
export function assertAllocation(value:unknown,commissioned:boolean) {
  const j=parseJourney(value);
  assert(j.lens_claim&&j.credit==="available","Protected first-light credit must remain available.");
  assert.equal(j.workshop_salvage,commissioned?0:1);assert.equal(j.bram_budget,commissioned?0:12);
  assert.equal(j.shells,commissioned?12:0);assert.equal(j.commission_fulfilled,commissioned);assert.equal(j.burned_shells,0);
  return j;
}
export function assertCanonicalCraft(value:unknown,item:unknown,supply:string,maker:string) {
  const j=parseJourney(value),actual=item as CraftItem;
  assert.equal(supply,"1");assert.equal(j.credit,"consumed");assert.equal(j.craft?.state,"confirmed");assert(j.lens_claim);
  const expected=expectedMint(maker,j.lens_claim);
  assert.deepEqual(j.craft.evidence,expected);assert.deepEqual(actual?.mint,expected);
  return actual;
}
export function assertNoInheritedAchievement(value:unknown) {
  const j=parseJourney(value);
  assert.deepEqual(j.banked,[]);assert.equal(j.lens_claim,null);assert.equal(j.moth_claim,null);
  assert.equal(j.lit,false);assert.equal(j.signaled,false);assert.equal(j.credit,"unclaimed");assert.equal(j.craft,null);
  assert.equal(j.workshop_salvage,0);assert.equal(j.bram_budget,0);assert.equal(j.shells,0);assert.equal(j.burned_shells,0);assert.equal(j.commission_fulfilled,false);
}
export function assertPlacement(beforeValue:unknown,afterValue:unknown,itemId:string,socket:"porch"|"dock") {
  const before=parseJourney(beforeValue),after=parseJourney(afterValue);
  assert.deepEqual(after.placement,{item_id:itemId,socket});assert.equal(after.revision,before.revision+1);
  assert.deepEqual({...after,revision:before.revision,placement:before.placement},before,"Placement must preserve the personal earned state.");
}
const failure=(value:unknown):value is {Failure:unknown}=>!!value&&typeof value==="object"&&"Failure" in value;
export function verifyFinalOutcome(value:unknown,expected:{hash:string;signer:string;receiver:string},expectedFailure?:RegExp,failureExecutor=expected.receiver):asserts value is Outcome {
  const o=value as Outcome;
  assert(o&&o.final_execution_status==="FINAL","Unknown finality: preserve original signed bytes and stop.");
  assert.equal(o.transaction?.hash,expected.hash);assert.equal(o.transaction.signer_id,expected.signer);assert.equal(o.transaction.receiver_id,expected.receiver);
  assert(o.status&&typeof o.status==="object"&&("SuccessValue" in o.status||"Failure" in o.status));
  assert(Array.isArray(o.receipts_outcome)&&o.receipts_outcome.length>0,"Full receipt evidence is required.");
  const receipts=new Map(o.receipts_outcome.map(r=>[r.id,r]));
  assert.equal(receipts.size,o.receipts_outcome.length,"Duplicate receipt IDs are ambiguous.");
  for(const r of o.receipts_outcome)assert(typeof r.id==="string"&&r.id.length>0&&typeof r.outcome?.executor_id==="string");
  function terminal(status:unknown,seen=new Set<string>()):void {
    assert(status&&typeof status==="object"&&Object.keys(status).length===1,"A receipt status is unknown or malformed.");
    if("SuccessValue" in status){assert.equal(typeof status.SuccessValue,"string");return;}
    if("Failure" in status){assert(status.Failure&&typeof status.Failure==="object");return;}
    assert("SuccessReceiptId" in status&&typeof status.SuccessReceiptId==="string","A receipt is not terminal.");
    const id=status.SuccessReceiptId;assert(!seen.has(id)&&receipts.has(id),"A receipt pointer is cyclic or missing.");
    seen.add(id);terminal(receipts.get(id)!.outcome.status,seen);
  }
  const transaction=o.transaction_outcome;
  assert.equal(transaction?.id,expected.hash);assert.equal(transaction.outcome?.executor_id,expected.signer);
  const transactionStatus=transaction.outcome.status;
  assert(transactionStatus&&typeof transactionStatus==="object"&&"SuccessReceiptId" in transactionStatus,"The transaction itself did not succeed into a receipt.");
  assert.equal(receipts.get(transactionStatus.SuccessReceiptId)?.outcome.executor_id,expected.receiver,"The transaction points to a different receiver receipt.");
  terminal(transactionStatus);
  for(const r of o.receipts_outcome)terminal(r.outcome.status);
  const failed=o.receipts_outcome.filter(r=>failure(r.outcome.status));
  if(expectedFailure){
    assert(failed.length>0,"The specifically expected rejection did not occur.");
    for(const r of failed){assert.equal(r.outcome.executor_id,failureExecutor);assert(expectedFailure.test(JSON.stringify(r.outcome.status)),"An unrelated failure cannot pass a negative ownership test.");}
    if(failure(o.status))assert(expectedFailure.test(JSON.stringify(o.status)));
  }else assert(!failure(o.status)&&failed.length===0,"A receipt failed; preserve its evidence and stop.");
}

function checkedKey(value:unknown):KeyPair {
  assert(typeof value==="string"&&value.startsWith("ed25519:"),"Missing operator key; no replacement is authorized.");
  const bytes=baseDecode(value.slice(8)),key=KeyPair.fromString(value as KeyPairString),publicKey=key.getPublicKey();
  assert(bytes.length===64&&publicKey.data.every((byte,i)=>bytes[i+32]===byte),"Operator key is inconsistent.");
  const challenge=new TextEncoder().encode("familiar:operator-QA-key-check:v1");assert(publicKey.verify(challenge,key.sign(challenge).signature));return key;
}
async function privateFile(path:string) {
  const info=await lstat(path);assert(info.isFile()&&!info.isSymbolicLink()&&(info.mode&0o777)===0o600,"QA evidence and keys require regular mode-0600 files.");
  return JSON.parse(await readFile(path,"utf8"));
}
async function qaKeys(allowCreate=true):Promise<PrivateQA> {
  async function read():Promise<PrivateQA>{
    const saved=await privateFile(KEY_FILE) as PrivateQA;
    assert(saved.version===1&&saved.kind==="operator-QA-not-Privy"&&saved.network==="testnet"&&saved.root===QA_ROOT,"Existing QA keys belong to a different run/stack; preserve them.");
    const keys=[saved.keys.maker,saved.keys.makerDevice,saved.keys.holder].map(checkedKey);
    assert.equal(new Set(keys.map(k=>k.getPublicKey().toString())).size,3);return saved;
  }
  if(await Bun.file(KEY_FILE).exists())return read();
  assert(allowCreate,"Reviewed resume never generates or replaces QA keys.");
  const saved:PrivateQA={version:1,kind:"operator-QA-not-Privy",network:"testnet",root:QA_ROOT,keys:{maker:KeyPair.fromRandom("ed25519").toString(),makerDevice:KeyPair.fromRandom("ed25519").toString(),holder:KeyPair.fromRandom("ed25519").toString()}};
  try{await writeFile(KEY_FILE,JSON.stringify(saved,null,2)+"\n",{flag:"wx",mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}
  return read();
}

async function runLive(upgradeHash?:string,postDock=false) {
  const resume=!!upgradeHash||postDock;
  assert(process.env.NEAR_NETWORK==="testnet"&&process.env.NEAR_ROOT===QA_ROOT&&process.env.RELAYER_ID===`relayer.${QA_ROOT}`,"Only the reviewed isolated testnet tuple is permitted.");
  const previous=resume?await privateFile(EVIDENCE_FILE) as Evidence:null;
  if(!resume)assert(!await Bun.file(EVIDENCE_FILE).exists(),"Existing QA evidence must be reviewed; this one-shot driver never retries or replaces a previous run.");
  if(postDock)assertPostDockJournal(previous);
  else if(previous){
    assert(previous.version===1&&previous.kind==="operator-controlled-QA-not-Privy-recovery"&&previous.network==="testnet"&&previous.root===QA_ROOT&&previous.status==="stopped-review-required");
    assert(!previous.reviews?.length&&previous.steps.length===6,"This exact reviewed exception can be attempted only once; preserve later stops.");
    assert.deepEqual(previous.steps.map(s=>s.name),["create-maker","fund-maker","adopt-maker","create-holder","fund-holder","adopt-holder"]);
    assert(previous.steps.slice(0,5).every(s=>s.state==="final"));assert(previous.steps[5]?.hash===REVIEWED_REJECTION&&previous.steps[5].state==="uncertain");
  }
  const root:Actor={role:"root",account:QA_ROOT,key:checkedKey(process.env.ROOT_PRIVATE_KEY)};
  const relayer:Actor={role:"relayer",account:`relayer.${QA_ROOT}`,key:checkedKey(process.env.RELAYER_PRIVATE_KEY)};
  // retries=1 means one HTTP attempt in the pinned SDK. No transport retry can acquire a fresh nonce.
  const provider=new JsonRpcProvider({url:RPC},{retries:1});assert.equal(await provider.getNetworkId(),"testnet");
  const view=async<T=unknown>(contractId:string,method:string,args:Record<string,unknown>={}):Promise<T>=>provider.callFunction({contractId,method,args,blockQuery:{finality:"final"}}) as Promise<T>;
  assertTideboundProtocol(QA_ROOT,await view(QA_ROOT,"tidebound_protocol"),await view(ITEMS,"craft_protocol"));
  const artifacts:Artifact[]=[];
  for(const name of ["root","items","bakery","market","pet"]){
    const bytes=new Uint8Array(await Bun.file(`contracts/target/deploy/familiar_${name}.wasm`).arrayBuffer()),codeHash=bytesHash(bytes);
    if(name!=="pet")assert.equal((await provider.viewAccount({accountId:name==="root"?QA_ROOT:`${name}.${QA_ROOT}`,blockQuery:{finality:"final"}})).code_hash,codeHash,"Live bytecode differs from the frozen local artifact.");
    artifacts.push({name,bytes:bytes.length,codeHash});
  }
  assert.deepEqual(await view(QA_ROOT,"get_config"),{relayer:relayer.account,pet_code_hash:artifacts.find(a=>a.name==="pet")!.codeHash,items:ITEMS,bakery:`bakery.${QA_ROOT}`,market:`market.${QA_ROOT}`,pool:POOL});
  for(const actor of [root,relayer])assert.equal((await provider.viewAccessKey({accountId:actor.account,publicKey:actor.key.getPublicKey(),finalityQuery:{finality:"final"}})).permission,"FullAccess");
  const liquid=async(account:string)=>{const a=await provider.viewAccount({accountId:account,blockQuery:{finality:"final"}});return a.amount-BigInt(a.storage_usage)*10n**19n;};
  assert(await liquid(QA_ROOT)>=nearToYocto("2.25"),"Keep at least 2.25 liquid testNEAR for named endowments, bounded QA, storage and the root floor.");
  if(!resume)for(const name of [...Object.values(names),...Object.values(pets).map(p=>p.split(".")[0]!)]){
    const accountId=`${name}.${QA_ROOT}`;assert.equal(await view(QA_ROOT,"player_name_available",{username:name}),true,"QA name already reserved; do not substitute another wallet/name.");
    try{await provider.viewAccount({accountId,blockQuery:{finality:"final"}});throw Error("QA account already exists; inspect it instead of creating another.");}catch(error){if(!(error instanceof AccountDoesNotExistError)||error.accountId!==accountId)throw error;}
  }
  await mkdir(".data",{recursive:true});const directory=await lstat(".data");assert(directory.isDirectory()&&!directory.isSymbolicLink());
  for(const path of [KEY_FILE,EVIDENCE_FILE])assert.equal(Bun.spawnSync({cmd:["git","check-ignore","--quiet",path],stdout:"pipe",stderr:"pipe"}).exitCode,0,"Private QA artifacts must be ignored by Git.");
  const saved=await qaKeys(!resume),maker:Actor={role:"maker",account:`${names.maker}.${QA_ROOT}`,key:checkedKey(saved.keys.maker)},holder:Actor={role:"holder",account:`${names.holder}.${QA_ROOT}`,key:checkedKey(saved.keys.holder)},device:Actor={role:"maker-device",account:maker.account,key:checkedKey(saved.keys.makerDevice)};
  for(const actor of [maker,holder])assert.equal(await view(QA_ROOT,"get_player",{public_key:actor.key.getPublicKey().toString()}),resume?actor.account:null,"Existing stable QA binding needs review, not a replacement.");
  const evidence:Evidence=previous??{version:1,kind:"operator-controlled-QA-not-Privy-recovery",network:"testnet",root:QA_ROOT,startedAt:new Date().toISOString(),status:"in-progress",artifacts,accounts:{maker:maker.account,holder:holder.account},publicKeys:{maker:maker.key.getPublicKey().toString(),makerDevice:device.key.getPublicKey().toString(),holder:holder.key.getPublicKey().toString()},extraNativeTopupCapYocto:(topups.maker+topups.holder).toString(),factoryEndowmentCapYocto:nearToYocto("0.50").toString(),steps:[],checks:[],limits:["Two operator signing keys are not two physical devices or a Privy recovery demonstration.","No David player, wallet, item or legacy registry is used.","Timeout, RPC error, uncertain finality or failed assertions stop without automatic retry, refund or ledger release."]};
  const json=()=>JSON.stringify(evidence,(_,value)=>typeof value==="bigint"?value.toString():value,2)+"\n";
  if(!resume)await writeFile(EVIDENCE_FILE,json(),{flag:"wx",mode:0o600});
  let saving=Promise.resolve();
  function persist(){saving=saving.then(async()=>{const temporary=join(".data",`tidebound-h1-qa-evidence-${crypto.randomUUID()}.tmp`);await writeFile(temporary,json(),{flag:"wx",mode:0o600});await rename(temporary,EVIDENCE_FILE);});return saving;}
  const record=async(label:string,value:unknown)=>{evidence.checks.push({label,value});await persist();};
  let token:string|undefined;
  function policy(actor:Actor,tx:Transaction,stepName?:string) {
    assert.equal(tx.signerId,actor.account);assert.equal(tx.publicKey.toString(),actor.key.getPublicKey().toString());assert.equal(tx.actions.length,1);
    const action=tx.actions[0]!;
    if(action.transfer){assert.equal(actor.role,"root");const role=tx.receiverId===maker.account?"maker":tx.receiverId===holder.account?"holder":null;assert(role);if(stepName==="reviewed-recovery-topup-holder"||stepName==="reviewed-recovery-maker-float"){assert(resume&&role===(stepName==="reviewed-recovery-topup-holder"?"holder":"maker")&&action.transfer.deposit>0n&&action.transfer.deposit<=nearToYocto("0.10"));}else assert.equal(action.transfer.deposit,topups[role]);return "transfer";}
    if(action.addKey){assert.equal(actor.role,"maker");assert.equal(tx.receiverId,maker.account);assertExactQAAction(tx,actions.addFullAccessKey(device.key.getPublicKey()));return "add_operator_device_key";}
    const call=action.functionCall;assert(call&&call.gas>0n&&call.gas<=teraToGas(180));const args=qaFunctionArgs(call.args);
    if(call.methodName==="create_named_player"){
      assert.equal(actor.role,"relayer");assert.equal(tx.receiverId,QA_ROOT);assert.equal(call.deposit,0n);assert.equal(call.gas,teraToGas(100));assert.deepEqual(Object.keys(args).sort(),["public_key","username"]);
      const chosen=args.username===names.maker?maker:args.username===names.holder?holder:null;assert(chosen);assert.equal(args.public_key,chosen.key.getPublicKey().toString());return call.methodName;
    }
    assert(["maker","maker-device","holder"].includes(actor.role));validateNativeIntent(tx,{root:QA_ROOT,items:ITEMS});assert.equal(call.gas,nativeGas(call.methodName));
    if(actor.role==="maker-device")assert.equal(call.methodName,"tidebound_craft");
    if(args.token_id&&tx.receiverId===QA_ROOT)assert.equal(args.token_id,actor.account===maker.account?pets.maker:pets.holder);
    if(call.methodName==="adopt")assert.equal(args.name,(actor.account===maker.account?pets.maker:pets.holder).split(".")[0]);
    if(args.item_id||tx.receiverId===ITEMS&&args.token_id)assert(token&&(args.item_id??args.token_id)===token);
    if(call.methodName==="storage_deposit"){assert.equal(args.account_id,holder.account);assert(call.deposit<=nearToYocto("0.02"));}
    if(call.methodName==="mt_transfer")assert.equal(args.receiver_id,holder.account);
    return call.methodName;
  }
  async function affordable(tx:Transaction) {
    const block=await provider.viewBlock({finality:"final"});
    const [account,protocol,price]=await Promise.all([provider.viewAccount({accountId:tx.signerId,blockQuery:{blockId:block.header.hash}}),provider.experimental_protocolConfig({blockId:block.header.hash}),provider.viewGasPrice(block.header.hash)]);
    const quote=nativePrepayment(tx,account,protocol,price.gas_price);
    assert(quote.available>quote.required+nearToYocto("0.002"),"QA native balance is below current protocol purchase prepayment plus margin; no automatic top-up.");
    return {blockHash:block.header.hash,...quote};
  }
  function originalEnvelope(step:Step,actor:Actor,receiver:string,action:Action) {
    const tx=decodeTransaction(base64Decode(step.transaction)),signed=decodeSignedTransaction(base64Decode(step.signedTransaction));
    assert.equal(base64Encode(encodeTransaction(tx)),step.transaction);assert.equal(base64Encode(encodeTransaction(signed.transaction)),step.transaction);assert.equal(base64Encode(signed.encode()),step.signedTransaction);
    assert.equal(bytesHash(new Uint8Array(encodeTransaction(tx))),step.hash);assert.equal(step.signer,actor.account);assert.equal(step.receiver,receiver);assert.equal(step.method,policy(actor,tx,step.name));
    const intended=createTransaction(actor.account,actor.key.getPublicKey(),receiver,tx.nonce,[action],new Uint8Array(tx.blockHash));
    assert.equal(base64Encode(encodeTransaction(intended)),step.transaction,"A stored action differs from its exact reviewed intent.");
    const signature=signed.signature.ed25519Signature;assert(signature&&tx.publicKey.verify(createHash("sha256").update(encodeTransaction(tx)).digest(),new Uint8Array(signature.data)));
    return {tx,signed};
  }
  async function submit(step:Step,signed:SignedTransaction,expectedFailure?:RegExp,failureExecutor=step.receiver) {
    step.state="submitted";await persist();let outcome:Outcome;
    try{outcome=await provider.sendTransactionUntil(signed,"FINAL");step.outcome=outcome;verifyFinalOutcome(outcome,step,expectedFailure,failureExecutor);}
    catch(error){step.state="uncertain";await persist();throw Error(`STOP ${step.name}: original ${step.hash} needs review; no new nonce or retry. ${error instanceof Error?error.message:"Delivery uncertain"}`);}
    step.state="final";step.outcome=outcome;await persist();console.info(`${step.name}: https://testnet.nearblocks.io/txns/${step.hash}`);
    return expectedFailure?undefined:confirmedValue({...outcome,receipts_outcome:outcome.receipts_outcome??[]},step.receiver,step.method);
  }
  async function send(name:string,actor:Actor,receiver:string,action:Action,expectedFailure?:RegExp,failureExecutor=receiver) {
    assert(!postDock||actor.role!=="root"&&actor.role!=="relayer","Post-dock continuation cannot issue accounts or add Root/relayer payments.");
    assert(!evidence.steps.some(s=>s.name===name),"A step may not be resubmitted.");
    const access=await provider.viewAccessKey({accountId:actor.account,publicKey:actor.key.getPublicKey(),finalityQuery:{finality:"final"}});assert.equal(access.permission,"FullAccess");
    const block=await provider.viewBlock({finality:"final"});
    const tx=createTransaction(actor.account,actor.key.getPublicKey(),receiver,access.nonce+1n,[action],baseDecode(block.header.hash)),method=policy(actor,tx,name),prepayment=await affordable(tx);
    const signed=(await new KeyPairSigner(actor.key).signTransaction(tx)).signedTransaction;
    const step:Step={name,signer:actor.account,receiver,method,hash:bytesHash(new Uint8Array(encodeTransaction(tx))),transaction:base64Encode(encodeTransaction(tx)),signedTransaction:base64Encode(signed.encode()),state:"prepared",prepayment,...(expectedFailure?{expectedFailure:expectedFailure.source}:{})};
    evidence.steps.push(step);await persist();return submit(step,signed,expectedFailure,failureExecutor);
  }
  const call=(name:string,actor:Actor,method:string,args:Record<string,unknown>={},receiver=QA_ROOT,deposit=0n,expectedFailure?:RegExp,failureExecutor=receiver)=>send(name,actor,receiver,actions.functionCall(method,args,method==="create_named_player"?teraToGas(100):nativeGas(method),deposit),expectedFailure,failureExecutor);
  const journey=async(actor=maker)=>parseJourney(await view(QA_ROOT,"tidebound_journey",{account_id:actor.account}));
  const item=async()=>view<CraftItem>(ITEMS,"craft_item",{token_id:token});
  const supply=async()=>view<string>(ITEMS,"mt_supply",{token_id:token});
  const balance=(actor:Actor)=>view<string>(ITEMS,"mt_balance_of",{account_id:actor.account,token_id:token});
  async function reviewedProof(step:Step,tx:Transaction) {
    const originalHash=baseEncode(new Uint8Array(tx.blockHash));
    const [final,original]=await Promise.all([provider.viewBlock({finality:"final"}),provider.viewBlock({blockId:originalHash})]);
    const hash=final.header.hash;
    const [access,account,protocol,price,binding,pet]=await Promise.all([
      provider.query<AccessKeyViewRaw>({request_type:"view_access_key",account_id:holder.account,public_key:holder.key.getPublicKey().toString(),block_id:hash}),
      provider.viewAccount({accountId:holder.account,blockQuery:{blockId:hash}}),provider.experimental_protocolConfig({blockId:hash}),provider.viewGasPrice(hash),
      provider.callFunction({contractId:QA_ROOT,method:"get_player",args:{public_key:holder.key.getPublicKey().toString()},blockQuery:{blockId:hash}}),
      provider.callFunction({contractId:QA_ROOT,method:"nft_token",args:{token_id:pets.holder},blockQuery:{blockId:hash}}),
    ]);
    let petAccountAbsent=false;
    try{await provider.viewAccount({accountId:pets.holder,blockQuery:{blockId:hash}});}
    catch(error){if(error instanceof AccountDoesNotExistError&&error.accountId===pets.holder&&error.blockHash===hash&&error.blockHeight===final.header.height)petAccountAbsent=true;else throw error;}
    let unknownTransactionHash="";
    try{await provider.viewTransactionStatusWithReceipts({txHash:step.hash,accountId:holder.account,waitUntil:"NONE"});throw Error("The original transaction is already known; inspect its receipt rather than resubmitting.");}
    catch(error){if(error instanceof UnknownTransactionError&&error.txHash===step.hash)unknownTransactionHash=error.txHash;else throw error;}
    assert(typeof access.nonce==="number"&&Number.isSafeInteger(access.nonce));assert.equal(protocol.chain_id,"testnet");
    const validity=protocol.transaction_validity_period;assert(typeof validity==="number");
    const proof:ResumeProof={hash:step.hash,binding:typeof binding==="string"?binding:"",permission:access.permission,nonce:BigInt(access.nonce),originalNonce:tx.nonce,unknownTransactionHash,petNFTAbsent:pet===null,petAccountAbsent,originalHash,returnedOriginalHash:original.header.hash,finalHash:hash,accessBlockHash:access.block_hash,accountBlockHash:account.block_hash,finalHeight:final.header.height,accessHeight:access.block_height,originalHeight:original.header.height,validity};
    assertResumeProof(proof);return {proof,account,protocol,price};
  }
  async function resumeReviewedRejection() {
    assert(previous&&upgradeHash);assert.deepEqual(evidence.accounts,{maker:maker.account,holder:holder.account});
    assert.deepEqual(evidence.publicKeys,{maker:maker.key.getPublicKey().toString(),makerDevice:device.key.getPublicKey().toString(),holder:holder.key.getPublicKey().toString()});
    assert.equal(evidence.artifacts.length,5);assert.equal(evidence.artifacts.find(a=>a.name==="root")?.codeHash,ORIGINAL_ROOT_HASH);
    for(const artifact of artifacts.filter(a=>a.name!=="root"))assert.deepEqual(evidence.artifacts.find(a=>a.name===artifact.name),artifact,"Only the reviewed Root bytecode may change.");
    const newRoot=artifacts.find(a=>a.name==="root")!;assert.notEqual(newRoot.codeHash,ORIGINAL_ROOT_HASH,"The named-player funding fix must be deployed first.");
    const upgrade=await provider.viewTransactionStatusWithReceipts({txHash:upgradeHash,accountId:QA_ROOT,waitUntil:"FINAL"});
    verifyFinalOutcome(upgrade,{hash:upgradeHash,signer:QA_ROOT,receiver:QA_ROOT});
    assertCodeOnlyUpgrade(upgrade.transaction.actions,newRoot.codeHash);
    const prior=[
      {actor:relayer,receiver:QA_ROOT,action:actions.functionCall("create_named_player",{public_key:maker.key.getPublicKey().toString(),username:names.maker},teraToGas(100),0n)},
      {actor:root,receiver:maker.account,action:actions.transfer(topups.maker)},
      {actor:maker,receiver:QA_ROOT,action:actions.functionCall("adopt",{name:pets.maker.split(".")[0]},nativeGas("adopt"),0n)},
      {actor:relayer,receiver:QA_ROOT,action:actions.functionCall("create_named_player",{public_key:holder.key.getPublicKey().toString(),username:names.holder},teraToGas(100),0n)},
      {actor:root,receiver:holder.account,action:actions.transfer(topups.holder)},
    ];
    const priorHashes=[];
    for(let i=0;i<prior.length;i++){
      const planned=prior[i]!,step=evidence.steps[i]!;originalEnvelope(step,planned.actor,planned.receiver,planned.action);
      verifyFinalOutcome(step.outcome,step);verifyFinalOutcome(await provider.viewTransactionStatusWithReceipts({txHash:step.hash,accountId:step.signer,waitUntil:"FINAL"}),step);priorHashes.push(step.hash);
    }
    assert.equal((await view<{owner_id:string}>(QA_ROOT,"nft_token",{token_id:pets.maker})).owner_id,maker.account);
    assertNoInheritedAchievement(await journey(maker));assertNoInheritedAchievement(await journey(holder));
    const step=evidence.steps[5]!,{tx,signed}=originalEnvelope(step,holder,QA_ROOT,actions.functionCall("adopt",{name:pets.holder.split(".")[0]},nativeGas("adopt"),0n));
    const before=await reviewedProof(step,tx),additional=reviewedTopup(before.account.amount);
    const projected=nativePrepayment(tx,{...before.account,amount:before.account.amount+additional},before.protocol,before.price.gas_price);
    assert(projected.available>projected.required+nearToYocto("0.002"),"The bounded top-up cannot cover current purchase prepayment; stop before transferring.");
    const review:Record<string,unknown>={reason:"Explicit operator review of the original NotEnoughBalance validation rejection; not a timeout retry.",originalHash:REVIEWED_REJECTION,originalStopStatus:evidence.status,originalStep:{...step},originalValidationLog:"/private/tmp/familiar-h1-live-qa.log",originalError:{name:"NotEnoughBalance",balance:"150000000000000000000000",cost:"180919068574859500000000"},startedAt:new Date().toISOString(),proofBeforeFunding:before.proof,verifiedPriorHashes:priorHashes,rootUpgradeTransaction:upgradeHash,resumedArtifacts:artifacts,historicalInitialTopupCapYocto:evidence.extraNativeTopupCapYocto,holderRecoveryTopupCapYocto:nearToYocto("0.10").toString(),holderRecoveryTopupYocto:additional.toString(),makerFloatTopupCapYocto:nearToYocto("0.10").toString(),combinedAdditionalRecoveryCapYocto:nearToYocto("0.20").toString()};
    evidence.reviews=[review];evidence.status="reviewed-resume-in-progress";await persist();
    if(additional>0n)await send("reviewed-recovery-topup-holder",root,holder.account,actions.transfer(additional));
    const after=await reviewedProof(step,tx);review.proofBeforeExactResubmission=after.proof;step.prepayment=await affordable(tx);review.exactResubmissionAt=new Date().toISOString();await persist();
    assert.equal(await submit(step,signed),pets.holder);
    for(const pet of Object.values(pets))assert.equal((await provider.viewAccessKeyList({accountId:pet})).keys.length,0);
  }
  async function continuePostDock() {
    assert(previous&&postDock);assertPostDockJournal(evidence);
    assert.deepEqual(evidence.accounts,{maker:maker.account,holder:holder.account});
    assert.deepEqual(evidence.publicKeys,{maker:maker.key.getPublicKey().toString(),makerDevice:device.key.getPublicKey().toString(),holder:holder.key.getPublicKey().toString()});
    assert.deepEqual(evidence.reviews![0]!.resumedArtifacts,artifacts,"The post-dock continuation cannot change the reviewed contract stack.");
    const makerState=await journey(),holderState=await journey(holder);token=makerState.craft?.evidence.token_id;assert(token);
    const minted=assertPostDockState(makerState,holderState,await item(),await supply(),await balance(maker),await balance(holder));
    const dock=evidence.checks.filter(c=>c.label==="confirmed-maker-dock");assert.equal(dock.length,1);assert.deepEqual(dock[0]!.value,makerState,"Current maker state differs from the confirmed checkpoint.");
    const porch=evidence.checks.filter(c=>c.label==="confirmed-maker-porch");assert.equal(porch.length,1);assertPlacement(porch[0]!.value,dock[0]!.value,token,"dock");
    assert.deepEqual(await view(ITEMS,"craft_mint_operation",{operation_id:minted.mint.id}),minted.mint);
    for(const actor of [maker,holder]){
      assert.equal((await view<{owner_id:string}>(QA_ROOT,"nft_token",{token_id:actor===maker?pets.maker:pets.holder})).owner_id,actor.account);
      assert.equal((await provider.viewAccessKeyList({accountId:actor===maker?pets.maker:pets.holder})).keys.length,0);
    }
    for(const actor of [maker,device,holder])assert.equal((await provider.viewAccessKey({accountId:actor.account,publicKey:actor.key.getPublicKey(),finalityQuery:{finality:"final"}})).permission,"FullAccess");
    const verifiedHashes=[];
    for(const step of evidence.steps){
      const tx=decodeTransaction(base64Decode(step.transaction));
      const actor=step.name.startsWith("create-")?relayer:step.name.startsWith("fund-")||step.name.startsWith("reviewed-recovery-")?root:step.name==="adopt-holder"?holder:step.name==="concurrent-craft-second-key"?device:maker;
      originalEnvelope(step,actor,step.receiver,tx.actions[0]!);
      verifyFinalOutcome(step.outcome,step);verifyFinalOutcome(await provider.viewTransactionStatusWithReceipts({txHash:step.hash,accountId:step.signer,waitUntil:"FINAL"}),step);verifiedHashes.push(step.hash);
    }
    const upgradeHash=evidence.reviews![0]!.rootUpgradeTransaction;assert.equal(typeof upgradeHash,"string");
    const upgrade=await provider.viewTransactionStatusWithReceipts({txHash:upgradeHash as string,accountId:QA_ROOT,waitUntil:"FINAL"});
    verifyFinalOutcome(upgrade,{hash:upgradeHash as string,signer:QA_ROOT,receiver:QA_ROOT});assertCodeOnlyUpgrade(upgrade.transaction.actions,artifacts.find(a=>a.name==="root")!.codeHash);
    const beforeStorage=await view(ITEMS,"storage_balance_of",{account_id:holder.account});assert.equal(beforeStorage,null,"A prior recipient registration requires separate review.");
    const deposit=qaStorageDeposit(await view(ITEMS,"storage_balance_bounds"));
    const continuation={checkpoint:POST_DOCK_CHECKPOINT,reason:"Continue only the gift/recipient checks after read-only zero-minimum storage-bound assertion; no earlier operation is replayed.",originalStopStatus:evidence.status,originalValidationLog:"/private/tmp/familiar-h1-live-qa-canonical-resume.log",startedAt:new Date().toISOString(),verifiedHashes,artifacts,makerCheckpoint:makerState,holderCheckpoint:holderState,item:minted,recipientStorageBefore:beforeStorage,recipientStorageDepositYocto:deposit.toString(),additionalRootPaymentsYocto:"0"};
    evidence.continuations=[continuation];evidence.status="reviewed-post-dock-continuation";await persist();return minted;
  }
  async function concurrentAffordable(args:Record<string,unknown>) {
    const block=await provider.viewBlock({finality:"final"});
    const [account,protocol,price]=await Promise.all([provider.viewAccount({accountId:maker.account,blockQuery:{blockId:block.header.hash}}),provider.experimental_protocolConfig({blockId:block.header.hash}),provider.viewGasPrice(block.header.hash)]);
    // These unsigned templates estimate simultaneous reservations, not transaction hashes or signing authority.
    const quotes=[maker,device].map(actor=>nativePrepayment(createTransaction(actor.account,actor.key.getPublicKey(),QA_ROOT,1n,[actions.functionCall("tidebound_craft",args,nativeGas("tidebound_craft"),0n)],baseDecode(block.header.hash)),account,protocol,price.gas_price));
    return {blockHash:block.header.hash,available:quotes[0]!.available,required:quotes.map(quote=>quote.required),purchaseGasPrice:quotes[0]!.purchaseGasPrice};
  }
  async function claim(label:string,actor:Actor,commands:string[],area:"beacon"|"wind"="beacon") {
    const before=await journey(actor),run=replayOuting("rope",before.banked,commands,area);assert(run?.outcome==="returned"&&run.cargo.length);
    const args={token_id:actor===maker?pets.maker:pets.holder,operation_id:`operator-qa:${label}`,expected_revision:before.revision,initial_checkpoint_hash:await view(QA_ROOT,"tidebound_checkpoint_hash",{account_id:actor.account}),rules_version:RULES,content_version:CONTENT,tool:"rope",commands,area};
    await call(label,actor,"tidebound_claim",args);await record(`${label}-accepted`,{transcript:run,journey:await journey(actor)});return args;
  }
  try{
    let minted:CraftItem;
    if(postDock)minted=await continuePostDock();
    else{
    if(resume)await resumeReviewedRejection();
    else for(const actor of [maker,holder]){
      const role=actor===maker?"maker":"holder";
      assert.equal(await call(`create-${role}`,relayer,"create_named_player",{public_key:actor.key.getPublicKey().toString(),username:names[role]}),actor.account);
      assert.equal(await view(QA_ROOT,"get_player",{public_key:actor.key.getPublicKey().toString()}),actor.account);
      await send(`fund-${role}`,root,actor.account,actions.transfer(topups[role]));
      assert.equal(await call(`adopt-${role}`,actor,"adopt",{name:pets[role].split(".")[0]}),pets[role]);
      assert.equal((await provider.viewAccessKeyList({accountId:pets[role]})).keys.length,0);
    }
    await send("add-operator-second-key",maker,maker.account,actions.addFullAccessKey(device.key.getPublicKey()));
    const first=await claim("maker-lens-moth",maker,["wait","move:left","move:center","move:right","reel:lens","move:center","move:right","take:moth","move:center","return"]);
    const earned=assertAllocation(await journey(),false);assert(earned.moth_claim);assert.equal(earned.lens_claim,earned.moth_claim);
    await call("known-final-claim-retry",maker,"tidebound_claim",first);assert.deepEqual(await journey(),earned);
    await call("restore-beacon",maker,"tidebound_restore",{restoration:"beacon"});
    await claim("maker-wind-vane",maker,["wait","move:left","wait","wait","move:center","turn:vane","take:vane","return"],"wind");
    await call("restore-signal",maker,"tidebound_restore",{restoration:"signal"});assert((await journey()).signaled);assertAllocation(await journey(),false);
    await call("commission-once",maker,"tidebound_commission");const commission=assertAllocation(await journey(),true);
    await call("known-final-commission-retry",maker,"tidebound_commission");assert.deepEqual(await journey(),commission);
    await record("finite-commission-preserves-credit",commission);
    const craftArgs={token_id:pets.maker,motif:"crest",origin_claim_id:earned.lens_claim};
    let aggregate=await concurrentAffordable(craftArgs);
    const float=reviewedMakerFloat(aggregate.available,aggregate.required);
    if(float>0n){
      const review=evidence.reviews?.[0];assert(resume&&review&&!review.makerFloat,"No unreviewed or repeated maker float is allowed.");
      review.makerFloat={before:aggregate,additionalYocto:float.toString()};await persist();
      await send("reviewed-recovery-maker-float",root,maker.account,actions.transfer(float));
      aggregate=await concurrentAffordable(craftArgs);review.makerFloatAfter=aggregate;await persist();
    }
    assertConcurrentPrepayment(aggregate.available,aggregate.required);await record("aggregate-concurrent-prepayment",aggregate);
    const concurrent=await Promise.allSettled([call("concurrent-craft-primary",maker,"tidebound_craft",craftArgs),call("concurrent-craft-second-key",device,"tidebound_craft",craftArgs)]);
    assert(concurrent.every(result=>result.status==="fulfilled"),"A concurrent request is uncertain; stop and inspect both original hashes.");
    token=(await journey()).craft?.evidence.token_id;assert(token);minted=assertCanonicalCraft(await journey(),await item(),await supply(),maker.account);
    for(const result of concurrent){assert(result.status==="fulfilled");assert.equal((result.value as Journey).craft?.evidence.id,minted.mint.id);}
    assert.deepEqual(await view(ITEMS,"craft_mint_operation",{operation_id:minted.mint.id}),minted.mint);
    await record("canonical-concurrent-craft",{journey:await journey(),item:minted,supply:await supply()});
    await call("known-final-craft-retry",maker,"tidebound_craft",craftArgs);assertCanonicalCraft(await journey(),await item(),await supply(),maker.account);
    await call("polish-once",maker,"tidebound_polish",{item_id:token,expected_appearance:0});const finished=await journey();assert.equal(finished.burned_shells,12);assert.equal(finished.shells,0);
    await call("known-final-polish-retry",maker,"tidebound_polish",{item_id:token,expected_appearance:0});assert.deepEqual(await journey(),finished);
    for(const socket of ["porch","dock"] as const){
      const before=await journey();await call(`place-${socket}`,maker,"tidebound_place",{item_id:token,socket,expected_revision:before.revision});
      const after=await journey();assertPlacement(before,after,token,socket);await record(`confirmed-maker-${socket}`,after);
    }
    }
    assert(token);
    assert.equal((await journey()).placement?.socket,"dock");assertNoInheritedAchievement(await journey(holder));
    const storageBounds=await view(ITEMS,"storage_balance_bounds"),storageDeposit=qaStorageDeposit(storageBounds);
    await call("register-QA-recipient",holder,"storage_deposit",{account_id:holder.account,registration_only:false},ITEMS,storageDeposit);
    const storage=await view<{total:string;available:string}>(ITEMS,"storage_balance_of",{account_id:holder.account});
    const funded=quoteItemStorage(storageBounds,storage);assert(funded.ready&&funded.available>=storageDeposit,"Recipient storage credit must be funded, not merely registered at a zero minimum.");await record("recipient-storage-funded",storage);
    const craftArgs={token_id:pets.maker,motif:"crest",origin_claim_id:(await journey()).lens_claim};
    const gift={receiver_id:holder.account,token_id:token,amount:"1",approval:null,memo:null};
    await call("standard-real-transfer",maker,"mt_transfer",gift,ITEMS,1n);assert.equal(await balance(maker),"0");assert.equal(await balance(holder),"1");assert.equal(await supply(),"1");
    assertNoInheritedAchievement(await journey(holder));
    const recipientBefore=await journey(holder);
    await call("recipient-place",holder,"tidebound_place",{item_id:token,socket:"dock",expected_revision:recipientBefore.revision});
    const recipientPlaced=await journey(holder);assertPlacement(recipientBefore,recipientPlaced,token,"dock");assertNoInheritedAchievement(recipientPlaced);
    await record("gift-keeps-maker-achievement-personal",{holderJourney:recipientPlaced,makerJourney:await journey(),item:await item(),makerBalance:await balance(maker),holderBalance:await balance(holder),supply:await supply()});
    const beforeOldHolder=await journey();await call("old-holder-placement-rejected",maker,"tidebound_place",{item_id:token,socket:"porch",expected_revision:beforeOldHolder.revision});assert.deepEqual(await journey(),beforeOldHolder);
    await call("old-holder-transfer-rejected",maker,"mt_transfer",gift,ITEMS,1n,/Balance of the sender is insufficient/);
    await call("transferred-craft-never-remints",maker,"tidebound_craft",craftArgs);assert.equal(await supply(),"1");assert.equal(await balance(holder),"1");
    await claim("holder-independent-lens",holder,["move:left","wait","move:center","reel:lens","return"]);assertAllocation(await journey(holder),false);
    await call("holder-personal-commission",holder,"tidebound_commission");assertAllocation(await journey(holder),true);
    // H1 accepts only appearance 0 requests; Items must reject this already-finished token.
    await call("token-second-finish-rejected",holder,"tidebound_polish",{item_id:token,expected_appearance:0},QA_ROOT,0n,/ERR_APPEARANCE/,ITEMS);
    const holderFinal=await journey(holder);assert.equal(holderFinal.shells,12);assert.equal(holderFinal.burned_shells,0);assert.equal(holderFinal.polish?.state,"failed-safe");
    const finalItem=await item();assert.deepEqual(finalItem.mint,minted.mint);assert.equal(finalItem.finish,"harbor_polish");assert.equal(finalItem.finish_used,true);assert.equal(finalItem.appearance_version,1);
    assertCanonicalCraft(await journey(),finalItem,await supply(),maker.account);assert.equal((await journey()).burned_shells,12);
    await record("final-canonical-state",{maker:await journey(),holder:holderFinal,item:finalItem,supply:await supply(),makerBalance:await balance(maker),holderBalance:await balance(holder),holderInventory:await view(ITEMS,"craft_inventory",{account_id:holder.account,from_index:0,limit:32})});
    evidence.status="complete";await persist();console.info(`Completed operator QA; actual public receipts are in ${EVIDENCE_FILE}. This is not Privy/device recovery evidence.`);
  }catch(error){evidence.status="stopped-review-required";await persist();throw error;}
}

if(import.meta.main){
  const args=process.argv.slice(2);
  if(parseLiveArguments(args))await runLive(args.length===3?args[2]!.slice("--root-upgrade=".length):undefined,args.length===2);
  else console.info(JSON.stringify({mode:"DRY_LOCAL_ONLY",network:"testnet",root:QA_ROOT,operatorPlayers:names,extraNativeTopupCap:"0.30 testNEAR",factoryEndowmentCap:"0.50 testNEAR for two new named players",freshRootOutgoingCap:"1.52 testNEAR plus storage/gas",rootLiquidHeadroomRequired:"2.25 testNEAR",reviewedExistingRejectionExtraCap:"0.20 testNEAR total: holder <=0.10 and maker float <=0.10, each once; exact original hash and code-only Root-upgrade receipt required",keyFile:KEY_FILE,evidenceFile:EVIDENCE_FILE,rpcCalls:0,mutations:0,note:"Explicit --live and reviewed isolated project credentials are required. No driver execution is a device-recovery claim."},null,2));
}
