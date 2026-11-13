import { MochiActor } from "../motion/MochiActor";
import type { MotifId } from "./domain";
import "./storycraft.css";

const art = "/assets/first-light-motion/";

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
      <MochiActor />
    </div>
  );
}
