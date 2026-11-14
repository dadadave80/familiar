import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type JSX } from "react";
import type { Area, BankedItem, Tool } from "../expedition/types";
import type { TideCard } from "./asks";
import { CARD_PICTURE, logCoverArt, logPageArt, sealArt } from "./art";
import { askLine, dayLabel } from "./cards";
import { chartFrames } from "./chart";
import type { TideEntry } from "./log";
import { pageForCard, stampSheet } from "./pages";
import TideChart from "./TideChart";
import TideStamp from "./TideStamp";
import AskIcon from "./AskIcon";
import { allKept, type DayResult } from "./run-day";
import { HaulRow, StampList } from "./RunStamps";
import "./tide.css";

export type LogPage =
  | { kind: "story"; id: string; title: string; subtitle: string; area: Area; tool: Tool; banked: readonly BankedItem[]; commands: readonly string[] }
  | { kind: "tide"; day: number; card: TideCard; entry: TideEntry }
  | { kind: "run"; day: number; card: TideCard; result: DayResult };

export default function TideLog({ pages, initialPage, reduced, sailBlockedReason, summary, onSail }: {
  pages: readonly LogPage[]; initialPage?: number; reduced: boolean; sailBlockedReason: string | null;
  summary: { sailed: number; kept: number; allThree: number }; onSail: (day: number) => void;
}): JSX.Element {
  const id = useId();
  const canSail = sailBlockedReason === null;
  const last = Math.max(0, pages.length - 1);
  const [selected, setSelected] = useState(() => Math.max(0, Math.min(last, Math.trunc(initialPage ?? 0))));
  useEffect(() => { setSelected(Math.max(0, Math.min(last, Math.trunc(initialPage ?? 0)))); }, [initialPage, last]);
  const index = Math.max(0, Math.min(last, selected));
  const page = pages[index];
  const selectedDay = page?.kind === "tide" ? page.day : undefined;
  const logRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const panel = logRef.current?.closest<HTMLElement>(".exp-panel");
    if (panel) panel.scrollTop = 0;
  }, [index]);
  const stamps = useMemo(() => stampSheet(pages.flatMap(item => item.kind === "tide" ? [item.entry] : [])), [pages]);
  const collected = stamps.filter(slot => slot.entry).length;
  const sealed = stamps.filter(slot => slot.allThree).length;
  const frames = useMemo(() => page ? page.kind === "story"
    ? chartFrames({ area: page.area, tool: page.tool, banked: page.banked }, page.commands)
    : page.kind === "tide" ? chartFrames({ area: "beacon", tool: page.entry.tool, banked: [] }, page.entry.commands) : null
    : null, [page]);
  const move = (by: number) => setSelected(Math.max(0, Math.min(last, index + by)));

  const title = page?.kind === "story" ? page.title : page?.card.name;
  const pageKey = page?.kind === "story" ? `story:${page.id}` : page?.kind === "run" ? `run:${page.day}` : `tide:${selectedDay}`;
  return <section ref={logRef} className="tide tide-log">
    <header className="tide-log-header">
      <img src={logCoverArt} width={92} height={92} alt="" decoding="async" />
      <div>
        <h3>Bram’s tide log</h3>
        {summary.sailed > 0 && <p className="tide-sub">{summary.sailed} tide{summary.sailed === 1 ? "" : "s"} sailed · {summary.kept} ask{summary.kept === 1 ? "" : "s"} kept · {summary.allThree} with all three</p>}
      </div>
    </header>
    <section className="tide-collection" aria-label="The Tidekeeper’s stamps">
      <h4>The Tidekeeper’s stamps</h4>
      <p className="tide-note">{collected} of 14 collected{sealed > 0 ? `, ${sealed} with the brass seal` : ""}</p>
      <div className="tide-stamp-sheet">
        {stamps.map(({ card, entry, allThree }) => entry
          ? <button key={card.id} type="button" aria-label={`${card.name} stamp, ${entry.kept.filter(Boolean).length} of 3 asks kept. Open its page.`} onClick={() => setSelected(pageForCard(pages, card.id))}>
            <TideStamp id={card.id} size={56} seal={allThree} />
          </button>
          : <span key={card.id} className="tide-stamp-empty"><span className="tide-sr">Not collected yet</span></span>)}
      </div>
    </section>
    {!page ? <p>The log is empty. Bring the lens home and Bram starts the first page.</p> : <>
    <div className="tide-pages" role="group" aria-label="Log pages" onKeyDown={event => {
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); }
    }}>
      <button type="button" aria-disabled={index === 0} onClick={() => move(-1)}>Earlier page</button>
      <p aria-live="polite">Page {index + 1} of {pages.length}</p>
      <button type="button" aria-disabled={index === last} onClick={() => move(1)}>Later page</button>
    </div>
    <h4>{title}</h4>
    <p className="tide-sub">{page.kind === "story" ? page.subtitle : page.kind === "run" ? `${dayLabel(page.day)} · tide run` : `${dayLabel(page.day)}${page.entry.late ? " · sailed late" : ""}`}</p>
    {page.kind === "run" ? <RunPage key={pageKey} page={page}/> : <div className={`tide-log-chart${page.kind === "tide" ? " tide-log-chart-stamped" : ""}`} style={{ "--tide-paper": `url(${logPageArt})` } as CSSProperties}>
      {frames ? <TideChart key={pageKey} frames={frames} area={page.kind === "story" ? page.area : "beacon"} reduced={reduced} label={`Chart of Mochi’s route: ${title}, ${frames.length - 1} ${frames.length === 2 ? "decision" : "decisions"}.`} />
        : <p>This page’s route could not be redrawn on this device.</p>}
      {page.kind === "tide" && <span className="tide-page-stamp">
        <TideStamp key={pageKey} id={page.card.id} size={84} tilt={5} seal={page.entry.kept.every(Boolean)} label={CARD_PICTURE[page.card.id]} />
      </span>}
    </div>}
    {page.kind === "tide" && <>
      <ol key={pageKey} className="tide-list">{page.card.asks.map((ask, i) => <li key={i} data-kept={String(page.entry.kept[i])}>
        <AskIcon ask={ask} tool={page.card.tool} size={28}/>
        <span className="tide-ask-mark" aria-hidden="true"><img src={sealArt(page.entry.kept[i] ? "kept" : "slipped")} width={24} height={24} alt="" decoding="async" /></span>
        <span>{askLine(ask, page.card.tool)}<span className="tide-sr"> ({page.entry.kept[i] ? "kept" : "slipped"})</span></span>
      </li>)}</ol>
      <dl className="tide-facts">
        <div><dt>Decisions</dt><dd>{page.entry.decisions}</dd></div>
        <div><dt>Sails</dt><dd>{page.entry.attempts}</dd></div>
        <div><dt>The Tidekeeper’s way</dt><dd>{page.card.best} {page.card.best === 1 ? "decision" : "decisions"}</dd></div>
      </dl>
      {page.entry.kept.every(Boolean) && page.entry.decisions <= page.card.best && <p className="tide-note">Mochi matched the Tidekeeper’s way.</p>}
      <button type="button" className="exp-primary" aria-disabled={!canSail} aria-describedby={!canSail ? `${id}-busy` : undefined} onClick={() => { if (canSail) onSail(page.day); }}><svg viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4 14h16l-3 6H7l-3-6Zm8-11v11M12 4l7 7h-7"/></svg>Sail this tide again</button>
      {!canSail && <p className="tide-note" id={`${id}-busy`}>{sailBlockedReason}</p>}
    </>}
    </>}
  </section>;
}

function RunPage({ page }: { page: Extract<LogPage, { kind: "run" }> }): JSX.Element {
  const { card, result } = page;
  return <>
    <div className="tide-log-chart tide-log-run" style={{ "--tide-paper": `url(${logPageArt})` } as CSSProperties}>
      <TideStamp id={card.id} size={84} tilt={5} seal={allKept(result)} label={CARD_PICTURE[card.id]} />
      <div><HaulRow result={result}/><p className="tide-note">Reed and glass go to Bram’s shelf. Pearls stay with Mochi.</p></div>
    </div>
    <dl className="tide-facts">
      <div><dt>Banked</dt><dd>{result.score}</dd></div>
      <div><dt>Bram’s guess</dt><dd>{result.guess}</dd></div>
      <div><dt>Splashes</dt><dd>{result.splashes}</dd></div>
    </dl>
    <StampList result={result}/>
  </>;
}
