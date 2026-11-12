import { useEffect, useRef, useState, type ReactNode } from "react";
import { MochiActor } from "../motion/MochiActor";
import { MOCHI_POSES } from "../motion/mochi";
import { replayOuting } from "../outing/engine";
import { previewMotifs, type LocalPreview, type MotifId, type SocketId } from "./domain";
import "./storycraft.css";

const art = "/assets/first-light-motion/";
const motifNames = { crest:"Crest", moth:"Moth" };

export function LanternArt({ motif, polished = false }: { motif:MotifId; polished?:boolean }) {
  return <span className="tb-lantern" data-motif={motif} data-polished={polished} aria-hidden="true">
    <span className="tb-lantern-handle" />
    <span className="tb-lantern-glass"><img src={`${art}lens.webp`} alt="" />
      <svg viewBox="0 0 48 48" focusable="false">
        {motif === "crest"
          ? <><path d="M4 24c7-13 13-13 20 0s13 13 20 0M4 33c7-13 13-13 20 0s13 13 20 0" /><path d="M20 14c-3-7 7-12 12-5" /></>
          : <><path d="M24 34C4 32 4 8 21 15l3 8 3-8c17-7 17 17-3 19Z" /><path d="M24 18v19M20 12l4 6 4-6" /></>}
      </svg>
    </span>
    <span className="tb-lantern-base" />
  </span>;
}

export function OriginDiorama({motif}:{motif:MotifId}) {
  return (
    <div className="tb-origin-scene" role="img" aria-label={motif === "moth" ? "Illustrated Beacon Court return with the rescued wind-moth" : "Illustrated Beacon Court return with the recovered lens"}>
      <img className="tb-origin-backdrop" src={`${art}arena.webp`} alt="" />
      <img className="tb-origin-guardian" src={`${art}tidekeeper.webp`} alt="" />
      <img className="tb-origin-find" src={`${art}${motif === "moth" ? "moth" : "lens"}.webp`} alt="" />
      <MochiActor x={50} y={87} pose={{ pose:"relieved", ...MOCHI_POSES.relieved, lift:0, rotate:0, scaleX:1, scaleY:1 }} />
    </div>
  );
}

function Origin({ preview }: { preview:LocalPreview }) {
  const motif = preview.lantern!.motif;
  const origin = preview.origins[motif]!;
  const run = replayOuting(origin.tool, origin.banked, origin.actions, origin.area)!;
  const dry = run.waves.length > 0 && !run.waves.some(w => w.hit);
  return <div className="tb-origin">
    <OriginDiorama motif={motif}/>
    <p>{motif === "moth" ? "Mochi carried the wind-moth home." : "Mochi brought the Beacon Lens home."} {run.turn} actions with the {origin.tool === "rope" ? "Rope" : "Lantern"}{dry ? "; a dry crossing." : "."}</p>
    <small>Illustrated from this device’s returned outing. Local preview; not an owned token.</small>
  </div>;
}

