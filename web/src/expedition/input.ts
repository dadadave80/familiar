import { findPosition,legalCommands,stepDestination } from "./engine";
import type { Command,CourtState,Position } from "./types";

/** Pointer and accessible object controls resolve the same target, without pathfinding or state mutation. */
export function commandAt(state:CourtState,target:Position):Command|null {
  if(state.area==="wind"&&target.x===1&&target.y===3&&legalCommands(state).includes("turn:vane"))return "turn:vane";
  for(const item of ["lens","moth","vane"] as const){
    const position=findPosition(state,item);if(position?.x!==target.x||position.y!==target.y)continue;
    const take=`take:${item}` as Command,reel=`reel:${item}` as Command;
    if(legalCommands(state).includes(take))return take;
    if(legalCommands(state).includes(reel))return reel;
  }
  for(const direction of ["north","south","west","east"] as const){
    const destination=stepDestination(state,direction),command=`step:${direction}` as Command;
    if(destination&&legalCommands(state).includes(command)&&(destination.x===target.x&&destination.y===target.y||target.y===2&&target.x===state.bridge&&target.x===state.position.x&&Math.abs(destination.y-state.position.y)===2))return command;
  }
  return null;
}
