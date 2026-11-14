import { useEffect, useRef, useState, type JSX } from "react";
import { askHolds, cardStatus, type Run, type TideCard } from "./asks";
import { sealArt } from "./art";
import { askChip } from "./cards";
import "./tide.css";

export default function TideHud({ card, run, reduced }: { card: TideCard; run: Run; reduced: boolean }): JSX.Element {
  const statuses = cardStatus(card, run);
  const holding = card.asks.map(ask => askHolds(ask, run));
  const previous = useRef({ cardId: card.id, turn: run.state.turn, statuses, holding });
  const [motions, setMotions] = useState<("holding" | "slipped" | undefined)[]>([]);
  const reset = previous.current.cardId !== card.id || run.state.turn < previous.current.turn;
  useEffect(() => {
    const before = previous.current;
    previous.current = { cardId: card.id, turn: run.state.turn, statuses, holding };
    const continuing = !reduced && before.cardId === card.id && run.state.turn > before.turn;
    setMotions(current => statuses.map((status, i) => {
      if (!continuing) return undefined;
      if (status === "slipped") return before.statuses[i] !== status ? "slipped" : current[i];
      if (status === "open" && holding[i]) return !before.holding[i] ? "holding" : current[i];
      return undefined;
    }));
  }, [card.id, run.state.turn, reduced, statuses[0], statuses[1], statuses[2], holding[0], holding[1], holding[2]]);
  return <ul className="tide-asks" aria-label="The Tidekeeper’s asks" aria-live="polite">
    {card.asks.map((ask, i) => {
      const status = statuses[i]!;
      return <li key={i} data-status={status} data-holding={status === "open" ? String(holding[i]) : undefined} data-motion={!reset ? motions[i] : undefined} onAnimationEnd={event => {
        if (event.target === event.currentTarget) setMotions(current => current.map((motion, j) => i === j ? undefined : motion));
      }}>
        <span className="tide-mark" aria-hidden="true">{status === "open"
          ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="4" fill={holding[i] ? "#3f7f76" : "none"} />{holding[i] && <path d="m3.5 6 1.6 1.6 3.4-3.4" stroke="#fff1d4" />}</svg>
          : <img src={sealArt(status)} width={16} height={16} alt="" decoding="async" />}</span>
        <span>{askChip(ask, card.tool, run)}</span><span className="tide-sr"> ({status === "open" ? holding[i] ? "holding" : "not yet" : status})</span>
      </li>;
    })}
  </ul>;
}
