import { expect, test } from "bun:test";
import { legalCommands } from "../expedition/engine";
import { TURN_LIMIT } from "../expedition/types";
import { askStatus, cardStatus, replayRun, solve, startRun, stepRun } from "./asks";
import { askChip, askLine, cardForDay, TIDE_POOL } from "./cards";

for(const card of TIDE_POOL)test(`${card.id} keeps every ask in exactly ${card.best} decisions`,()=>{
  const route=solve(card.tool,card.asks);expect(route).not.toBeNull();expect(route!.length).toBe(card.best);
  const run=replayRun(card.tool,route)!;
  expect(run.state.outcome).toBe("returned");expect(cardStatus(card,run)).toEqual(["kept","kept","kept"]);
  expect(solve(card.tool,card.asks,card.best-1)).toBeNull();
  for(const ask of card.asks){
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
  for(const card of TIDE_POOL)for(const ask of card.asks)expect(askStatus(ask,run)).toBe("slipped");
});

test("a decision budget slips when there is no decision left to come home",()=>{
  const ask={kind:"within",decisions:2} as const;
  let run=startRun("rope");expect(askStatus(ask,run)).toBe("open");
  run=stepRun(run,"step:north")!;expect(askStatus(ask,run)).toBe("open");
  run=stepRun(run,"step:west")!;expect(run.state.outcome).toBe("active");expect(askStatus(ask,run)).toBe("slipped");
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
    if(command==="take:lens"){expect(askStatus(moth,run)).toBe("open");expect(askStatus(moth,next)).toBe("slipped");picked=true;}
    run=next;
  }
  expect(splashes).toBe(1);expect(picked).toBe(true);
});
