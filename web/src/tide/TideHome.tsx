import { useId, type CSSProperties, type JSX } from "react";
import { cardStatus, type Run, type TideCard } from "./asks";
import { askLine } from "./cards";
import { CARD_PICTURE, sealArt } from "./art";
import { homeResult } from "./pages";
import TideStamp from "./TideStamp";
import { allKept, resultLine, resultTitle, type DayResult } from "./run-day";
import { HaulRow, StampList } from "./RunStamps";
import "./tide.css";

type Shared = { card: TideCard; canShelve: boolean; reduced: boolean; notice: string; sailBlockedReason: string | null;
  onBram: () => void; onSail: () => void; onOpenLog: () => void };
type ClassicProps = Shared & { run: Run };
/** The Home sheet after a daily tide run. */
export type RunHomeProps = Shared & { result: DayResult };

const BAG = "M6 8h12l2 12H4L6 8Zm3 0V5a3 3 0 0 1 6 0v3", SAIL = "M4 14h16l-3 6H7l-3-6Zm8-11v11M12 4l7 7h-7";
export default function TideHome(props: ClassicProps | RunHomeProps): JSX.Element {
  return "result" in props ? <RunHome {...props}/> : <ClassicHome {...props}/>;
}

function RunHome({ card, result, canShelve, reduced, notice, sailBlockedReason, onBram, onSail, onOpenLog }: RunHomeProps): JSX.Element {
  const id = useId(), kept = allKept(result);
  const blocked = !canShelve && sailBlockedReason !== null;
  return <section className="tide tide-home" data-reduced={reduced || undefined} aria-labelledby={`${id}-title`}>
    <div className="tide-home-keeps">
    <div className="tide-home-stamp"><TideStamp id={card.id} size={112} tilt={-3} seal={kept} label={CARD_PICTURE[card.id]} press={!reduced}/></div>
    <StampList result={result} arrival/>
    </div>
    <div className="tide-home-result">
    <div className="tide-home-heading">
      {kept && <img className="tide-home-portrait" src="/assets/ui/mochi-portrait-proud.webp" width={72} height={72} alt="" decoding="async"/>}
      <h2 id={`${id}-title`}>{resultTitle(result)}</h2>
    </div>
    <p className="tide-home-sub">{resultLine(result)}</p>
    <HaulRow result={result}/>
    {notice && <p className="tide-home-note">{notice}</p>}
    <button type="button" className="exp-primary" aria-disabled={blocked} aria-describedby={blocked ? `${id}-busy` : undefined} onClick={() => { if (!blocked) (canShelve ? onBram : onSail)(); }}>
      <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={canShelve ? BAG : SAIL}/></svg>
      {canShelve ? "Take it to Bram" : "Sail again for practice"}
    </button>
    {blocked && <p className="tide-note" id={`${id}-busy`}>{sailBlockedReason}</p>}
    <button type="button" className="exp-secondary" onClick={onOpenLog}>
      <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/></svg>
      See the tide log
    </button>
    </div>
  </section>;
}

function ClassicHome({ card, run, canShelve, reduced, notice, sailBlockedReason, onBram, onSail, onOpenLog }: ClassicProps): JSX.Element {
  const id = useId(), result = homeResult(run, card), statuses = cardStatus(card, run);
  const allKept = statuses.every(status => status === "kept");
  const blocked = !canShelve && sailBlockedReason !== null;
  return <section className="tide tide-home" data-reduced={reduced || undefined} aria-labelledby={`${id}-title`}>
    <div className="tide-home-keeps">
    <div className="tide-home-stamp"><TideStamp id={card.id} size={112} tilt={-3} seal={allKept} label={CARD_PICTURE[card.id]} press={!reduced}/></div>
    <ol className="tide-list" data-arrival="true">{card.asks.map((ask, i) => <li key={i} data-kept={String(statuses[i] === "kept")}>
      <span className="tide-ask-mark" aria-hidden="true" style={{ "--ask-delay": `${360 + i * 120}ms` } as CSSProperties}><img src={sealArt(statuses[i] === "kept" ? "kept" : "slipped")} width={24} height={24} alt="" decoding="async"/></span>
      <span>{askLine(ask, card.tool)}<span className="tide-sr"> ({statuses[i] === "kept" ? "kept" : "slipped"})</span></span>
    </li>)}</ol>
    </div>
    <div className="tide-home-result">
    <div className="tide-home-heading">
      {allKept && <img className="tide-home-portrait" src="/assets/ui/mochi-portrait-proud.webp" width={72} height={72} alt="" decoding="async"/>}
      <h2 id={`${id}-title`}>{result.title}</h2>
    </div>
    <p className="tide-home-sub">{result.body}</p>
    {notice && <p className="tide-home-note">{notice}</p>}
    <button type="button" className="exp-primary" aria-disabled={blocked} aria-describedby={blocked ? `${id}-busy` : undefined} onClick={() => { if (!blocked) (canShelve ? onBram : onSail)(); }}>
      <svg viewBox="0 0 24 24" width={20} height={20} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d={canShelve ? "M6 8h12l2 12H4L6 8Zm3 0V5a3 3 0 0 1 6 0v3" : "M4 14h16l-3 6H7l-3-6Zm8-11v11M12 4l7 7h-7"}/></svg>
      {canShelve ? "Take it to Bram" : "Sail again"}
    </button>
    {blocked && <p className="tide-note" id={`${id}-busy`}>{sailBlockedReason}</p>}
    <button type="button" className="exp-secondary" onClick={onOpenLog}>
      <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5"/></svg>
      See the tide log
    </button>
    </div>
  </section>;
}
