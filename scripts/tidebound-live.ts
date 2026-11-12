import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {lstat,mkdir,readFile,rename,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {actions,base64Encode,baseDecode,baseEncode,createTransaction,encodeTransaction,JsonRpcProvider,KeyPair,KeyPairSigner,nearToYocto,teraToGas,type KeyPairString,type Transaction} from "near-api-js";
import {AccountDoesNotExistError} from "near-api-js/rpc-errors";
import {nativeGas,parseJourney,type CraftItem,type MintEvidence,type Journey} from "../web/src/tidebound/client";
import {assertTideboundProtocol} from "../web/src/tidebound/protocol";
import {replayOuting} from "../web/src/outing/engine";
import {validateNativeIntent} from "../services/relayer/src/auth/sign";
import {confirmedValue} from "../services/relayer/src/outcome";

export const QA_ROOT="familiar-game.testnet";
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

export function parseLiveArguments(args:readonly string[]) {
  assert(args.length===0 || args.length===1&&args[0]==="--live","Use only the explicit --live flag; dry mode performs no RPC or credential access.");
  return args.length===1;
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
async function qaKeys():Promise<PrivateQA> {
  async function read():Promise<PrivateQA>{
    const saved=await privateFile(KEY_FILE) as PrivateQA;
    assert(saved.version===1&&saved.kind==="operator-QA-not-Privy"&&saved.network==="testnet"&&saved.root===QA_ROOT,"Existing QA keys belong to a different run/stack; preserve them.");
    const keys=[saved.keys.maker,saved.keys.makerDevice,saved.keys.holder].map(checkedKey);
    assert.equal(new Set(keys.map(k=>k.getPublicKey().toString())).size,3);return saved;
  }
  if(await Bun.file(KEY_FILE).exists())return read();
  const saved:PrivateQA={version:1,kind:"operator-QA-not-Privy",network:"testnet",root:QA_ROOT,keys:{maker:KeyPair.fromRandom("ed25519").toString(),makerDevice:KeyPair.fromRandom("ed25519").toString(),holder:KeyPair.fromRandom("ed25519").toString()}};
  try{await writeFile(KEY_FILE,JSON.stringify(saved,null,2)+"\n",{flag:"wx",mode:0o600});}catch(error){if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;}
  return read();
}

async function runLive() {
  assert(process.env.NEAR_NETWORK==="testnet"&&process.env.NEAR_ROOT===QA_ROOT&&process.env.RELAYER_ID===`relayer.${QA_ROOT}`,"Only the reviewed isolated testnet tuple is permitted.");
  assert(!await Bun.file(EVIDENCE_FILE).exists(),"Existing QA evidence must be reviewed; this one-shot driver never retries or replaces a previous run.");
  const root:Actor={role:"root",account:QA_ROOT,key:checkedKey(process.env.ROOT_PRIVATE_KEY)};
  const relayer:Actor={role:"relayer",account:`relayer.${QA_ROOT}`,key:checkedKey(process.env.RELAYER_PRIVATE_KEY)};
  // retries=1 means one HTTP attempt in the pinned SDK. No transport retry can acquire a fresh nonce.
  const provider=new JsonRpcProvider({url:RPC},{retries:1});assert.equal(await provider.getNetworkId(),"testnet");
  const view=async<T=unknown>(contractId:string,method:string,args:Record<string,unknown>={}):Promise<T>=>provider.callFunction({contractId,method,args,blockQuery:{finality:"final"}}) as Promise<T>;
  assertTideboundProtocol(QA_ROOT,await view(QA_ROOT,"tidebound_protocol"),await view(ITEMS,"craft_protocol"));
  const artifacts=[];
  for(const name of ["root","items","bakery","market","pet"]){
    const bytes=new Uint8Array(await Bun.file(`contracts/target/deploy/familiar_${name}.wasm`).arrayBuffer()),codeHash=bytesHash(bytes);
    if(name!=="pet")assert.equal((await provider.viewAccount({accountId:name==="root"?QA_ROOT:`${name}.${QA_ROOT}`,blockQuery:{finality:"final"}})).code_hash,codeHash,"Live bytecode differs from the frozen local artifact.");
    artifacts.push({name,bytes:bytes.length,codeHash});
  }
  assert.deepEqual(await view(QA_ROOT,"get_config"),{relayer:relayer.account,pet_code_hash:artifacts.find(a=>a.name==="pet")!.codeHash,items:ITEMS,bakery:`bakery.${QA_ROOT}`,market:`market.${QA_ROOT}`,pool:POOL});
  for(const actor of [root,relayer])assert.equal((await provider.viewAccessKey({accountId:actor.account,publicKey:actor.key.getPublicKey(),finalityQuery:{finality:"final"}})).permission,"FullAccess");
  const final=await provider.viewBlock({finality:"final"}),gasPrice=BigInt((await provider.viewGasPrice(final.header.hash)).gas_price);
  assert(gasPrice>0n&&gasPrice<=100_000_000n,"The reviewed native gas-price bound changed; stop for budget review.");
  const liquid=async(account:string)=>{const a=await provider.viewAccount({accountId:account,blockQuery:{finality:"final"}});return a.amount-BigInt(a.storage_usage)*10n**19n;};
  assert(await liquid(QA_ROOT)>=nearToYocto("1.75"),"Keep at least 1.75 liquid testNEAR for bounded operator QA, storage, gas and the root floor.");
  for(const name of [...Object.values(names),...Object.values(pets).map(p=>p.split(".")[0]!)]){
    const accountId=`${name}.${QA_ROOT}`;assert.equal(await view(QA_ROOT,"player_name_available",{username:name}),true,"QA name already reserved; do not substitute another wallet/name.");
    try{await provider.viewAccount({accountId,blockQuery:{finality:"final"}});throw Error("QA account already exists; inspect it instead of creating another.");}catch(error){if(!(error instanceof AccountDoesNotExistError)||error.accountId!==accountId)throw error;}
  }
  await mkdir(".data",{recursive:true});const directory=await lstat(".data");assert(directory.isDirectory()&&!directory.isSymbolicLink());
  for(const path of [KEY_FILE,EVIDENCE_FILE])assert.equal(Bun.spawnSync({cmd:["git","check-ignore","--quiet",path],stdout:"pipe",stderr:"pipe"}).exitCode,0,"Private QA artifacts must be ignored by Git.");
  const saved=await qaKeys(),maker:Actor={role:"maker",account:`${names.maker}.${QA_ROOT}`,key:checkedKey(saved.keys.maker)},holder:Actor={role:"holder",account:`${names.holder}.${QA_ROOT}`,key:checkedKey(saved.keys.holder)},device:Actor={role:"maker-device",account:maker.account,key:checkedKey(saved.keys.makerDevice)};
  for(const actor of [maker,holder])assert.equal(await view(QA_ROOT,"get_player",{public_key:actor.key.getPublicKey().toString()}),null,"Existing stable QA binding needs review, not a replacement.");
  type Step={name:string;signer:string;receiver:string;method:string;hash:string;transaction:string;signedTransaction:string;state:"prepared"|"submitted"|"final"|"uncertain";expectedFailure?:string;outcome?:unknown};
  const evidence={version:1,kind:"operator-controlled-QA-not-Privy-recovery",network:"testnet",root:QA_ROOT,startedAt:new Date().toISOString(),status:"in-progress",artifacts,accounts:{maker:maker.account,holder:holder.account},publicKeys:{maker:maker.key.getPublicKey().toString(),makerDevice:device.key.getPublicKey().toString(),holder:holder.key.getPublicKey().toString()},extraNativeTopupCapYocto:(topups.maker+topups.holder).toString(),steps:[] as Step[],checks:[] as {label:string;value:unknown}[],limits:["Two operator signing keys are not two physical devices or a Privy recovery demonstration.","No David player, wallet, item or legacy registry is used.","Timeout, RPC error, uncertain finality or failed assertions stop without automatic retry, refund or ledger release."]};
  const json=()=>JSON.stringify(evidence,(_,value)=>typeof value==="bigint"?value.toString():value,2)+"\n";
  await writeFile(EVIDENCE_FILE,json(),{flag:"wx",mode:0o600});
  let saving=Promise.resolve();
  function persist(){saving=saving.then(async()=>{const temporary=join(".data",`tidebound-h1-qa-evidence-${crypto.randomUUID()}.tmp`);await writeFile(temporary,json(),{flag:"wx",mode:0o600});await rename(temporary,EVIDENCE_FILE);});return saving;}
  const record=async(label:string,value:unknown)=>{evidence.checks.push({label,value});await persist();};
  let token:string|undefined;
  function policy(actor:Actor,tx:Transaction) {
    assert.equal(tx.signerId,actor.account);assert.equal(tx.publicKey.toString(),actor.key.getPublicKey().toString());assert.equal(tx.actions.length,1);
    const action=tx.actions[0]!;
    if(action.transfer){assert.equal(actor.role,"root");const role=tx.receiverId===maker.account?"maker":tx.receiverId===holder.account?"holder":null;assert(role);assert.equal(action.transfer.deposit,topups[role]);return "transfer";}
    if(action.addKey){assert.equal(actor.role,"maker");assert.equal(tx.receiverId,maker.account);assert.deepEqual(action,actions.addFullAccessKey(device.key.getPublicKey()));return "add_operator_device_key";}
    const call=action.functionCall;assert(call&&call.gas>0n&&call.gas<=teraToGas(180));const args=JSON.parse(new TextDecoder().decode(call.args));
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
  async function send(name:string,actor:Actor,receiver:string,action:Action,expectedFailure?:RegExp,failureExecutor=receiver) {
    assert(!evidence.steps.some(s=>s.name===name),"A step may not be resubmitted.");
    const access=await provider.viewAccessKey({accountId:actor.account,publicKey:actor.key.getPublicKey(),finalityQuery:{finality:"final"}});assert.equal(access.permission,"FullAccess");
    const block=await provider.viewBlock({finality:"final"});
    const tx=createTransaction(actor.account,actor.key.getPublicKey(),receiver,access.nonce+1n,[action],baseDecode(block.header.hash)),method=policy(actor,tx);
    const deposit=action.functionCall?.deposit??action.transfer?.deposit??0n,prepay=(action.functionCall?.gas??teraToGas(1))*gasPrice;
    assert(await liquid(actor.account)>deposit+prepay+nearToYocto("0.002"),"QA native balance is below the next bounded prepayment; no automatic top-up.");
    const signed=(await new KeyPairSigner(actor.key).signTransaction(tx)).signedTransaction;
    const step:Step={name,signer:actor.account,receiver,method,hash:bytesHash(new Uint8Array(encodeTransaction(tx))),transaction:base64Encode(encodeTransaction(tx)),signedTransaction:base64Encode(signed.encode()),state:"prepared",...(expectedFailure?{expectedFailure:expectedFailure.source}:{})};
    evidence.steps.push(step);await persist();step.state="submitted";await persist();
    let outcome:Outcome;
    try{outcome=await provider.sendTransactionUntil(signed,"FINAL");step.outcome=outcome;verifyFinalOutcome(outcome,step,expectedFailure,failureExecutor);}
    catch(error){step.state="uncertain";await persist();throw Error(`STOP ${name}: original ${step.hash} needs review; no new nonce or retry. ${error instanceof Error?error.message:"Delivery uncertain"}`);}
    step.state="final";step.outcome=outcome;await persist();console.info(`${name}: https://testnet.nearblocks.io/txns/${step.hash}`);
    return expectedFailure?undefined:confirmedValue({...outcome,receipts_outcome:outcome.receipts_outcome??[]},receiver,method);
  }
  const call=(name:string,actor:Actor,method:string,args:Record<string,unknown>={},receiver=QA_ROOT,deposit=0n,expectedFailure?:RegExp,failureExecutor=receiver)=>send(name,actor,receiver,actions.functionCall(method,args,method==="create_named_player"?teraToGas(100):nativeGas(method),deposit),expectedFailure,failureExecutor);
  const journey=async(actor=maker)=>parseJourney(await view(QA_ROOT,"tidebound_journey",{account_id:actor.account}));
  const item=async()=>view<CraftItem>(ITEMS,"craft_item",{token_id:token});
  const supply=async()=>view<string>(ITEMS,"mt_supply",{token_id:token});
  const balance=(actor:Actor)=>view<string>(ITEMS,"mt_balance_of",{account_id:actor.account,token_id:token});
  async function claim(label:string,actor:Actor,commands:string[],area:"beacon"|"wind"="beacon") {
    const before=await journey(actor),run=replayOuting("rope",before.banked,commands,area);assert(run?.outcome==="returned"&&run.cargo.length);
    const args={token_id:actor===maker?pets.maker:pets.holder,operation_id:`operator-qa:${label}`,expected_revision:before.revision,initial_checkpoint_hash:await view(QA_ROOT,"tidebound_checkpoint_hash",{account_id:actor.account}),rules_version:RULES,content_version:CONTENT,tool:"rope",commands,area};
    await call(label,actor,"tidebound_claim",args);await record(`${label}-accepted`,{transcript:run,journey:await journey(actor)});return args;
  }
  try{
    for(const actor of [maker,holder]){
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
    const concurrent=await Promise.allSettled([call("concurrent-craft-primary",maker,"tidebound_craft",craftArgs),call("concurrent-craft-second-key",device,"tidebound_craft",craftArgs)]);
    assert(concurrent.every(result=>result.status==="fulfilled"),"A concurrent request is uncertain; stop and inspect both original hashes.");
    token=(await journey()).craft?.evidence.token_id;assert(token);const minted=assertCanonicalCraft(await journey(),await item(),await supply(),maker.account);
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
    assert.equal((await journey()).placement?.socket,"dock");assertNoInheritedAchievement(await journey(holder));
    const bounds=await view<{min:string}>(ITEMS,"storage_balance_bounds");assert(/^\d+$/.test(bounds.min)&&BigInt(bounds.min)>0n&&BigInt(bounds.min)<=nearToYocto("0.02"));
    await call("register-QA-recipient",holder,"storage_deposit",{account_id:holder.account,registration_only:true},ITEMS,BigInt(bounds.min));
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
  if(parseLiveArguments(process.argv.slice(2)))await runLive();
  else console.info(JSON.stringify({mode:"DRY_LOCAL_ONLY",network:"testnet",root:QA_ROOT,operatorPlayers:names,extraNativeTopupCap:"0.30 testNEAR",rootLiquidHeadroomRequired:"1.75 testNEAR",keyFile:KEY_FILE,evidenceFile:EVIDENCE_FILE,rpcCalls:0,mutations:0,note:"Explicit --live and reviewed isolated project credentials are required. No driver execution is a device-recovery claim."},null,2));
}
