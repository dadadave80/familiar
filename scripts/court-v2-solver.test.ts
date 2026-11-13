import { expect, test } from "bun:test";
import { applyCommand, legalCommands, replayCourt, startCourt, walkable } from "../web/src/expedition/engine";
import { solveCourt } from "./court-v2-solver";

test("both tools have dry spatial return routes, and the second goal actually uses its mechanism",()=>{
  for(const area of ["beacon","wind"] as const)for(const tool of ["rope","lantern"] as const) {
    const initial={area,tool,banked:[]},goal=area==="beacon"?"lens":"vane";
    const found=solveCourt(initial,[goal],{dry:true});expect(found).not.toBeNull();
    const state=replayCourt(initial,found!.commands)!;
    expect(state.outcome).toBe("returned");expect(state.resolve).toBe(3);expect(state.cargo).toContain(goal);
    expect(found!.commands.filter(command=>command.startsWith("step:")).length).toBeGreaterThanOrEqual(6);
    if(area==="wind")expect(found!.commands).toContain("turn:vane");
    if(area==="beacon") {
      const rescue=solveCourt(initial,["lens","moth"],{dry:true});expect(rescue).not.toBeNull();
      const both=replayCourt(initial,rescue!.commands)!;
      expect(both.cargo).toEqual(expect.arrayContaining(["lens","moth"]));expect(both.resolve).toBe(3);
      expect(rescue!.commands.length).toBeGreaterThan(found!.commands.length);
      expect(both.uses).toBeLessThan(2);
    }
  }
});

test("search bounds produce no false claim that a room is unsolvable",()=>{
  expect(()=>solveCourt({area:"beacon",tool:"rope",banked:[]},["lens"],{maxVisited:1})).toThrow("no solvability verdict");
});

test("accepted command sequences never leave Mochi standing in water or on the moving bridge",()=>{
  for(const area of ["beacon","wind"] as const)for(const tool of ["rope","lantern"] as const) {
    for(let seed=1;seed<=32;seed++) {
      let state=startCourt({area,tool,banked:[]}),random=seed;
      for(let turn=0;turn<24&&state.outcome==="active";turn++) {
        random=(Math.imul(random,1664525)+1013904223)>>>0;
        const options=legalCommands(state).filter(command=>command!=="return"),command=options[random%options.length]!;
        const step=applyCommand(state,command)!;state=step.after;
        expect(walkable(state,state.position)).toBe(true);expect(state.position.y).not.toBe(2);
        expect(state.resolve).toBeGreaterThanOrEqual(0);expect(state.resolve).toBeLessThanOrEqual(3);
        expect(state.cargo.length).toBe(new Set(state.cargo).size);
      }
    }
  }
});
