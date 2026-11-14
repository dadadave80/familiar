import { useId, type JSX } from "react";
import type { TideCard } from "./asks";
import { askLine, dayLabel, TOOL_NOTE } from "./cards";
import type { TideEntry } from "./log";
import { CARD_PICTURE, keeperArt, sealArt } from "./art";
import TideStamp from "./TideStamp";
import AskIcon from "./AskIcon";
import { STAMPS, allKept, resultLine, type DayResult } from "./run-day";
import "./tide.css";

export interface TideDayView { day: number; card: TideCard; entry: TideEntry | null }
type ClassicProps = {
  today: TideDayView; earlier: readonly TideDayView[]; sailBlockedReason: string | null;
  onSail: (day: number) => void; onOpenLog: (day?: number) => void;
};
/** Today's tide on a device harbor: the day's card, Bram's guess and the tide run's three stamps. */
export type RunAskProps = {
  day: number; card: TideCard; guess: number; result: DayResult | null; sailBlockedReason: string | null;
  onSail: (day: number) => void; onOpenLog: (day?: number) => void;
};

const SAIL_ICON = <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4 14h16l-3 6H7l-3-6Zm8-11v11M12 4l7 7h-7"/></svg>;

export default function TideAsk(props: ClassicProps | RunAskProps): JSX.Element {
  return "guess" in props ? <RunAsk {...props}/> : <ClassicAsk {...props}/>;
}

function RunAsk({ day, card, guess, result, sailBlockedReason, onSail, onOpenLog }: RunAskProps): JSX.Element {
  const id = useId();
  const canSail = sailBlockedReason === null;
  return <section className="tide tide-ask" aria-labelledby={`${id}-title`}>
    <img className="tide-keeper" src={keeperArt} width="300" height="200" alt="" decoding="async" />
    <h3 id={`${id}-title`}>Today’s tide</h3>
    <p className="tide-day">{dayLabel(day)}</p>
    <div className="tide-card">
      <div className="tide-card-heading">
        <TideStamp id={card.id} size={112} tilt={-3} seal={!!result && allKept(result)} label={CARD_PICTURE[card.id]} />
        <div><h4>{card.name}</h4><p className="tide-note">Twelve waves, two lanes at a time from the seventh. Each wave leaves a prize; bank it at the dock.</p></div>
      </div>
      <p className="tide-ask-intro">The Tidekeeper asks</p>
      <ol className="tide-list">
        {STAMPS.map(stamp => <li key={stamp.key} data-kept={result ? String(result.stamps[stamp.key]) : undefined}>
          <span className="tide-ask-icon" aria-hidden="true"><img src={stamp.icon} width={32} height={32} alt="" decoding="async"/></span>
          {result && <span className="tide-ask-mark" aria-hidden="true"><img src={sealArt(result.stamps[stamp.key] ? "kept" : "slipped")} width="24" height="24" alt="" decoding="async" /></span>}
          <span>{stamp.ask(guess)}{result && <span className="tide-sr"> ({result.stamps[stamp.key] ? "kept" : "slipped"})</span>}</span>
        </li>)}
      </ol>
      <p className="tide-note">Bram plays it safe: he never ends a wave in the water. His guess is what that careful tide banks.</p>
      {result && <p className="tide-result">Today’s tide: {resultLine(result)}. Another sail is practice; the first tide each day is the one that counts.</p>}
      <button type="button" className="exp-primary" aria-disabled={!canSail} aria-describedby={!canSail ? `${id}-busy` : undefined} onClick={() => { if (canSail) onSail(day); }}>{SAIL_ICON}{result ? "Sail again for practice" : "Sail today’s tide"}</button>
      {!canSail && <p className="tide-note" id={`${id}-busy`}>{sailBlockedReason}</p>}
    </div>
    <button type="button" className="exp-text-button tide-open-log" onClick={() => onOpenLog(day)}>Open the tide log</button>
  </section>;
}

