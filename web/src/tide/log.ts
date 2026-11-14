import type { Command, Tool } from "../expedition/types";
import { cardStatus, replayRun } from "./asks";
import { cardForDay } from "./cards";
import { runSummary, type DayResult } from "./run-day";

export interface TideEntry { day:number;cardId:string;tool:Tool;commands:Command[];kept:[boolean,boolean,boolean];decisions:number;outcome:"returned"|"rescued";late:boolean;attempts:number;savedAt:string }
export const tideLogKey=(scope:string)=>`familiar.tide.log.v1:${scope}`;
const pendingKey=(scope:string)=>`familiar.tide.pending.v1:${scope}`;

function score(day:number,tool:Tool,commands:readonly string[]) {
  const run=replayRun(tool,commands);if(!run||run.state.outcome==="active")return null;
  const card=cardForDay(day);
  return {cardId:card.id,kept:cardStatus(card,run).map(status=>status==="kept") as [boolean,boolean,boolean],decisions:run.state.turn,outcome:run.state.outcome};
}

export function readTideLog(scope:string,store?:Pick<Storage,"getItem">):TideEntry[] {
  try{
    const values=JSON.parse((store??localStorage).getItem(tideLogKey(scope))??"[]");if(!Array.isArray(values))return [];
    const days=new Map<number,TideEntry>();
    for(const value of values){
      if(!value||!Number.isSafeInteger(value.day)||(value.tool!=="rope"&&value.tool!=="lantern")||!Array.isArray(value.commands)||
        !value.commands.every((command:unknown)=>typeof command==="string")||typeof value.late!=="boolean")continue;
      const scored=score(value.day,value.tool,value.commands);if(!scored)continue;
      const entry:TideEntry={day:value.day,tool:value.tool,commands:[...value.commands],...scored,late:value.late,
        attempts:Number.isInteger(value.attempts)&&value.attempts>0?value.attempts:1,savedAt:typeof value.savedAt==="string"?value.savedAt:""};
      const previous=days.get(entry.day);
      const best=!previous||(entry.outcome===previous.outcome?betterTide(entry,previous):entry.outcome==="returned")?entry:previous;
      days.set(entry.day,{...best,attempts:Math.max(entry.attempts,previous?.attempts??1)});
    }
    return [...days.values()].sort((a,b)=>a.day-b.day);
  }catch{return [];}
}

export function betterTide(a:Pick<TideEntry,"kept"|"decisions">,b:Pick<TideEntry,"kept"|"decisions">):boolean {
  const kept=a.kept.filter(Boolean).length-b.kept.filter(Boolean).length;
  return kept>0||kept===0&&a.decisions<b.decisions;
}

export function recordTide(scope:string,input:{day:number;tool:Tool;commands:readonly string[];late:boolean;now?:Date},store?:Pick<Storage,"getItem"|"setItem">):{entry:TideEntry;improved:boolean;previous:TideEntry|null} {
  const scored=Number.isSafeInteger(input.day)?score(input.day,input.tool,input.commands):null;
  if(!scored)throw new RangeError("This outing cannot be logged.");
  store=store??localStorage;
  const log=readTideLog(scope,store),previous=log.find(entry=>entry.day===input.day)??null;
  const candidate:TideEntry={day:input.day,tool:input.tool,commands:[...input.commands] as Command[],...scored,late:input.late&&(previous?.late??true),
    attempts:(previous?.attempts??0)+1,savedAt:(input.now??new Date()).toISOString()};
  const improved=previous===null||candidate.outcome==="returned"&&(previous.outcome==="rescued"||betterTide(candidate,previous));
  const entry=improved?candidate:{...previous!,late:candidate.late,attempts:candidate.attempts};
  const next=[...log.filter(value=>value.day!==input.day),entry].sort((a,b)=>a.day-b.day).slice(-90),text=JSON.stringify(next),key=tideLogKey(scope);
  store.setItem(key,text);if(store.getItem(key)!==text)throw Error("The tide log could not be saved on this device.");
  return {entry,improved,previous};
}

export interface TidePending { day:number;late:boolean }
export function readTidePending(scope:string,store?:Pick<Storage,"getItem">):TidePending|null {
  try{const value=JSON.parse((store??localStorage).getItem(pendingKey(scope))??"null");return value&&Number.isSafeInteger(value.day)&&typeof value.late==="boolean"?{day:value.day,late:value.late}:null;}catch{return null;}
}
export function writeTidePending(scope:string,pending:TidePending|null,store?:Pick<Storage,"getItem"|"setItem"|"removeItem">):void {
  try{store=store??localStorage;if(pending===null)store.removeItem(pendingKey(scope));else store.setItem(pendingKey(scope),JSON.stringify({day:pending.day,late:pending.late}));}catch{}
}
export function tideSummary(entries:readonly TideEntry[],results:readonly DayResult[]=[]):{sailed:number;kept:number;allThree:number} {
  const runs=runSummary(results);
  return {sailed:entries.length+runs.sailed,kept:entries.reduce((sum,entry)=>sum+entry.kept.filter(Boolean).length,0)+runs.kept,allThree:entries.filter(entry=>entry.kept.every(Boolean)).length+runs.allThree};
}
