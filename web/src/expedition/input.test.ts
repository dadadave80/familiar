import { expect,test } from "bun:test";
import { applyCommand,startCourt } from "./engine";
import { commandAt } from "./input";
import type { CourtState } from "./types";

test("clicking the open bridge or its far landing crosses in one canonical decision",()=>{
  const state:CourtState={...startCourt({area:"beacon",tool:"rope",banked:[]}),position:{x:1,y:1}};
  expect(commandAt(state,{x:1,y:2})).toBe("step:north");
  expect(commandAt(state,{x:1,y:3})).toBe("step:north");
  const transition=applyCommand(state,commandAt(state,{x:1,y:2}))!;
  expect(transition.after.position).toEqual({x:1,y:3});expect(transition.after.turn).toBe(1);
  expect(commandAt(state,{x:0,y:2})).toBeNull();expect(commandAt(state,{x:0,y:3})).toBeNull();
});
test("an exposed object target collects before generic neighboring movement",()=>{
  const state:CourtState={...startCourt({area:"beacon",tool:"rope",banked:[]}),position:{x:0,y:3},opened:[0]};
  const command=commandAt(state,{x:0,y:4});expect(command).toBe("take:lens");
  const transition=applyCommand(state,command)!;expect(transition.after.position).toEqual(state.position);
  expect(transition.after.turn).toBe(1);expect(transition.after.cargo).toEqual(["lens"]);
  expect(transition.events.filter(e=>e.kind==="move")).toEqual([]);
});
test("rope targets only exposed reachable unbanked finds and never spend extra moves",()=>{
  const base=startCourt({area:"beacon",tool:"rope",banked:[]});
  const state:CourtState={...base,position:{x:1,y:3},opened:[0]};
  expect(commandAt(state,{x:0,y:4})).toBe("reel:lens");
  expect(commandAt({...state,uses:0},{x:0,y:4})).toBeNull();
  expect(commandAt({...state,opened:[]},{x:0,y:4})).toBeNull();
  expect(commandAt({...state,banked:["lens"]},{x:0,y:4})).toBeNull();
});
test("the wind-wheel target turns only from its own station",()=>{
  const base=startCourt({area:"wind",tool:"rope",banked:[]});
  expect(commandAt({...base,position:{x:1,y:3}},{x:1,y:3})).toBe("turn:vane");
  expect(commandAt(base,{x:1,y:3})).toBeNull();
});
