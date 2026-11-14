import { expect, test } from "bun:test";
import { applyCommand, phaseOf, startCourt } from "../expedition/engine";
import { TURN_LIMIT, type BankedItem } from "../expedition/types";
import { solve, startRun, stepRun } from "./asks";
import { cardForDay } from "./cards";
import { chartFrames, chartLines } from "./chart";

const card=cardForDay(20771),surf=solve(card.tool,card.asks)!;
const beacon={area:"beacon",tool:"rope",banked:[]} as const;
const wind={area:"wind",tool:"rope",banked:["lens","moth"] as readonly BankedItem[]} as const;
const gate=["step:east","step:north","step:west","step:west","step:north","wait","step:east","turn:vane","wait","turn:vane","take:vane","step:west","step:east","step:south","step:west","step:south","step:east","return"];

test("the surf chart records one splash, one lens and the returned ending",()=>{
  const frames=chartFrames(beacon,surf)!;expect(frames.length).toBe(surf.length+1);
  expect(frames[0]).toMatchObject({index:0,command:null,wave:null,splash:false,pickup:null,phase:"low",outcome:"active"});
  expect(frames.filter(frame=>frame.splash).length).toBe(1);expect(frames.filter(frame=>frame.pickup==="lens").length).toBe(1);expect(frames.at(-1)!.outcome).toBe("returned");
  let state=startCourt(beacon);
  for(let i=0;i<surf.length;i++){
    const turn=applyCommand(state,surf[i])!,frame=frames[i+1]!,wave=turn.events.find(event=>event.kind==="wave");
    expect(frame).toMatchObject({index:i+1,command:surf[i],position:turn.after.position,bridge:turn.after.bridge,opened:turn.after.opened,cargo:turn.after.cargo,phase:phaseOf(turn.before),marked:turn.after.locked,
      wave:wave?{source:wave.source,exit:wave.exit}:null,splash:turn.events.some(event=>event.kind==="hit"),pickup:turn.events.find(event=>event.kind==="pickup")?.item??null,outcome:turn.after.outcome});
    expect(frame.opened).not.toBe(turn.after.opened);expect(frame.cargo).not.toBe(turn.after.cargo);state=turn.after;
  }
  frames.at(-1)!.cargo.push("moth");expect(frames.at(-2)!.cargo).toEqual(["lens"]);
});

test("invalid starts, illegal commands and overlong routes cannot be charted",()=>{
  expect(chartFrames(beacon,["step:south"])).toBeNull();expect(chartFrames({...beacon,banked:["vane","vane"]},[])).toBeNull();
  expect(chartFrames(beacon,Array(TURN_LIMIT+1).fill("wait"))).toBeNull();expect(chartFrames(beacon,null as unknown as string[])).toBeNull();
  expect(chartFrames(beacon,["return","wait"])).toBeNull();expect(chartFrames(beacon,[])!.length).toBe(1);
});

test("the Wind Gate chart carries the vane home",()=>{
  const frames=chartFrames(wind,gate)!;expect(frames.length).toBe(19);expect(frames.at(-1)!.outcome).toBe("returned");expect(frames.some(frame=>frame.pickup==="vane")).toBe(true);
});

test("both courts tell one numbered plain sentence per decision",()=>{
  for(const [start,commands] of [[beacon,surf],[wind,gate]] as const){
    const frames=chartFrames(start,commands)!,lines=chartLines(frames,start.area);
    expect(lines.length).toBe(frames.length-1);
    lines.forEach((line,i)=>{expect(line.startsWith(`${i+1}. Mochi `)).toBe(true);expect(line.trim().length).toBeGreaterThan(10);expect(line.endsWith(".")).toBe(true);});
    expect(lines.at(-1)).toContain("comes home with");
  }
  const lines=chartLines(chartFrames(beacon,surf)!,"beacon");
  expect(lines[0]).toContain("steps north");expect(lines.some(line=>line.includes("It soaks her."))).toBe(true);expect(lines.some(line=>line.includes("A wave runs down the"))).toBe(true);
  expect(lines.find(line=>line.includes("takes the lens"))).toBeTruthy();
  const windLines=chartLines(chartFrames(wind,gate)!,"wind");expect(windLines.some(line=>line.includes("turns the wheel"))).toBe(true);expect(windLines.some(line=>line.includes("takes the vane"))).toBe(true);
  expect(chartLines(chartFrames(beacon,["return"])!,"beacon")).toEqual(["1. Mochi comes home empty-pawed."]);expect(chartLines([],"beacon")).toEqual([]);
});

test("route descriptions include reels, lures and rescue",()=>{
  const lens=["wait","step:west","wait","step:north","step:north","step:east","reel:lens","step:west","step:south","step:east","return"];
  const rope=chartFrames(beacon,lens)!;expect(rope.at(-1)!.outcome).toBe("returned");expect(chartLines(rope,"beacon").some(line=>line.includes("reels in the lens"))).toBe(true);
  const lantern=chartFrames({...beacon,tool:"lantern"},["wait","wait","lure:left"])!;
  expect(chartLines(lantern,"beacon")[2]).toContain("lures the wave to the left column");
  let run=startRun("rope");for(let i=0;i<TURN_LIMIT&&run.state.outcome==="active";i++)run=stepRun(run,"wait")!;
  const lines=chartLines(chartFrames(beacon,run.state.commands)!,"beacon");expect(lines.at(-1)).toContain("She is rescued and carried home.");
});

test("waves describe a lane or distinct source and exit through lures and the Wind Gate wheel",()=>{
  const lantern=chartLines(chartFrames({...beacon,tool:"lantern"},["wait","wait","lure:left"])!,"beacon");
  expect(lantern[2]).toBe("3. Mochi lures the wave to the left column. A wave runs down the left lane.");
  const lines=chartLines(chartFrames(wind,gate)!,"wind");
  expect(lines[2]).toContain("A wave rises on the right and runs out on the left.");
  expect(lines[5]).toContain("A wave rises on the left and runs out on the center.");
  expect(lines[8]).toContain("A wave rises on the center and runs out on the left.");
  expect(lines[11]).toContain("A wave runs down the center lane.");
});
