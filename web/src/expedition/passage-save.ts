import { replayPassage, passageDelivered, type PassageJob, type PassageState } from "./passage";

export type Landing = PassageJob;
export interface PassageHome {
  services: Landing[];
  watchedReeds: boolean;
  heardBell: boolean;
  active: PassageState|null;
}

export const emptyPassageHome = ():PassageHome=>({services:[],watchedReeds:false,heardBell:false,active:null});
const landing=(value:unknown):value is Landing=>value==="bell"||value==="reed";

export function readPassageHome(storage:Pick<Storage,"getItem">,key:string):PassageHome {
  const raw=storage.getItem(key);
  if(raw===null)return emptyPassageHome();
  const bad=()=>new Error("The saved crossing could not be read. Its original record is still on this device.");
  if(raw.length>8192)throw bad();
  const value=JSON.parse(raw);
  if(value?.version!==1||!Array.isArray(value.services)||value.services.length>2||
    !value.services.every(landing)||new Set(value.services).size!==value.services.length||
    typeof value.watchedReeds!=="boolean"||(value.heardBell!==undefined&&typeof value.heardBell!=="boolean"))throw bad();
  const heardBell=value.heardBell??false;
  let active=null;
  if(value.active!==null){
    const trace=value.active;
    if(!trace||!landing(trace.job)||typeof trace.mothHome!=="boolean"||!Array.isArray(trace.commands))throw bad();
    if(trace.bellRigged===true&&!heardBell)throw bad();
    active=replayPassage(trace.job,trace.commands,trace.mothHome,trace.bellRigged,trace.archOpen);
    if(!active)throw bad();
  }
  return {services:value.services,watchedReeds:value.watchedReeds,heardBell,active};
}

export function writePassageHome(storage:Pick<Storage,"getItem"|"setItem">,key:string,home:PassageHome){
  const run=home.active;
  const raw=JSON.stringify({version:1,services:home.services,watchedReeds:home.watchedReeds,heardBell:home.heardBell,
    active:run?{job:run.job,mothHome:run.mothHome,bellRigged:run.bellRigged,archOpen:run.archOpen,commands:run.commands}:null});
  storage.setItem(key,raw);
  if(storage.getItem(key)!==raw)throw new Error("The crossing could not be saved.");
}

export function dockPassage(home:PassageHome):PassageHome {
  const run=home.active;
  if(!run||run.court.outcome==="active")throw new Error("This outing has not ended.");
  const safe=run.court.outcome==="returned";
  const services=passageDelivered(run)?[...home.services.filter(side=>side!==run.job),run.job]:home.services;
  return {active:null,services,watchedReeds:home.watchedReeds||(safe&&run.watched),heardBell:home.heardBell||(safe&&run.heardBell)};
}
