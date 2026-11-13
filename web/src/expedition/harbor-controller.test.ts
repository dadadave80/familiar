import {expect,test} from "bun:test";
import {KeyPair} from "near-api-js";
import {createHash} from "node:crypto";
import {syntheticReturnLock} from "./return-record.fixture";
import fixtures from "../../../contracts/common/fixtures/court.json";
import {HarborController,canonicalWorkshop,type HarborConnection,type HarborClient} from "./harbor-controller";
import {replayCourt} from "./engine";
import {returnRecordKey} from "./return-record";
import type {PlayerBinding} from "../tidebound/domain";
import type {ChainSnapshot,PendingNative} from "../tidebound/client";
const root="familiar-game.testnet",key=KeyPair.fromRandom("ed25519").getPublicKey().toString();
const binding:PlayerBinding={playerId:`testnet:${root}:alice.${root}`,network:"testnet",nearAccountId:`alice.${root}`,signerPublicKey:key,signerBindingId:"synthetic-owner"};
const preview={banked:[],lit:false,signaled:false};
const lensCommands=["step:west","wait","step:east","step:west","step:north","step:east","step:west","step:north","step:east","reel:lens","step:west","step:east","step:west","step:south","step:east","step:south","return"];
function fixture() {
 const data=new Map<string,string>([["familiar.first-light.beacon.v1","unchanged-v1-save"]]),sent:{method:string;args:Record<string,unknown>;options:unknown}[]=[],existingLookups:string[]=[];
 let supported=true,unknown=false,pending:PendingNative|null=null,credit=0n,resumes=0,provisions=0,reads:(()=>Promise<void>)|null=null,onSend:((method:string,args:Record<string,unknown>)=>void)|null=null;
 let snapshot:ChainSnapshot={readAt:"synthetic",binding,checkpointHash:"a".repeat(64),pets:[{token_id:`mochi.${root}`}],items:[],nextItemIndex:null,
 journey:{revision:0,banked:[],lit:false,signaled:false,lens_claim:null,moth_claim:null,credit:"unclaimed",workshop_salvage:0,bram_budget:0,shells:0,burned_shells:0,commission_fulfilled:false,craft:null,polish:null,placement:null}};
 const client={root,itemsContract:`items.${root}`,async snapshot(){if(reads)await reads();return structuredClone(snapshot);},pending:()=>pending,async verifyStack(version?:string){if(version==="first_light_v2"&&!supported)throw Error("spatial content unsupported");},
  async send(_binding:PlayerBinding,method:string,args:Record<string,unknown>,options?:{deposit:bigint}) {
   sent.push({method,args:structuredClone(args),options});
   if(unknown){pending={operationId:"native:original",hash:"original-hash",method,receiver:root,transaction:"EXACT_ORIGINAL_BYTES",state:"prepared"};throw Error("original approval did not finish");}
   onSend?.(method,args);
   if(method==="storage_deposit")credit+=options!.deposit;
   else if(method==="tidebound_commission"){Object.assign(snapshot.journey,{commission_fulfilled:true,workshop_salvage:0,bram_budget:0,shells:12});snapshot.journey.revision++;}
   else if(method==="tidebound_craft")snapshot.journey.revision++;
   return "finalized";
  },
  async resumeNative(){resumes++;expect(pending?.transaction).toBe("EXACT_ORIGINAL_BYTES");pending=null;return "original finalized";},async reconcileNative(){return "checked";},async resolveExpiredNative(){return "not proven expired";},
  async view<T>(_contract:string,method:string){if(method==="storage_balance_bounds")return {min:"0",max:null} as T;if(method==="storage_balance_of")return {total:String(credit),available:String(credit)} as T;throw Error("unexpected view");},
 } as unknown as HarborClient;
 const adapter={accountRoot:root,async restoreSession(){return binding;},async authenticate(){return binding;},async endSession(){},async provisionAccount(){provisions++;return binding;}} as unknown as HarborConnection["adapter"];
 const controller=new HarborController({client,adapter,async accountExists(account){existingLookups.push(account);if(account==="absent.testnet")throw Error("recipient absent");}}, {getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value);}},syntheticReturnLock());
 return {controller,adapter,data,sent,existingLookups,get snapshot(){return snapshot;},set snapshot(value:ChainSnapshot){snapshot=value;},set supported(value:boolean){supported=value;},set unknown(value:boolean){unknown=value;},get pending(){return pending;},set pending(value:PendingNative|null){pending=value;},get resumes(){return resumes;},get provisions(){return provisions;},set credit(value:bigint){credit=value;},set reads(value:(()=>Promise<void>)|null){reads=value;},set onSend(value:(method:string,args:Record<string,unknown>)=>void){onSend=value;}};
}
async function saved(f:ReturnType<typeof fixture>){await f.controller.setBinding(binding);await f.controller.selectSaved();}
function earn(f:ReturnType<typeof fixture>){Object.assign(f.snapshot.journey,{revision:1,banked:["lens"],lens_claim:"b".repeat(64),credit:"available",workshop_salvage:1,bram_budget:12});}
function lantern(f:ReturnType<typeof fixture>){f.snapshot.items=[{mint:{id:"c".repeat(64),token_id:`lantern:${"d".repeat(64)}`,maker:binding.nearAccountId,origin_claim_id:"b".repeat(64),motif:"crest",input_hash:"e".repeat(64),rules_version:"tidebound_h1_v1",content_version:"first_light_v2"},finish:"original",finish_used:false,appearance_version:0}];}

