import {expect,test} from "bun:test";
import {emptyBook,readBook} from "../run/save";
import {startTide} from "../run/engine";
import {emptyPassageHome,readPassageHome} from "./passage-save";
import {decodeReturnRecord,ReturnRecords,returnRecordKey} from "./return-record";
import {hasPristineDeviceHistory,isPristineHarbor,pristineDeviceHarbor} from "./onboarding";

const fresh=()=>({home:{banked:[],lit:false,signaled:false,lantern:null},active:null,last:null});
const legacyKeys=["familiar.tide.log.v1:preview","familiar.season.tide.v1:preview","familiar.tide.pending.v1:preview"];
function storage(entries:Iterable<readonly [string,string]>=[]){
  const bytes=new Map(entries),writes:string[]=[];
  return {bytes,writes,getItem:(key:string)=>bytes.get(key)??null,setItem:(key:string,value:string)=>{writes.push(key);bytes.set(key,value);}};
}

test("a pristine device requires verified empty histories, independently of the guidance preference",()=>{
  const store=storage([["familiar.guidance.keep-wrens-light.v1",'{"version":1,"intro":null,"buttons":true}']]);
  expect(pristineDeviceHarbor(fresh(),emptyBook(),emptyPassageHome(),{ok:true,records:[]},store)).toBe(true);
  for(const key of legacyKeys)store.bytes.set(key,key.includes("pending")?"null":"[]");
  expect(hasPristineDeviceHistory(store)).toBe(true);expect(store.writes).toEqual([]);
});

test("all earned, active and completed outing states suppress automatic introduction",()=>{
  const save=fresh(),book=emptyBook(),passage=emptyPassageHome();
  expect(isPristineHarbor(save,book,passage)).toBe(true);
  for(const home of [{banked:["lens"]},{lit:true},{signaled:true},{lantern:{motif:"crest",socket:"porch"}}]){
    expect(isPristineHarbor({...save,home:{...save.home,...home}} as Parameters<typeof isPristineHarbor>[0],book,passage)).toBe(false);
  }
  expect(isPristineHarbor({...save,active:{}},book,passage)).toBe(false);
  expect(isPristineHarbor({...save,last:{}},book,passage)).toBe(false);
  expect(isPristineHarbor(save,{...book,active:startTide({seed:5,story:"lens"})},passage)).toBe(false);
  expect(isPristineHarbor(save,{...book,days:[startTide({seed:5})]},passage)).toBe(false);
  for(const progress of [{services:["bell"]},{watchedReeds:true},{heardBell:true},{active:{}}]){
    expect(isPristineHarbor(save,book,{...passage,...progress} as Parameters<typeof isPristineHarbor>[2])).toBe(false);
  }
  expect(pristineDeviceHarbor(save,book,passage,{ok:false,records:[]},storage())).toBe(false);
  const record=decodeReturnRecord({schemaVersion:1,id:"onboarding-test",operationId:"return:onboarding-test",contentVersion:"first_light_v2",context:{authority:"local-preview",banked:[],lit:false,signaled:false},area:"beacon",tool:"rope",banked:[],commands:["return"],outcome:"returned",cargo:[],disposition:"private-memory"});
  expect(pristineDeviceHarbor(save,book,passage,{ok:true,records:[record]},storage())).toBe(false);
});

test("corrupt and nonempty legacy histories cannot masquerade as empty and retain their original bytes",()=>{
  for(const key of legacyKeys){
    const cases=key.includes("pending")?["", "{", "[]", "{}", '{"day":12,"late":false}']:["", "{", "null", "{}", "[null]", "[{}]"];
    for(const raw of cases){
      const store=storage([[key,raw]]);
      expect(pristineDeviceHarbor(fresh(),emptyBook(),emptyPassageHome(),{ok:true,records:[]},store)).toBe(false);
      expect(store.bytes.get(key)).toBe(raw);expect(store.writes).toEqual([]);
    }
  }
});

test("an unreadable legacy history suppresses introduction without a write",()=>{
  for(const key of legacyKeys){
    let writes=0;const store={getItem:(candidate:string)=>{if(candidate===key)throw Error("blocked");return null;},setItem:()=>{writes++;}};
    expect(hasPristineDeviceHistory(store)).toBe(false);expect(writes).toBe(0);
  }
});

test("strict return, TideBook and passage reads reject corrupt or unreadable records without repairing bytes",()=>{
  const context={authority:"local-preview" as const,banked:[],lit:false,signaled:false};
  const readers:[string,(store:ReturnType<typeof storage>)=>unknown][]=[
    [returnRecordKey(context),store=>new ReturnRecords(store).read(context)],
    ["familiar.expedition.local.v2:tide-run.v1",store=>readBook(store,"familiar.expedition.local.v2:tide-run.v1")],
    ["familiar.expedition.local.v2:shore-passages.v1",store=>readPassageHome(store,"familiar.expedition.local.v2:shore-passages.v1")],
  ];
  for(const [key,read] of readers){
    for(const raw of ["", "{", "{}", "[null]"]){
      const store=storage([[key,raw]]);expect(()=>read(store)).toThrow();expect(store.bytes.get(key)).toBe(raw);expect(store.writes).toEqual([]);
    }
    const blocked=storage();blocked.getItem=()=>{throw Error("blocked");};expect(()=>read(blocked)).toThrow("blocked");expect(blocked.writes).toEqual([]);
  }
});
