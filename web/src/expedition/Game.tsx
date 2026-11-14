import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/figtree";
import World from "./World";
import PassageGame from "./PassageGame";
import {SealedNote,sealedNoteEnabled} from "../note/SealedNote";
import { passageDelivered, startPassage, type PassageState } from "./passage";
import { dockPassage, emptyPassageHome, readPassageHome, writePassageHome, type Landing, type PassageHome } from "./passage-save";
import HarborChart from "./HarborChart";
import Inspect, { commandName, forecast } from "./Inspect";
import { applyCommand, findPosition, legalCommands, packSlots, phaseOf, replayCourt, startCourt } from "./engine";
import { commandAt } from "./input";
import { HarborAudio } from "./audio";
import { COURTS } from "./rooms";
import { CONTENT_VERSION, TURN_LIMIT, type Area, type BankedItem, type Command, type CourtEvent, type CourtState, type CourtTransition, type Position, type Tool } from "./types";
import { ReturnRecords, validateRunContext } from "./return-record";
import type { HarborSession, HomeCheckpoint, RunContext, WorldIntent } from "./harbor-port";
import type { HarborView, HomePlace } from "./scene";
import { LanternArt, OriginDiorama } from "../tidebound/Storycraft";
import "./game.css";
import { keepTide, shelfNote } from "../season/data";
import SeasonBoundary from "../season/SeasonBoundary";
import { cardForDay, tideDay } from "../tide/cards";
import { cardStatus, replayRun } from "../tide/asks";
import { readTideLog, readTidePending, recordTide, tideSummary, writeTidePending, type TidePending } from "../tide/log";
import { askFlips, devTideDay, earlierDays, harborTide, logPages, outingNotice, pageForDay, restartTide, tideObjective, todayView } from "../tide/pages";
import TideAsk from "../tide/TideAsk";
import TideHud from "../tide/TideHud";
import TideLog from "../tide/TideLog";
import TideStamp from "../tide/TideStamp";

// Bram's shelf loads when his dialog first opens.
const SeasonBram=lazy(()=>import("../season/SeasonBram"));

export const EXPEDITION_SAVE_KEY="familiar.expedition.local.v2";
interface LocalHome extends HomeCheckpoint {lantern:null|{motif:"crest"|"moth";socket:"porch"|"dock"}}
interface ActiveSave {context:RunContext;state:CourtState;season?:true}
interface LocalSave {version:2;home:LocalHome;active:ActiveSave|null;last:CourtState|null}
const fresh=():LocalSave=>({version:2,home:{banked:[],lit:false,signaled:false,lantern:null},active:null,last:null});
const names={lens:"Beacon Lens",moth:"wind-moth",vane:"Signal Vane"};
const columns=["Left","Center","Right"] as const;
const title=(word:string)=>word[0]!.toUpperCase()+word.slice(1);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const tideScopeOf=(context:RunContext)=>context.authority==="near-testnet"?context.accountId:"preview";

function readLocal(key=EXPEDITION_SAVE_KEY):{save:LocalSave;problem:string}{
  try{
    const raw=localStorage.getItem(key);if(!raw)return{save:fresh(),problem:""};
    const value=JSON.parse(raw) as LocalSave,h=value.home;
    if(!value||typeof value!=="object"||Array.isArray(value)||value.version!==2||!h||typeof h!=="object"||Array.isArray(h)||!Array.isArray(h.banked)||new Set(h.banked).size!==h.banked.length||h.banked.some(i=>!["lens","moth","vane","chart","salvage"].includes(i))||typeof h.lit!=="boolean"||typeof h.signaled!=="boolean"||(h.lit&&!h.banked.includes("lens"))||(h.signaled&&(!h.lit||!h.banked.includes("vane")))||value.active!==null&&(!value.active||typeof value.active!=="object"||Array.isArray(value.active))||value.last!==null&&(!value.last||typeof value.last!=="object"||Array.isArray(value.last))||h.lantern!==null&&(!h.lantern||typeof h.lantern!=="object"||Array.isArray(h.lantern)))throw Error();
    if(h.lantern&&(!h.banked.includes("lens")||!["crest","moth"].includes(h.lantern.motif)||!["porch","dock"].includes(h.lantern.socket)||(h.lantern.motif==="moth"&&!h.banked.includes("moth"))))throw Error();
    const restore=(run:CourtState)=>{const replay=replayCourt({area:run.area,tool:run.tool,banked:run.banked},run.commands);if(!replay||!same(replay,run))throw Error();return replay;};
    if(value.active){validateRunContext(value.active.context);value.active.state=restore(value.active.state);if(!same(value.active.context.banked,value.active.state.banked))throw Error();const context=value.active.context;if(key===EXPEDITION_SAVE_KEY?context.authority!=="local-preview":context.authority!=="near-testnet"||key!==`familiar.expedition.game.v2:testnet:${context.accountId}`)throw Error();}
    if(value.last)value.last=restore(value.last);
    return{save:value,problem:""};
  }catch{return{save:fresh(),problem:"The saved expedition could not be read. Its original data has been preserved. Restore the browser’s saved data before continuing."};}
}
function writeLocal(next:LocalSave,key:string){const text=JSON.stringify(next);localStorage.setItem(key,text);if(localStorage.getItem(key)!==text)throw Error("The move could not be saved. No new action was taken. Try again when this browser can save data.");}

export function eventDescription(event:CourtEvent,area?:Area):string{
  switch(event.kind){
    case"move":return Math.abs(event.to.y-event.from.y)>1?"Mochi crosses the bridge.":"Mochi finds her footing.";
    case"telegraph":return area==="wind"?`${columns[event.column]} source marked. The wheel determines its exit.`:`${columns[event.column]} is marked. The next surge follows that source.`;
    case"redirect":return `The lantern draws the source to ${columns[event.to]}.`;
    case"rotate":return event.to===0?"Mochi seats the wheel in its alignment notch.":"Mochi turns the wheel one notch. The outlets shift.";
    case"wave":return `The wave travels from ${columns[event.source]} to ${columns[event.exit]}.`;
    case"bridge":return `The ${columns[event.to]} bridge opens; ${columns[event.from]} closes.`;
    case"open":return area==="wind"?`The ${columns[event.column].toLowerCase()} channel holds its charge.`:`${columns[event.column]} opens to the tide.`;
    case"hit":return `The surge washes Mochi down to safe ground. Resolve ${event.resolve} of 3.`;
    case"pickup":return `Mochi ${event.rope?"reels in":"carefully carries"} the ${names[event.item]}.`;
    case"return":return event.cargo.length?`Home with ${event.cargo.map(i=>names[i]).join(" and ")}.`:"Mochi returns safely to the harbor.";
    case"rescue":return event.reason==="resolve"?"The last splash used Mochi’s Resolve. Bram brings her home; the unbanked cargo stays behind.":"The tide closed after 24 decisions. Bram brings Mochi home; the unbanked cargo stays behind.";
  }
}
function Icon({kind}:{kind:"menu"|"close"|"bag"|"sound"|"silent"|"north"|"south"|"west"|"east"}){
  const paths={sound:"M3 9h4l5-4v14l-5-4H3z M16 9q4 3 0 6 M19 6q7 6 0 12",silent:"M3 9h4l5-4v14l-5-4H3z M16 9l6 6 M22 9l-6 6",menu:"M4 6h16M4 12h16M4 18h16",close:"m6 6 12 12M18 6 6 18",bag:"M6 8h12l2 12H4L6 8Zm3 0V5a3 3 0 0 1 6 0v3",north:"m5 15 7-7 7 7",south:"m5 9 7 7 7-7",west:"m15 5-7 7 7 7",east:"m9 5 7 7-7 7"};
  return <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[kind]}/></svg>;
}

