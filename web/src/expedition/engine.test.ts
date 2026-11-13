import { expect, test } from "bun:test";
import { applyCommand, findPosition, legalCommands, packSlots, phaseOf, replayCourt, startCourt, stepDestination, walkable, waveExit } from "./engine";
import { CONTENT_VERSION, TURN_LIMIT, type Command, type CourtState, type Tool } from "./types";

const start = (tool:Tool="rope") => startCourt({area:"beacon",tool,banked:[]});
function play(commands:readonly Command[],tool:Tool="rope") {
  const result=replayCourt({area:"beacon",tool,banked:[]},commands);
  expect(result).not.toBeNull();return result!;
}

test("the room has connected platforms, one real bridge, and no movement through water",()=>{
  const state=start();
  expect(state.contentVersion).toBe(CONTENT_VERSION);
  expect(state.position).toEqual({x:1,y:0});
  expect(walkable(state,{x:1,y:2})).toBe(true);
  expect(walkable(state,{x:0,y:2})).toBe(false);
  expect(walkable(state,{x:2,y:2})).toBe(false);
  expect(walkable(state,{x:1,y:-1})).toBe(false);
  expect(walkable(state,{x:1,y:5})).toBe(false);
  const lower=play(["step:west","step:north"]);
  expect(legalCommands(lower)).not.toContain("step:north");
  expect(applyCommand(lower,"step:north")).toBeNull();
  expect(lower.commands).toEqual(["step:west","step:north"]);
});

test("baiting then dodging a surge opens a shell and changes the traversable route",()=>{
  const rising=play(["step:west"]);
  expect(phaseOf(rising)).toBe("rising");expect(rising.locked).toBeNull();
  const marked=applyCommand(rising,"wait")!;
  expect(marked.after.locked).toBe(0);expect(marked.events).toEqual([{kind:"telegraph",column:0}]);
  expect(waveExit(marked.after)).toBe(0);
  const surge=applyCommand(marked.after,"step:east")!;
  expect(surge.after.position).toEqual({x:1,y:0});expect(surge.after.resolve).toBe(3);
  expect(surge.after.bridge).toBe(0);expect(surge.after.opened).toEqual([0]);
  expect(walkable(surge.after,{x:0,y:2})).toBe(true);expect(walkable(surge.after,{x:1,y:2})).toBe(false);
  expect(surge.events.map(event=>event.kind)).toEqual(["move","wave","bridge","open"]);
  expect(findPosition(surge.after,"lens")).toEqual({x:0,y:4});
});

test("the forecast uses the actual vane exit and lantern redirects before the surge",()=>{
  let state=startCourt({area:"wind",tool:"lantern",banked:[]});
  state=applyCommand(state,"step:west")!.after;state=applyCommand(state,"wait")!.after;
  expect(state.locked).toBe(0);expect(waveExit(state)).toBe(1);
  const redirected=applyCommand(state,"lure:right")!;
  expect(redirected.events[0]).toEqual({kind:"redirect",from:0,to:2});
  expect(redirected.events.find(event=>event.kind==="wave")).toEqual({kind:"wave",source:2,exit:0});
  expect(redirected.after.uses).toBe(1);expect(redirected.after.opened).toEqual([0]);
});

test("crossing a bridge is one decision and leaves room to evade the following wave",()=>{
  const lower=play(["step:north"]);
  expect(stepDestination(lower,"north")).toEqual({x:1,y:3});
  const upper=applyCommand(lower,"step:north")!;
  expect(upper.after.position).toEqual({x:1,y:3});expect(upper.after.locked).toBe(1);
  expect(upper.events[0]).toEqual({kind:"move",from:{x:1,y:1},to:{x:1,y:3}});
  const dry=applyCommand(upper.after,"step:west")!;
  expect(dry.after.resolve).toBe(3);expect(dry.after.position).toEqual({x:0,y:3});
  const hit=applyCommand(upper.after,"step:north")!;
  expect(hit.after.resolve).toBe(2);expect(hit.events.filter(event=>event.kind==="hit")).toHaveLength(1);
  expect(walkable(hit.after,hit.after.position)).toBe(true);
});

