import { expect, test } from "bun:test";
import { legalCommands } from "../expedition/engine";
import { TURN_LIMIT } from "../expedition/types";
import { askHolds, askStatus, cardStatus, replayRun, solve, startRun, stepRun } from "./asks";
import { askChip, askLine, cardForDay, TIDE_POOL } from "./cards";

for(const card of TIDE_POOL)test(`${card.id} keeps every ask in exactly ${card.best} decisions`,()=>{
  const route=solve(card.tool,card.asks);expect(route).not.toBeNull();expect(route!.length).toBe(card.best);
  const run=replayRun(card.tool,route)!;
  expect(run.state.outcome).toBe("returned");expect(cardStatus(card,run)).toEqual(["kept","kept","kept"]);
  expect(solve(card.tool,card.asks,card.best-1)).toBeNull();
  for(const ask of card.asks){
    expect(askHolds(ask,run)).toBe(askStatus(ask,run)==="kept");
    if(ask.kind==="within")expect(ask.decisions).toBeGreaterThanOrEqual(card.best);
    expect(askLine(ask,card.tool).trim().length).toBeGreaterThan(0);
    for(const current of [startRun(card.tool),run])expect(askChip(ask,card.tool,current).trim().length).toBeGreaterThan(0);
  }
},60_000);

test("daily cards have unique ids, alternate tools and wrap fractional or negative days",()=>{
  expect(new Set(TIDE_POOL.map(card=>card.id)).size).toBe(TIDE_POOL.length);
  for(let day=20771;day<=20798;day++)expect(cardForDay(day).tool).not.toBe(cardForDay(day+1).tool);
  expect(cardForDay(20771).id).toBe("surf-home");expect(cardForDay(20772).id).toBe("brams-bridge");
  for(const day of [-1,-15.5,3.7]){expect(()=>cardForDay(day)).not.toThrow();expect(TIDE_POOL).toContain(cardForDay(day));}
});

test("a rescued outing slips every ask",()=>{
  let run=startRun("rope");
  for(let i=0;i<TURN_LIMIT&&run.state.outcome==="active";i++){
    expect(legalCommands(run.state)).toContain("wait");run=stepRun(run,"wait")!;
  }
  expect(run.state.outcome).toBe("rescued");
  for(const card of TIDE_POOL)for(const ask of card.asks){expect(askStatus(ask,run)).toBe("slipped");expect(askHolds(ask,run)).toBe(false);}
});

test("a decision budget slips when there is no decision left to come home",()=>{
  const ask={kind:"within",decisions:2} as const;
  let run=startRun("rope");expect(askStatus(ask,run)).toBe("open");expect(askHolds(ask,run)).toBe(true);
  run=stepRun(run,"step:north")!;expect(askStatus(ask,run)).toBe("open");expect(askHolds(ask,run)).toBe(true);
  run=stepRun(run,"step:west")!;expect(run.state.outcome).toBe("active");expect(askStatus(ask,run)).toBe("slipped");expect(askHolds(ask,run)).toBe(false);
});

test("the surf route slips moth-only at the lens and dry paws at the first splash",()=>{
  const card=cardForDay(20771),route=solve(card.tool,card.asks)!;
  expect(route).toEqual(["step:north","step:west","step:east","step:west","step:north","take:lens","step:south","step:east","return"]);
  const dry={kind:"style",style:"dry"} as const,moth={kind:"haul",haul:"moth"} as const;
  let run=startRun(card.tool),splashes=0,picked=false;
  for(const command of route){
    const next=stepRun(run,command)!;
    if(!splashes)expect(askStatus(dry,run)).toBe("open");
    if(next.state.resolve<run.state.resolve){splashes++;expect(askStatus(dry,next)).toBe("slipped");}
    if(command==="take:lens"){
      const lens={kind:"haul",haul:"lens"} as const;
      expect(askHolds(lens,run)).toBe(false);expect(askHolds(lens,next)).toBe(true);expect(askStatus(lens,next)).toBe("open");
      expect(askStatus(moth,run)).toBe("open");expect(askStatus(moth,next)).toBe("slipped");expect(askHolds(moth,next)).toBe(false);picked=true;
    }
    run=next;
  }
  expect(splashes).toBe(1);expect(picked).toBe(true);
});

test("an empty return keeps no asks on any card without changing live statuses",()=>{
  for(const card of TIDE_POOL){
    const run=startRun(card.tool);expect(cardStatus(card,run)).toEqual(["open","open","open"]);
    expect(cardStatus(card,stepRun(run,"return")!)).toEqual(["slipped","slipped","slipped"]);
  }
});

test("a budget holds through the final return decision but not an extra active decision",()=>{
  const card=cardForDay(20771),route=solve(card.tool,card.asks)!,ask={kind:"within",decisions:route.length} as const;
  const before=replayRun(card.tool,route.slice(0,-1))!,home=stepRun(before,"return")!;
  expect(askHolds(ask,before)).toBe(true);expect(askStatus(ask,before)).toBe("open");
  expect(askHolds(ask,home)).toBe(true);expect(askStatus(ask,home)).toBe("kept");
  const spent={...ask,decisions:before.state.turn};
  expect(askHolds(spent,before)).toBe(false);expect(askStatus(spent,before)).toBe("slipped");
  expect(askHolds(spent,home)).toBe(false);expect(askStatus(spent,home)).toBe("slipped");
});

test("a bridge ask can stop holding and hold again while remaining open",()=>{
  const ask={kind:"style",style:"bridge-center"} as const,start=startRun("lantern");
  const away=replayRun("lantern",["wait","wait","lure:left"])!,back=replayRun("lantern",[...away.state.commands,"wait","wait","lure:center"])!;
  expect([start.state.bridge,away.state.bridge,back.state.bridge]).toEqual([1,0,1]);
  expect([start,away,back].map(run=>askHolds(ask,run))).toEqual([true,false,true]);
  expect([start,away,back].map(run=>askStatus(ask,run))).toEqual(["open","open","open"]);
});

test("bridge chips name the requested lane and the bridge's current lane",()=>{
  for(const [style,name,command] of [["bridge-left","Left","lure:left"],["bridge-center","Center","lure:center"],["bridge-right","Right","lure:right"]] as const){
    const ask={kind:"style",style} as const,there=replayRun("lantern",["wait","wait",command])!;
    expect(askChip(ask,"lantern",there)).toBe(`Bridge at ${name} · there now`);
    const elsewhere=style==="bridge-center"?replayRun("lantern",["wait","wait","lure:left"])!:startRun("lantern");
    expect(askChip(ask,"lantern",elsewhere)).toBe(`Bridge at ${name} · now ${style==="bridge-center"?"Left":"Center"}`);
  }
});
