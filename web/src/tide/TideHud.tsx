import type { JSX } from "react";
import { cardStatus, type Run, type TideCard } from "./asks";
import { askChip } from "./cards";
import "./tide.css";

export default function TideHud({ card, run }: { card: TideCard; run: Run }): JSX.Element {
  const statuses = cardStatus(card, run);
  return <ul className="tide-asks" aria-label="The Tidekeeper’s asks" aria-live="polite">
    {card.asks.map((ask, i) => {
      const status = statuses[i]!;
      return <li key={i} data-status={status}>
        <span className="tide-mark" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          {status === "open" ? <circle cx="6" cy="6" r="4" /> : status === "kept" ? <path d="M2 6L5 9L10 3" /> : <path d="M3 6H9" />}
        </svg></span>
        <span>{askChip(ask, card.tool, run)}</span><span className="tide-sr"> ({status})</span>
      </li>;
    })}
  </ul>;
}