export function Storycraft({ preview, hasEarlierDiscoveries, temporary, onCraft, onPlace, onRecordOrigin, accountPanel }: {
  preview:LocalPreview;
  hasEarlierDiscoveries:boolean;
  temporary:boolean;
  onCraft:(motif:MotifId) => boolean;
  onPlace:(socket:SocketId) => boolean;
  onRecordOrigin:() => void;
  accountPanel?:ReactNode;
}) {
  const motifs = previewMotifs(preview);
  const [motif,setMotif] = useState<MotifId>("crest");
  const [socket,setSocket] = useState<SocketId>(preview.lantern?.socket??"porch");
  const [screen,setScreen] = useState<"craft"|"motif"|"place"|"socket"|"origin"|"help">(preview.lantern?"place":"craft");
  const [problem,setProblem] = useState(false);
  const [placed,setPlaced] = useState(false);
  const lastAction = useRef<()=>boolean>(()=>false);
  useEffect(()=>{setSocket(preview.lantern?.socket??"porch");},[preview.lantern?.socket]);
  useEffect(()=>{if(!previewMotifs(preview).includes(motif))setMotif("crest");},[preview.origins.crest,preview.origins.moth,motif]);
  function perform(action:()=>boolean) {
    lastAction.current=action;
    const ok=action();setProblem(!ok);
    if(ok){setScreen("place");setPlaced(true);}
  }
  return <section className="tb-workshop" aria-labelledby="tb-workshop-title" data-testid="storycraft" data-screen={problem?"error":screen}>
    <h2 id="tb-workshop-title">{problem?"This change isn’t saved.":screen==="origin"?"Light’s origin":screen==="socket"?"Place your lantern":screen==="motif"?"Choose a motif":"First Light lantern"}</h2>
    <p className="tb-authority">Local preview · {temporary?"this visit only":"not backed up"} · not transferable</p>
    {problem ? <>
      <p role="alert" className="of-pressure">The lantern change could not be saved. Your earlier harbor is safe. Try again, or reload to read the device save.</p>
      <button className="of-primary" onClick={()=>perform(lastAction.current)}>Try again</button><button onClick={()=>setProblem(false)}>Back to workbench</button>
    </> : screen==="help" ? <>
      <p>One returned outing gives this light its mark. The preview stays on this device. A confirmed owned lantern is a separate NEAR item.</p>
      {accountPanel}<button className="of-primary" onClick={()=>setScreen(preview.lantern?"place":"craft")}>Back to workbench</button>
    </> : screen==="origin" && preview.lantern ? <>
      <Origin preview={preview}/><button className="of-primary" onClick={()=>setScreen("place")}>Back to lantern</button>
    </> : !preview.origins.crest ? <>
      <p>Bram has a lantern frame waiting. Bring the Beacon Lens home to record its first light.</p>
      {hasEarlierDiscoveries&&<><p>Your earlier discoveries are safe. A new Beacon return can record the missing origin without resetting the harbor.</p><button className="of-primary" onClick={onRecordOrigin}>Record a Beacon memory</button></>}
      <button className="of-secondary" onClick={()=>setScreen("help")}>About Storycraft</button>
    </> : !preview.lantern && screen==="motif" ? <>
      <fieldset className="tb-motifs"><legend>Earned by a returned outing</legend>{(["crest","moth"] as const).map(choice=><label key={choice} data-locked={!motifs.includes(choice)}>
        <input type="radio" name="lantern-motif" value={choice} checked={motif===choice} disabled={!motifs.includes(choice)} onChange={()=>setMotif(choice)}/><LanternArt motif={choice}/>
        <span><b>{motifNames[choice]}</b><small>{choice==="crest"?"Etched wave glass · lens returned":motifs.includes("moth")?"Wing-shaped light · moth returned":"Bring the wind-moth home to unlock this motif"}</small></span>
      </label>)}</fieldset>
      <button className="of-primary" onClick={()=>setScreen("craft")}>Use {motifNames[motif]} motif</button>
    </> : !preview.lantern ? <>
      <p className="tb-credit">First Light craft available.</p>
      <div className="tb-storycard"><LanternArt motif={motif}/><p><b>{motifNames[motif]} motif</b><br/>{motif==="moth"?"A remembered rescue.":"Etched wave glass."}</p></div>
      <div className="of-choice-grid"><button onClick={()=>setScreen("motif")}>Choose motif</button><button onClick={()=>setScreen("help")}>About Storycraft</button></div>
      <button className="of-primary" onClick={()=>perform(()=>onCraft(motif))}>Preview lantern</button>
    </> : screen==="socket" ? <>
      <fieldset className="tb-sockets"><legend>Where should its light fall?</legend>{(["porch","dock"] as const).map(choice=><label key={choice}>
        <input type="radio" name="lantern-socket" value={choice} checked={socket===choice} onChange={()=>{setSocket(choice);setPlaced(false);}}/>
        <span><b>{choice==="porch"?"Porch":"Dock"}</b><small>{choice==="porch"?"A warm nook beside Mochi":"A light reflected on the water"}</small></span>
      </label>)}</fieldset>
      <button className="of-primary" onClick={()=>perform(()=>onPlace(socket))}>Place here</button>
      <button onClick={()=>setScreen("place")}>Back to lantern</button>
    </> : <>
      <div className="tb-storycard" data-testid="lantern-storycard"><LanternArt motif={preview.lantern.motif}/><p><b>{motifNames[preview.lantern.motif]} motif</b><br/>At the {preview.lantern.socket}. One lantern, one remembered return.</p></div>
      <p className="tb-placement-note" role="status">{placed?`Lantern placed at the ${preview.lantern.socket}.`:"The beacon stays lit wherever it lives."}</p>
      <div className="of-choice-grid"><button onClick={()=>setScreen("socket")}>Choose placement</button><button onClick={()=>setScreen("origin")}>View origin</button><button onClick={()=>setScreen("help")}>About Storycraft</button>
      {hasEarlierDiscoveries&&!preview.origins.moth&&<button onClick={onRecordOrigin}>Record a wind-moth memory</button>}</div>
    </>}
  </section>;
}
