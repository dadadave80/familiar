import {expect,test} from "bun:test";
import {PREPARED_ITEMS,REVIEW_SHA,parseContinuationArguments,assertPreparedJournal,assertUnusedPreparedProof,RpcPacer,submitPreparedItems,captureAfterFinalItems,type PreparedProof} from "./continue-tidebound-v2-upgrade";
import {UPGRADE,type Journal,type Snapshot} from "./upgrade-tidebound-v2";
import {base64Encode,baseDecode} from "near-api-js";
const directory="/Users/dadadave/.codex/specs/familiar-tidebound-2026-11-12";
function journal():Journal{return {version:1,kind:"private-two-contract-v2-execution",network:"testnet",root:UPGRADE.root,reviewSha256:REVIEW_SHA,startedAt:"original",status:"stopped-review-required",steps:[{name:"items",account:UPGRADE.items,hash:PREPARED_ITEMS,state:"prepared",transaction:"ORIGINAL_BYTES",signedTransaction:"ORIGINAL_SIGNATURE"}],observations:[{label:"stop",error:{message:"Rate limits exceeded429"}}]};}
test("continuation defaults to read-only and allows only the exact reviewed Items hash and review digest",()=>{
 expect(parseContinuationArguments([`--review-dir=${directory}`,`--items=${PREPARED_ITEMS}`])).toEqual({directory,live:false});
 expect(parseContinuationArguments([`--review-dir=${directory}`,`--items=${PREPARED_ITEMS}`,"--live",`--approve=${REVIEW_SHA}`])).toEqual({directory,live:true});
 for(const args of [[],["--live"],[`--review-dir=${directory}`,"--items=other"],[`--review-dir=${directory}`,`--items=${PREPARED_ITEMS}`,"--live"],[`--review-dir=${directory}`,`--items=${PREPARED_ITEMS}`,`--approve=${REVIEW_SHA}`],[`--review-dir=${directory}`,`--items=${PREPARED_ITEMS}`,"--reset"],[`--review-dir=${directory}`,`--items=${PREPARED_ITEMS}`,"--live",`--approve=${"a".repeat(64)}`]])expect(()=>parseContinuationArguments(args)).toThrow();
});
test("only the original one-step prepared429 stop can acquire one continuation without replacing history",()=>{
 const original=journal();expect(()=>assertPreparedJournal(original)).not.toThrow();
 for(const changed of [{status:"complete"},{reviewSha256:"different"},{steps:[]},{steps:[...original.steps,...original.steps]},{steps:[{...original.steps[0],state:"submitted"}]},{steps:[{...original.steps[0],hash:"other"}]},{observations:[]},{continuations:[{stage:"uncertain"}]}])expect(()=>assertPreparedJournal({...original,...changed})).toThrow();
 expect(original.steps[0]?.transaction).toBe("ORIGINAL_BYTES");expect(original.observations).toHaveLength(1);
});
test("same-byte submission requires exact unknown hash, pinned unused nonce, full state preservation and real protocol validity",()=>{
 const proof:PreparedProof={hash:PREPARED_ITEMS,unknownHash:PREPARED_ITEMS,account:UPGRADE.items,permission:"FullAccess",nonce:4n,transactionNonce:5n,originalBlockHash:"original",returnedOriginalBlockHash:"original",originalHeight:100,finalHash:"final",finalHeight:200,accessHash:"final",accessHeight:200,validity:86400};
 expect(()=>assertUnusedPreparedProof(proof)).not.toThrow();
 for(const changed of [{hash:"other"},{unknownHash:"outage"},{account:UPGRADE.root},{permission:"FunctionCall"},{nonce:5n},{nonce:3n},{returnedOriginalBlockHash:"other"},{accessHash:"other"},{accessHeight:199},{validity:0},{finalHeight:86501,accessHeight:86501},{originalHeight:201}])expect(()=>assertUnusedPreparedProof({...proof,...changed})).toThrow();
 expect(()=>assertUnusedPreparedProof({...proof,finalHeight:86500,accessHeight:86500})).not.toThrow();
});
test("pacing serializes every RPC attempt and preserves spacing after errors without automatic retries",async()=>{
 const log:string[]=[],pacer=new RpcPacer(250,async delay=>{log.push(`wait:${delay}`);});
 const a=pacer.run(async()=>{log.push("a");throw Error("429");}),b=pacer.run(async()=>{log.push("b");return 2;});
 await expect(a).rejects.toThrow("429");expect(await b).toBe(2);expect(log).toEqual(["wait:250","a","wait:250","b"]);
});
test("resumed-submitted marker and original bytes are durable before the sole submission; unknown result forbids Root signing",async()=>{
 const j=journal(),step=j.steps[0]!,history=JSON.stringify(j.observations),review:Record<string,unknown>={stage:"approved"};let attempts=0,rootSignatures=0;const saved:{state:string;stage:unknown;bytes:string}[]=[];
 const persist=async()=>{saved.push({state:step.state,stage:review.stage,bytes:step.signedTransaction});};
 await expect((async()=>{await submitPreparedItems(step,review,async()=>{attempts++;expect(saved.at(-1)).toEqual({state:"submitted",stage:"resumed-submitted",bytes:"ORIGINAL_SIGNATURE"});throw Error("unknown");},persist);rootSignatures++;})()).rejects.toThrow("unknown");
 expect(attempts).toBe(1);expect(rootSignatures).toBe(0);expect(step.state).toBe("uncertain");expect(review.stage).toBe("uncertain");expect(new Set(saved.map(v=>v.bytes)).size).toBe(1);expect(JSON.stringify(j.observations)).toBe(history);
 await expect(submitPreparedItems(step,review,async()=>{attempts++;},persist)).rejects.toThrow();expect(attempts).toBe(1);
});
test("Items becoming FINAL after a phase0 snapshot is verified against a new phase1 snapshot, never the stale view",async()=>{
 const primary={network:"testnet",rules_version:"tidebound_h1_v1",content_version:"first_light_v1",registry:UPGRADE.root},codes={[UPGRADE.root]:UPGRADE.old.root,[UPGRADE.items]:UPGRADE.old.items,[UPGRADE.config.bakery]:UPGRADE.unchanged.bakery,[UPGRADE.config.market]:UPGRADE.unchanged.market};
 const before={block:{hash:"before",height:100},codes,config:UPGRADE.config,rootProtocol:{...primary,items:UPGRADE.items},itemProtocol:primary,state:{root:"SAME",items:"SAME"},protected:{owned:"SAME"},accounts:{},protocol:{},gasPrice:"1",observedPets:[],itemAvailableCredit:"0"} as Snapshot;
 const after:Snapshot={...before,block:{hash:"after-final",height:101},codes:{...codes,[UPGRADE.items]:UPGRADE.candidates.items.codeHash},itemProtocol:{...primary,supported_content_versions:["first_light_v1","first_light_v2"]}};
 const receipt={final_execution_status:"FINAL",transaction:{hash:PREPARED_ITEMS,signer_id:UPGRADE.items,receiver_id:UPGRADE.items,actions:[{DeployContract:{code:base64Encode(baseDecode(UPGRADE.candidates.items.codeHash))}}]},status:{SuccessValue:""},transaction_outcome:{id:PREPARED_ITEMS,outcome:{executor_id:UPGRADE.items,status:{SuccessReceiptId:"execution"}}},receipts_outcome:[{id:"execution",outcome:{executor_id:UPGRADE.items,status:{SuccessValue:""}}}]};
 let reads=0,budgets=0;const result=await captureAfterFinalItems(receipt,before,async()=>{reads++;return after;},snapshot=>{budgets++;expect(snapshot.block.hash).toBe("after-final");});expect(result).toBe(after);expect(reads).toBe(1);expect(budgets).toBe(1);
 await expect(captureAfterFinalItems(receipt,before,async()=>before,()=>{budgets++;})).rejects.toThrow();expect(budgets).toBe(1);
 await expect(captureAfterFinalItems({...receipt,final_execution_status:"EXECUTED"},before,async()=>{reads++;return after;},()=>{})).rejects.toThrow();expect(reads).toBe(1);
});
