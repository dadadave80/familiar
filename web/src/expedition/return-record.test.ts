import {expect,test} from "bun:test";
import {applyCommand,startCourt,replayCourt} from "./engine";
import {ReturnRecords,decodeReturnRecord,returnRecordKey} from "./return-record";
import {KeyPair} from "near-api-js";
import type {RunContext} from "./harbor-port";
import {syntheticReturnLock} from "./return-record.fixture";
import fixtures from "../../../contracts/common/fixtures/court_v2.json";
const context:RunContext={authority:"near-testnet",network:"testnet",root:"familiar-game.testnet",accountId:"alice.familiar-game.testnet",companionId:"mochi.familiar-game.testnet",publicKey:KeyPair.fromRandom("ed25519").getPublicKey().toString(),revision:0,checkpointHash:"a".repeat(64),banked:[],lit:false,signaled:false};
const returned=()=>applyCommand(startCourt({area:"beacon",tool:"rope",banked:[]}),"return")!.after;
test("an interleaved second writer cannot lose its successfully captured return",async()=>{
 const data=new Map<string,string>();let interleave=true,nested:Promise<unknown>|undefined;
 const route=(id:string)=>{const row=fixtures.cases.find(c=>c.id===id)!;return replayCourt(row.start,row.commands)!;};
 const lens=route("beacon-rope-objective"),moth=route("beacon-rope-rescue");expect(lens.cargo).toEqual(["lens"]);expect(moth.cargo).toContain("moth");
 const store={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{if(interleave){interleave=false;nested=two.capture(moth,context);}data.set(key,value);}};
 const lock=syntheticReturnLock(),one=new ReturnRecords(store,lock),two=new ReturnRecords(store,lock);
 await one.capture(lens,context);await nested;expect(one.read(context)).toHaveLength(2);expect(one.read(context).some(r=>r.cargo.includes("moth"))).toBe(true);
});
test("return capture is durable, account-scoped and idempotent before the expedition is cleared",async()=>{
 const data=new Map<string,string>(),store={getItem:(key:string)=>data.get(key)??null,setItem:(key:string,value:string)=>{data.set(key,value);}};
 const records=new ReturnRecords(store,syntheticReturnLock()),one=await records.capture(returned(),context),two=await records.capture(returned(),context);
 expect(one).toEqual(two);expect(records.read(context)).toHaveLength(1);expect(data.has(returnRecordKey(context))).toBe(true);
 expect(records.read({...context,accountId:"bob.familiar-game.testnet"})).toEqual([]);
 await expect(records.capture({...returned(),outcome:"active"},context)).rejects.toThrow();
});
test("a failed or silent local write cannot report a captured return",async()=>{
 const silent=new ReturnRecords({getItem:()=>null,setItem:()=>{}},syntheticReturnLock());await expect(silent.capture(returned(),context)).rejects.toThrow("could not be saved");
 const throws=new ReturnRecords({getItem:()=>null,setItem:()=>{throw Error("storage full");}},syntheticReturnLock());await expect(throws.capture(returned(),context)).rejects.toThrow("storage full");
});
test("more than 32 original memories remain readable without silently dropping a staged record",async()=>{
 const data=new Map<string,string>(),records=new ReturnRecords({getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value);}},syntheticReturnLock());
 for(let revision=0;revision<40;revision++)await records.capture(returned(),{...context,revision});
 expect(records.read(context)).toHaveLength(40);expect(records.read(context).every(r=>r.disposition==="staged")).toBe(true);
});
test("v1 return decoding remains unchanged and malformed, foreign or relabelled v2 records fail closed",async()=>{
 const data=new Map<string,string>(),records=new ReturnRecords({getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value);}},syntheticReturnLock()),r=await records.capture(returned(),context);
 expect(decodeReturnRecord({...r,contentVersion:"first_light_v1",commands:["return"]}).contentVersion).toBe("first_light_v1");
 for(const changed of [{contentVersion:"new"},{cargo:["lens"]},{commands:["move:left"]},{context:{...context,network:"mainnet"}},{context:{...context,root:"foreign.testnet"}},{disposition:"accepted"}])expect(()=>decodeReturnRecord({...r,...changed})).toThrow();
 await records.mark(context,r.id,"accepted","b".repeat(64));await expect(records.mark(context,r.id,"staged")).rejects.toThrow();
});
test("unsupported Web Locks fails before any write, rather than claiming a recoverable return",async()=>{
 let writes=0;const records=new ReturnRecords({getItem:()=>null,setItem:()=>{writes++;}});
 await expect(records.capture(returned(),context)).rejects.toThrow("Web Locks");expect(writes).toBe(0);
});
test("crossing the readable memory bound fails before overwriting the earlier history",async()=>{
 const data=new Map<string,string>(),records=new ReturnRecords({getItem:key=>data.get(key)??null,setItem:(key,value)=>{data.set(key,value);}},syntheticReturnLock()),base=await records.capture(returned(),context);
 const rows:string[]=[];let length=2;
 for(let index=0;;index++){
   const id=`record-${String(index).padStart(5,"0")}`,row=JSON.stringify({...base,id,operationId:`return:${id}`,context:{...context,revision:index+1}}),addition=row.length+(rows.length?1:0);
   if(length+addition>4_000_000-50)break;rows.push(row);length+=addition;
 }
 const key=returnRecordKey(context),before=`[${rows.join(",")}]`;data.set(key,before);
 await expect(records.capture(returned(),context)).rejects.toThrow("memory limit");expect(data.get(key)).toBe(before);expect(records.read(context)).toHaveLength(rows.length);
});