/** `audio`, `initialSound` and `initialMix` carry the title screen's sound choice; `initialSurface` carries its “Continue to today’s ask”. */
export interface ExpeditionGameProps {session?:HarborSession;accountPanel?:ReactNode;audio?:HarborAudio;initialSound?:boolean;initialMix?:readonly [number,number];initialSurface?:"tide"}
export default function ExpeditionGame({session,accountPanel,audio:titleAudio,initialSound=false,initialMix=[0.8,1],initialSurface}:ExpeditionGameProps={}){
  const [initial]=useState(readLocal),[save,setSave]=useState(initial.save),[surface,setSurface]=useState<HomePlace|"menu"|"guide"|"lantern"|"inspect"|"crossings"|"chart"|"tide"|"log"|null>(initialSurface??null);
  const [problem,setProblem]=useState(initial.problem),[corrupt,setCorrupt]=useState(!!initial.problem),[notice,setNotice]=useState(""),[transition,setTransition]=useState<CourtTransition|null>(null),[presentationId,setPresentationId]=useState(0),[busy,setBusy]=useState(false),[finishing,setFinishing]=useState(false),[focused,setFocused]=useState<Command|null>(null);
  const [lease,setLease]=useState<"waiting"|"held"|"blocked"|"unavailable">("waiting"),[leaseAttempt,setLeaseAttempt]=useState(0);
  const [tool,setTool]=useState<Tool>("rope"),[area,setArea]=useState<Area>(()=>initial.save.home.lit&&!initial.save.home.banked.includes("vane")?"wind":"beacon"),[reduced,setReduced]=useState(()=>matchMedia("(prefers-reduced-motion: reduce)").matches),[hidden,setHidden]=useState(document.hidden),[unfocused,setUnfocused]=useState(false),[fault,setFault]=useState(""),[sceneKey,setSceneKey]=useState(0),[sound,setSound]=useState(initialSound),[motif,setMotif]=useState<"crest"|"moth">("crest"),[recipient,setRecipient]=useState(""),[lastBeat,setLastBeat]=useState("");
  const saveRef=useRef(save),keyRef=useRef(EXPEDITION_SAVE_KEY),busyRef=useRef(false),buffer=useRef<Command|null>(null),presentation=useRef(0),sessionRef=useRef(session),audio=useRef<HarborAudio|null>(titleAudio??null),panelRef=useRef<HTMLDivElement>(null),trigger=useRef<HTMLElement|null>(null),corruptRef=useRef(corrupt),finishBusy=useRef(false),finishEpoch=useRef(0),alive=useRef(true);
  const [resting,setResting]=useState(false),[greeting,setGreeting]=useState(0);
  const [musicLevel,setMusicLevel]=useState(initialMix[0]),[effectsLevel,setEffectsLevel]=useState(initialMix[1]);
  const [passage,setPassage]=useState(emptyPassageHome);
  const [passageScope,setPassageScope]=useState("");
  const [passageError,setPassageError]=useState("");
  const passageReadable=useRef(false);
  const audioRequest=useRef(0);
  const repairRequest=useRef<{branch:string;kind:"beacon"|"signal"}|null>(null);
  function muteSound(){
    audioRequest.current++;
    setSound(false);
    void audio.current?.setEnabled(false).catch(()=>{});
  }
  async function toggleSound(){
    if(sound){muteSound();return;}
    const request=++audioRequest.current;
    try{
      const player=audio.current??(audio.current=new HarborAudio());
      await player.setEnabled(true);
      if(!alive.current||request!==audioRequest.current)return;
      player.setMix(musicLevel,effectsLevel);
      setSound(true);
      if(!saveRef.current.active)player.playMusic("harbor");
    }catch{
      if(alive.current&&request===audioRequest.current){setSound(false);setNotice("Sound is unavailable. Mochi can keep going quietly.");}
    }
  }
  useEffect(()=>{audio.current?.setMix(musicLevel,effectsLevel);},[musicLevel,effectsLevel]);
  const queuedFrame=useRef<number|null>(null),panelOpen=useRef(false),restoreInspectFocus=useRef(false);
  const [readySceneKey,setReadySceneKey]=useState(-1),worldReady=readySceneKey===sceneKey;
  const leaseRef=useRef(lease);leaseRef.current=lease;
  saveRef.current=save;sessionRef.current=session;
  corruptRef.current=corrupt;
  const run=save.active?.state??null,legal=run?legalCommands(run):[],savedMode=session?.state.mode==="saved"&&!!session.state.snapshot;
  const visibleRun=busy&&transition?transition.before:run;
  const canonical=savedMode?session!.state.snapshot!.journey:null;
  const desiredKey=savedMode?`familiar.expedition.game.v2:testnet:${session!.state.snapshot!.binding.nearAccountId}`:EXPEDITION_SAVE_KEY;
  const home:LocalHome=canonical?{banked:canonical.banked as BankedItem[],lit:canonical.lit,signaled:canonical.signaled,lantern:null}:save.home;
  const tideScope=savedMode?session!.state.snapshot!.binding.nearAccountId:"preview";
  const today=import.meta.env.DEV?devTideDay(location.search)??tideDay():tideDay();
  const [tideVersion,setTideVersion]=useState(0),[logDay,setLogDay]=useState<number|undefined>(undefined),[pressDay,setPressDay]=useState<number|undefined>(undefined);
  useEffect(()=>{if(surface!=="log")setPressDay(undefined);},[surface]);
  const tideEntries=useMemo(()=>readTideLog(tideScope),[tideScope,tideVersion,lease]);
  const tideCard=useMemo(()=>save.active?.season?cardForDay(readTidePending(tideScopeOf(save.active.context))?.day??today):null,[save.active?.context,save.active?.season,today,tideVersion]);
  const tideRun=useMemo(()=>tideCard&&visibleRun?replayRun(visibleRun.tool,visibleRun.commands):null,[tideCard,visibleRun]);
  const passageKey=desiredKey+":shore-passages.v1";
  const showPassage=passageScope===passageKey&&!run&&!!passage.active;
  const services=passageScope===passageKey?passage.services:[];
  const lastService=services.at(-1);
  const chapterComplete=home.signaled&&services.includes("bell")&&services.includes("reed");
  const placement=session?.state.workshop.placement,placedItem=savedMode&&placement?session!.state.workshop.items.find(item=>item.mint.token_id===placement.item_id):null;
  const harbor:HarborView={resting,greeting,heardBell:passageScope===passageKey&&passage.heardBell,services,watchedReeds:passageScope===passageKey&&passage.watchedReeds,lit:home.lit,signaled:home.signaled,moth:home.banked.includes("moth"),lantern:!!(savedMode?placedItem:home.lantern),socket:savedMode&&placedItem?placement!.socket:home.lantern?.socket??"porch",motif:savedMode?placedItem?.mint.motif??"crest":home.lantern?.motif??"crest",polished:savedMode&&placedItem?.finish==="harbor_polish",relic:home.banked.includes("lens")&&!home.lit?"lens":home.banked.includes("vane")&&!home.signaled?"vane":null};
  const paused=showPassage||!worldReady||!!surface||hidden||unfocused||!!fault||!!problem||!!session?.state.review;
  const pausedRef=useRef(paused);pausedRef.current=paused;
  const snapshot=useMemo(()=>({court:run,home:harbor,reducedMotion:reduced,previewCommand:focused}),[run,harbor.lit,harbor.signaled,harbor.moth,harbor.lantern,harbor.socket,harbor.motif,harbor.polished,harbor.relic,resting,greeting,passage,passageScope,reduced,focused]);
  const previousHome=useRef({branch:desiredKey,lit:home.lit,signaled:home.signaled});
  useEffect(()=>{
    const before=previousHome.current;
    previousHome.current={branch:desiredKey,lit:home.lit,signaled:home.signaled};
    if(before.branch!==desiredKey)return;
    if(!before.lit&&home.lit)setArea("wind");
    const repair=repairRequest.current;
    if(repair?.branch!==desiredKey)return;
    const completed=repair.kind==="signal"?!before.signaled&&home.signaled:!before.lit&&home.lit;
    if(completed){repairRequest.current=null;audio.current?.playMusic(repair.kind);}
  },[home.lit,home.signaled,desiredKey]);
  const previewReturns=useMemo(()=>{try{return new ReturnRecords(localStorage).read({authority:"local-preview",banked:save.home.banked,lit:save.home.lit,signaled:save.home.signaled});}catch{return[];}},[save.last,save.home.banked]);
  const logReturns=savedMode?session!.state.returns:previewReturns;
  const logBook=useMemo(()=>logPages(logReturns,tideEntries),[logReturns,tideEntries]);
  const canSailTide=home.lit&&lease==="held"&&!problem&&!run&&worldReady&&!showPassage&&!session?.state.busy&&!session?.state.pending;
  const canRestartTide=!!save.active?.season&&run?.outcome==="active"&&!busy&&!finishing&&!problem&&!fault&&worldReady&&lease==="held"&&!session?.state.busy&&!session?.state.pending;
  function sailTide(day:number){begin({tool:cardForDay(day).tool,day});}
  function openLog(day?:number){setPressDay(undefined);setLogDay(day);open("log");}
  const previewOrigin=previewReturns.find(record=>record.outcome==="returned"&&record.cargo.includes(home.lantern?.motif==="moth"?"moth":"lens"));

  useEffect(()=>{const media=matchMedia("(prefers-reduced-motion: reduce)"),change=()=>setReduced(media.matches),visibility=()=>{setHidden(document.hidden);buffer.current=null;if(document.hidden)muteSound();},blur=()=>{setUnfocused(true);buffer.current=null;muteSound();},focus=()=>setUnfocused(false);media.addEventListener("change",change);document.addEventListener("visibilitychange",visibility);window.addEventListener("blur",blur);window.addEventListener("focus",focus);return()=>{media.removeEventListener("change",change);document.removeEventListener("visibilitychange",visibility);window.removeEventListener("blur",blur);window.removeEventListener("focus",focus);void audio.current?.close().catch(()=>{});};},[]);
  useEffect(()=>{document.title=run?`${COURTS[run.area].title} · Familiar`:"Pocket Harbor · Familiar";},[run?.area]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;finishEpoch.current++;finishBusy.current=false;buffer.current=null;if(queuedFrame.current!==null)cancelAnimationFrame(queuedFrame.current);queuedFrame.current=null;leaseRef.current="waiting";};},[]);
  useEffect(()=>{
    if(keyRef.current===desiredKey)return;
    repairRequest.current=null;setResting(false);
    const branch=readLocal(desiredKey);keyRef.current=desiredKey;saveRef.current=branch.save;setSave(branch.save);setProblem(branch.problem);setCorrupt(!!branch.problem);corruptRef.current=!!branch.problem;
    buffer.current=null;if(queuedFrame.current!==null)cancelAnimationFrame(queuedFrame.current);queuedFrame.current=null;busyRef.current=false;setBusy(false);finishEpoch.current++;finishBusy.current=false;setFinishing(false);setTransition(null);presentation.current++;setPresentationId(presentation.current);setSceneKey(k=>k+1);setNotice("");setFocused(null);
    sessionRef.current?.setActiveRun(branch.save.active?.context??null);
  },[desiredKey]);
  useEffect(()=>{
    // A restored identity must not switch harbors underneath a device-only crossing.
    session?.setActiveRun?.(save.active?.context??(showPassage?{authority:"local-preview",banked:[],lit:false,signaled:false}:null));
  },[session,save.active?.context,showPassage]);
  useEffect(()=>{
    let current=true,release:(()=>void)|undefined;setLease("waiting");leaseRef.current="waiting";
    const frame=requestAnimationFrame(()=>{
      if(!navigator.locks){setLease("unavailable");leaseRef.current="unavailable";return;}
      void navigator.locks.request(`familiar-expedition-play:${desiredKey}`,{ifAvailable:true},async lock=>{
        if(!current)return;if(!lock){setLease("blocked");leaseRef.current="blocked";return;}
        try{
          const restored=readPassageHome(localStorage,passageKey);
          setPassage(restored);setPassageError("");passageReadable.current=true;
        }catch{
          setPassage(emptyPassageHome());setPassageError("Your crossing record could not be read. The original is preserved on this device.");passageReadable.current=false;
        }
        setPassageScope(passageKey);
        const latest=readLocal(desiredKey);saveRef.current=latest.save;setSave(latest.save);setProblem(latest.problem);setCorrupt(!!latest.problem);corruptRef.current=!!latest.problem;setSceneKey(k=>k+1);sessionRef.current?.setActiveRun(latest.save.active?.context??null);
        setLease("held");leaseRef.current="held";
        await new Promise<void>(resolve=>{release=resolve;});
      }).catch(()=>{if(current){setLease("unavailable");leaseRef.current="unavailable";}});
    });
    return()=>{current=false;leaseRef.current="waiting";cancelAnimationFrame(frame);release?.();};
  },[desiredKey,leaseAttempt]);
  useEffect(()=>{if(surface||session?.state.review){if(!panelOpen.current)trigger.current=document.activeElement as HTMLElement;panelOpen.current=true;const frame=requestAnimationFrame(()=>panelRef.current?.focus({preventScroll:true}));return()=>cancelAnimationFrame(frame);}if(panelOpen.current){panelOpen.current=false;const opener=trigger.current;trigger.current=null;if(restoreInspectFocus.current){restoreInspectFocus.current=false;document.querySelector<HTMLButtonElement>(".exp-inspect-button")?.focus({preventScroll:true});}else if(opener?.isConnected)opener.focus({preventScroll:true});}},[surface,session?.state.review?.id,worldReady]);
  useEffect(()=>{if(!surface&&!session?.state.review)return;const trap=(event:KeyboardEvent)=>{if(event.key!=="Tab")return;const panel=panelRef.current;if(!panel)return;const targets=[...panel.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(n=>n.getClientRects().length);if(!targets.length){event.preventDefault();panel.focus();return;}const first=targets[0]!,last=targets.at(-1)!;if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel)){event.preventDefault();last.focus();}else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===panel)){event.preventDefault();first.focus();}};window.addEventListener("keydown",trap);return()=>window.removeEventListener("keydown",trap);},[surface,session?.state.review?.id]);

  function persist(next:LocalSave){if(leaseRef.current!=="held"){setNotice("This expedition is open in another tab. Finish there, or close that tab and check again.");return false;}try{writeLocal(next,keyRef.current);saveRef.current=next;setSave(next);setProblem("");return true;}catch(error){setProblem(error instanceof Error?error.message:"This browser could not save the move. No new action was taken.");return false;}}
  /** `tide` starts Season 2's daily outing: a fresh Beacon Court with nothing banked, kept apart from First Light progress, answering one day's Tidekeeper ask. */
  function begin(tide?:{tool:Tool;day?:number}){
    if(showPassage||!worldReady||saveRef.current.active||corruptRef.current||leaseRef.current!=="held")return;
    startOuting(tide);
  }
  function startTideOver(){
    const active=saveRef.current.active;if(!canRestartTide||!active?.season||active.state.outcome!=="active"||busyRef.current||finishBusy.current||corruptRef.current||leaseRef.current!=="held")return;
    const pending=readTidePending(tideScopeOf(active.context));if(startOuting(restartTide(pending,today,active.state.tool),pending??undefined))setNotice("Mochi sets out again. The asks are open.");
  }
  function startOuting(tide?:{tool:Tool;day?:number},pending?:TidePending){
    try{const harborContext=sessionRef.current?.runContext(saveRef.current.home)??{authority:"local-preview" as const,banked:[...saveRef.current.home.banked],lit:saveRef.current.home.lit,signaled:saveRef.current.home.signaled};
      const context:RunContext=tide?{...harborContext,banked:[]}:harborContext,runArea:Area=tide?"beacon":area,runTool:Tool=tide?.tool??tool;
      if(runArea==="wind"&&!context.lit){setNotice("Restore the beacon before sailing to Wind Gate.");return;}
      setResting(false);
      const state=startCourt({area:runArea,tool:runTool,banked:context.banked});if(!persist({...saveRef.current,active:{context,state,...(tide?{season:true as const}:{})},last:null})){sessionRef.current?.setActiveRun(saveRef.current.active?.context??null);return;}if(tide&&!pending){const day=tide.day??today;try{writeTidePending(tideScopeOf(context),{day,late:day!==today});}catch{/* Unmarked outings count for today. */}}
      sessionRef.current?.setActiveRun?.(context);audio.current?.playMusic(runArea==="wind"?"wind-departure":"departure");setSurface(null);setNotice(runArea==="wind"?"Watch the outlet. The wheel bends a marked surge into a different channel.":"Tap a glowing neighbor to move. Water advances only when you decide.");setTransition(null);buffer.current=null;
      if(queuedFrame.current!==null)cancelAnimationFrame(queuedFrame.current);queuedFrame.current=null;busyRef.current=false;setBusy(false);setFocused(null);return true;
    }catch(error){setProblem(error instanceof Error?error.message:"The outing could not start. Your saved harbor is unchanged.");}
  }
  async function complete(){
    const current=saveRef.current,active=current.active;if(!active||active.state.outcome==="active"||leaseRef.current!=="held")return;
    if(finishBusy.current)return;finishBusy.current=true;setFinishing(true);
    const epoch=++finishEpoch.current,branch=keyRef.current,generation=presentation.current,owner=sessionRef.current;
    try{
      if(active.season)keepTide(tideScopeOf(active.context),{id:crypto.randomUUID(),contentVersion:CONTENT_VERSION,tool:active.state.tool,commands:[...active.state.commands],cargo:[...active.state.cargo],outcome:active.state.outcome==="returned"?"returned":"rescued",savedAt:new Date().toISOString()});
      else if(owner)await owner.captureReturn(active.state,active.context);else await new ReturnRecords(localStorage).capture(active.state,active.context);
      if(!alive.current||epoch!==finishEpoch.current||branch!==keyRef.current||generation!==presentation.current||saveRef.current.active!==active||sessionRef.current!==owner)return;
      const banked=!active.season&&active.context.authority==="local-preview"?[...new Set([...current.home.banked,...(active.state.outcome==="returned"?active.state.cargo:[])])]:current.home.banked;
      const next={...current,home:{...current.home,banked},active:null,last:active.state};
      if(!persist(next))return;sessionRef.current?.setActiveRun?.(null);setTransition(null);let tideNote="";if(active.season){try{const scope=tideScopeOf(active.context),pending=readTidePending(scope),day=pending?.day??today,recorded=recordTide(scope,{day,tool:active.state.tool,commands:active.state.commands,late:pending?.late??false}),outing=replayRun(active.state.tool,active.state.commands);try{writeTidePending(scope,null);}catch{}setTideVersion(n=>n+1);tideNote=active.state.outcome==="rescued"?" The asks slipped this time; the tide log keeps the try.":outing?` ${outingNotice(outing,cardForDay(day),recorded)}`:"";setLogDay(day);setPressDay(day);setSurface("log");}catch{tideNote=" The tide log could not be saved on this device. The outing itself is kept.";}}setNotice((active.state.outcome==="returned"?(active.state.cargo.length?`Home with ${active.state.cargo.map(i=>names[i]).join(" and ")}.${active.season?shelfNote({cargo:active.state.cargo,day:today}):active.context.authority==="near-testnet"?" Bring the satchel to Bram.":""}`:"Mochi is home, safe and empty-pawed."):eventDescription({kind:"rescue",reason:active.state.resolve<=0?"resolve":"flood"}))+tideNote);
    }catch(error){if(alive.current&&epoch===finishEpoch.current&&branch===keyRef.current)setProblem(error instanceof Error?error.message:"The returned outing could not be recorded. Keep it open and retry saving.");}
    finally{if(alive.current&&epoch===finishEpoch.current){finishBusy.current=false;setFinishing(false);}}
  }
  const command=useCallback((input:Command)=>{
    if(!alive.current||pausedRef.current||corruptRef.current||leaseRef.current!=="held")return;const current=saveRef.current,active=current.active;if(!active||active.state.outcome!=="active")return;
    if(busyRef.current){if(!buffer.current){buffer.current=input;setNotice(`${commandName(input)} queued. Mochi will finish this moment first.`);}return;}
    const accepted=applyCommand(active.state,input);if(!accepted){setNotice("That action is not available here. Choose a glowing neighbor or inspect the tide.");return;}
    if(!persist({...current,active:{...active,state:accepted.after}}))return;
    busyRef.current=true;setBusy(true);setFocused(null);setTransition(accepted);const id=++presentation.current;setPresentationId(id);
    if(!accepted.events.length)setNotice("Mochi waits. The tide advances.");
  },[]);
  function settled(id:number){if(!alive.current||id!==presentation.current)return;const wave=transition?.events.find(event=>event.kind==="wave");
    if(wave&&transition?.after.outcome==="active"){
      const opened=transition.events.some(event=>event.kind==="open");
      const hit=transition.events.some(event=>event.kind==="hit");
      const discovery=opened?(transition.after.area==="wind"?` ${columns[wave.exit]} channel charged.`:" Oyster opens."):"";
      const footing=hit?` Mochi is splashed. Resolve ${transition.after.resolve}/3.`:" Mochi stays dry.";
      const route=transition.after.area==="wind"?`${columns[wave.source]} source → ${columns[wave.exit]} exit`:`${columns[wave.exit]} surge`;
      setNotice(`${route}. Bridge at ${columns[wave.exit]}.${discovery}${footing}`);
    }
    if(tideCard&&transition&&transition.after.outcome==="active"){const before=replayRun(transition.before.tool,transition.before.commands),after=replayRun(transition.after.tool,transition.after.commands),flip=before&&after?askFlips(tideCard,before,after):"";if(flip)setNotice(note=>note?`${note} ${flip}`:flip);}
    busyRef.current=false;setBusy(false);setTransition(null);const queued=buffer.current;buffer.current=null;if(saveRef.current.active?.state.outcome!=="active"){complete();return;}if(queued&&!pausedRef.current){const branch=keyRef.current,generation=presentation.current;const frame=requestAnimationFrame(()=>{if(queuedFrame.current===frame)queuedFrame.current=null;if(!alive.current||branch!==keyRef.current||generation!==presentation.current||leaseRef.current!=="held")return;command(queued);});queuedFrame.current=frame;}}
  function beat(event:CourtEvent,index:number){setLastBeat(`${presentation.current}:${index}:${event.kind}`);setNotice(eventDescription(event,run?.area));if(sound)audio.current?.play(event,run?.area);}
  useEffect(()=>{const keys=(event:KeyboardEvent)=>{
    if(showPassage)return;
    if(event.key==="Escape"){closePanel();return;}
    if(event.repeat||event.isComposing||event.altKey||event.ctrlKey||event.metaKey||event.shiftKey)return;
    if(pausedRef.current)return;
    const target=event.target instanceof Element?event.target:null;
    if(target?.closest("input,textarea,select,[contenteditable]:not([contenteditable=false]),dialog,[role=dialog],[role=slider],[role=tablist]"))return;
    if((event.key===" "||event.key==="Enter")&&target?.closest("button,a"))return;
    const map:Record<string,Command>={ArrowUp:"step:north",ArrowDown:"step:south",ArrowLeft:"step:west",ArrowRight:"step:east",w:"step:north",s:"step:south",a:"step:west",d:"step:east"," ":"wait",r:"return"};
    let selected:Command|undefined=map[event.key];if(event.key==="e"){const state=saveRef.current.active?.state,available=state?legalCommands(state):[];selected=available.find(c=>/^(take:|reel:)/.test(c))??available.find(c=>c==="turn:vane");}
    if(selected){event.preventDefault();command(selected);}
  };window.addEventListener("keydown",keys);return()=>window.removeEventListener("keydown",keys);},[command,showPassage]);
  function inspect(position:Position){
    const state=saveRef.current.active?.state;
    if(!state)return;
    if(state.area==="wind"){
      if(position.x===1&&position.y===3){
        setNotice("The wind-wheel. Turn it from this landing to shift every outlet one column.");
        return;
      }
      if(position.x===1&&position.y===4){
        setNotice(state.banked.includes("vane")?"The cradle is empty. The signal vane is home.":state.cargo.includes("vane")?"The vane is in Mochi’s pack. Return at the center dock.":findPosition(state,"vane")?"The cradle is open. The vane is ready to lift.":"Two charged outlets, left and center, and an aligned wheel release the vane.");
        return;
      }
      if(position.y===4){
        setNotice(`${columns[position.x]} outlet. ${position.x===2?"This channel carries water past the cradle.":state.opened.includes(position.x)?"Its charge is holding.":"Send a surge here to charge it."}`);
        return;
      }
    }
    setNotice(position.y===2?`${columns[position.x]} crossing: ${state.bridge===position.x?"bridge open. Approach from the platform beside it to cross.":"water. Route a surge here to open this bridge."}`:position.y===4?position.x===0?"The Beacon Lens waits inside the left shell. A surge opens it.":position.x===2?"The wind-moth needs two satchel slots. A surge opens its shell.":"The upper walkway connects both discoveries.":"A stone foothold. Tap a glowing neighbor to walk there.");
  }
  function target(position:Position){const state=saveRef.current.active?.state;if(!state)return;const input=commandAt(state,position);if(input)command(input);else inspect(position);}
  function hover(position:Position|null){if(busyRef.current)return;const state=saveRef.current.active?.state;setFocused(position&&state?commandAt(state,position):null);}
  function open(place:HomePlace|"menu"|"guide"|"lantern"|"inspect"|"crossings"|"chart"|"tide"|"log"){if(place==="mochi"){setResting(true);setGreeting(n=>n+1);return;}setResting(false);buffer.current=null;restoreInspectFocus.current=place==="inspect";setSurface(place);}
  function closePanel(){const controller=sessionRef.current;if(controller?.state.review){if(controller.state.busy)return;controller.cancelReview();}setSurface(null);}
  function request(intent:WorldIntent){void sessionRef.current?.review(intent).catch(()=>{/* The controller keeps the actual failure and original operation visible. */});}
  function restore(restoration:"beacon"|"signal"){
    if(savedMode){request({kind:"restore",restoration});return;}
    if(restoration==="beacon"&&home.banked.includes("lens")){if(persist({...saveRef.current,home:{...saveRef.current.home,lit:true}})){repairRequest.current={branch:desiredKey,kind:"beacon"};setNotice("Mochi lifts the lens into place. The beacon finds the bay again.");setSurface(null);}}
    else if(restoration==="signal"&&home.lit&&home.banked.includes("vane")){if(persist({...saveRef.current,home:{...saveRef.current.home,signaled:true}})){repairRequest.current={branch:desiredKey,kind:"signal"};setNotice("The vane catches the breeze. Bram reads the wind from the quay.");setSurface(null);}}
  }
  function storePassage(next:PassageHome){
    if(!passageReadable.current||passageScope!==passageKey||keyRef.current!==desiredKey||leaseRef.current!=="held")return false;
    try{
      writePassageHome(localStorage,passageKey,next);
      setPassage(next);setPassageError("");return true;
    }catch{setPassageError("This crossing could not be saved. Keep the tab open and try again.");return false;}
  }
  function departPassage(job:Landing){
    if(!home.lit||run||passage.active||!storePassage({...passage,active:startPassage(job,home.banked.includes("moth"),passage.heardBell,chapterComplete)}))return;
    setResting(false);buffer.current=null;setSurface(null);setNotice("");
    audio.current?.playMusic("departure");
  }
  function backFromPassage(next:PassageHome,message:string){
    if(storePassage(next)){setReadySceneKey(-1);setSceneKey(k=>k+1);setNotice(message);}
  }
  function finishPassage(state:PassageState){
    if(!passage.active||state.court.outcome==="active")return;
    const next=dockPassage({...passage,active:state});
    const completed=passageDelivered(state);
    backFromPassage(next,next.heardBell&&!passage.heardBell?"Bram rigs a bell pull for both crossings. One pull per outing calls the next surge left from the far-center landing.":completed?(state.job==="bell"?"Bram’s supplies are stacked at Bell Steps.":"Mochi’s skiff is tied up at the quay."):state.court.outcome==="rescued"?"Bram brought Mochi home. The crossing can wait.":"Mochi is back at the dock.");
  }
  const button=(input:Command,label=commandName(input))=><button key={input} data-command={input} disabled={!legal.includes(input)||!!problem} onFocus={()=>setFocused(input)} onBlur={()=>setFocused(null)} onMouseEnter={()=>setFocused(input)} onMouseLeave={()=>setFocused(null)} onClick={()=>{const state=saveRef.current.active?.state,item=/^(take:|reel:)/.test(input)?input.slice(5) as "lens"|"moth"|"vane":null,position=state&&item?findPosition(state,item):null;if(position)target(position);else command(input);}} aria-label={label}>{label}</button>;
  const interactionLegal=busy?[]:legal;
  const pickups=interactionLegal.filter(c=>/^(take:|reel:|turn:)/.test(c));
  const activeReturn=save.active?.state.outcome!=="active"&&!!save.active;
  const authority=savedMode?"NEAR testnet":"Local preview";
  const stagedReturns=session?.state.returns.filter(r=>r.disposition==="staged"&&r.outcome==="returned"&&r.cargo.length>0)??[];
  const recordReturns=stagedReturns.filter(record=>{
    const c=record.context,snapshot=session?.state.snapshot;if(!savedMode||!snapshot||c.authority!=="near-testnet")return false;
    const samePlayer=c.accountId===snapshot.binding.nearAccountId&&c.publicKey===snapshot.binding.signerPublicKey&&snapshot.pets.some(pet=>pet.token_id===c.companionId);
    const knownOriginal=(snapshot.journey as typeof snapshot.journey&{claims?:{operation_id:string}[]}).claims?.some(claim=>claim.operation_id===record.operationId);
    return samePlayer&&(knownOriginal||c.revision===snapshot.journey.revision&&c.checkpointHash===snapshot.checkpointHash&&same(c.banked,snapshot.journey.banked));
  });
  const earlierReturns=stagedReturns.filter(record=>!recordReturns.includes(record));
  const waitingCraft=["reserved","recovery-required"].includes(canonical?.craft?.state??""),waitingPolish=["reserved","recovery-required"].includes(canonical?.polish?.state??"");
  const objective=tideCard&&tideRun?tideObjective(tideCard,tideRun):visibleRun?.area==="wind"?visibleRun.cargo.includes("vane")?"Vane secured · reach the center dock.":visibleRun.banked.includes("vane")?"Practice the channels · your vane stays home.":!visibleRun.opened.includes(0)||!visibleRun.opened.includes(1)?`Charge the ${!visibleRun.opened.includes(0)&&!visibleRun.opened.includes(1)?"left and center exits":!visibleRun.opened.includes(0)?"left exit":"center exit"}.`:visibleRun.orientation!==0?"Turn the wheel at far center to align the cradle.":"The cradle is open. Lift the Signal Vane.":visibleRun?.cargo.includes("lens")?"Lens secured · reach the center dock.":visibleRun?.banked.includes("lens")?visibleRun.banked.includes("moth")?"Practice the tides · discoveries stay home.":"Rescue the wind-moth from the Right oyster.":"Open the Left oyster; bring its lens home.";

  const needLens=home.banked.includes("lens")&&!home.lit,needVane=home.lit&&home.banked.includes("vane")&&!home.signaled;
  const canPreviewCrest=previewReturns.some(record=>record.outcome==="returned"&&record.cargo.includes("lens"));
  const canPreviewMoth=previewReturns.some(record=>record.outcome==="returned"&&record.cargo.includes("moth"));
  const needsLantern=savedMode?!!session?.state.workshop.creditAvailable:home.lit&&!home.lantern&&canPreviewCrest;
  const nextPlace:HomePlace|"crossings"|"chart"|null=recordReturns.length?"satchel":needLens||needVane?"beacon":chapterComplete?"chart":home.signaled?"crossings":needsLantern?"workbench":null;
  const homeTitle=recordReturns.length?"A full satchel. A safe harbor.":needLens?"The lens is home.":needVane?"The vane is home.":chapterComplete?"A harbor connected.":lastService==="bell"?"Supplies at Bell Steps.":lastService==="reed"?"The reed skiff is home.":home.signaled?"The harbor finds its bearings.":needsLantern?"A little light of your own.":home.lit?"A light worth coming home to.":"A little help for the harbor.";
  const homeIntent=recordReturns.length?"Bring the original returned satchel to Bram. Review what can be saved before unpacking.":needLens?"Mochi kept it safe. Carry the lens up to the beacon.":needVane?"Bram steadies the bare post. Mochi has brought back the missing arrow.":chapterComplete?(harbor.heardBell?"The bell pull is rigged. Try a different crossing with Mochi, or sit together by the quay.":"Bram has cleared the old arch at Bell Steps. Mochi keeps turning toward it. What does she hear when the water falls?"):lastService==="bell"?"Across the water, Bram’s crates stand on the receiving steps.":lastService==="reed"?"The skiff rocks at its mooring on the near bank.":home.signaled?"Bram has a load for Bell Steps. Mochi is watching a skiff across at Reed.":needsLantern?"Your returned adventure can become one light for home.":home.lit?`Wind Gate has a different tide to understand.${home.banked.includes("moth")?"":" You can also return for the wind-moth."}`:"The beacon’s lens is across the tide. Mochi is ready to help.";
  const primaryLabel=recordReturns.length?"Unpack the satchel":needLens?"Bring the lens to the beacon":needVane?"Fit the Signal Vane":chapterComplete?"Look over the harbor":home.signaled?"Choose a crossing":needsLantern?"Make a little light":area==="wind"?"Sail to Wind Gate":"Set out with Mochi";
  const storyStep=!!recordReturns.length||needLens||needVane||needsLantern||home.lit&&!home.banked.includes("vane")||home.signaled&&!chapterComplete;
  const tideHome=resting?null:harborTide({lit:home.lit,storyStep,card:cardForDay(today),next:cardForDay(today+1),entry:todayView(today,tideEntries).entry}),tidePanel=tideHome?.kind==="panel"?tideHome:null;
  const beatParts=lastBeat.split(":"),currentBeat=busy&&transition&&Number(beatParts[0])===presentationId?transition.events[Number(beatParts[1])]:null;
  const shownForecast=busy?currentBeat?`Resolving: ${eventDescription(currentBeat,run?.area)}`:"Mochi is acting. The tide will follow.":run?forecast(run,focused):"";

  if(showPassage&&passage.active&&lease==="held"&&!problem&&!session?.state.review)return <>
    <PassageGame key={passageKey+passage.active.job} job={passage.active.job} initial={passage.active} mothHome={passage.active.mothHome} reduced={reduced} sound={sound} audio={audio.current}
      blocked={!!session?.state.busy}
      onSave={next=>storePassage({...passage,active:next})}
      onFinish={finishPassage} onToggleSound={()=>void toggleSound()} onLeave={()=>backFromPassage({...passage,active:null},"The line is coiled at home. You can choose another crossing.")}/>
    {passageError&&<p className="passage-storage-error" role="alert">{passageError}</p>}
  </>;
  return <main className="exp-game" data-testid="expedition-game" data-mode={run?"court":"harbor"} data-busy={busy} data-lease={lease} data-content={CONTENT_VERSION} data-beat={lastBeat}>
    {lease!=="waiting"&&<World key={sceneKey} snapshot={snapshot} transition={transition} presentationId={presentationId} paused={paused} onCommand={command} onTarget={target} onInspect={inspect} onHover={hover} onHome={open} onSettled={settled} onBeat={beat} onFault={message=>{setFault(message);buffer.current=null;}} onReady={()=>setReadySceneKey(sceneKey)}/>}
    {!worldReady&&!fault&&<section className="familiar-boot exp-loading" role="status"><p className="boot-brand">familiar.</p><h1>Unpacking the harbor.</h1><p>Opening the artwork. Mochi’s saved moves are safe.</p><a href="">Reload Familiar</a></section>}
    {worldReady&&<>
    <header className="exp-mast"><a className="exp-brand" href="/" aria-label="Familiar home">familiar.<small>{authority}</small></a><div className="exp-place">{run?COURTS[run.area].title:"Pocket Harbor"}</div><div className="exp-header-actions">{!run&&!surface&&!session?.state.review&&<button className="exp-menu-button" aria-label={sound?"Mute game audio":"Enable game audio"} aria-pressed={sound} onClick={()=>void toggleSound()}><Icon kind={sound?"sound":"silent"}/></button>}<button className="exp-menu-button" onClick={()=>open("menu")} aria-label="Game menu"><Icon kind="menu"/></button></div></header>
    {visibleRun&&<section className="exp-hud" aria-label="Expedition status"><strong><span aria-hidden="true" className={`exp-tide-dial phase-${phaseOf(visibleRun)}`}><i/><i/><i/></span>{title(phaseOf(visibleRun))} tide <span>{visibleRun.turn+1>TURN_LIMIT?TURN_LIMIT:visibleRun.turn+1}/{TURN_LIMIT}</span></strong><span>Resolve {visibleRun.resolve}/3</span><span>Pack {packSlots(visibleRun.cargo)}/3</span><span>{title(visibleRun.tool)} {visibleRun.uses}</span></section>}
    {tideCard&&tideRun&&<div className="tide-outing"><TideHud card={tideCard} run={tideRun} reduced={reduced}/>{cardStatus(tideCard,tideRun).includes("slipped")&&<button className="exp-text-button tide-restart" disabled={!canRestartTide} onClick={startTideOver}>Start this tide over</button>}</div>}
    {visibleRun&&<p id="exp-position" className="exp-sr-only">Mochi is at {columns[visibleRun.position.x]}, {visibleRun.position.y>=3?"upper":"lower"} bank, row {visibleRun.position.y+1} of 5. The {columns[visibleRun.bridge]} bridge is open. Carried: {visibleRun.cargo.length?visibleRun.cargo.map(i=>names[i]).join(", "):"nothing"}.</p>}
    {visibleRun?.area==="wind"&&<aside className="exp-channel-map" aria-label="Wind channel routing">
      <div className="exp-wind-routes"><span>Outlets</span>{columns.map((source,index)=><b key={source} data-marked={visibleRun.locked===index} aria-label={`${source} source to ${columns[(index+visibleRun.orientation)%3]} exit`}>{source[0]} → {columns[(index+visibleRun.orientation)%3]![0]}</b>)}</div>
      <small>{visibleRun.opened.includes(0)?"✓ Left":"○ Left"} · {visibleRun.opened.includes(1)?"✓ Center":"○ Center"} · {visibleRun.orientation===0?"Wheel aligned":`${3-visibleRun.orientation} ${visibleRun.orientation===2?"turn":"turns"} to align`}</small>
    </aside>}
    {!run&&!surface&&<>
      <nav className="exp-home-places" aria-label="Places in the harbor"><button className="exp-place-beacon" onClick={()=>open("beacon")}>Beacon<small>{home.lit?"Light restored":home.banked.includes("lens")?"Lens ready":"Missing lens"}</small></button><button className="exp-place-bram" onClick={()=>open("bram")}>Bram</button><button className="exp-place-workbench" onClick={()=>open("workbench")}>Workbench</button><button className="exp-place-satchel" onClick={()=>open("satchel")}><Icon kind="bag"/> Satchel{recordReturns.length?` · ${recordReturns.length}`:""}</button></nav>
      <section className="exp-departure">{tidePanel&&<span className="tide-departure-stamp"><TideStamp id={cardForDay(today).id} size={72} tilt={3} seal={todayView(today,tideEntries).entry?.kept.every(Boolean)} label=""/></span>}<h1>{resting?"A moment together.":tidePanel?tidePanel.title:homeTitle}</h1><p>{resting?(greeting?"Mochi rests a paw against your hand, then settles beside you.":harbor.moth?"Mochi tucks a paw under and watches the moth at its perch.":harbor.watchedReeds?"Mochi tucks a paw under, just as at the sheltered reeds.":"Mochi settles beside you. The water moves below the quay."):tidePanel?tidePanel.body:homeIntent}</p><button className="exp-primary" data-action={tidePanel?"tide":nextPlace?"home-next":"depart"} disabled={!!problem||lease!=="held"||tidePanel?.primary.target==="sail"&&!canSailTide} onClick={()=>resting?setResting(false):tidePanel?tidePanel.primary.target==="sail"?sailTide(today):tidePanel.primary.target==="log"?openLog(today):open("tide"):nextPlace?open(nextPlace):begin()}>{resting?"Back to the harbor":tidePanel?tidePanel.primary.label:primaryLabel}</button><div className="exp-harbor-links">{tideHome?.links.map(link=><button key={link.label} disabled={link.action==="sail"&&!canSailTide} onClick={()=>link.action==="sail"?sailTide(today):link.action==="log"?openLog(today):link.action==="bram"?open("bram"):open("tide")}>{link.label}</button>)}<button onClick={()=>open("chart")}>Harbor chart</button><button hidden={resting} onClick={()=>{setGreeting(0);setResting(true);if(sound)audio.current?.playMusic("harbor");}}>Sit with Mochi</button>{resting&&<button onClick={()=>setGreeting(n=>n+1)}>Offer a hand</button>}</div><button className="exp-text-button" onClick={()=>open("sail")}>{COURTS[area].title} · {title(tool)} · Change preparation</button></section>
    </>}
    {run&&!surface&&!fault&&!session?.state.review&&<section className="exp-command-tray" aria-label="Guide Mochi" aria-describedby="exp-position"><div className="exp-objective-row"><p className="exp-objective" data-testid="expedition-objective">{objective}</p><button className="exp-inspect-button" disabled={busy||!!problem||activeReturn} onClick={()=>open("inspect")}>Inspect</button></div><p className="exp-forecast" data-testid="expedition-forecast">{shownForecast}</p><div className="exp-current-controls" aria-label={busy?"Queue one next decision":"Choose a decision"}><div className="exp-directions" aria-label="Move to a neighboring platform">{(["north","west","east","south"] as const).map(direction=><button key={direction} className={`exp-${direction}`} data-command={`step:${direction}`} aria-label={`Move ${direction}`} disabled={!legal.includes(`step:${direction}`)||!!problem} onFocus={()=>setFocused(`step:${direction}`)} onBlur={()=>setFocused(null)} onMouseEnter={()=>setFocused(`step:${direction}`)} onMouseLeave={()=>setFocused(null)} onClick={()=>command(`step:${direction}`)}><Icon kind={direction}/></button>)}<button className="exp-wait" data-command="wait" aria-label="Wait for the tide" disabled={!legal.includes("wait")||!!problem} onFocus={()=>setFocused("wait")} onClick={()=>command("wait")}>Wait</button></div><div className="exp-context-actions">{pickups.map(input=>button(input))}{run.tool==="lantern"&&interactionLegal.some(c=>c.startsWith("lure:"))&&<button onClick={()=>open("lantern")}>Lure the wave</button>}{interactionLegal.includes("return")&&button("return")}{!pickups.length&&!interactionLegal.includes("return")&&!interactionLegal.some(c=>c.startsWith("lure:"))&&<p>{busy?"Mochi finishes this moment first. One next direction can wait.":run.cargo.length?`${run.cargo.map(i=>names[i]).join(" + ")} secured. Reach the center dock to return.`:"Route a surge to open a shell and move the bridge."}</p>}</div></div></section>}
    <div className="exp-feedback" role="status" aria-live="polite" data-testid="expedition-feedback">{notice}</div>
    {(problem||activeReturn&&!busy)&&<section className="exp-save-problem" role="alert"><p>{problem||(finishing?"Keeping the original return safe…":"Mochi’s return is ready to save.")}</p>{activeReturn&&<button disabled={finishing} onClick={()=>void complete()}>{finishing?"Recording return…":"Retry recording this return"}</button>}{!corrupt&&!activeReturn&&<button onClick={()=>persist(saveRef.current)}>Check device saving again</button>}</section>}
    {(lease==="blocked"||lease==="unavailable")&&<section className="exp-lease" role="status"><p>{lease==="blocked"?"This expedition is open in another tab. Finish there, or close that tab before continuing here.":"This browser cannot safely coordinate saved expeditions. Web Locks support is required; no move has been taken."}</p>{lease==="blocked"&&<button onClick={()=>setLeaseAttempt(n=>n+1)}>Check this tab again</button>}</section>}
    {(surface||session?.state.review)&&<div className="exp-panel-shade"><section ref={panelRef} className={`exp-panel${surface==="bram"&&!session?.state.review?" exp-panel-season":""}`} role="dialog" aria-modal="true" aria-label={session?.state.review?.title??(surface==="account"?"Account and recovery":surface==="tide"?"Today’s tide":surface==="log"?"Bram’s tide log":surface?title(surface):"Harbor")} tabIndex={-1}><button className="exp-close" aria-label="Close panel" disabled={!!session?.state.review&&session.state.busy} onClick={closePanel}><Icon kind="close"/></button>
      {session?.state.review?<><h2>{session.state.review.title}</h2><p>{session.state.review.description}</p>{session.state.review.costs.length>0&&<ul>{session.state.review.costs.map(cost=><li key={cost}>{cost}</li>)}</ul>}<button className="exp-primary" disabled={session.state.busy} onClick={()=>{if(session.state.review?.intent.kind==="restore")repairRequest.current={branch:desiredKey,kind:session.state.review.intent.restoration};void session.confirm(session.state.review!.id).catch(()=>{});}}>{session.state.review.confirmLabel}</button><button disabled={session.state.busy} onClick={()=>{if(!session.state.busy)session.cancelReview();}}>Back</button></>:surface==="account"?<><h2>Keep your harbor</h2>{accountPanel??<p>Recoverable account controls are not connected to this local preview. This visit does not prove ownership or device recovery.</p>}</>:surface==="menu"?<><h2>A moment at the water’s edge.</h2><p>Play at your own pace. Only accepted decisions advance the tide.</p><button disabled={!!run} onClick={()=>open("chart")}>Harbor chart</button>{logBook.length>0&&<button onClick={()=>openLog()}>Tide log</button>}<button onClick={()=>open("guide")}>How to guide Mochi</button><button onClick={()=>open("account")}>Account & recovery</button><button aria-pressed={sound} onClick={()=>void toggleSound()}>Sound {sound?"on":"off"}</button>{sound&&<fieldset className="exp-mix"><legend>Sound mix</legend><label>Music<input type="range" min="0" max="1" step=".05" value={musicLevel} onChange={event=>setMusicLevel(Number(event.target.value))}/></label><label>Effects<input type="range" min="0" max="1" step=".05" value={effectsLevel} onChange={event=>setEffectsLevel(Number(event.target.value))}/></label></fieldset>}{save.active?.season&&<button disabled={!canRestartTide} onClick={startTideOver}>Start this tide over</button>}<button className="exp-primary" onClick={()=>setSurface(null)}>Back to Mochi</button></>:surface==="lantern"?<><h2>A light on the water.</h2><p>Choose a source. The wind-wheel, when present, determines its exit.</p>{(["left","center","right"] as const).map(lane=><button key={lane} disabled={!legal.includes(`lure:${lane}`)} onClick={()=>{setSurface(null);requestAnimationFrame(()=>command(`lure:${lane}`));}}>Lure {title(lane)}</button>)}</>:surface==="inspect"&&run?<Inspect state={run}/>:surface==="guide"?<><h2>Read the water.</h2><p>Tap a glowing neighboring platform, use the arrow keys or W A S D, or use the direction buttons. Crossing the open bridge is one decision.</p><p>Low: choose your footing. Rising: your resulting column becomes the source. Surge: act first, then the wave opens that column’s bridge and shell. Standing in the wave washes Mochi down one platform.</p><p>Rope retrieves an exposed lens or vane from two steps away. Lantern redirects a marked surge. A living moth needs two pack slots. Reach the center dock to return before 24 decisions.</p>{run?.area==="wind"&&<p>Current channels: Left → {columns[run.orientation]}, Center → {columns[(1+run.orientation)%3]}, Right → {columns[(2+run.orientation)%3]}. The cradle needs Left and Center charged and wheel alignment zero.</p>}<p>E uses a nearby object; Space waits; R returns at the dock. Right-click or hold a world target to inspect for free. Inspection and menus spend no turns.</p><button className="exp-primary" onClick={()=>setSurface(null)}>Back to Mochi</button></>:surface==="chart"?<HarborChart banked={home.banked} lit={home.lit} signaled={home.signaled} services={services} watched={harbor.watchedReeds??false} heardBell={harbor.heardBell??false} blocked={lease!=="held"||!!problem||!!passage.active}
        onSail={choice=>{setArea(choice);open("sail");}} onCrossing={departPassage} onRepair={()=>open("beacon")}
        onRest={()=>{setSurface(null);setGreeting(0);setResting(true);if(sound)audio.current?.playMusic("harbor");}}/>:surface==="crossings"?<>
        <h2>The harbor crossing</h2>
        <p>{harbor.heardBell?"Bram’s bell pull is rigged at the far-center landing on both crossings. Once per outing, call a marked surge left.":chapterComplete?"Mochi pricks her ears toward Bell Steps. The old far-left arch falls quiet at low water.":"One line, two landings. Choose which way to rig the boat."}</p>
        <div className="exp-job-list">
          <button onClick={()=>departPassage("bell")} disabled={lease!=="held"||!passageReadable.current||!!problem}><strong>Bell Steps · {chapterComplete?"Explore the old arch":services.includes("bell")?"Sail again":"Send supplies"}</strong><span>{chapterComplete?"Go beyond the worksite with Mochi. Listen under the far-left arch at low tide.":services.includes("bell")?"The supplies are across. Try guiding from shore, or riding the line.":"Bram’s crates are on the near left bank. Take the load out, then find your own way home."}</span><small>{services.includes("bell")?"Supplies delivered · Sail again":"Near bank → far bank"}</small></button>
          <button onClick={()=>departPassage("reed")} disabled={lease!=="held"||!passageReadable.current||!!problem}><strong>Reed Steps · Bring the skiff home</strong><span>Follow Mochi across the bridge to the far right bank. Bring the empty skiff back on the tide.</span><small>{services.includes("reed")?"Skiff moored · Sail again":"Far bank → near bank"}</small></button>
        </div>
        <p className="exp-crossing-note">{passageError||"These crossings and their harbor changes are saved on this device."}</p>
      </>:surface==="sail"?<><h2>What shall we bring?</h2>{home.lit&&<button onClick={()=>open("crossings")}>Bell Steps &amp; Reed Steps</button>}<fieldset><legend>Outing</legend>{(["beacon","wind"] as const).map(choice=><label key={choice}><input type="radio" name="exp-area" value={choice} checked={area===choice} disabled={choice==="wind"&&!home.lit} onChange={()=>setArea(choice)}/><span>{COURTS[choice].title}{choice==="wind"&&!home.lit?" · restore the beacon first":""}</span></label>)}</fieldset>{area==="wind"&&<p className="exp-wind-brief">The wheel on the far bank steers the tide. Charge the left and center outlets to free the harbor’s signal vane.</p>}<fieldset><legend>One tool</legend>{(["rope","lantern"] as const).map(choice=><label key={choice}><input type="radio" name="exp-tool" checked={tool===choice} onChange={()=>setTool(choice)}/><span>{title(choice)} · {choice==="rope"?"pull a find across two steps":"redirect two marked surges"}</span></label>)}</fieldset><button className="exp-primary" disabled={!!problem||lease!=="held"} onClick={()=>begin()}>Sail to {COURTS[area].title}</button></>:surface==="beacon"?<>{(needVane||home.signaled)&&<div className={`exp-signal-study ${home.signaled?"fitted":""}`} aria-hidden="true"><i/><b/><span/></div>}<h2>{needVane?"One missing piece.":home.signaled?"Wind on the quay.":home.lit?"The beacon knows the way.":"A light for everyone."}</h2><p>{needVane?"Bram holds the post while Mochi raises the brass arrow to its spindle.":home.signaled?"The signal arrow swings free above the quay. The beacon lights the way home.":home.lit?"The lens is safe in its lantern. Its light belongs to the whole harbor.":home.banked.includes("lens")?"The recovered lens fits the empty lantern. Mochi is ready to lift it into place.":"The missing lens waits in Beacon Court’s left shell. The Tidekeeper can open it."}</p>{!home.lit&&home.banked.includes("lens")&&<button className="exp-primary" onClick={()=>restore("beacon")}>Restore the beacon</button>}{home.lit&&!home.signaled&&home.banked.includes("vane")&&<button className="exp-primary" onClick={()=>restore("signal")}>Repair the signal post</button>}</>:surface==="satchel"?<><h2>What came home.</h2><p>{home.banked.length?home.banked.map(i=>i in names?names[i as keyof typeof names]:title(i)).join(" · "):"An empty satchel. There’s room for a small adventure."}</p>{recordReturns.map(record=><button key={record.id} disabled={session?.state.busy} onClick={()=>request({kind:"unpack",returnId:record.id})}>Unpack {COURTS[record.area].title} return</button>)}{earlierReturns.map(record=><details key={record.id}><summary>Earlier {COURTS[record.area].title} memory</summary><p>This return began at another saved checkpoint. Its original memory is preserved; it cannot be merged into the current harbor.</p><p className="exp-origin-metadata">{record.id}</p></details>)}{sealedNoteEnabled()&&savedMode&&session?.noteToken&&<SealedNote returns={session.state.returns} token={()=>session.noteToken!()}/>}{save.last&&<p>{save.last.outcome==="returned"?`Mochi came home after ${save.last.turn} decisions with ${save.last.resolve}/3 Resolve.`:"Bram brought Mochi home. Only the unbanked cargo was lost."}</p>}<p>{authority}. {savedMode?"Only accepted returns change the saved harbor.":"Device saves are not backed up or transferable. Signing in does not replace this preview."}</p><button onClick={()=>open("account")}>Keep this harbor on my devices</button></>:surface==="bram"?<><h2>“You’re back.”</h2><p>{lastService==="bell"?"Bram shades his eyes. Across the channel his crates are stacked high and dry.":lastService==="reed"?"Bram loops the skiff’s painter around the mooring and checks Mochi’s knot.":home.signaled?"Bram watches the arrow swing. “An easterly. I can tell before I untie a single rope.”":home.banked.includes("moth")?"The little wings sound rather like a kettle beginning to sing. Bram makes room beside the hearth.":home.lit?"Bram puts the kettle on. A harbor looks different when everyone can find it.":"Bram looks across the bay. “A lighthouse shouldn’t have to guess where it’s pointing.”"}</p>{harbor.heardBell&&<p>“There’s your bell,” Bram says. “I’ve run a pull to the far-center landing at both crossings. One good tug calls the Tidekeeper’s surge left. Choose when to use it.”</p>}{passage.watchedReeds&&passageScope===passageKey&&<p>Mochi settles beside you, one paw tucked under, just as at the reeds.</p>}{home.lit&&<button onClick={()=>open("crossings")}>Choose a harbor crossing</button>}{session?.state.workshop.commissionAvailable&&<button className="exp-primary" onClick={()=>request({kind:"commission"})}>Help Bram with the workshop salvage</button>}{recordReturns.length>0&&<button onClick={()=>open("satchel")}>Unpack the returned satchel</button>}{(waitingCraft||waitingPolish)&&<details><summary>Original job details</summary><p>Bram keeps the original job. An uncertain result never authorizes another lantern, payment or refund.</p>{session?.state.pending?<button onClick={()=>open("account")}>Open the original request</button>:<><button disabled={session?.state.busy} onClick={()=>request({kind:"check-item"})}>Ask about the original job</button><button disabled={session?.state.busy} onClick={()=>request({kind:"retry-original-item"})}>Retry the original job</button>{waitingPolish&&<button disabled={session?.state.busy} onClick={()=>request({kind:"resolve-original-polish"})}>Resolve the original polish</button>}</>}</details>}{!savedMode&&<p>The personal Shell commission belongs to an accepted saved return. This preview does not issue currency.</p>}{<SeasonBoundary><Suspense fallback={<p role="status">Bram is setting out his shelf…</p>}><SeasonBram session={session} onOpenTide={()=>open("tide")} tideScope={savedMode?session!.state.snapshot!.binding.nearAccountId:"preview"}/></Suspense></SeasonBoundary>}</>:surface==="tide"?<TideAsk today={todayView(today,tideEntries)} earlier={earlierDays(today,tideEntries)} canSail={canSailTide} onSail={sailTide} onOpenLog={openLog}/>:surface==="log"?<TideLog key={logDay??"latest"} pages={logBook} initialPage={pageForDay(logBook,logDay)} pressDay={pressDay} reduced={reduced} canSail={canSailTide} summary={tideSummary(tideEntries)} onSail={sailTide}/>:surface==="workbench"?<><h2>A little light of your own.</h2>{savedMode?<>{session?.state.workshop.creditAvailable?<><p>Choose an earned motif for one First Light lantern.</p>{session.state.workshop.motifs.map(m=><button className="exp-recipe-preview" key={m} onClick={()=>request({kind:"craft",motif:m})}><LanternArt motif={m}/><span>Make the {title(m)} lantern</span></button>)}</>:<p>{session?.state.workshop.items.length?"Your owned lantern keeps the maker’s actual accepted story.":"Bring an accepted Beacon Lens return home to earn the first craft."}</p>}{!!session?.state.workshop.items.length&&<details className="exp-gift-details"><summary>Give a lantern</summary><label>Recipient’s NEAR testnet account<input value={recipient} onChange={event=>setRecipient(event.target.value)} autoCapitalize="none" autoComplete="off" spellCheck={false}/></label><p>Gifting moves the owned item. The maker’s achievement stays with its maker. Storage, if needed, is a separate reviewed action.</p></details>}{session?.state.workshop.items.map(item=><div className="exp-owned-item" key={item.mint.token_id}><div className="exp-lantern-preview"><LanternArt motif={item.mint.motif} polished={item.finish==="harbor_polish"}/></div><p>{title(item.mint.motif)} lantern · {item.finish==="harbor_polish"?"Harbor polish":"Original finish"}</p><details className="exp-origin"><summary>Origin and maker</summary><OriginDiorama motif={item.mint.motif}/><p>Illustrated {item.mint.motif==="moth"?"wind-moth rescue":"Beacon Lens return"}, from the maker’s actual accepted event. This is not a recorded screenshot.</p><p className="exp-origin-metadata">Maker: {item.mint.maker}<br/>Accepted claim: {item.mint.origin_claim_id}<br/>Content: {item.mint.content_version}<br/>Rules: {item.mint.rules_version}</p></details><button onClick={()=>request({kind:"place",itemId:item.mint.token_id,socket:"porch"})}>Place on the porch</button><button onClick={()=>request({kind:"place",itemId:item.mint.token_id,socket:"dock"})}>Place at the dock</button>{!item.finish_used&&<button onClick={()=>request({kind:"polish",itemId:item.mint.token_id})}>Review the optional finish</button>}<button disabled={!recipient||session.state.busy} onClick={()=>request({kind:"gift",itemId:item.mint.token_id,recipient})}>Review a gift to this account</button></div>)}</>:home.lantern?<><div className="exp-lantern-preview"><LanternArt motif={home.lantern.motif}/></div><p>One {title(home.lantern.motif)} lantern. Local preview only; not backed up or transferable.</p><details className="exp-origin"><summary>Light’s origin</summary>{previewOrigin?<><OriginDiorama motif={home.lantern.motif}/><p>Mochi returned with the {home.lantern.motif==="moth"?"wind-moth":"Beacon Lens"}. {previewOrigin.commands.length} choices with the {title(previewOrigin.tool)}.</p><p>Static illustration of this device’s validated return, not a recorded screenshot or an accepted NEAR claim.</p><p className="exp-origin-metadata">Content: {previewOrigin.contentVersion} · memory {previewOrigin.id}</p></>:<p>The original return is unavailable. This device preview is not proof of an earned event.</p>}</details>{(["porch","dock"] as const).map(socket=><button key={socket} onClick={()=>{if(persist({...saveRef.current,home:{...saveRef.current.home,lantern:{...home.lantern!,socket}}})){setNotice(`The lantern lights the ${socket}.`);setSurface(null);}}}>Place at the {socket}</button>)}</>:canPreviewCrest?<><div className="exp-lantern-preview"><LanternArt motif={motif}/><span>{title(motif)} motif</span></div><p>The lens return earned a Crest. A rescued wind-moth earns its own motif.</p><fieldset><legend>Motif</legend>{(["crest","moth"] as const).map(m=><label key={m}><input type="radio" name="exp-motif" checked={motif===m} disabled={m==="moth"&&!canPreviewMoth} onChange={()=>setMotif(m)}/>{title(m)}</label>)}</fieldset><button className="exp-primary" onClick={()=>{if(persist({...saveRef.current,home:{...saveRef.current.home,lantern:{motif,socket:"porch"}}})){setNotice("A first light for the porch. Local preview only.");setSurface(null);}}}>Preview one lantern</button></>:<p>Bring the Beacon Lens home first. A lantern should remember something you actually did.</p>}</>:null}
      {session?.state.message&&<p role="status">{session.state.message}</p>}
    </section></div>}
    </>}
    {fault&&<section className="exp-fault" role="alert"><h2>The world needs a moment.</h2><p>{fault}</p><button onClick={()=>{busyRef.current=false;setBusy(false);buffer.current=null;setTransition(null);setFault("");setSceneKey(k=>k+1);if(saveRef.current.active?.state.outcome!=="active")complete();}}>Reload the scene</button></section>}
    {(hidden||unfocused)&&!surface&&!fault&&<div className="exp-paused" role="status">Mochi is waiting. Return to the game to continue.</div>}
  </main>;
}
