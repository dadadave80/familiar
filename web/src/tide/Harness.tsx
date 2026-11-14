import { useMemo, useState, type JSX } from "react";
import { replayRun, solve } from "./asks";
import { cardForDay } from "./cards";
import type { TideEntry } from "./log";
import TideAsk from "./TideAsk";
import TideHud from "./TideHud";
import TideLog, { type LogPage } from "./TideLog";
import "../expedition/game.css";
import "./tide.css";

export default function TideHarness(): JSX.Element {
  const [sailed, setSailed] = useState(false);
  const [message, setMessage] = useState("");
  const [initialPage, setInitialPage] = useState(0);
  const sample = useMemo(() => {
    const card = cardForDay(20771);
    const commands = solve(card.tool, card.asks) ?? [];
    const entry: TideEntry = { day: 20771, cardId: card.id, tool: card.tool, commands, kept: [true, true, true], decisions: commands.length, outcome: "returned", late: false, attempts: 2, savedAt: new Date().toISOString() };
    const run = replayRun(card.tool, commands.slice(0, 5))!;
    const pages: LogPage[] = [
      { kind: "story", id: "lens", title: "The lens comes home", subtitle: "Your first return", area: "beacon", tool: "rope", banked: [], commands: solve("rope", [{ kind: "haul", haul: "lens" }]) ?? [] },
      { kind: "tide", day: 20771, card, entry },
    ];
    return { card, entry, run, pages };
  }, []);
  const onSail = (day: number) => setMessage(`Sample sail selected: day ${day}.`);
  return <main className="exp-game" style={{ position: "fixed", inset: 0, overflow: "auto", background: "#3d5a4c" }}>
    <p className="tide tide-harness-note" role="note">Development harness. Sample data only.</p>
    <div className="tide tide-harness-panels">
      <div className="tide-harness-court">
        <div className="exp-hud"><strong>Beacon Court</strong><span>Low tide · Sample outing</span></div>
        <TideHud card={sample.card} run={sample.run} />
      </div>
      <div className="exp-panel tide-harness-panel">
        <TideAsk today={{ day: 20771, card: sample.card, entry: sailed ? sample.entry : null }} earlier={[{ day: 20770, card: cardForDay(20770), entry: null }]} canSail onSail={onSail} onOpenLog={day => { setInitialPage(day === undefined ? 0 : 1); setMessage("Sample log page selected."); }} />
        <button type="button" aria-pressed={sailed} onClick={() => setSailed(value => !value)}>{sailed ? "Show unsailed state" : "Show sailed state"}</button>
        <p className="tide-harness-status" role="status">{message}</p>
      </div>
      <div className="exp-panel tide-harness-panel">
        <TideLog pages={sample.pages} initialPage={initialPage} reduced={matchMedia("(prefers-reduced-motion: reduce)").matches} canSail summary={{ sailed: 1, kept: 3, allThree: 1 }} onSail={onSail} />
      </div>
    </div>
  </main>;
}
