import { applyCommand, legalCommands, startCourt } from "../web/src/expedition/engine";
import type { Command, CourtStart, CourtState, Find } from "../web/src/expedition/types";

export function courtStateKey(state:CourtState):string {
  return [state.position.x,state.position.y,state.turn%3,state.resolve,state.uses,state.orientation,state.locked??"-",state.bridge,
    [...state.opened].sort().join(""),[...state.cargo].sort().join("")].join("/");
}

/** A bounded design check, never part of authoritative replay or a player's input path. */
export function solveCourt(start:CourtStart,goals:readonly Find[],options:{dry?:boolean;maxVisited?:number}={}):{commands:readonly Command[];visited:number}|null {
  const initial=startCourt(start),queue=[initial],seen=new Set([courtStateKey(initial)]);
  for(let cursor=0;cursor<queue.length;cursor++) {
    const state=queue[cursor]!;
    for(const command of legalCommands(state)) {
      if(command==="return"&&!goals.every(goal=>state.cargo.includes(goal)||state.banked.includes(goal)))continue;
      const next=applyCommand(state,command)!.after;
      if(options.dry&&next.resolve!==3||next.outcome==="rescued")continue;
      if(next.outcome==="returned")return {commands:next.commands,visited:seen.size};
      const key=courtStateKey(next);if(seen.has(key))continue;
      seen.add(key);if(seen.size>(options.maxVisited??250000))throw Error("Court solver reached its explicit design-search bound; no solvability verdict was made.");
      queue.push(next);
    }
  }
  return null;
}

if(import.meta.main) {
  for(const area of ["beacon","wind"] as const)for(const tool of ["rope","lantern"] as const) {
    const goals:Find[]=area==="beacon"?["lens"]:["vane"];
    const start={area,tool,banked:[]};
    console.info(JSON.stringify({area,tool,goals,dry:solveCourt(start,goals,{dry:true})}));
    if(area==="beacon")console.info(JSON.stringify({area,tool,goals:["lens","moth"],dry:solveCourt(start,["lens","moth"],{dry:true})}));
  }
}
