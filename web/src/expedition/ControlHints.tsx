import { useEffect, useRef, useState, type ReactNode } from "react";
import { scrollReadingRegion } from "./keyboard-scroll";

type InputMode = "touch" | "keyboard";

export default function ControlHints({id,context="Tap Wait beside Mochi · tap a find to collect it.",children,reading,initialMode,keyboardContext="Space waits · E interacts · R returns at the dock · I inspects"}:{
  id:string; context?:string; children:ReactNode; reading?:ReactNode; initialMode?:InputMode; keyboardContext?:string;
}) {
  const root=useRef<HTMLDivElement>(null);
  const readingArea=useRef<HTMLDivElement>(null);
  const [moreReading,setMoreReading]=useState(false);
  const [mode,setMode]=useState<InputMode>(()=>initialMode??(typeof matchMedia!=="undefined"&&matchMedia("(any-pointer: coarse)").matches?"touch":"keyboard"));
  useEffect(()=>{
    const game=root.current?.closest(".exp-game");
    if(!game)return;
    let frame=0;
    const pointer=(event:Event)=>{const input=event as PointerEvent;cancelAnimationFrame(frame);
      // Let Phaser finish the release before new hint text can move its targets.
      frame=requestAnimationFrame(()=>setMode(input.pointerType==="touch"||input.pointerType==="pen"?"touch":"keyboard"));};
    const keyboard=(event:Event)=>{const key=event as KeyboardEvent;if(!key.isComposing&&!key.metaKey&&!key.altKey&&!key.ctrlKey){cancelAnimationFrame(frame);setMode("keyboard");}};
    game.addEventListener("pointerup",pointer,true);game.addEventListener("keydown",keyboard,true);
    return()=>{cancelAnimationFrame(frame);game.removeEventListener("pointerup",pointer,true);game.removeEventListener("keydown",keyboard,true);};
  },[]);
  useEffect(()=>{
    const area=readingArea.current;
    if(!area)return;
    const update=()=>setMoreReading(area.scrollTop+area.clientHeight<area.scrollHeight-1);
    const observer=new ResizeObserver(update);
    observer.observe(area);for(const child of area.children)observer.observe(child);
    area.addEventListener("scroll",update,{passive:true});update();
    return()=>{observer.disconnect();area.removeEventListener("scroll",update);};
  },[reading,mode]);
  const help=<div id={id} className="exp-input-help">
      <p className="exp-input-primary">{mode==="touch"?"Swipe to move · tap a glowing stone":"WASD or arrow keys to move"}</p>
      <p className="exp-input-context">{mode==="touch"?context:keyboardContext}</p>
    </div>;
  return <div ref={root} className="exp-control-hints" data-input={mode}>
    {reading?<div ref={readingArea} className="exp-input-reading" tabIndex={0} role="region" aria-label="Outing guidance" onKeyDown={scrollReadingRegion}>{reading}{help}</div>:help}
    <details className="exp-button-controls"><summary>Button controls</summary><div className="exp-button-controls-body">{children}</div></details>
    {moreReading&&<button className="exp-input-more" aria-label="Read more outing guidance" onClick={()=>{const area=readingArea.current;if(area){area.focus({preventScroll:true});area.scrollBy({top:Math.max(44,area.clientHeight*.75),behavior:"instant"});}}}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 8 7 7 7-7"/></svg></button>}
  </div>;
}