test("restore selects no world and preserves existing Mochi, historical saves and wallet without provisioning",async()=>{
 const f=fixture();await f.controller.restore();expect(f.controller.state.mode).toBe("preview");expect(f.controller.state.snapshot?.pets[0]?.token_id).toBe(`mochi.${root}`);
 expect(f.data.get("familiar.first-light.beacon.v1")).toBe("unchanged-v1-save");expect(f.provisions).toBe(0);expect(f.sent).toEqual([]);
 f.supported=false;await expect(f.controller.selectSaved()).rejects.toThrow("private preview");expect(f.controller.state.mode).toBe("preview");expect(f.sent).toEqual([]);
});
test("waiting for sign-in does not block a local outing or merge it into a remembered saved harbor",async()=>{
 const f=fixture();let release!:(binding:PlayerBinding)=>void;
 f.adapter.authenticate=()=>new Promise(resolve=>release=resolve);
 f.data.set(`familiar.expedition.authority.v2:testnet:${root}:${binding.nearAccountId}`,"saved");
 f.pending={operationId:"native:original",hash:"original-hash",method:"adopt",receiver:root,transaction:"EXACT_ORIGINAL_BYTES",state:"prepared"};const original=structuredClone(f.pending);
 const signingIn=f.controller.authenticate();expect(f.controller.state.busy).toBe(true);
 const context=f.controller.runContext(preview);expect(context.authority).toBe("local-preview");f.controller.setActiveRun(context);
 release(binding);await signingIn;
 expect(f.controller.state.mode).toBe("preview");expect(f.controller.state.snapshot?.binding).toEqual(binding);expect(f.pending).toEqual(original);
 await expect(f.controller.selectSaved()).rejects.toThrow("Finish this outing");expect(f.sent).toEqual([]);expect(f.provisions).toBe(0);
});
test("saved outings and authority switches stay blocked while canonical reads or a review are pending",async()=>{
 const f=fixture();earn(f);await saved(f);let release!:()=>void,entered!:()=>void;
 const began=new Promise<void>(resolve=>entered=resolve);f.reads=()=>{entered();return new Promise<void>(resolve=>release=resolve)};
 const loading=f.controller.refresh();await began;
 expect(()=>f.controller.runContext(preview)).toThrow("Resolve the original request");expect(()=>f.controller.selectPreview()).toThrow("Finish this outing");release();await loading;f.reads=null;
 await f.controller.review({kind:"commission"});expect(()=>f.controller.runContext(preview)).toThrow("Resolve the original request");expect(f.sent).toEqual([]);
});
test("canonical workshop on another device uses accepted claims without any local origins",async()=>{
 const f=fixture();earn(f);await saved(f);expect(canonicalWorkshop(f.snapshot).motifs).toEqual(["crest"]);
 await f.controller.review({kind:"craft",motif:"crest"});expect(f.controller.state.review?.costs).toContain("1 protected First Light craft credit. No Shell cost.");expect(f.sent).toEqual([]);
 const id=f.controller.state.review!.id;f.controller.state.review!.intent={kind:"craft",motif:"moth"};await f.controller.confirm(id);
 expect(f.sent[0]?.args.motif).toBe("crest");expect(f.sent[0]?.args.origin_claim_id).toBe("b".repeat(64));
});
test("canonical return keeps exact context, original operation and companion; mere capture never sends",async()=>{
 const f=fixture();await saved(f);const context=f.controller.runContext(preview),run=replayCourt({area:"beacon",tool:"rope",banked:[]},lensCommands)!;
 f.controller.setActiveRun(context);await expect(f.controller.selectSaved()).rejects.toThrow("Finish this outing");const record=await f.controller.captureReturn(run,context);expect(record.commands).toHaveLength(17);expect(f.sent).toEqual([]);
 await expect(f.controller.selectSaved()).rejects.toThrow("Finish this outing");f.controller.setActiveRun(null);
 await f.controller.review({kind:"unpack",returnId:record.id});expect(f.controller.state.review?.description).toContain("lens");expect(f.sent).toEqual([]);
 f.unknown=true;await expect(f.controller.confirm(f.controller.state.review!.id)).rejects.toThrow("approval");
 expect(f.sent[0]?.args).toMatchObject({operation_id:record.operationId,token_id:`mochi.${root}`,content_version:"first_light_v2",commands:lensCommands});
 const before=JSON.stringify(f.pending);await expect(f.controller.review({kind:"commission"})).rejects.toThrow("original request");expect(JSON.stringify(f.pending)).toBe(before);expect(f.sent).toHaveLength(1);
 await f.controller.resumeOriginal();expect(f.resumes).toBe(1);expect(f.sent).toHaveLength(1);expect(f.controller.state.returns[0]?.operationId).toBe(record.operationId);
});
test("preview returns never merge at login and checkpoint conflicts preserve the return without payment",async()=>{
 const f=fixture(),run=replayCourt({area:"beacon",tool:"rope",banked:[]},lensCommands)!;
 const local=await f.controller.captureReturn(run,f.controller.runContext(preview));expect(local.disposition).toBe("private-memory");await saved(f);expect(f.controller.state.returns).toEqual([]);
 await expect(f.controller.review({kind:"unpack",returnId:local.id})).rejects.toThrow("private memory");
 const record=await f.controller.captureReturn(run,f.controller.runContext(preview));f.snapshot.journey.revision=1;
 await expect(f.controller.review({kind:"unpack",returnId:record.id})).rejects.toThrow("checkpoint changed");expect(f.sent).toEqual([]);
});
test("current holder, fresh review and explicit costs gate placement, commission and gifts",async()=>{
 const f=fixture();earn(f);lantern(f);await saved(f);const itemId=f.snapshot.items[0]!.mint.token_id;
 await f.controller.review({kind:"place",itemId,socket:"dock"});f.snapshot.items=[];
 await expect(f.controller.confirm(f.controller.state.review!.id)).rejects.toThrow("no longer holds");expect(f.sent).toEqual([]);
 lantern(f);await f.controller.review({kind:"gift",itemId,recipient:"recipient.testnet"});expect(f.controller.state.review?.title).toBe("Prepare the recipient’s storage");expect(f.controller.state.review?.costs[0]).toContain("0.02 test NEAR");
 f.credit=10n**22n;await expect(f.controller.confirm(f.controller.state.review!.id)).rejects.toThrow("credit changed");expect(f.sent).toEqual([]);
 await f.controller.review({kind:"gift",itemId,recipient:"recipient.testnet"});await f.controller.confirm(f.controller.state.review!.id);expect(f.sent).toHaveLength(1);expect(f.sent[0]?.method).toBe("storage_deposit");expect(f.sent[0]?.args.registration_only).toBe(false);
 expect(f.controller.state.review).toBeNull();await f.controller.review({kind:"gift",itemId,recipient:"recipient.testnet"});expect(f.controller.state.review?.title).toBe("Give the lantern");expect(f.sent).toHaveLength(1);f.controller.cancelReview();
 await expect(f.controller.review({kind:"gift",itemId,recipient:"absent.testnet"})).rejects.toThrow("recipient absent");expect(f.sent).toHaveLength(1);
});
test("signout or close fences late snapshots without deleting original pending records",async()=>{
 const f=fixture();let release!:()=>void,entered!:()=>void;const began=new Promise<void>(resolve=>entered=resolve);
 f.reads=()=>{entered();return new Promise<void>(resolve=>release=resolve);};const loading=f.controller.setBinding(binding);await began;await f.controller.signOut();release();await loading;
 expect(f.controller.state.binding).toBeNull();expect(f.controller.state.snapshot).toBeNull();expect(f.controller.state.mode).toBe("preview");expect(f.sent).toEqual([]);
});
test("explicit saved selection survives same-owner restoration, while active previews and an explicit preview choice do not merge",async()=>{
 const f=fixture();await saved(f);await f.controller.setBinding(null);await f.controller.setBinding(binding);expect(f.controller.state.mode).toBe("saved");
 f.controller.setActiveRun({authority:"local-preview",...preview});await f.controller.setBinding(binding);expect(f.controller.state.mode).toBe("preview");
 f.controller.setActiveRun(null);await f.controller.selectSaved();f.controller.selectPreview();await f.controller.setBinding(binding);expect(f.controller.state.mode).toBe("preview");
 f.controller.close();await expect(f.controller.authenticate()).rejects.toThrow("changed");await expect(f.controller.provisionPlayer("another")).rejects.toThrow("changed");expect(f.provisions).toBe(0);
});
for(const contentVersion of ["first_light_v1","first_light_v2"] as const)test(`an accepted ${contentVersion} return is reconciled by its exact original input hash before another payment`,async()=>{
 const f=fixture();await saved(f);const context=f.controller.runContext(preview),run=replayCourt({area:"beacon",tool:"rope",banked:[]},lensCommands)!;
 const captured=await f.controller.captureReturn(run,context);if(context.authority!=="near-testnet")throw Error();
 const record=contentVersion==="first_light_v1"?{...captured,contentVersion,commands:["move:left","wait","move:center","reel:lens","return"],cargo:["lens"]}:captured;
 f.data.set(returnRecordKey(context),JSON.stringify([record]));await f.controller.refresh();
 const input=createHash("sha256").update(JSON.stringify(["familiar.claim.v1","testnet",root,binding.nearAccountId,context.companionId,record.operationId,context.revision,context.checkpointHash,"tidebound_h1_v1",contentVersion,"rope",record.commands,"beacon"])).digest("hex");
 Object.assign(f.snapshot.journey,{revision:1,banked:["lens"],lens_claim:"b".repeat(64),credit:"available",workshop_salvage:1,bram_budget:12,claims:[{operation_id:record.operationId,id:"b".repeat(64),input_hash:input}]});
 await f.controller.review({kind:"unpack",returnId:record.id});expect(f.controller.state.review).toBeNull();expect(f.controller.state.returns[0]?.disposition).toBe("accepted");expect(f.sent).toEqual([]);
 const exported=JSON.parse(f.controller.exportReturns());expect(exported.records[0].acceptedClaimId).toBe("b".repeat(64));expect(JSON.stringify(exported)).not.toContain("synthetic-owner");
});
test("a reviewed unpack never substitutes a companion or pays gas after the original NFT leaves",async()=>{
 const f=fixture();await saved(f);const record=await f.controller.captureReturn(replayCourt({area:"beacon",tool:"rope",banked:[]},lensCommands)!,f.controller.runContext(preview));
 await f.controller.review({kind:"unpack",returnId:record.id});f.snapshot.pets=[{token_id:`different-mochi.${root}`}];
 await expect(f.controller.confirm(f.controller.state.review!.id)).rejects.toThrow("original companion");expect(f.sent).toEqual([]);
 expect(f.controller.state.returns[0]?.operationId).toBe(record.operationId);
});
test("mutating a displayed return after review cannot mark another memory accepted",async()=>{
 const f=fixture();await saved(f);const context=f.controller.runContext(preview),a=await f.controller.captureReturn(replayCourt({area:"beacon",tool:"rope",banked:[]},lensCommands)!,context),moth=fixtures.cases.find(c=>c.id==="beacon-rope-rescue")!,b=await f.controller.captureReturn(replayCourt(moth.start,moth.commands)!,context);
 await f.controller.review({kind:"unpack",returnId:a.id});f.controller.state.returns.find(r=>r.id===a.id)!.id=b.id;
 f.onSend=(_method,args)=>{const input=createHash("sha256").update(JSON.stringify(["familiar.claim.v1","testnet",root,binding.nearAccountId,args.token_id,args.operation_id,args.expected_revision,args.initial_checkpoint_hash,args.rules_version,args.content_version,args.tool,args.commands,args.area])).digest("hex");Object.assign(f.snapshot.journey,{revision:1,banked:["lens"],lens_claim:"b".repeat(64),credit:"available",workshop_salvage:1,bram_budget:12,claims:[{operation_id:args.operation_id,id:"b".repeat(64),input_hash:input}]});};
 await f.controller.confirm(f.controller.state.review!.id);expect(f.controller.state.returns.find(r=>r.id===a.id)?.disposition).toBe("accepted");expect(f.controller.state.returns.find(r=>r.id===b.id)?.disposition).toBe("staged");
});
test("Bram original-job recovery uses only the reserved operation and does not promise a timeout refund",async()=>{
 const f=fixture();earn(f);lantern(f);f.snapshot.journey.credit="reserved";f.snapshot.journey.craft={state:"reserved",attempt:1,pet_id:`mochi.${root}`,evidence:f.snapshot.items[0]!.mint};await saved(f);
 await f.controller.review({kind:"check-item"});expect(f.controller.state.review?.description).toContain("timeout never grants");await f.controller.confirm(f.controller.state.review!.id);expect(f.sent[0]?.method).toBe("tidebound_reconcile");expect(f.sent[0]?.args).toEqual({});expect(f.controller.state.message).toContain("remain reserved");
 await f.controller.review({kind:"retry-original-item"});await f.controller.confirm(f.controller.state.review!.id);expect(f.sent[1]?.method).toBe("tidebound_retry_operation");expect(f.sent[1]?.args).toEqual({});
 f.snapshot.journey.polish={state:"recovery-required"};await f.controller.review({kind:"resolve-original-polish"});expect(f.controller.state.review?.description).toContain("Shells return only after the contract proves cancellation");await f.controller.confirm(f.controller.state.review!.id);expect(f.sent[2]?.method).toBe("tidebound_cancel_polish");expect(f.sent.every(s=>s.options===undefined)).toBe(true);
 f.snapshot.journey.craft.state="confirmed";f.snapshot.journey.polish!.state="confirmed";await expect(f.controller.review({kind:"retry-original-item"})).rejects.toThrow("already settled");expect(f.sent).toHaveLength(3);
});

