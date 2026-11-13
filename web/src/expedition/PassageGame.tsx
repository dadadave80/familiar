import { useEffect, useMemo, useRef, useState } from "react";
import World from "./World";
import { commandName, forecast } from "./Inspect";
import { phaseOf } from "./engine";
import { commandAt } from "./input";
import { applyPassage, canWatchMoth, PASSAGE_LANDINGS, passageCommands, passageDelivered, type PassageCommand, type PassageJob, type PassageState, type PassageTransition } from "./passage";
import type { HarborAudio } from "./audio";
import type { WorldSnapshot } from "./scene";
import { TURN_LIMIT, type CourtEvent, type CourtTransition, type Direction, type Position } from "./types";
import "./passage-game.css";

interface Props {
  job:PassageJob; initial:PassageState; mothHome:boolean; reduced:boolean; sound:boolean; audio:HarborAudio|null;
  onSave:(next:PassageState)=>boolean; onFinish:(state:PassageState)=>void; onLeave:()=>void; onToggleSound:()=>void; blocked:boolean;
}
const places={bell:"Bell Steps",reed:"Reed Steps"};
const channels=["Left","Center","Right"];
const rows=["dock bank","near landing","crossing","far landing","far shore"];
const directions:readonly Direction[]=["north","west","east","south"];
const arrows={north:"↑",west:"←",east:"→",south:"↓"};
const home:WorldSnapshot["home"]={lit:true,signaled:false,moth:false,lantern:false,socket:"dock",motif:"crest",polished:false,relic:null};
const at=(a:Position,b:Position)=>a.x===b.x&&a.y===b.y;
const where=(p:Position)=>`${channels[p.x]} ${rows[p.y]}`;
const name=(command:PassageCommand)=>command==="ride"?"Ride line":commandName(command);
const done=(s:PassageState)=>s.court.outcome!=="active";

function objective(state:PassageState):string {
  if(state.stage==="delivered")return "Return to the center dock.";
  if(state.job==="bell")return state.stage==="waiting"?"Meet Bram’s supplies at the near-left landing.":"Guide the load to the far-left landing.";
  return state.stage==="waiting"?"Find the empty skiff at the far-right landing.":"Guide the skiff to the near-right landing.";
}
function consequence({before,after,events}:PassageTransition):string {
  if(after.court.outcome==="rescued")return "Bram brings Mochi home. The crossing can be tried again.";
  if(after.court.outcome==="returned")return passageDelivered(after)?"Mochi is safely back. Bring the crossing home.":"Mochi came home safely. The job can wait.";
  const facts:string[]=[];
  if(after.watched&&!before.watched)facts.push("Mochi lowers a paw. The moth settles among the reeds.");
  if(before.stage!==after.stage)facts.push(after.stage==="dispatched"
    ?(after.job==="bell"?"Bram has the load ready.":"The skiff is ready to come home.")
    :(after.job==="bell"?"The supplies reach the far worksite.":"The skiff reaches its near mooring."));
  const wave=events.find(e=>e.kind==="wave"),mark=events.find(e=>e.kind==="telegraph");
  if(wave)facts.push(`${channels[wave.exit]} surge. Bridge ${channels[after.court.bridge]!.toLowerCase()}. ${after.court.resolve<before.court.resolve?"Mochi is splashed.":"Mochi stays dry."}`);
  else if(mark)facts.push(`${channels[mark.column]} is marked for the next surge.`);
  else if(!facts.length)facts.push("Next, the rising tide marks Mochi’s column.");
  return facts.join(" ");
}

