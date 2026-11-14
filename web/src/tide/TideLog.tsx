import { useEffect, useMemo, useState, type JSX } from "react";
import type { Area, BankedItem, Tool } from "../expedition/types";
import type { TideCard } from "./asks";
import { askLine, dayLabel } from "./cards";
import { chartFrames } from "./chart";
import type { TideEntry } from "./log";
import TideChart from "./TideChart";
import "./tide.css";

export type LogPage =
  | { kind: "story"; id: string; title: string; subtitle: string; area: Area; tool: Tool; banked: readonly BankedItem[]; commands: readonly string[] }
  | { kind: "tide"; day: number; card: TideCard; entry: TideEntry };

export default function TideLog({ pages, initialPage, reduced, canSail, summary, onSail }: {
  pages: readonly LogPage[]; initialPage?: number; reduced: boolean; canSail: boolean;
  summary: { sailed: number; kept: number; allThree: number }; onSail: (day: number) => void;
}): JSX.Element {
  const last = Math.max(0, pages.length - 1);
  const [selected, setSelected] = useState(() => Math.max(0, Math.min(last, Math.trunc(initialPage ?? 0))));
  useEffect(() => { setSelected(Math.max(0, Math.min(last, Math.trunc(initialPage ?? 0)))); }, [initialPage, last]);
  const index = Math.max(0, Math.min(last, selected));
  const page = pages[index];
  const frames = useMemo(() => page ? page.kind === "story"
    ? chartFrames({ area: page.area, tool: page.tool, banked: page.banked }, page.commands)
    : chartFrames({ area: "beacon", tool: page.entry.tool, banked: [] }, page.entry.commands)
    : null, [page]);
  const move = (by: number) => setSelected(Math.max(0, Math.min(last, index + by)));

  if (!page) return <section className="tide tide-log"><h3>Bram’s tide log</h3><p>The log is empty. Bring the lens home and Bram starts the first page.</p></section>;
  const title = page.kind === "story" ? page.title : page.card.name;
  const pageKey = page.kind === "story" ? `story:${page.id}` : `tide:${page.day}`;
  return <section className="tide tide-log">
    <h3>Bram’s tide log</h3>
    {summary.sailed > 0 && <p className="tide-sub">{summary.sailed} tide{summary.sailed === 1 ? "" : "s"} sailed · {summary.kept} asks kept · {summary.allThree} with all three</p>}
    <div className="tide-pages" role="group" aria-label="Log pages" onKeyDown={event => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); }
    }}>
      <button type="button" aria-disabled={index === 0} onClick={() => move(-1)}>Earlier page</button>
      <p aria-live="polite">Page {index + 1} of {pages.length}</p>
      <button type="button" aria-disabled={index === last} onClick={() => move(1)}>Later page</button>
    </div>
    <h4>{title}</h4>
    <p className="tide-sub">{page.kind === "story" ? page.subtitle : `${dayLabel(page.day)}${page.entry.late ? " · sailed late" : ""}`}</p>
    {frames ? <TideChart key={pageKey} frames={frames} area={page.kind === "story" ? page.area : "beacon"} reduced={reduced} label={`Chart of Mochi’s route: ${title}, ${frames.length - 1} decisions.`} />
      : <p>This page’s route could not be redrawn on this device.</p>}
    {page.kind === "tide" && <>
      <ol className="tide-list">{page.card.asks.map((ask, i) => <li key={i} data-kept={String(page.entry.kept[i])}>
        <span className="tide-ask-mark" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d={page.entry.kept[i] ? "M2 6L5 9L10 3" : "M3 6H9"} /></svg></span>
        <span>{askLine(ask, page.card.tool)}<span className="tide-sr"> ({page.entry.kept[i] ? "kept" : "slipped"})</span></span>
      </li>)}</ol>
      <dl className="tide-facts">
        <div><dt>Decisions</dt><dd>{page.entry.decisions}</dd></div>
        <div><dt>Sails</dt><dd>{page.entry.attempts}</dd></div>
        <div><dt>The Tidekeeper’s way</dt><dd>{page.card.best}</dd></div>
      </dl>
      <button type="button" className="exp-primary" aria-disabled={!canSail} onClick={() => { if (canSail) onSail(page.day); }}>Sail this tide again</button>
      {!canSail && <p className="tide-note">Finish the outing in progress first.</p>}
    </>}
  </section>;
}
