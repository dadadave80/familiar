import { expect, test } from "bun:test";
import { TURN_LIMIT } from "../expedition/types";
import { replayRun, solve, startRun, stepRun } from "./asks";
import { cardForDay, tideDay, TIDE_POOL } from "./cards";
import { betterTide, readTideLog, readTidePending, recordTide, tideLogKey, tideSummary, writeTidePending } from "./log";

const memory=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);},removeItem:(k:string)=>{m.delete(k);}};};
const day=20771,card=cardForDay(day),route=solve(card.tool,card.asks)!;
const input=(commands:readonly string[]=route)=>({day,tool:card.tool,commands,late:false,now:new Date("2026-11-14T12:00:00Z")});
const rescue=()=>{let run=startRun("rope");for(let i=0;i<TURN_LIMIT&&run.state.outcome==="active";i++)run=stepRun(run,"wait")!;expect(run.state.outcome).toBe("rescued");return run.state.commands;};

test("each day keeps more asks, then fewer decisions, while counting every attempt",()=>{
  const store=memory(),slow=recordTide("p",input(["wait","return"]),store);
  expect(slow.improved).toBe(true);expect(slow.previous).toBeNull();
  const quick=recordTide("p",input(["return"]),store);
  expect(quick.improved).toBe(true);expect(quick.entry.kept).toEqual(slow.entry.kept);expect(quick.entry.decisions).toBeLessThan(slow.entry.decisions);
  const best=recordTide("p",input(),store);
  expect(best.improved).toBe(true);expect(best.entry.kept).toEqual([true,true,true]);expect(best.entry.attempts).toBe(3);
  const longer=["wait","wait","wait",...route];expect(replayRun(card.tool,longer)?.state.outcome).toBe("returned");
  const worse=recordTide("p",{...input(longer),late:true},store);
  expect(worse.improved).toBe(false);expect(worse.previous).toEqual(best.entry);expect(worse.entry).toEqual({...best.entry,attempts:4});
  expect(recordTide("p",input(),store).improved).toBe(false);expect(readTideLog("p",store)[0]!.attempts).toBe(5);
  expect(readTideLog("other",store)).toEqual([]);
});

test("rescues can be logged but never replace a returned outing",()=>{
  const store=memory(),commands=rescue();
  const first=recordTide("p",input(commands),store);expect(first.entry.outcome).toBe("rescued");expect(first.entry.kept).toEqual([false,false,false]);
  const home=recordTide("p",input(["return"]),store);expect(home.improved).toBe(true);
  const again=recordTide("p",input(commands),store);expect(again.improved).toBe(false);expect(again.entry).toEqual({...home.entry,attempts:3});
});

test("an empty return logs no asks kept on every card",()=>{
  const store=memory();
  for(let day=0;day<TIDE_POOL.length;day++){
    const card=cardForDay(day),recorded=recordTide("p",{...input(["return"]),day,tool:card.tool},store);
    expect(recorded.entry.kept).toEqual([false,false,false]);
  }
  expect(readTideLog("p",store).every(entry=>entry.kept.every(kept=>!kept))).toBe(true);
});

for(const late of [false,true])test(`${late?"a late":"an on-time"} day keeps its timing after a better late run`,()=>{
  const store=memory();recordTide("p",{...input(["return"]),late},store);
  const better=recordTide("p",{...input(),late:true},store);
  expect(better.improved).toBe(true);expect(better.entry.kept).toEqual([true,true,true]);expect(better.entry.late).toBe(late);
  expect(readTideLog("p",store)[0]!.late).toBe(late);
});

test("an on-time attempt updates the day even when its route is not better",()=>{
  const store=memory(),best=recordTide("p",{...input(),late:true},store).entry;
  const worse=recordTide("p",input(["return"]),store);
  expect(worse.improved).toBe(false);expect(worse.entry).toEqual({...best,late:false,attempts:2});
  expect(readTideLog("p",store)[0]!.late).toBe(false);
});

test("reading ignores broken data and derives scores from commands",()=>{
  const store=memory(),key=tideLogKey("p");
  for(const raw of ["{","null","{}"]){store.setItem(key,raw);expect(readTideLog("p",store)).toEqual([]);}
  expect(readTideLog("p",{getItem:()=>{throw Error("blocked");}})).toEqual([]);
  const good=recordTide("p",input(),store).entry;
  store.setItem(key,JSON.stringify([null,{...good,commands:["step:south"]},{...good,day:1.5},{...good,late:0},{...good,tool:"net"},{...good,commands:[7]},
    {...good,cardId:"wrong",kept:[false,false,false],decisions:999,outcome:"rescued",attempts:0,savedAt:7}]));
  expect(readTideLog("p",store)).toEqual([{...good,attempts:1,savedAt:""}]);
});