export default function PassageGame({job,initial,mothHome,reduced,sound,audio,onSave,onFinish,onLeave,onToggleSound,blocked}:Props){
  const [state,setState]=useState(initial),[result,setResult]=useState<PassageTransition|null>(null);
  const current=useRef(initial),pending=useRef<PassageTransition|null>(null),serial=useRef(0);
  const [ready,setReady]=useState(false),[fault,setFault]=useState(""),[sceneKey,setSceneKey]=useState(0);
  const [away,setAway]=useState(document.hidden),[notice,setNotice]=useState(""),[retry,setRetry]=useState<PassageCommand|null>(null);
  const [panel,setPanel]=useState<"inspect"|"leave"|null>(null),[choice,setChoice]=useState<PassageCommand|null>(null);
  const [spot,setSpot]=useState<Position|null>(null),[hover,setHover]=useState<PassageCommand|null>(null);
  const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLButtonElement|null>(null);
  const inspectButton=useRef<HTMLButtonElement>(null),harborButton=useRef<HTMLButtonElement>(null);
  const busy=!!result,terminal=done(state),paused=away||blocked||!!panel||!!fault;
  const legal=passageCommands(state),landings=PASSAGE_LANDINGS[job];
  const turn=state.court.turn,phase=phaseOf(state.court),watch=canWatchMoth(state);
  const ride=result?.after.commands.at(-1)==="ride";
  const passage=useMemo(()=>({job,stage:state.stage,watched:state.watched,mothHome,rode:ride}),[job,state.stage,state.watched,mothHome,ride]);
  const snapshot=useMemo<WorldSnapshot>(()=>({court:state.court,home,reducedMotion:reduced,previewCommand:hover==="ride"?null:hover,passage}),[state.court,reduced,hover,passage]);
  const animation=useMemo<CourtTransition|null>(()=>result?{before:result.before.court,after:result.after.court,events:result.events}:null,[result]);
  const inspection=choice?applyPassage(state,choice):null;

  useEffect(()=>{
    const hide=()=>setAway(true),show=()=>setAway(document.hidden);
    document.addEventListener("visibilitychange",show);window.addEventListener("blur",hide);window.addEventListener("focus",show);
    return ()=>{document.removeEventListener("visibilitychange",show);window.removeEventListener("blur",hide);window.removeEventListener("focus",show);};
  },[]);
  useEffect(()=>{
    if(!panel){opener.current?.focus({preventScroll:true});opener.current=null;return;}
    const element=dialog.current;
    element?.showModal();
    return ()=>element?.close();
  },[panel]);

  function take(command:PassageCommand){
    if(!ready||paused||pending.current||done(current.current)||document.hidden)return;
    const next=applyPassage(current.current,command);
    if(!next)return;
    if(!onSave(next.after)){
      setRetry(command);setNotice("This move could not be saved. Try it again when this browser can save.");return;
    }
    current.current=next.after;pending.current=next;serial.current++;
    setRetry(null);setHover(null);setNotice("");setResult(next);setState(next.after);
  }
  function beat(event:CourtEvent){
    const accepted=pending.current;
    if(!accepted||!sound||away||document.hidden)return;
    if(event.kind==="move"&&accepted.after.commands.at(-1)==="ride")audio?.playPassage("ride");
    else audio?.play(event);
  }
  function settle(id:number){
    const accepted=pending.current;
    if(id!==serial.current||!accepted)return;
    if(sound&&!away&&!document.hidden&&accepted.after.watched&&!accepted.before.watched)audio?.playPassage("watch");
    setNotice(consequence(accepted));pending.current=null;setResult(null);
  }
  function inspect(position:Position|null=null){
    if(!ready||paused||pending.current||done(current.current))return;
    opener.current=inspectButton.current;
    setChoice(null);setSpot(position);setPanel("inspect");
  }
  function target(position:Position){
    const court=current.current.court,cmd=commandAt(court,position);
    const options=passageCommands(current.current);
    if(cmd&&options.includes(cmd))take(cmd);
    else if(options.includes("ride")&&at(position,landings.arrival))take("ride");
    else inspect(position);
  }
  function leave(){
    if(blocked)return;
    if(done(current.current)){onFinish(current.current);return;}
    if(!current.current.commands.length){onLeave();return;}
    opener.current=harborButton.current;
    setPanel("leave");
  }
  useEffect(()=>{
    function keys(event:KeyboardEvent){
      if(event.isComposing||event.repeat||event.metaKey||event.ctrlKey||event.altKey||event.shiftKey||panel||
          (event.target instanceof Element&&event.target.closest('input,textarea,select,[contenteditable=true],dialog')))return;
      const key=event.key.toLowerCase();
      if(key===" "&&event.target instanceof Element&&event.target.closest("button,a"))return;
      const commands:Record<string,PassageCommand>={arrowup:"step:north",w:"step:north",arrowdown:"step:south",s:"step:south",arrowleft:"step:west",a:"step:west",arrowright:"step:east",d:"step:east"," ":"wait",e:"ride",r:"return"};
      const cmd=commands[key];if(!cmd&&key!=="i")return;
      event.preventDefault();
      if(cmd)take(cmd);else inspect();
    }
    window.addEventListener("keydown",keys);return ()=>window.removeEventListener("keydown",keys);
  });
  const localForecast=hover==="ride"?"Ride to the opposite landing and stay dry through this surge.":forecast(state.court,hover);
  const placeHint=spot&&at(spot,landings.departure)?"Bram starts this trip here.":spot&&at(spot,landings.arrival)?"This is where Bram’s trip ends.":null;
  const finishText=state.court.outcome==="rescued"?"Bram has Mochi safe.":passageDelivered(state)?job==="bell"?"The supplies reached the worksite.":"Bram’s skiff is home.":"A safe return.";
  return <main className="exp-game passage-game" data-mode="court" data-testid="passage-game" data-job={job} data-stage={state.stage} data-turn={turn} data-outcome={state.court.outcome} data-busy={busy} data-watched={state.watched}>
    <World key={sceneKey} snapshot={snapshot} transition={animation} presentationId={serial.current} paused={paused}
      onReady={()=>setReady(true)} onFault={message=>{setFault(message);setReady(false);pending.current=null;setResult(null);}}
      onBeat={beat} onSettled={settle} onCommand={take} onTarget={target} onInspect={inspect} onHome={()=>{}}
      onHover={pos=>{if(!busy&&!panel){const cmd=pos?commandAt(state.court,pos):null;setHover(cmd&&legal.includes(cmd)?cmd:null);}}}/>
    <header className="exp-mast"><div className="exp-brand">familiar.<small>Saved on this device</small></div><h1 className="exp-place">{places[job]}</h1>
      <div className="passage-header-actions"><button aria-pressed={sound} aria-label={sound?"Mute game audio":"Enable game audio"} onClick={onToggleSound}>{sound?"Sound on":"Sound off"}</button><button ref={harborButton} className="passage-leave" data-testid="passage-leave" onClick={leave} disabled={blocked||busy}>Harbor</button></div></header>
    <section className="exp-hud" aria-label="Passage status"><strong>{phase} tide</strong><span>Turn {Math.min(turn+1,TURN_LIMIT)}/{TURN_LIMIT}</span><span>Resolve {state.court.resolve}/3</span></section>
    {fault?<section className="exp-fault" role="alert"><p>{fault}</p><button onClick={()=>{setFault("");setSceneKey(key=>key+1);}}>Reopen the court</button></section>
      :(!ready&&!terminal)?<section className="exp-paused" role="status">Opening {places[job]}…</section>:null}
    {blocked?<p className="exp-paused" role="status">This passage is paused while another view holds the harbor.</p>:away&&!panel?<p className="exp-paused">Mochi is waiting. Return to this window to continue.</p>:null}
    {terminal&&!busy?<section className="exp-departure passage-finish" aria-label="Passage return">
      <h2>{finishText}</h2><p>{passageDelivered(state)?"Bring word of the crossing back to Bram.":"The landing is ready for another trip."}</p>
      <button className="exp-primary" data-testid="passage-finish" disabled={blocked} onClick={()=>onFinish(current.current)}>Back to the harbor</button>
    </section>:<section className="exp-command-tray passage-tray" aria-label="Guide Mochi">
      <div className="exp-objective-row"><p className="exp-objective">{objective(state)}</p><button ref={inspectButton} className="exp-inspect-button" data-testid="passage-inspect" disabled={!ready||paused||busy} onClick={()=>inspect()}>Inspect</button></div>
      <p className="exp-forecast">{watch?"Mochi faces the moth in the still reeds. Wait to watch together.":legal.includes("ride")&&!hover?"The skiff line is taut. Ride this surge, or guide from shore.":localForecast}</p>
      <span className="exp-sr-only">Mochi is at the {where(state.court.position)}. The bridge is at {channels[state.court.bridge]}.</span>
      <div className="exp-current-controls"><div className="exp-directions" aria-label="Movement">
        {directions.map(dir=>{const cmd=`step:${dir}` as const;return <button key={dir} className={`exp-${dir}`} data-command={cmd} aria-label={`Move ${dir}`} disabled={!ready||paused||busy||!legal.includes(cmd)} onMouseEnter={()=>setHover(cmd)} onMouseLeave={()=>setHover(null)} onFocus={()=>setHover(cmd)} onBlur={()=>setHover(null)} onClick={()=>take(cmd)}>{arrows[dir]}</button>;})}
        <button className="exp-wait" data-command="wait" aria-label={watch?"Wait and watch the moth":"Wait for the tide"} disabled={!ready||busy||paused} onClick={()=>take("wait")}>Wait</button>
      </div><div className="exp-context-actions">
        {legal.includes("ride")&&<button className="exp-primary" data-command="ride" disabled={!ready||paused||busy} onClick={()=>take("ride")}>Ride line</button>}
        {legal.includes("return")&&<button data-command="return" disabled={!ready||paused||busy} onClick={()=>take("return")}>Return to harbor</button>}
        {retry&&<button disabled={!ready||paused||busy} onClick={()=>take(retry)}>Retry {name(retry).toLowerCase()}</button>}
      </div></div>
    </section>}
    <div className="exp-feedback passage-feedback" data-testid="passage-feedback" role="status" aria-live="polite">{notice}</div>
    {panel&&<dialog ref={dialog} className="exp-panel passage-panel" aria-labelledby="passage-dialog-title" onCancel={event=>{event.preventDefault();setPanel(null);}}>
      <button className="exp-close" autoFocus aria-label="Close panel" onClick={()=>setPanel(null)}>×</button>
      {panel==="leave"?<><h2 id="passage-dialog-title">Leave this outing?</h2><p>Bram will keep the fitting. Leaving now discards this attempt. You can also guide Mochi back to the center dock.</p>
        <button className="exp-primary" onClick={()=>setPanel(null)}>Keep playing</button><button disabled={blocked} onClick={onLeave}>Leave this attempt</button></>:<>
        <h2 id="passage-dialog-title">Read the crossing</h2>
        <p>{job==="bell"?"Bram’s supplies leave the near-left bell for the worksite on the far-left landing.":"The empty skiff waits by the far-right reeds. Bring it to the near-right mooring."}</p>
        <p>Visit both landings in order to guide from shore. At the starting landing, a surge in its column lets you ride the line across. Return to the center dock to finish.</p>
        <dl className="exp-inspect-position"><div><dt>Mochi</dt><dd>{where(state.court.position)}</dd></div><div><dt>Bridge</dt><dd>{channels[state.court.bridge]} crossing</dd></div></dl>
        {spot&&<p><strong>{where(spot)}.</strong> {placeHint??(spot.y===2?"A surge in this column draws the bridge here.":"A stone foothold.")}</p>}
        {job==="reed"&&<p>{mothHome?"Mochi’s moth is already home. Only the bent reeds stir here.":state.watched?"You saw the moth settle here together.":watch?"Mochi faces the moth to your right. Waiting here lets it settle.":state.court.opened.includes(2)?"The moth is out beside the reeds. It settles at rising tide if you wait with Mochi at the center of the far shore.":"Bent reeds shelter the far-right shore. A right surge opens the shell there."}</p>}
        <fieldset className="exp-inspect-actions"><legend>Compare a move · no turns spent</legend><div>{legal.map(cmd=><button key={cmd} data-preview-command={cmd} aria-pressed={choice===cmd} onClick={()=>setChoice(cmd)}>{name(cmd)}</button>)}</div></fieldset>
        <div className="exp-inspect-reading" role="status"><p>{inspection?`${consequence(inspection)} ${done(inspection.after)?"":`Mochi ends at the ${where(inspection.after.court.position)}.`}`:forecast(state.court,null)}</p></div>
      </>}
    </dialog>}
  </main>;
}
