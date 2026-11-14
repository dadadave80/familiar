import { useId, type JSX } from "react";
import type { TideCard } from "./asks";
import { askLine, dayLabel, TOOL_NOTE } from "./cards";
import type { TideEntry } from "./log";
import { CARD_PICTURE, keeperArt, sealArt } from "./art";
import TideStamp from "./TideStamp";
import "./tide.css";

export interface TideDayView { day: number; card: TideCard; entry: TideEntry | null }

export default function TideAsk({ today, earlier, canSail, onSail, onOpenLog }: {
  today: TideDayView; earlier: readonly TideDayView[]; canSail: boolean;
  onSail: (day: number) => void; onOpenLog: (day?: number) => void;
}): JSX.Element {
  const id = useId();
  const { card, entry } = today;
  const kept = entry?.kept.filter(Boolean).length ?? 0;
  return <section className="tide" aria-labelledby={`${id}-title`}>
    <img className="tide-keeper" src={keeperArt} width="300" height="200" alt="" decoding="async" />
    <h3 id={`${id}-title`}>Today’s tide</h3>
    <p className="tide-day">{dayLabel(today.day)}</p>
    <div className="tide-card">
      <div className="tide-card-heading">
        <TideStamp id={card.id} size={112} tilt={-3} seal={kept === 3} label={CARD_PICTURE[card.id]} />
        <div><h4>{card.name}</h4><p className="tide-note">{TOOL_NOTE[card.tool]}</p></div>
      </div>
      <p className="tide-kicker">The Tidekeeper asks</p>
      <ol className="tide-list">
        {card.asks.map((ask, i) => <li key={i} data-kept={entry ? String(entry.kept[i]) : undefined}>
          <span className="tide-ask-mark" aria-hidden="true">{entry ? <img src={sealArt(entry.kept[i] ? "kept" : "slipped")} width="24" height="24" alt="" decoding="async" /> : i + 1}</span>
          <span>{askLine(ask, card.tool)}{entry && <span className="tide-sr"> ({entry.kept[i] ? "kept" : "slipped"})</span>}</span>
        </li>)}
      </ol>
      {entry && <>
        <p className="tide-result">{entry.outcome === "returned"
          ? `Best so far: ${kept} of 3 asks kept in ${entry.decisions} ${entry.decisions === 1 ? "decision" : "decisions"}. The Tidekeeper knows a way in ${card.best} ${card.best === 1 ? "decision" : "decisions"}.`
          : "Bram fetched Mochi back this time. Nothing kept yet — the tide is still yours to sail."}</p>
        {entry.attempts > 1 && <p className="tide-note">{entry.attempts} sails today.</p>}
      </>}
      <button type="button" className="exp-primary" aria-disabled={!canSail} aria-describedby={!canSail ? `${id}-busy` : undefined} onClick={() => { if (canSail) onSail(today.day); }}>{entry ? "Sail it again" : "Sail today’s tide"}</button>
      {!canSail && <p className="tide-note" id={`${id}-busy`}>Finish the outing in progress first.</p>}
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
