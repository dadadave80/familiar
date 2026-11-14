import { useEffect, useRef, useState, type ReactNode } from "react";

type InputMode = "touch" | "keyboard";

export default function ControlHints({id,context="Tap Wait beside Mochi · tap a find to collect it.",children,initialMode,keyboardContext="Space waits · E interacts · R returns at the dock · I inspects"}:{
  id:string; context?:string; children:ReactNode; initialMode?:InputMode; keyboardContext?:string;
}) {
  const root=useRef<HTMLDivElement>(null);
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
  return <div ref={root} className="exp-control-hints" data-input={mode}>
    <div id={id} className="exp-input-help">
      <p className="exp-input-primary">{mode==="touch"?"Swipe to move · tap a glowing stone":"WASD or arrow keys to move"}</p>
      <p className="exp-input-context">{mode==="touch"?context:keyboardContext}</p>
    </div>
    <details className="exp-button-controls"><summary>Button controls</summary><div className="exp-button-controls-body">{children}</div></details>
  </div>;
}
