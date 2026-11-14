import { applyCommand, phaseOf, startCourt } from "../expedition/engine";
import { TURN_LIMIT, type Area, type BankedItem, type Column, type CourtState, type Find, type Phase, type Position, type Tool } from "../expedition/types";

export interface ChartFrame { index:number;command:string|null;position:Position;bridge:Column;opened:Column[];cargo:Find[];phase:Phase;marked:Column|null;wave:{source:Column;exit:Column}|null;splash:boolean;pickup:Find|null;outcome:CourtState["outcome"] }

export function chartFrames(start:{area:Area;tool:Tool;banked:readonly BankedItem[]},commands:readonly string[]):ChartFrame[]|null {
  let state:CourtState;try{state=startCourt(start);}catch{return null;}
  if(!Array.isArray(commands)||commands.length>TURN_LIMIT)return null;
  const frames:ChartFrame[]=[{index:0,command:null,position:{...state.position},bridge:state.bridge,opened:[...state.opened],cargo:[...state.cargo],
    phase:phaseOf(state),marked:state.locked,wave:null,splash:false,pickup:null,outcome:state.outcome}];
  for(const command of commands){
    const turn=applyCommand(state,command);if(!turn)return null;
    const wave=turn.events.find(event=>event.kind==="wave"),pickup=turn.events.find(event=>event.kind==="pickup");
    state=turn.after;
    frames.push({index:frames.length,command,position:{...state.position},bridge:state.bridge,opened:[...state.opened],cargo:[...state.cargo],
      phase:phaseOf(turn.before),marked:state.locked,wave:wave?{source:wave.source,exit:wave.exit}:null,splash:turn.events.some(event=>event.kind==="hit"),pickup:pickup?.item??null,outcome:state.outcome});
  }
  return frames;
}

export function chartLines(frames:readonly ChartFrame[],area:Area):string[] {
  const columns=["left","center","right"];
  return frames.slice(1).map((frame,i)=>{
    const command=frame.command??"";
    let action="waits for the tide";
    if(command.startsWith("step:"))action=`steps ${command.slice(5)} onto row ${frame.position.y}, ${columns[frame.position.x]} column`;
    else if(command.startsWith("reel:"))action=`reels in the ${command.slice(5)}`;
    else if(command.startsWith("take:"))action=`takes the ${command.slice(5)}`;
    else if(command.startsWith("lure:"))action=`lures the wave to the ${command.slice(5)} column`;
    else if(command==="turn:vane")action=`turns the ${area==="wind"?"wheel":"vane"}`;
    else if(command==="return")action=frame.cargo.length?`comes home with ${frame.cargo.map(item=>`the ${item}`).join(" and ")}`:"comes home empty-pawed";
    let line=`${frame.index}. Mochi ${action}.`;
    if(frame.wave)line+=` A wave runs from the ${columns[frame.wave.source]} to the ${columns[frame.wave.exit]}.`;
    if(frame.splash)line+=" It soaks her.";
    if(frame.outcome==="rescued"&&frames[i]!.outcome!=="rescued")line+=" She is rescued and carried home.";
    return line;
  });
}
