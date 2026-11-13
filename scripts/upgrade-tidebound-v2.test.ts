import {expect,test} from "bun:test";
import {createHash} from "node:crypto";
import {mkdtemp,readFile,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {actions,base64Decode,base64Encode,baseEncode,createTransaction,encodeTransaction,JsonRpcProvider,KeyPair,KeyPairSigner,nearToYocto} from "near-api-js";
import {UPGRADE,parseUpgradeArguments,assertUpgradeArtifact,assertDeployEnvelope,assertUpgradePhase,assertPreserved,quoteUpgrade,decodeRootReservedStorage,decodeItemCredits,submitUpgradeOnce,requireNoExecutionJournal,type UpgradeStep} from "./upgrade-tidebound-v2";
import existing from "../docs/TIDEBOUND-GAMEPLAY.json";

const code=new Uint8Array([0,97,115,109,1,0,0,0]),hash=(bytes:Uint8Array)=>baseEncode(createHash("sha256").update(bytes).digest());
const candidate={account:UPGRADE.root,codeHash:hash(code),bytes:code.length};
// Actual public STATE at finalized277431055, pinned3eeo Root. Contains no keys, envelopes or credentials.
const actualState="FQAAAGZhbWlsaWFyLWdhbWUudGVzdG5ldPsFAAAAAAAAAQAAAAAAAAACAAAAdHYDAAAAAAAAAAIAAAB0bgEBAAAAbQEBAAAAZQEBAAAAYQECAAAAYW4dAAAAcmVsYXllci5mYW1pbGlhci1nYW1lLnRlc3RuZXSpbwTzTtbqqFL7FqgG3IREP0rrJmtNjxBR1ykcYgmztRsAAABpdGVtcy5mYW1pbGlhci1nYW1lLnRlc3RuZXQcAAAAYmFrZXJ5LmZhbWlsaWFyLWdhbWUudGVzdG5ldBwAAABtYXJrZXQuZmFtaWxpYXItZ2FtZS50ZXN0bmV0FAAAAGtpbG4ucG9vbC5mODYzOTczLm0wBwAAAHBsYXllcnMOAAAAcGVuZGluZ3BsYXllcnMUAAAAcGVuZGluZy1wbGF5ZXItbmFtZXMJAAAAcGxheWVyaWRzBwAAAGFkb3B0ZWQDAAAAAAAAAAkAAABhZG9wdGlvbnMEAAAAYnVzeQQAAABkZW5zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAJcLAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACFRAAAAAAAAAwADAAMAAAAAAHoiwcixIgAAAAAAAAsAAAB0Yi1qb3VybmV5cwAA";
// Generated offline with actual familiar_root::Contract::new / create_named_player in mocked near-sdk VM,
// then near_sdk::borsh::to_vec. No hand-assembled Borsh model is used for these positive layout fixtures.
const rustZero="FQAAAGZhbWlsaWFyLWdhbWUudGVzdG5ldPsFAAAAAAAAAAAAAAAAAAACAAAAdHYAAAAAAAAAAAIAAAB0bgEBAAAAbQEBAAAAZQEBAAAAYQECAAAAYW4dAAAAcmVsYXllci5mYW1pbGlhci1nYW1lLnRlc3RuZXSpbwTzTtbqqFL7FqgG3IREP0rrJmtNjxBR1ykcYgmztRsAAABpdGVtcy5mYW1pbGlhci1nYW1lLnRlc3RuZXQcAAAAYmFrZXJ5LmZhbWlsaWFyLWdhbWUudGVzdG5ldBwAAABtYXJrZXQuZmFtaWxpYXItZ2FtZS50ZXN0bmV0FAAAAGtpbG4ucG9vbC5mODYzOTczLm0wBwAAAHBsYXllcnMOAAAAcGVuZGluZ3BsYXllcnMUAAAAcGVuZGluZy1wbGF5ZXItbmFtZXMJAAAAcGxheWVyaWRzBwAAAGFkb3B0ZWQAAAAAAAAAAAkAAABhZG9wdGlvbnMEAAAAYnVzeQQAAABkZW5zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAsAAAB0Yi1qb3VybmV5cwAA";
const rustPending="FQAAAGZhbWlsaWFyLWdhbWUudGVzdG5ldPsFAAAAAAAAAAAAAAAAAAACAAAAdHYAAAAAAAAAAAIAAAB0bgEBAAAAbQEBAAAAZQEBAAAAYQECAAAAYW4dAAAAcmVsYXllci5mYW1pbGlhci1nYW1lLnRlc3RuZXSpbwTzTtbqqFL7FqgG3IREP0rrJmtNjxBR1ykcYgmztRsAAABpdGVtcy5mYW1pbGlhci1nYW1lLnRlc3RuZXQcAAAAYmFrZXJ5LmZhbWlsaWFyLWdhbWUudGVzdG5ldBwAAABtYXJrZXQuZmFtaWxpYXItZ2FtZS50ZXN0bmV0FAAAAGtpbG4ucG9vbC5mODYzOTczLm0wBwAAAHBsYXllcnMOAAAAcGVuZGluZ3BsYXllcnMUAAAAcGVuZGluZy1wbGF5ZXItbmFtZXMJAAAAcGxheWVyaWRzBwAAAGFkb3B0ZWQBAAAAAAAAAAkAAABhZG9wdGlvbnMEAAAAYnVzeQQAAABkZW5zAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAoCcSjBwrAgAAAAAAAAsAAAB0Yi1qb3VybmV5cwAA";
async function step():Promise<UpgradeStep>{
 const pair=KeyPair.fromRandom("ed25519"),tx=createTransaction(candidate.account,pair.getPublicKey(),candidate.account,1n,[actions.deployContract(code)],new Uint8Array(32)),signed=(await new KeyPairSigner(pair).signTransaction(tx)).signedTransaction;
 return {name:"root",account:candidate.account,hash:hash(encodeTransaction(tx)),transaction:base64Encode(encodeTransaction(tx)),signedTransaction:base64Encode(signed.encode()),state:"prepared"};
}
test("upgrade arguments have one fixed tuple and explicit digest approval; preparation never implies signing",()=>{
 expect(parseUpgradeArguments([])).toEqual({live:false});
 const directory="/Users/dadadave/.codex/specs/familiar-tidebound-2026-11-12";
 expect(parseUpgradeArguments([`--review-dir=${directory}`])).toEqual({live:false,directory});
 expect(parseUpgradeArguments([`--review-dir=${directory}`,"--live",`--approve=${"a".repeat(64)}`])).toEqual({live:true,directory,approval:"a".repeat(64)});
 for(const args of [["--live"],[`--review-dir=${directory}`,"--live"],[`--review-dir=${directory}`,`--approve=${"a".repeat(64)}`],["--root=legacy.testnet"],["--resume"],[`--review-dir=${directory}`,"--live",`--approve=${"a".repeat(64)}`,"--live"]])expect(()=>parseUpgradeArguments(args)).toThrow();
});
test("only both frozen candidate byte lengths and digests can be loaded",()=>{
 expect(()=>assertUpgradeArtifact("root",code)).toThrow();expect(()=>assertUpgradeArtifact("items",code)).toThrow();
 expect(UPGRADE.candidates.root.codeHash).toBe("4xtG29913j2BNpJaX16YQwMrP7WEE6mQp5UaBWFqb8xt");
 expect(UPGRADE.candidates.items.codeHash).toBe("8wXoHBcJwoX9fUkz83uG5bmnM18hNWGJBceXx5dvGNa2");
 expect(Object.keys(UPGRADE.candidates)).toEqual(["items","root"]);
 expect(UPGRADE.config as Record<string,string>).toEqual(existing.contracts.config);for(const [name,expected] of Object.entries(UPGRADE.old))expect(existing.contracts.currentCode.find(c=>c.accountId===(name==="root"?UPGRADE.root:UPGRADE.items))?.codeHash).toBe(expected);
});
test("signed deployment guards compare actual Borsh bytes, signature, hash, self-account and sole code action",async()=>{
 const good=await step();expect(()=>assertDeployEnvelope(good,candidate,code)).not.toThrow();
 for(const changed of [{hash:"wrong"},{account:UPGRADE.items},{signedTransaction:good.transaction},{transaction:good.transaction+"\n"}])expect(()=>assertDeployEnvelope({...good,...changed},candidate,code)).toThrow();
 const pair=KeyPair.fromRandom("ed25519");
 for(const [signer,receiver,actionList] of [[UPGRADE.root,UPGRADE.items,[actions.deployContract(code)]],[UPGRADE.items,UPGRADE.root,[actions.deployContract(code)]],[UPGRADE.root,UPGRADE.root,[actions.deployContract(code),actions.functionCall("new",{},1n,0n)]],[UPGRADE.root,UPGRADE.root,[actions.transfer(1n)]],[UPGRADE.root,UPGRADE.root,[actions.deployContract(new Uint8Array([...code,0]))]]] as const){
  const tx=createTransaction(signer,pair.getPublicKey(),receiver,1n,[...actionList],new Uint8Array(32)),signed=(await new KeyPairSigner(pair).signTransaction(tx)).signedTransaction;
  expect(()=>assertDeployEnvelope({...good,hash:hash(encodeTransaction(tx)),transaction:base64Encode(encodeTransaction(tx)),signedTransaction:base64Encode(signed.encode())},candidate,code)).toThrow();
 }
});
const primary={network:"testnet",rules_version:"tidebound_h1_v1",content_version:"first_light_v1",registry:UPGRADE.root},v2={...primary,supported_content_versions:["first_light_v1","first_light_v2"]};
function snapshot(phase=0){return {codes:{[UPGRADE.root]:phase===2?UPGRADE.candidates.root.codeHash:UPGRADE.old.root,[UPGRADE.items]:phase>=1?UPGRADE.candidates.items.codeHash:UPGRADE.old.items,[UPGRADE.config.bakery]:UPGRADE.unchanged.bakery,[UPGRADE.config.market]:UPGRADE.unchanged.market},config:UPGRADE.config,rootProtocol:{...(phase===2?v2:primary),items:UPGRADE.items},itemProtocol:phase>=1?v2:primary,state:{root:{sha256:"root-state",value:"ROOT"},items:{sha256:"items-state",value:"ITEMS"}},protected:{players:[{account:"alice",journey:{revision:0}}],pets:[{globalHash:UPGRADE.unchanged.pet,keys:[]}],items:[{supply:"1",finish_used:true}]}};}
test("Items-first capability stages preserve v1 throughout and never accept another building or global Pet",()=>{
 for(let phase=0;phase<=2;phase++)expect(()=>assertUpgradePhase(snapshot(phase),phase as 0|1|2)).not.toThrow();
 for(const changed of [{...snapshot(1),codes:{...snapshot(1).codes,[UPGRADE.root]:UPGRADE.candidates.root.codeHash}},{...snapshot(2),config:{...UPGRADE.config,pet_code_hash:"new-pet"}},{...snapshot(2),codes:{...snapshot(2).codes,[UPGRADE.config.market]:"wrong"}},{...snapshot(2),rootProtocol:{...v2,items:UPGRADE.items,content_version:"first_light_v2"}},{...snapshot(2),itemProtocol:primary}])expect(()=>assertUpgradePhase(changed,2)).toThrow();
});
test("any changed STATE or selected earned/owned state demands review, without a restore operation",()=>{
 const before=snapshot();expect(()=>assertPreserved(before,snapshot(2))).not.toThrow();
 expect(()=>assertPreserved(before,{...snapshot(2),state:{...before.state,root:{sha256:"played",value:"NEW"}}})).toThrow("concurrent gameplay");
 expect(()=>assertPreserved(before,{...snapshot(2),protected:{...before.protected,players:[{account:"alice",journey:{revision:1}}]}})).toThrow("concurrent gameplay");
 expect(before.state.root.value).toBe("ROOT");
});
test("deployment budget prices protocol fees and positive code growth, preserving operating reserves under the fixed cap",()=>{
 const fee={send_sir:2,send_not_sir:3,execution:5},protocol={chain_id:"testnet",protocol_version:88,runtime_config:{min_gas_purchase_price:"1000000000",storage_amount_per_byte:"10000000000000000000",transaction_costs:{action_receipt_creation_config:fee,action_creation_config:{deploy_contract_cost:fee,deploy_contract_cost_per_byte:fee}}}};
 const state={value:actualState,codeHash:UPGRADE.old.root},q=quoteUpgrade("root",{amount:nearToYocto("10").toString(),storage_usage:432002},protocol,"100000000",state);
 expect(q.purchaseGasPrice).toBe(1000000000n);expect(q.storageGrowth).toBe(6757n*10n**19n);expect(q.required).toBe(q.storageGrowth+(16n+8n*433139n)*1000000000n);
 expect(q.operatingFloor).toBe(nearToYocto("2.25"));expect(q.available>=q.required+q.operatingFloor).toBe(true);
 expect(q.reservedStorage).toBe(nearToYocto("0.16384"));expect(q.contractReserve).toBe(nearToYocto("0.10"));expect(q.available).toBe(q.protocolUnlocked-q.reservedStorage-q.contractReserve);
 for(const changed of [{...protocol,chain_id:"mainnet"},{...protocol,runtime_config:{...protocol.runtime_config,min_gas_purchase_price:"0"}},{...protocol,runtime_config:{...protocol.runtime_config,transaction_costs:{}}}])expect(()=>quoteUpgrade("root",{amount:"1",storage_usage:1},changed,"100000000",state)).toThrow();
 expect(()=>quoteUpgrade("root",{amount:"1",storage_usage:1},protocol,"100000000",state)).toThrow("operating reserve");
 expect(()=>quoteUpgrade("root",{amount:nearToYocto("10"),storage_usage:1},protocol,"100000000")).toThrow("reservation proof");
 const balance=q.required+q.operatingFloor+nearToYocto("0.10")+nearToYocto("0.16");
 expect(()=>quoteUpgrade("root",{amount:balance,storage_usage:0},protocol,"100000000",state)).toThrow("operating reserve");
 expect(()=>quoteUpgrade("root",{amount:balance,storage_usage:0},protocol,"100000000",{value:rustZero,codeHash:UPGRADE.old.root})).not.toThrow();
 const items=quoteUpgrade("items",{amount:nearToYocto("4"),storage_usage:320000},protocol,"100000000",undefined,nearToYocto("0.11584"));expect(items.reservedStorage).toBe(nearToYocto("0.11584"));expect(items.available).toBe(items.protocolUnlocked-items.reservedStorage);expect(items.operatingFloor).toBe(nearToYocto("0.10"));
 expect(()=>quoteUpgrade("items",{amount:nearToYocto("4"),storage_usage:320000},protocol,"100000000")).toThrow("refundable Items credit proof");
});
test("complete frozen Root Borsh decoder agrees with actual public state and independent Rust zero/nonzero serialization",()=>{
 const actual=base64Decode(actualState);expect(actual.length).toBe(567);expect(createHash("sha256").update(actual).digest("hex")).toBe("c72544ffe24bcf52bf1ce54a155229b26b81ae83ff4dcebe5a2fb8c53c88f0e7");
 expect(decodeRootReservedStorage(actual,UPGRADE.old.root)).toBe(163840000000000000000000n);
 expect(decodeRootReservedStorage(base64Decode(rustZero),UPGRADE.old.root)).toBe(0n);expect(decodeRootReservedStorage(base64Decode(rustPending),UPGRADE.old.root)).toBe(10240000000000000000000n);
 expect(decodeRootReservedStorage(actual,UPGRADE.candidates.root.codeHash)).toBe(163840000000000000000000n);
 for(const bytes of [actual.slice(1),actual.slice(0,-1),new Uint8Array([...actual,0]),new Uint8Array([...actual.slice(0,100),255,...actual.slice(101)])])expect(()=>decodeRootReservedStorage(bytes,UPGRADE.old.root)).toThrow();
 expect(()=>decodeRootReservedStorage(actual,"unknown-layout")).toThrow("Unknown Root layout");
});
test("unknown submission stops after one attempt with the same signed envelope durably recorded first",async()=>{
 const original=await step(),states:string[]=[],envelopes:string[]=[];let sends=0;
 const persist=async()=>{states.push(original.state);envelopes.push(original.signedTransaction);};
 await expect(submitUpgradeOnce(original,async()=>{sends++;expect(states.at(-1)).toBe("submitted");throw Error("unknown result");},persist)).rejects.toThrow("unknown result");
 expect(sends).toBe(1);expect(original.state).toBe("uncertain");expect(states).toEqual(["prepared","submitted","uncertain"]);expect(new Set(envelopes).size).toBe(1);
 await expect(submitUpgradeOnce(original,async()=>{sends++;return {};},persist)).rejects.toThrow("already attempted");expect(sends).toBe(1);
});
test("an existing stopped execution journal is never replaced or resumed",async()=>{
 const directory=await mkdtemp(join(tmpdir(),"familiar-v2-upgrade-test-")),path=join(directory,"journal.json");
 try{await requireNoExecutionJournal(path);await writeFile(path,"ORIGINAL_SIGNED_ENVELOPE_PRESERVE",{flag:"wx",mode:0o600});await expect(requireNoExecutionJournal(path)).rejects.toThrow("no rerun");expect(await readFile(path,"utf8")).toBe("ORIGINAL_SIGNED_ENVELOPE_PRESERVE");}finally{await rm(directory,{recursive:true,force:true});}
});
test("actual pinned Items credit rows preserve every refundable liability, including accounts without players",()=>{
 // Public raw AQ== rows at finalized277431634, pinned2s2 Items; not a mock economic allocation.
 const rows=[
  {key:"ARwAAABtYXJrZXQuZmFtaWxpYXItZ2FtZS50ZXN0bmV0",value:"AACAZHWTwTM8BAAAAAAAAAAAgGR1k8EzPAQAAAAAAAA="},
  {key:"ASEAAABxYS1tYWtlci1oMS5mYW1pbGlhci1nYW1lLnRlc3RuZXQ=",value:"AACAZHWTwTM8BAAAAAAAAAAAABs0vxAZugMAAAAAAAA="},
  {key:"ASEAAABxYS1tb2NoaS1oMS5mYW1pbGlhci1nYW1lLnRlc3RuZXQ=",value:"AACAZHWTwTM8BAAAAAAAAAAAgGR1k8EzPAQAAAAAAAA="},
  {key:"ASIAAABxYS1ob2xkZXItaDEuZmFtaWxpYXItZ2FtZS50ZXN0bmV0",value:"AACAZHWTwTM8BAAAAAAAAAAAAJVWgNnK3AMAAAAAAAA="},
  {key:"ASMAAABxYS1icmFtYmxlLWgxLmZhbWlsaWFyLWdhbWUudGVzdG5ldA==",value:"AACAZHWTwTM8BAAAAAAAAAAAgGR1k8EzPAQAAAAAAAA="},
  {key:"AS4AAABtb2NoaS1kMDAzMDdiNmY0NTZhNjkzMDguZmFtaWxpYXItZ2FtZS50ZXN0bmV0",value:"AACAZHWTwTM8BAAAAAAAAAAAgGR1k8EzPAQAAAAAAAA="},
 ];
 const proof=decodeItemCredits(rows,UPGRADE.old.items);expect(proof.entries).toHaveLength(6);expect(proof.available).toBe(115840000000000000000000n);expect(proof.entries.find(e=>e.accountId===UPGRADE.config.market)?.available).toBe(nearToYocto("0.02"));
 expect(decodeItemCredits(rows,UPGRADE.candidates.items.codeHash).available).toBe(proof.available);
 for(const malformed of [null,Array(513).fill(rows[0]),[rows[0],rows[0]],[{...rows[0],key:rows[0]!.key+"\n"}],[{...rows[0],value:base64Encode(new Uint8Array(31))}],[{key:base64Encode(new Uint8Array([1,255,255,255,255,1,1])),value:rows[0]!.value}]])expect(()=>decodeItemCredits(malformed,UPGRADE.old.items)).toThrow();
 expect(()=>decodeItemCredits(rows,"other-layout")).toThrow();
 const corrupted=new Uint8Array(32);corrupted[16]=1;expect(()=>decodeItemCredits([{...rows[0],value:base64Encode(corrupted)}],UPGRADE.old.items)).toThrow("liability");
});
test("actual SDK with retries1 makes one HTTP attempt and retains the original submitted bytes on failure",async()=>{
 const original=await step(),fetch=globalThis.fetch,states:string[]=[];let attempts=0;
 try{globalThis.fetch=Object.assign(async()=>{attempts++;expect(original.state).toBe("submitted");return new Response("Service unavailable",{status:503});},{preconnect:fetch.preconnect});
  const provider=new JsonRpcProvider({url:"http://127.0.0.1:1"},{retries:1});await expect(submitUpgradeOnce(original,()=>provider.sendTransactionUntil(assertDeployEnvelope(original,candidate,code),"FINAL"),async()=>{states.push(original.state);})).rejects.toThrow();
  expect(attempts).toBe(1);expect(states).toEqual(["prepared","submitted","uncertain"]);expect(original.state).toBe("uncertain");expect(()=>assertDeployEnvelope(original,candidate,code)).not.toThrow();
 }finally{globalThis.fetch=fetch;}
});
