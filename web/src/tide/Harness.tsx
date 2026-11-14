import { useMemo, useState, type JSX } from "react";
import { cardStatus, replayRun, solve } from "./asks";
import { cardForDay } from "./cards";
import { tideSummary, type TideEntry } from "./log";
import { earlierDays, pageForDay, tidePages } from "./pages";
import TideAsk from "./TideAsk";
import TideHud from "./TideHud";
import TideLog, { type LogPage } from "./TideLog";
import TideStamp from "./TideStamp";
import "../expedition/game.css";
import "./tide.css";

export default function TideHarness(): JSX.Element {
  const [sailed, setSailed] = useState(false);
  const [message, setMessage] = useState("");
  const [initialPage, setInitialPage] = useState(0);
  const [press, setPress] = useState(0);
  const [askOpen, setAskOpen] = useState(true);
  const [logOpen, setLogOpen] = useState(true);
  const sample = useMemo(() => {
    const card = cardForDay(20771);
    const entries: TideEntry[] = [20765, 20767, 20768, 20770, 20771].map((day, i) => {
      const past = cardForDay(day);
      const route = i % 2 === 0 ? solve(past.tool, past.asks)! : ["return" as const];
      const returned = replayRun(past.tool, route)!;
      if (returned.state.outcome !== "returned") throw new Error("The sample tide must come home.");
      return { day, cardId: past.id, tool: past.tool, commands: route,
        kept: cardStatus(past, returned).map(status => status === "kept") as [boolean, boolean, boolean],
        decisions: returned.state.turn, outcome: "returned", late: day !== 20771, attempts: 2,
        savedAt: new Date(day * 86_400_000).toISOString() };
    });
    const entry = entries.at(-1)!;
    const commands = entry.commands;
    const run = replayRun(card.tool, commands.slice(0, 5))!;
    const pages: LogPage[] = [
      { kind: "story", id: "lens", title: "The lens comes home", subtitle: "Your first return", area: "beacon", tool: "rope", banked: [], commands: solve("rope", [{ kind: "haul", haul: "lens" }]) ?? [] },
      ...tidePages(entries),
    ];
    return { card, entry, run, returned: replayRun(card.tool, commands)!, entries, pages };
  }, []);
  const onSail = (day: number) => setMessage(`Sample sail selected: day ${day}.`);
  return <main className="exp-game" style={{ position: "fixed", inset: 0, overflow: "auto", background: "#3d5a4c" }}>
    <p className="tide tide-harness-note" role="note">Development harness. Sample data only.</p>
    <div className="tide tide-harness-panels">
      <section className="tide-harness-stamps" aria-labelledby="tide-harness-stamps-title">
        <h3 id="tide-harness-stamps-title">Stamps</h3>
        <div className="tide-harness-stamp-row">{[52, 56, 72, 84, 112, 160].map(size => <div className="tide-harness-stamp-pair" key={size}>
          <span>{size} px</span>
          <TideStamp key={`plain:${press}`} id={sample.card.id} size={size} tilt={-3} press={press > 0} />
          <TideStamp key={`seal:${press}`} id={sample.card.id} size={size} tilt={3} seal press={press > 0} />
        </div>)}</div>
        <button type="button" onClick={() => setPress(value => value + 1)}>Press stamps</button>
      </section>
      <div className="tide-harness-court">
        <div className="exp-hud"><strong>Beacon Court</strong><span>Low tide · Sample outing</span></div>
        <TideHud card={sample.card} run={sailed ? sample.returned : sample.run} reduced={matchMedia("(prefers-reduced-motion: reduce)").matches} />
      </div>
      {!askOpen && <button type="button" onClick={() => setAskOpen(true)}>Today’s tide</button>}
      {askOpen && <div className="exp-panel tide-harness-panel">
        <button type="button" className="exp-close" aria-label="Close panel" onClick={() => setAskOpen(false)}><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m4 4 10 10M14 4 4 14" /></svg></button>
        <TideAsk today={{ day: 20771, card: sample.card, entry: sailed ? sample.entry : null }} earlier={earlierDays(20771, sample.entries)} canSail onSail={onSail} onOpenLog={day => { setInitialPage(pageForDay(sample.pages, day)); setLogOpen(true); setMessage("Sample log page selected."); }} />
        <button type="button" aria-pressed={sailed} onClick={() => setSailed(value => !value)}>{sailed ? "Show unsailed state" : "Show sailed state"}</button>
        <p className="tide-harness-status" role="status">{message}</p>
      </div>}
      {!logOpen && <button type="button" onClick={() => setLogOpen(true)}>Bram’s tide log</button>}
      {logOpen && <div className="exp-panel tide-harness-panel">
        <button type="button" className="exp-close" aria-label="Close panel" onClick={() => setLogOpen(false)}><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m4 4 10 10M14 4 4 14" /></svg></button>
        <TideLog pages={sample.pages} initialPage={initialPage} reduced={matchMedia("(prefers-reduced-motion: reduce)").matches} canSail summary={tideSummary(sample.entries)} onSail={onSail} />
      </div>}
    </div>
  </main>;
}