test("tools respect exposure, reach, finite uses and a moth's two pack slots",()=>{
  const base=start();expect(findPosition(base,"lens")).toBeNull();
  const exposed:CourtState={...base,position:{x:1,y:3},bridge:0,opened:[0]};
  expect(legalCommands(exposed)).toContain("reel:lens");expect(legalCommands(exposed)).not.toContain("take:lens");
  const pulled=applyCommand(exposed,"reel:lens")!;
  expect(pulled.after.cargo).toEqual(["lens"]);expect(pulled.after.uses).toBe(1);
  expect(pulled.events[0]).toEqual({kind:"pickup",item:"lens",from:{x:0,y:4},rope:true});
  expect(findPosition(pulled.after,"lens")).toBeNull();
  expect(legalCommands({...exposed,uses:0})).not.toContain("reel:lens");
  const near:CourtState={...base,position:{x:0,y:3},opened:[0]};
  expect(legalCommands(near)).toContain("take:lens");expect(legalCommands(near)).not.toContain("reel:lens");
  expect(packSlots(["lens","moth"])).toBe(3);
  const full:CourtState={...base,position:{x:1,y:4},cargo:["lens","vane"],opened:[2]};
  expect(legalCommands(full)).not.toContain("take:moth");
});

test("the wind vane requires two deliberately charged channels and a nearby turning station",()=>{
  const base=startCourt({area:"wind",tool:"rope",banked:[]});
  expect(findPosition({...base,opened:[0]},"vane")).toBeNull();
  expect(findPosition({...base,opened:[0,1]},"vane")).toBeNull();
  expect(findPosition({...base,opened:[0,1],orientation:0},"vane")).toEqual({x:1,y:4});
  expect(legalCommands(base)).not.toContain("turn:vane");
  const station:CourtState={...base,position:{x:1,y:3}};
  expect(legalCommands(station)).toContain("turn:vane");
  expect(applyCommand(station,"turn:vane")!.after.orientation).toBe(2);
});

test("only the dock extracts, before the final surge or flood",()=>{
  const base=start();expect(legalCommands({...base,position:{x:1,y:1}})).not.toContain("return");
  const last:CourtState={...base,turn:TURN_LIMIT-1,locked:1,cargo:["lens"]};
  const result=applyCommand(last,"return")!;
  expect(result.after.outcome).toBe("returned");expect(result.after.cargo).toEqual(["lens"]);
  expect(result.events).toEqual([{kind:"return",cargo:["lens"]}]);
  const flooded=applyCommand({...last,position:{x:0,y:0}},"wait")!;
  expect(flooded.after.outcome).toBe("rescued");expect(flooded.after.cargo).toEqual([]);
  expect(flooded.events.at(-1)).toEqual({kind:"rescue",reason:"flood"});
});

test("replay rejects altered, overlong and post-outcome transcripts without mutating inputs",()=>{
  const state=start();Object.freeze(state);Object.freeze(state.position);Object.freeze(state.commands);
  expect(applyCommand(state,"teleport")).toBeNull();expect(applyCommand(state,"step:north")?.after.position).toEqual({x:1,y:1});
  expect(state.position).toEqual({x:1,y:0});expect(state.commands).toEqual([]);
  expect(replayCourt({area:"beacon",tool:"rope",banked:[]},["return","wait"])).toBeNull();
  expect(replayCourt({area:"beacon",tool:"rope",banked:[]},Array(25).fill("wait"))).toBeNull();
  expect(replayCourt({area:"beacon",tool:"rope",banked:["lens","lens"]},[])).toBeNull();
  expect(replayCourt({area:"other",tool:"rope",banked:[]},[])).toBeNull();
  expect(replayCourt({area:"beacon",tool:"rope",banked:[]},["step:north",null])).toBeNull();
});

test("banked discoveries never respawn or become a new reward",()=>{
  const state=startCourt({area:"beacon",tool:"rope",banked:["lens","moth"]});
  expect(findPosition({...state,opened:[0,2]},"lens")).toBeNull();
  expect(findPosition({...state,opened:[0,2]},"moth")).toBeNull();
  expect(legalCommands({...state,position:{x:1,y:4},opened:[0,2]})).not.toContain("take:lens");
});
