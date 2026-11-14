import type { CSSProperties, JSX } from "react";
import { sealArt } from "./art";
import { STAMPS, haulCount, haulWords, type DayResult } from "./run-day";
import "./tide.css";

const HAUL_ART = { reed: "/assets/season/reed.webp", glass: "/assets/season/glass.webp", pearl: "/assets/run/pearl.webp" } as const;

/** The day's haul as painted prizes with counts, read as one sentence. Renders nothing for an empty haul. */
export function HaulRow({ result }: { result: Pick<DayResult, "banked"> }): JSX.Element | null {
  const count = haulCount(result);
  const shown = (["reed", "glass", "pearl"] as const).filter(prize => count[prize] > 0);
  if (!shown.length) return null;
  return <p className="tide-haul"><span className="tide-sr">Haul: {haulWords(result)}.</span>
    {shown.map(prize => <span key={prize} aria-hidden="true"><img src={HAUL_ART[prize]} width={24} height={24} alt="" decoding="async"/>×{count[prize]}</span>)}
  </p>;
}

/** The three stamps of a finished tide run, with their kept or slipped marks. */
export function StampList({ result, arrival = false }: { result: DayResult; arrival?: boolean }): JSX.Element {
  return <ol className="tide-list" data-arrival={arrival || undefined}>{STAMPS.map((stamp, i) => <li key={stamp.key} data-kept={String(result.stamps[stamp.key])}>
    <span className="tide-ask-icon" aria-hidden="true"><img src={stamp.icon} width={28} height={28} alt="" decoding="async"/></span>
    <span className="tide-ask-mark" aria-hidden="true" style={arrival ? { "--ask-delay": `${360 + i * 120}ms` } as CSSProperties : undefined}><img src={sealArt(result.stamps[stamp.key] ? "kept" : "slipped")} width={24} height={24} alt="" decoding="async"/></span>
    <span>{stamp.label(result)}<span className="tide-sr"> ({result.stamps[stamp.key] ? "kept" : "slipped"})</span></span>
  </li>)}</ol>;
}