test("unpacking a historical return keeps its exact checkpoint, content and original operation",async()=>{
 const f=fixture();await saved(f);const context=f.controller.runContext(preview);
 const record={schemaVersion:1,id:"historical-lens",operationId:"return:historical-lens",contentVersion:"first_light_v1",context,area:"beacon",tool:"rope",banked:[],commands:["move:left","wait","move:center","reel:lens","return"],outcome:"returned",cargo:["lens"],disposition:"staged"};
 f.data.set(returnRecordKey(context),JSON.stringify([record]));
 await f.controller.refresh();await f.controller.review({kind:"unpack",returnId:record.id});
 expect(f.sent).toEqual([]);f.unknown=true;
 await expect(f.controller.confirm(f.controller.state.review!.id)).rejects.toThrow("approval");
 expect(f.sent[0]!.args).toMatchObject({operation_id:record.operationId,initial_checkpoint_hash:context.authority==="near-testnet"?context.checkpointHash:"",content_version:"first_light_v1",commands:record.commands});
 const original=JSON.stringify(f.pending);
 await expect(f.controller.review({kind:"commission"})).rejects.toThrow("original request");
 expect(JSON.stringify(f.pending)).toBe(original);expect(f.sent).toHaveLength(1);
 await f.controller.resumeOriginal();expect(f.resumes).toBe(1);expect(f.sent).toHaveLength(1);
 expect(f.controller.state.returns[0]!.operationId).toBe(record.operationId);
});
test("season actions send one exact allowlisted call to season.<root> and return only that call's final outcome",async()=>{
 const f=fixture();await expect(f.controller.seasonAct({kind:"buy",good:"glass",qty:1,maxPrice:8})).rejects.toThrow();expect(f.sent).toEqual([]);
 await saved(f);
 const client=(f.controller as unknown as {connection:{client:HarborClient&{lastFinal:unknown}}}).connection.client;
 const view=client.view.bind(client);let minimum="12500000000000000000000";
 client.view=(async(contract:string,method:string,args?:Record<string,unknown>)=>method==="storage_minimum"?(expect(contract).toBe(`season.${root}`),minimum):view(contract,method,args)) as typeof client.view;
 f.onSend=(method)=>{client.lastFinal={hash:"h",method,receiver:`season.${root}`,failed:method==="sell",outcome:{status:{SuccessValue:btoa("{}")}}};};
 expect(await f.controller.seasonAct({kind:"buy",good:"glass",qty:2,maxPrice:9})).toEqual({failed:false,outcome:{status:{SuccessValue:btoa("{}")}}});
 expect((await f.controller.seasonAct({kind:"sell",good:"reed",qty:1,minPrice:3}))?.failed).toBe(true);
 await f.controller.seasonAct({kind:"claim",contentVersion:"first_light_v2",tool:"rope",commands:["return"]});
 await f.controller.seasonAct({kind:"set-wish",good:"reed",limit:6,qty:2});
 await f.controller.seasonAct({kind:"cancel-wish"});
 await f.controller.seasonAct({kind:"register"});
 const season={receiver:`season.${root}`,deposit:0n};
 expect(f.sent).toEqual([
  {method:"buy",args:{good:"glass",qty:2,max_price:9},options:season},
  {method:"sell",args:{good:"reed",qty:1,min_price:3},options:season},
  {method:"claim_daily",args:{rules_version:"tidebound_h1_v1",content_version:"first_light_v2",tool:"rope",area:"beacon",commands:["return"]},options:season},
  {method:"set_wish",args:{pet:`mochi.${root}`,good:"reed",limit:6,qty:2},options:season},
  {method:"cancel_wish",args:{pet:`mochi.${root}`},options:season},
  {method:"storage_deposit",args:{},options:{receiver:`season.${root}`,deposit:12500000000000000000000n}},
 ]);
 minimum="1";await expect(f.controller.seasonAct({kind:"register"})).rejects.toThrow("page size");expect(f.sent.length).toBe(6);
 f.onSend=()=>{};expect(await f.controller.seasonAct({kind:"buy",good:"glass",qty:1,maxPrice:8})).toBeNull();
});
