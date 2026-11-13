import { expect, test } from "bun:test";
import { replayPassage } from "./passage";
import { dockPassage, emptyPassageHome, readPassageHome, writePassageHome } from "./passage-save";

test("a terminal reload banks a completed job once and keeps the other landing in the harbor",()=>{
  const store=new Map<string,string>();
  const storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);}};
  const bell=replayPassage("bell",["step:north","step:west","ride","step:south","step:south","step:east","return"]);
  expect(bell?.court.outcome).toBe("returned");
  writePassageHome(storage,"preview",{services:["reed"],watchedReeds:true,heardBell:false,active:bell});
  const resumed=readPassageHome(storage,"preview");
  expect(resumed.active).toEqual(bell);
  writePassageHome(storage,"preview",dockPassage(resumed));
  expect(readPassageHome(storage,"preview")).toEqual({services:["reed","bell"],watchedReeds:true,heardBell:false,active:null});
  expect(readPassageHome(storage,"another player")).toEqual(emptyPassageHome());
});

test("an empty return creates no service and an invalid ride cannot be resumed",()=>{
  const active=replayPassage("reed",["return"]);
  expect(dockPassage({...emptyPassageHome(),active})).toEqual(emptyPassageHome());
  const raw=JSON.stringify({version:1,services:[],watchedReeds:false,active:{job:"reed",mothHome:false,commands:["ride"]}});
  expect(()=>readPassageHome({getItem:()=>raw},"preview")).toThrow();
});

test("existing saves preserve their original departure and missing bell fields read as false",()=>{
  const old={version:1,services:["reed"],watchedReeds:true,active:{job:"bell",mothHome:false,commands:["step:north","step:north"]}};
  const read=(record:unknown)=>readPassageHome({getItem:()=>JSON.stringify(record)},"preview");
  expect(read(old)).toMatchObject({services:["reed"],watchedReeds:true,heardBell:false,active:{bellRigged:false,heardBell:false,archOpen:false}});
  expect(read({...old,heardBell:true}).active?.bellRigged).toBe(false);
  expect(()=>read({...old,heardBell:null})).toThrow();
  expect(()=>read({...old,active:{...old.active,bellRigged:null}})).toThrow();
  expect(()=>read({...old,active:{...old.active,archOpen:null}})).toThrow();
  expect(read({...old,services:["reed","bell"]}).active?.archOpen).toBe(false);
  expect(()=>read({...old,active:{...old.active,bellRigged:true}})).toThrow();
  expect(()=>read({...old,active:{...old.active,commands:[...old.active.commands,"ring"]}})).toThrow();
});

test("hearing the bell survives interruption and rigs the next outing only after a safe return",()=>{
  const N="step:north",W="step:west",S="step:south",E="step:east";
  const approach=[N,W,"ride",N,E,W,"listen"];
  const run=replayPassage("bell",approach,false,false,true)!;
  let raw="";
  const storage={getItem:()=>raw,setItem:(_key:string,value:string)=>{raw=value;}};
  writePassageHome(storage,"preview",{...emptyPassageHome(),active:run});
  const resumed=readPassageHome(storage,"preview");
  expect(resumed.heardBell).toBe(false);
  expect(resumed.active).toEqual(run);
  const safe = replayPassage("bell",[...approach,S,E,W,S,E,S,"return"],false,false,true);
  const unlocked = dockPassage({...resumed,active:safe});
  expect(unlocked.heardBell).toBe(true);
  const rescue = replayPassage("bell",["wait",N,N,N,W,N,N,E,W,"listen","wait","wait"],false,false,true);
  expect(rescue?.court.outcome).toBe("rescued");
  expect(rescue?.heardBell).toBe(true);
  expect(dockPassage({...resumed,active:rescue}).heardBell).toBe(false);
  expect(dockPassage({...unlocked,active:rescue}).heardBell).toBe(true);
  const rigged = replayPassage("reed",[N,N,"ring"],false,true);
  writePassageHome(storage,"preview",{...unlocked,active:rigged});
  expect(readPassageHome(storage,"preview").active).toEqual(rigged);
});
