import type { RefObject } from "react";
import { CHAPTERS } from "../run/story";
import { scrollReadingRegion } from "./keyboard-scroll";

export type StoryMoment="introduction"|"replay"|"lens"|"vane"|"moth";
export const exchangeBeats={
  lens:["Mochi lifts the lens into place. The beacon finds the bay again.","The Tidekeeper goes still beneath the light.",...CHAPTERS.lens.after.map(line=>`Bram: “${line}”`)],
  vane:["The vane catches the breeze.",...CHAPTERS.vane.after.map(line=>`Bram: “${line}”`)],
  moth:["The little wings sound rather like a kettle beginning to sing. Bram makes room beside the hearth.",...CHAPTERS.moth.after.map(line=>`Bram: “${line}”`)],
} as const;
const headings={introduction:"Keep Wren’s Light",replay:"Keep Wren’s Light",lens:"Wren’s light",vane:"The light’s keeper",moth:"Two familiars and one light"};

export default function StoryPanel({kind,beat,progress,buttons,headingRef,onClose,onHelp,onUseButtons,onContinue}:{
  kind:StoryMoment;beat:number;progress:boolean;buttons:boolean;headingRef:RefObject<HTMLHeadingElement|null>;
  onClose:()=>void;onHelp:()=>void;onUseButtons:()=>void;onContinue:()=>void;
}){
  const introduction=kind==="introduction",replay=kind==="replay";
  const beats=!introduction&&!replay?exchangeBeats[kind]:null;
  return <>
    <header className="exp-panel-header"><h2 ref={headingRef} tabIndex={-1} id="exp-story-heading" data-prologue-heading={introduction||undefined}>{replay&&progress?"How it began":headings[kind]}</h2><button className="exp-close" aria-label="Close panel" onClick={onClose}><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="m6 6 12 12M18 6 6 18"/></svg></button></header>
    <div className="exp-panel-body exp-story-reading" tabIndex={0} role="region" aria-label={introduction?"Introduction":replay?"Introduction replay":"Harbor exchange"} onKeyDown={scrollReadingRegion}>
      {replay&&progress?<p>The storm had taken the beacon’s lens. Mochi was ready to help.</p>:introduction||replay?<>
        <p>You guide Mochi as a volunteer harbor helper.</p>
        <p>Bram: “I’m Bram. Wren’s beacon helps the boats find harbor. The storm took its lens. Mochi’s ready to fetch it. Will you guide her?”</p>
        <p>Mochi looks from the dark beacon to the water, then waits for your lead.</p>
      </>:<p key={beat}>{beats?.[beat]}</p>}
      {introduction&&buttons&&<p role="status">Button controls will be open when you sail.</p>}
    </div>
    <div className="exp-story-actions">{introduction?<>
      <p className="exp-story-objective">Bring the Beacon Lens home from the left shell.</p>
      <button className="exp-primary" onClick={onHelp}>Help Mochi</button>
      <button className="exp-secondary" onClick={onUseButtons} aria-pressed={buttons}>Use buttons</button>
      <button className="exp-text-button" onClick={onClose}>Skip introduction</button>
    </>:replay?<button className="exp-primary" onClick={onClose}>Back to Mochi</button>:<button className="exp-primary" onClick={onContinue}>{beat===(beats?.length??0)-1?"Continue with Mochi":"Continue"}</button>}</div>
  </>;
}
