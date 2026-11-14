import { findPosition,legalCommands,stepDestination } from "./engine";
import type { Command,CourtState,Position } from "./types";

export function swipeCommand(dx:number,dy:number):Command|null {
  if(!Number.isFinite(dx)||!Number.isFinite(dy))return null;
  const x=Math.abs(dx),y=Math.abs(dy);
  if(Math.max(x,y)<32||Math.max(x,y)<Math.min(x,y)*1.5)return null;
  return x>y?(dx>0?"step:east":"step:west"):(dy>0?"step:south":"step:north");
}

export function movementKey(key:string):Command|null {
  switch(key.toLowerCase()){
    case "w":case "arrowup":return "step:north";
    case "s":case "arrowdown":return "step:south";
    case "a":case "arrowleft":return "step:west";
    case "d":case "arrowright":return "step:east";
    default:return null;
  }
}

/** Pointer and accessible object controls resolve the same target, without pathfinding or state mutation. */
export function commandAt(state:CourtState,target:Position):Command|null {
  if(target.x===1&&target.y===0&&legalCommands(state).includes("return"))return "return";
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
