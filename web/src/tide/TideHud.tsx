import { useEffect, useRef, useState, type JSX } from "react";
import { cardStatus, type Run, type TideCard } from "./asks";
import { sealArt } from "./art";
import { askChip } from "./cards";
import "./tide.css";

export default function TideHud({ card, run }: { card: TideCard; run: Run }): JSX.Element {
  const statuses = cardStatus(card, run);
  const previous = useRef({ cardId: card.id, turn: run.state.turn, statuses });
  const [motions, setMotions] = useState<("kept" | "slipped" | undefined)[]>([]);
  const reset = previous.current.cardId !== card.id || run.state.turn < previous.current.turn;
  useEffect(() => {
    const before = previous.current;
    previous.current = { cardId: card.id, turn: run.state.turn, statuses };
    const continuing = before.cardId === card.id && run.state.turn > before.turn;
    setMotions(current => statuses.map((status, i) => continuing && status !== "open"
      ? before.statuses[i] !== status ? status : current[i]
      : undefined));
  }, [card.id, run.state.turn, statuses[0], statuses[1], statuses[2]]);
  return <ul className="tide-asks" aria-label="The Tidekeeper’s asks" aria-live="polite">
    {card.asks.map((ask, i) => {
      const status = statuses[i]!;
      return <li key={i} data-status={status} data-motion={!reset && motions[i] === status ? motions[i] : undefined} onAnimationEnd={event => {
        if (event.target === event.currentTarget) setMotions(current => current.map((motion, j) => i === j ? undefined : motion));
      }}>
        <span className="tide-mark" aria-hidden="true">{status === "open"
          ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="6" cy="6" r="4" /></svg>
          : <img src={sealArt(status)} width={16} height={16} alt="" decoding="async" />}</span>
        <span>{askChip(ask, card.tool, run)}</span><span className="tide-sr"> ({status})</span>
      </li>;
    })}
  </ul>;
}
