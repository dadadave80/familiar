import type { JSX } from "react";
import { askHolds, cardStatus, type Run, type TideCard } from "./asks";
import { sealArt } from "./art";
import { askChip } from "./cards";
import AskIcon from "./AskIcon";
import "./tide.css";

export default function TideHud({ card, run }: { card: TideCard; run: Run; reduced: boolean }): JSX.Element {
  const statuses = cardStatus(card, run);
  const holding = card.asks.map(ask => askHolds(ask, run));
  return <ul className="tide-asks" aria-label="The Tidekeeper’s asks" aria-live="polite">
    {card.asks.map((ask, i) => {
      const status = statuses[i]!;
      const label = askChip(ask, card.tool, run), divider = label.indexOf(" · ");
      const nounEnd = divider >= 0 ? divider + 3 : ask.kind === "style" && (ask.style === "coiled" || ask.style === "shut-left" || ask.style === "shut-right") ? label.lastIndexOf(" ") + 1 : 0;
      const statusEnd = ask.kind === "style" && ask.style === "dry" ? label.indexOf(" ") : label.length;
      return <li key={i} data-status={status} data-holding={status === "open" ? String(holding[i]) : undefined}>
        <AskIcon ask={ask} tool={card.tool} size={28}/>
        <span className="tide-mark" aria-hidden="true">{status === "open"
          ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="4" fill={holding[i] ? "#3f7f76" : "none"} />{holding[i] && <path d="m3.5 6 1.6 1.6 3.4-3.4" stroke="#fff1d4" />}</svg>
          : <img src={sealArt(status)} width={16} height={16} alt="" decoding="async" />}</span>
        <span className="tide-chip-label">{nounEnd > 0 && <span className="tide-chip-noun">{label.slice(0, nounEnd)}</span>}<span className="tide-chip-status">{label.slice(nounEnd, statusEnd)}</span>{statusEnd < label.length && <span className="tide-chip-noun">{label.slice(statusEnd)}</span>}</span><span className="tide-sr"> ({status === "open" ? holding[i] ? "holding" : "not yet" : status})</span>
      </li>;
    })}
  </ul>;
}