function ClassicAsk({ today, earlier, sailBlockedReason, onSail, onOpenLog }: ClassicProps): JSX.Element {
  const id = useId();
  const canSail = sailBlockedReason === null;
  const { card, entry } = today;
  const kept = entry?.kept.filter(Boolean).length ?? 0;
  return <section className="tide tide-ask" aria-labelledby={`${id}-title`}>
    <img className="tide-keeper" src={keeperArt} width="300" height="200" alt="" decoding="async" />
    <h3 id={`${id}-title`}>Today’s tide</h3>
    <p className="tide-day">{dayLabel(today.day)}</p>
    <div className="tide-card">
      <div className="tide-card-heading">
        <TideStamp id={card.id} size={112} tilt={-3} seal={kept === 3} label={CARD_PICTURE[card.id]} />
        <div><h4>{card.name}</h4><p className="tide-note">{TOOL_NOTE[card.tool]}</p></div>
      </div>
      <p className="tide-ask-intro">The Tidekeeper asks</p>
      <ol className="tide-list">
        {card.asks.map((ask, i) => <li key={i} data-kept={entry ? String(entry.kept[i]) : undefined}>
          <AskIcon ask={ask} tool={card.tool} size={32}/>
          {entry && <span className="tide-ask-mark" aria-hidden="true"><img src={sealArt(entry.kept[i] ? "kept" : "slipped")} width="24" height="24" alt="" decoding="async" /></span>}
          <span>{askLine(ask, card.tool)}{entry && <span className="tide-sr"> ({entry.kept[i] ? "kept" : "slipped"})</span>}</span>
        </li>)}
      </ol>
      {entry && <>
        <p className="tide-result">{entry.outcome === "returned"
          ? `Best so far: ${kept} of 3 asks kept in ${entry.decisions} ${entry.decisions === 1 ? "decision" : "decisions"}. The Tidekeeper knows a way in ${card.best} ${card.best === 1 ? "decision" : "decisions"}.`
          : "Bram fetched Mochi back this time. Nothing kept yet — the tide is still yours to sail."}</p>
        {entry.attempts > 1 && <p className="tide-note">{entry.attempts} sails today.</p>}
      </>}
      <button type="button" className="exp-primary" aria-disabled={!canSail} aria-describedby={!canSail ? `${id}-busy` : undefined} onClick={() => { if (canSail) onSail(today.day); }}><svg viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M4 14h16l-3 6H7l-3-6Zm8-11v11M12 4l7 7h-7"/></svg>{entry ? "Sail it again" : "Sail today’s tide"}</button>
      {!canSail && <p className="tide-note" id={`${id}-busy`}>{sailBlockedReason}</p>}
    </div>
    {earlier.length > 0 && <details className="tide-earlier">
      <summary>Earlier tides</summary>
      <ul>{earlier.map(({ day, card: past, entry: saved }) => <li key={day}>
        <TideStamp id={past.id} size={56} tilt={-2} seal={saved?.kept.every(Boolean)} />
        <div>
        <p className="tide-day">{dayLabel(day)}</p>
        <h4>{past.name}</h4>
        <p className="tide-note">{saved ? `${saved.kept.filter(Boolean).length} of 3 kept` : "Not sailed"}</p>
        <div className="tide-actions">
          <button type="button" className={!saved ? "exp-text-button" : undefined} aria-disabled={!canSail} aria-describedby={!canSail ? `${id}-busy` : undefined} onClick={() => { if (canSail) onSail(day); }}>{saved ? "Sail again" : "Sail late"}</button>
          {saved && <button type="button" className="exp-text-button" onClick={() => onOpenLog(day)}>See the page</button>}
        </div>
        </div>
      </li>)}</ul>
    </details>}
    <button type="button" className="exp-text-button tide-open-log" onClick={() => onOpenLog()}>Open the tide log</button>
  </section>;
}