test("duplicate days keep the better return and the largest attempt count",()=>{
  const store=memory(),good=recordTide("p",input(),store).entry;
  const poor={...good,commands:["return"],attempts:7},rescued={...good,commands:rescue(),attempts:9};
  for(const entries of [[good,poor,rescued],[rescued,poor,good]]){
    store.setItem(tideLogKey("p"),JSON.stringify(entries));expect(readTideLog("p",store)).toEqual([{...good,attempts:9}]);
  }
  const slow={...good,commands:["wait","return"],attempts:4};
  for(const entries of [[slow,poor],[poor,slow]]){
    store.setItem(tideLogKey("p"),JSON.stringify(entries));expect(readTideLog("p",store)[0]).toMatchObject({commands:["return"],decisions:1,attempts:7});
  }
  let run=replayRun(card.tool,route.slice(0,3))!;
  while(run.state.outcome==="active")run=stepRun(run,"wait")!;
  expect(run.state.commands.length).toBeGreaterThan(rescued.commands.length);
  const laterRescue={...rescued,commands:run.state.commands,attempts:12};
  for(const entries of [[laterRescue,rescued],[rescued,laterRescue]]){
    store.setItem(tideLogKey("p"),JSON.stringify(entries));expect(readTideLog("p",store)[0]).toMatchObject({commands:rescued.commands,attempts:12});
  }
});

test("only the highest ninety days remain",()=>{
  const store=memory();for(let i=0;i<95;i++)recordTide("p",{...input(["return"]),day:day+i},store);
  const entries=readTideLog("p",store);expect(entries.length).toBe(90);expect(entries[0]!.day).toBe(day+5);expect(entries[89]!.day).toBe(day+94);
});

test("unfinished, invalid and silently unsaved outings are refused",()=>{
  const store=memory();
  for(const value of [{...input(),day:1.5},input([]),input(["step:south"])])expect(()=>recordTide("p",value,store)).toThrow(new RangeError("This outing cannot be logged."));
  expect(()=>recordTide("p",input(),{getItem:()=>null,setItem:()=>{}})).toThrow("The tide log could not be saved on this device.");
});

test("pending outings round-trip, clear and tolerate unavailable storage",()=>{
  const store=memory(),key="familiar.tide.pending.v1:p";
  expect(readTidePending("p",store)).toBeNull();writeTidePending("p",{day,late:true},store);expect(readTidePending("p",store)).toEqual({day,late:true});
  writeTidePending("p",null,store);expect(store.getItem(key)).toBeNull();expect(readTidePending("p",store)).toBeNull();
  for(const raw of ["{","null",'{"day":1.5,"late":false}','{"day":1,"late":0}']){store.setItem(key,raw);expect(readTidePending("p",store)).toBeNull();}
  const blocked=()=>{throw Error("blocked");},broken={getItem:blocked,setItem:blocked,removeItem:blocked};
  expect(readTidePending("p",broken)).toBeNull();expect(()=>writeTidePending("p",{day,late:false},broken)).not.toThrow();expect(()=>writeTidePending("p",null,broken)).not.toThrow();
});

test("an outing docked after midnight is scored for its pending day",()=>{
  const store=memory(),midnight=(day+1)*86_400_000;
  writeTidePending("p",{day:tideDay(midnight-10_000),late:false},store);
  const pending=readTidePending("p",store)!;
  const recorded=recordTide("p",{...input(),...pending,now:new Date(midnight+10_000)},store).entry;
  expect(recorded).toMatchObject({day,cardId:card.id,tool:card.tool,kept:[true,true,true],late:false});
  expect(readTidePending("p",store)).toEqual({day,late:false});
  expect(readTideLog("p",store).some(entry=>entry.day===tideDay(midnight))).toBe(false);
});

test("score comparison and summary count asks and complete cards",()=>{
  const all={kept:[true,true,true] as [boolean,boolean,boolean],decisions:9},one={kept:[true,false,false] as [boolean,boolean,boolean],decisions:1};
  expect(betterTide(all,one)).toBe(true);expect(betterTide(one,all)).toBe(false);expect(betterTide(all,all)).toBe(false);
  expect(betterTide({...all,decisions:8},all)).toBe(true);expect(betterTide({...all,decisions:10},all)).toBe(false);
  const store=memory(),entry=recordTide("p",input(),store).entry;
  expect(tideSummary([entry,{...entry,...one}])).toEqual({sailed:2,kept:4,allThree:1});expect(tideSummary([])).toEqual({sailed:0,kept:0,allThree:0});
});
