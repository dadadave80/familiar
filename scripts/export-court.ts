import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { applyCommand, legalCommands, startCourt } from "../web/src/expedition/engine";
import { CONTENT_VERSION, type BankedItem, type Command, type CourtEvent, type CourtStart, type CourtState, type Find } from "../web/src/expedition/types";
import { solveCourt } from "./court-solver";

const cases:{id:string;start:CourtStart;commands:readonly Command[];states:CourtState[];legal:Command[][];events:(readonly CourtEvent[])[]}[]=[];
function record(id:string,start:CourtStart,commands:readonly Command[]) {
  let state=startCourt(start);
  const states=[state],legal=[legalCommands(state)],events:(readonly CourtEvent[])[]=[];
  for(const command of commands) {
    const next=applyCommand(state,command);assert(next,`${id}: invalid generated action`);
    state=next.after;states.push(state);legal.push(legalCommands(state));events.push(next.events);
  }
  cases.push({id,start,commands,states,legal,events});
}
for(const area of ["beacon","wind"] as const)for(const tool of ["rope","lantern"] as const) {
  const start={area,tool,banked:[]},goals:Find[]=area==="beacon"?["lens"]:["vane"];
  const solution=solveCourt(start,goals,{dry:true});assert(solution);record(`${area}-${tool}-objective`,start,solution.commands);
  if(area==="beacon") {const both=solveCourt(start,["lens","moth"],{dry:true});assert(both);record(`${area}-${tool}-rescue`,start,both.commands);}
  for(let seed=1;seed<=32;seed++) {
    const banked:BankedItem[]=seed%4===0?["lens"]:seed%5===0?["chart","salvage"]:[];
    const initial={area,tool,banked};let state=startCourt(initial),random=seed;
    while(state.outcome==="active") {
      random=(Math.imul(random,1664525)+1013904223)>>>0;
      const choices=legalCommands(state).filter(command=>command!=="return"||random%11===0);
      state=applyCommand(state,choices[random%choices.length]!)!.after;
    }
    record(`${area}-${tool}-seed-${seed}`,initial,state.commands);
  }
}
const directory=join(import.meta.dir,"../contracts/common/fixtures");await mkdir(directory,{recursive:true});
const path=join(directory,"court.json");await writeFile(path,JSON.stringify({version:CONTENT_VERSION,cases})+"\n");
console.info(JSON.stringify({path,cases:cases.length,states:cases.reduce((sum,value)=>sum+value.states.length,0),bytes:Bun.file(path).size}));
