import { COURTS } from "./rooms";
import { CONTENT_VERSION, TURN_LIMIT, type BankedItem, type Column, type Command, type CourtEvent, type CourtStart, type CourtState, type CourtTransition, type Direction, type Find, type Phase, type Position } from "./types";

const columns=[0,1,2] as const;
const columnNames=["left","center","right"] as const;
const finds=["lens","moth","vane"] as const;
const bankedItems=[...finds,"chart","salvage"] as const;
const directions:readonly [Direction,number,number][]=[
  ["north",0,1],["south",0,-1],["west",-1,0],["east",1,0],
];
const distance=(a:Position,b:Position)=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y);
const isColumn=(value:unknown):value is Column=>Number.isInteger(value)&&columns.includes(value as Column);
const isRecord=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);

export function startCourt(input:CourtStart):CourtState {
  if(!isRecord(input)||!(input.area==="beacon"||input.area==="wind")||!(input.tool==="rope"||input.tool==="lantern")||
    !Array.isArray(input.banked)||input.banked.length>5||!input.banked.every(item=>bankedItems.includes(item as BankedItem))||new Set(input.banked).size!==input.banked.length)
    throw new RangeError("Unsupported expedition starting checkpoint.");
  const room=COURTS[input.area];
  return {
    area:input.area,tool:input.tool,banked:[...input.banked],contentVersion:CONTENT_VERSION,position:{x:1,y:0},turn:0,resolve:3,uses:2,
    orientation:room.initialOrientation,locked:null,bridge:room.initialBridge,opened:[],cargo:[],commands:[],outcome:"active",
  };
}

export function phaseOf(state:Pick<CourtState,"turn">):Phase {
  return (["low","rising","surge"] as const)[state.turn%3]!;
}
export function waveExit(state:Pick<CourtState,"locked"|"orientation">,source:Column|null=state.locked):Column|null {
  return source===null?null:(source+state.orientation)%3 as Column;
}
export function walkable(state:Pick<CourtState,"bridge">,position:Position):boolean {
  return isColumn(position.x)&&Number.isInteger(position.y)&&position.y>=0&&position.y<=4&&(position.y!==2||position.x===state.bridge);
}
export function packSlots(cargo:readonly Find[]):number {
  return cargo.reduce((sum,item)=>sum+(item==="moth"?2:1),0);
}
export function stepDestination(state:CourtState,direction:Direction):Position|null {
  const delta=directions.find(([name])=>name===direction);
  if(!delta)return null;
  const [,dx,dy]=delta;
  const crossing=direction==="north"&&state.position.y===1||direction==="south"&&state.position.y===3;
  if(crossing&&state.position.x!==state.bridge)return null;
  const position={x:state.position.x+dx as Column,y:state.position.y+dy*(crossing?2:1)};
  return walkable(state,position)?position:null;
}
export function findPosition(state:CourtState,item:Find):Position|null {
  if(state.banked.includes(item)||state.cargo.includes(item))return null;
  const position=COURTS[state.area].finds[item];
  if(!position)return null;
  const exposed=item==="vane"?state.opened.includes(0)&&state.opened.includes(1)&&state.orientation===0:state.opened.includes(position.x);
  return exposed?position:null;
}

export function legalCommands(state:CourtState):Command[] {
  if(state.outcome!=="active"||state.turn>=TURN_LIMIT||state.resolve<=0)return [];
  const commands:Command[]=["wait"];
  for(const [direction] of directions)if(stepDestination(state,direction))commands.push(`step:${direction}`);
  if(state.position.x===1&&state.position.y===0)commands.push("return");
  if(state.area==="wind"&&state.position.x===1&&state.position.y===3)commands.push("turn:vane");
  if(state.tool==="lantern"&&state.uses>0&&phaseOf(state)==="surge"&&state.locked!==null)
    for(const column of columnNames)commands.push(`lure:${column}`);
  for(const item of finds) {
    const position=findPosition(state,item);
    if(!position||packSlots([...state.cargo,item])>3)continue;
    const reach=distance(state.position,position);
    if(reach<=1)commands.push(`take:${item}`);
    else if(state.tool==="rope"&&state.uses>0&&reach<=2&&(item==="lens"||item==="vane"))commands.push(`reel:${item}`);
  }
  return commands;
}

/** State comes only from start/replay. Rendering and animation never mutate the simulation. */
export function applyCommand(before:CourtState,candidate:unknown):CourtTransition|null {
  const command=legalCommands(before).find(legal=>legal===candidate);
  if(!command)return null;
  let after:CourtState={...before,turn:before.turn+1,commands:[...before.commands,command]};
  const events:CourtEvent[]=[];
  if(command==="return")return {before,after:{...after,outcome:"returned"},events:[{kind:"return",cargo:[...before.cargo]}]};

  if(command.startsWith("step:")) {
    const to=stepDestination(before,command.slice(5) as Direction)!;
    after={...after,position:to};events.push({kind:"move",from:before.position,to});
  }else if(command==="turn:vane") {
    const to=(before.orientation+1)%3 as Column;
    after={...after,orientation:to};events.push({kind:"rotate",from:before.orientation,to});
  }else if(command.startsWith("lure:")) {
    const to=columnNames.indexOf(command.slice(5) as typeof columnNames[number]) as Column;
    after={...after,locked:to,uses:before.uses-1};events.push({kind:"redirect",from:before.locked!,to});
  }else if(command.startsWith("take:")||command.startsWith("reel:")) {
    const item=command.slice(5) as Find,rope=command.startsWith("reel:");
    after={...after,cargo:[...before.cargo,item],uses:before.uses-(rope?1:0)};
    events.push({kind:"pickup",item,from:findPosition(before,item)!,rope});
  }

  const phase=phaseOf(before);
  if(phase==="rising") {
    after={...after,locked:after.position.x};events.push({kind:"telegraph",column:after.position.x});
  }else if(phase==="surge") {
    const source=after.locked,exit=waveExit(after);
    if(source!==null&&exit!==null) {
      events.push({kind:"wave",source,exit});
      if(exit!==after.bridge)events.push({kind:"bridge",from:after.bridge,to:exit});
      const opens=(after.area==="wind"?exit!==2:exit!==1)&&!after.opened.includes(exit);
      if(opens)events.push({kind:"open",column:exit});
      const hit=after.position.x===exit||(after.position.y===2&&after.position.x!==exit);
      after={...after,bridge:exit,opened:opens?[...after.opened,exit]:after.opened,locked:null};
      if(hit) {
        const from=after.position;let y=Math.max(0,from.y-1);
        while(y>0&&(y===2||!walkable(after,{x:from.x,y})))y--;
        const to={x:from.x,y};after={...after,position:to,resolve:after.resolve-1};
        events.push({kind:"hit",from,to,resolve:after.resolve});
      }
    }
  }
  if(after.resolve<=0||after.turn>=TURN_LIMIT) {
    events.push({kind:"rescue",reason:after.resolve<=0?"resolve":"flood"});
    after={...after,cargo:[],outcome:"rescued"};
  }
  return {before,after,events};
}

/** Persist start + commands, then derive every position, opening and cargo item on reload. */
export function replayCourt(input:unknown,commands:unknown):CourtState|null {
  if(!Array.isArray(commands)||commands.length>TURN_LIMIT)return null;
  let state:CourtState;try{state=startCourt(input as CourtStart);}catch{return null;}
  for(const command of commands) {
    const transition=applyCommand(state,command);
    if(!transition)return null;state=transition.after;
  }
  return state;
}
