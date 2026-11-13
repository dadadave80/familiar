import { expect, test } from "bun:test";
import { replayPassage } from "./passage";
import { dockPassage, emptyPassageHome, readPassageHome, writePassageHome } from "./passage-save";

test("a terminal reload banks a completed job once and keeps the other landing in the harbor",()=>{
  const store=new Map<string,string>();
  const storage={getItem:(k:string)=>store.get(k)??null,setItem:(k:string,v:string)=>{store.set(k,v);}};
  const bell=replayPassage("bell",["step:north","step:west","ride","step:south","step:south","step:east","return"]);
  expect(bell?.court.outcome).toBe("returned");
  writePassageHome(storage,"preview",{services:["reed"],watchedReeds:true,active:bell});
  const resumed=readPassageHome(storage,"preview");
  expect(resumed.active).toEqual(bell);
  writePassageHome(storage,"preview",dockPassage(resumed));
  expect(readPassageHome(storage,"preview")).toEqual({services:["reed","bell"],watchedReeds:true,active:null});
  expect(readPassageHome(storage,"another player")).toEqual(emptyPassageHome());
});

test("an empty return creates no service and an invalid ride cannot be resumed",()=>{
  const active=replayPassage("reed",["return"]);
  expect(dockPassage({...emptyPassageHome(),active})).toEqual(emptyPassageHome());
  const raw=JSON.stringify({version:1,services:[],watchedReeds:false,active:{job:"reed",mothHome:false,commands:["ride"]}});
  expect(()=>readPassageHome({getItem:()=>raw},"preview")).toThrow();
});
