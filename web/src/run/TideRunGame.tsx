import { useEffect, useMemo, useRef, useState } from "react";
import TideWorld from "./TideWorld";
import { HEARTS, PACK_SLOTS, SLOTS, applyMove, countdown, legalMoves, stepDestination, tideShape, type Move, type Position, type TideEvent, type TideState, type TideTransition } from "./engine";
import { bramsGuess } from "./bot";
import { CHAPTERS, aPrize, consequence, itemName, laneNames } from "./story";
import { STAMPS } from "../tide/run-day";
import type { HarborAudio } from "../expedition/audio";
import type { CourtEvent } from "../expedition/types";
import "../expedition/passage-game.css";
import "../tide/tide.css";
import "./tide-run.css";

interface Props {
  initial: TideState; reduced: boolean; sound: boolean; audio: HarborAudio | null; blocked: boolean;
  /** Persists every accepted move. False means the browser could not save it. */
  onSave: (next: TideState) => boolean;
  /** False means filing failed. `again` asks for the same tide once more. */
  onFinish: (state: TideState, again: boolean) => boolean;
  /** Back to the harbor with the tide still in progress and saved. */
  onLeave: () => void;
  onToggleSound: () => void;
}

const STEPS = ["north", "west", "east", "south"] as const;
const ARROWS = { north: "m5 15 7-7 7 7", west: "m15 5-7 7 7 7", east: "m9 5 7 7-7 7", south: "m5 9 7 7 7-7" };
const WAVE = "M3 8c3-4 5 4 9 0s6 4 9 0M3 15c3-4 5 4 9 0s6 4 9 0";
const HEART = "M12 20 4 12C-2 6 7 0 12 6c5-6 14 0 8 6l-8 8Z";
const BAG = "M6 8h12l2 12H4L6 8Zm3 0V5a3 3 0 0 1 6 0v3";
const HOME = "m3 11 9-8 9 8M6 9v12h12V9m-9 12v-7h6v7";
const icon = (path: string) => <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={path}/></svg>;
const LANES = ["left", "center", "right"];
const ROWS = ["quay", "near landing", "channel", "far landing", "far shore"];
const KEYS: Partial<Record<string, Move>> = { arrowup: "north", w: "north", arrowdown: "south", s: "south", arrowleft: "west", a: "west", arrowright: "east", d: "east", " ": "wait", r: "home" };
const same = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
const where = (position: Position) => position.y === 4 && position.x !== 1 ? `the ${LANES[position.x]} shell` : `the ${LANES[position.x]} ${ROWS[position.y]}`;
const landing = (position: Position) => `${position.y === 4 && position.x !== 1 ? "in" : "on"} ${where(position)}`;

/** A tap on a platform one step away walks there. The channel is never stood on: a tap on the bridge crosses it. */
function moveToward(state: TideState, target: Position): Move | null {
  const step = STEPS.find(move => { const to = stepDestination(state, move); return !!to && same(to, target); });
  if (step) return step;
  if (target.y !== 2 || target.x !== state.bridge || state.position.x !== target.x) return null;
  return state.position.y === 1 ? "north" : state.position.y === 3 ? "south" : null;
}

function forecast(state: TideState): string {
  const left = countdown(state), { lanes, drops } = state.next;
  const leaves = drops.length ? ` It leaves ${drops.map(drop => `${aPrize(drop.kind)} ${landing(drop)}`).join(" and ")}.` : " It leaves nothing.";
  return `${laneNames(lanes)} wave in ${left} ${left === 1 ? "move" : "moves"}.${leaves}`;
}

/** The harbor's sound recipes are keyed by court events; a tide event borrows the closest one. */
function sound(event: TideEvent): CourtEvent | null {
  switch (event.kind) {
    case "move": case "bridge": return event;
    case "wave": return { kind: "wave", source: event.lanes[0]!, exit: event.lanes[0]! };
    case "open": return { kind: "open", column: event.lane };
    case "splash": return { kind: "hit", from: event.from, to: event.to, resolve: event.hearts };
    case "pickup": return { kind: "pickup", item: event.item === "vane" || event.item === "moth" ? event.item : "lens", from: event.at, rope: false };
    case "bank": return { kind: "return", cargo: [] };
    case "end": return event.reason === "rescued" ? { kind: "rescue", reason: "resolve" } : null;
    default: return null;
  }
}

export default function TideRunGame({ initial, reduced, sound: soundOn, audio, blocked, onSave, onFinish, onLeave, onToggleSound }: Props) {
  const [state, setState] = useState(initial), [result, setResult] = useState<TideTransition | null>(null);
  const current = useRef(initial), pending = useRef<TideTransition | null>(null), serial = useRef(0);
  const [ready, setReady] = useState(false), [fault, setFault] = useState(""), [sceneKey, setSceneKey] = useState(0);
  const [away, setAway] = useState(document.hidden), [guide, setGuide] = useState(false);
  const [finishError, setFinishError] = useState(false);
  const finishAttempted = useRef(false), filed = useRef(false);
  const chapter = initial.story ? CHAPTERS[initial.story] : null;
  const [notice, setNotice] = useState(() => initial.outcome !== "active" || initial.moves.length ? "" : chapter ? `Bram: “${chapter.before}”` : `The Tidekeeper turns to the ${laneNames(initial.next.lanes).toLowerCase()} lane.`);
  const dialog = useRef<HTMLDialogElement>(null), guideButton = useRef<HTMLButtonElement>(null);
  const guess = useMemo(() => initial.story ? null : bramsGuess(initial.seed), [initial.seed, initial.story]);
  const busy = !!result, paused = away || blocked || guide || !!fault;
  // The board catches up before the numbers do: the status shows the tide as drawn.
  const seen = result ? result.before : state, over = state.outcome !== "active" && !busy;
  const { waves, roughFrom } = tideShape(initial), legal = legalMoves(state);
  const used = seen.pack.reduce((sum, item) => sum + SLOTS[item], 0);
  const snapshot = useMemo(() => ({ tide: state, reducedMotion: reduced }), [state, reduced]);

  useEffect(() => {
    const hide = () => setAway(true), show = () => setAway(document.hidden);
    document.addEventListener("visibilitychange", show); window.addEventListener("blur", hide); window.addEventListener("focus", show);
    return () => { document.removeEventListener("visibilitychange", show); window.removeEventListener("blur", hide); window.removeEventListener("focus", show); };
  }, []);
  useEffect(() => {
    if (!guide) { guideButton.current?.focus({ preventScroll: true }); return; }
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [guide]);

  function take(move: Move) {
    if (!ready || paused || pending.current || current.current.outcome !== "active" || document.hidden) return;
    const next = applyMove(current.current, move);
    if (!next) return;
    if (!onSave(next.after)) { setNotice("This move could not be saved. Try it again when this browser can save."); return; }
    current.current = next.after; pending.current = next; serial.current++;
    setResult(next); setState(next.after);
  }
  function beat(event: TideEvent) {
    const cue = sound(event);
    if (cue && pending.current && soundOn && !away && !document.hidden) audio?.play(cue);
  }
  function settle(id: number) {
    const accepted = pending.current;
    if (id !== serial.current || !accepted) return;
    // The last thing that happened stays up until something else does.
    const line = consequence(accepted);
    if (line) setNotice(line);
    pending.current = null; setResult(null);
  }
  function target(position: Position) { const move = moveToward(current.current, position); if (move) take(move); }
  function finish(again: boolean) {
    if (!current.current.story) {
      if (!over || !ready || blocked || filed.current) return;
      finishAttempted.current = true;
    }
    const saved = onFinish(current.current, again);
    if (!current.current.story && saved) filed.current = true;
    setFinishError(!saved);
  }
  function leave() {
    if (blocked) return;
    if (current.current.outcome !== "active") finish(false); else onLeave();
  }
  useEffect(() => {
    if (!state.story && over && ready && !blocked && !finishAttempted.current) finish(false);
  }, [state.story, over, ready, blocked, onFinish]);
  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if (event.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || guide ||
          (event.target instanceof Element && event.target.closest("input,textarea,select,[contenteditable=true],dialog"))) return;
      const key = event.key.toLowerCase();
      if (key === " " && event.target instanceof Element && event.target.closest("button,a")) return;
      const move = KEYS[key];
      if (!move && key !== "i") return;
      event.preventDefault();
      if (move) take(move); else setGuide(true);
    }
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  });

  const prizeHome = !!state.story && state.banked.includes(state.story);
  const lastWave = state.outcome === "active" && state.wave === waves - 1;
  const objective = lastWave ? "The last wave. Get to the dock." : chapter ? (prizeHome ? "The rest of the tide is yours. Bank what you can." : chapter.goal) : "";
  const title = state.outcome === "rescued" ? "Bram wades out for Mochi." : state.outcome === "turned" ? "The tide turns." : "Home for the day.";
  const lockControls = !ready || paused || busy;
  const feedback = <div className="exp-feedback passage-feedback" data-testid="tide-feedback" role="status" aria-live="polite">{notice}</div>;

  return <main className="exp-game passage-game tide-run" data-mode="court" data-testid="tide-run" data-story={state.story} data-seed={state.seed} data-beat={state.beat} data-wave={state.wave}
      data-outcome={state.outcome} data-busy={busy} data-score={state.score} data-hearts={state.hearts}>
    <TideWorld key={sceneKey} snapshot={snapshot} transition={result} presentationId={serial.current} paused={paused}
      onReady={() => setReady(true)} onFault={message => { setFault(message); setReady(false); pending.current = null; setResult(null); }}
      onBeat={beat} onSettled={settle} onTarget={target} />
    <header className="exp-mast"><div className="exp-brand">familiar.<small>Played and saved on this device</small></div>
      <h1 className="exp-place">{chapter ? chapter.title : "Today’s tide"}</h1>
      <div className="passage-header-actions">
        <button className="tide-sound" aria-pressed={soundOn} aria-label={soundOn ? "Mute game audio" : "Enable game audio"} onClick={onToggleSound}>{icon(soundOn ? "m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" : "m11 4-6 5H2v6h3l6 5V4Zm5 5 6 6m0-6-6 6")}</button>
        <button className="passage-leave" data-testid="tide-leave" onClick={leave} disabled={blocked || busy}>Harbor</button>
      </div></header>
    <section className="exp-hud tide-hud" aria-label="Tide status">
      <img className="tide-portrait" src={seen.hearts < HEARTS ? "/assets/ui/mochi-portrait-splashed.webp" : "/assets/ui/mochi-portrait.webp"} width="48" height="48" alt=""/>
      <div className="tide-vitals"><strong>Wave {Math.min(seen.wave + 1, waves)}/{waves}</strong>
        <span className="tide-hearts" role="img" aria-label={`${seen.hearts} of ${HEARTS} hearts`}>{Array.from({ length: HEARTS }, (_, i) => <span key={i} className={i < seen.hearts ? "tide-heart-full" : "tide-heart-empty"}>{icon(HEART)}</span>)}</span>
      </div>
      <span className="tide-tally">{icon(BAG)}<span>Pack <b>{used}/{PACK_SLOTS}</b></span></span>
      <span className="tide-tally">{icon(HOME)}<span>Banked <b data-testid="tide-score">{seen.score}</b></span></span>
      <span className="tide-sr">Mochi: wave {Math.min(seen.wave + 1, waves)} of {waves}, {seen.hearts} of {HEARTS} hearts, pack {used} of {PACK_SLOTS} slots, banked {seen.score} points, {seen.splashes === 0 ? "dry paws" : `splashed ${seen.splashes} ${seen.splashes === 1 ? "time" : "times"}`}.</span>
    </section>
    {fault ? <section className="exp-fault" role="alert"><p>{fault}</p><button onClick={() => { setFault(""); setSceneKey(key => key + 1); }}>Reopen the tide</button></section>
      : !ready && !over ? <section className="exp-paused" role="status">Opening the tide…</section> : null}
    {blocked ? <p className="exp-paused" role="status">This tide is paused while another view holds the harbor.</p> : away && !guide ? <p className="exp-paused">Mochi is waiting. Return to this window to continue.</p> : null}
    {over && (state.story || finishError) && <section className="exp-departure passage-finish tide-finish" aria-label="The tide is over">
      <div><img className="tide-finish-portrait" src={state.outcome === "rescued" ? "/assets/ui/mochi-portrait-splashed.webp" : "/assets/ui/mochi-portrait-proud.webp"} width="80" height="80" alt=""/><h2>{title}</h2>
        {state.story ? <p>{prizeHome ? `The ${itemName(state.story)} is home. Banked ${state.score} besides.` : `The ${itemName(state.story)} is still in its shell. The same tide comes again.`}</p>
          : <p>Banked {state.score}. Bram guessed {guess}.</p>}
        {feedback}
        {finishError && <p role="alert">This tide could not be saved. Try it again when this browser can save.</p>}
      </div>
      <div className="tide-finish-actions">
        <button className="exp-primary" data-testid="tide-finish" disabled={blocked} onClick={() => finish(false)}>{icon(HOME)}Back to the harbor</button>
        {state.story && !prizeHome && <button className="exp-text-button" data-testid="tide-again" disabled={blocked} onClick={() => finish(true)}>Try this tide again</button>}
      </div>
    </section>}
    {!over && <section className="exp-command-tray passage-tray" aria-label="Guide Mochi">
      {guess !== null && <ol className="tide-asks" aria-label="Today’s asks" aria-live="polite">{STAMPS.map(stamp => {
        const status = stamp.key === "home" ? (seen.score > 0 ? "kept" : undefined)
          : stamp.key === "guess" ? (seen.score >= guess ? "kept" : undefined)
          : seen.splashes > 0 ? "slipped" : seen.outcome !== "active" ? "kept" : undefined;
        const label = stamp.key === "home" ? "Bring one home" : stamp.key === "dry" ? "Dry paws" : `${seen.score === guess ? "Matched" : "Beat"} ${guess}`;
        return <li key={stamp.key} data-status={status}>
          <span className="tide-ask-icon" aria-hidden="true"><img src={stamp.icon} width="24" height="24" alt=""/></span>
          <span className="tide-ask-label" aria-hidden="true">{label}</span>
          <span className="tide-sr">{stamp.ask(guess)} {status === "kept" ? "Kept." : status === "slipped" ? "Slipped." : "Still open."}</span>
        </li>;
      })}</ol>}
      <div className="tide-tray-reading">
      {chapter && <div className="exp-objective-row"><p className="exp-objective">{objective}</p></div>}
      <p className={`exp-forecast${countdown(seen) === 1 ? " tide-forecast-soon" : ""}`} data-testid="tide-forecast" aria-live="polite">{icon(WAVE)}<span>{state.outcome === "active" ? forecast(seen.outcome === "active" ? seen : state) : ""}</span></p>
      <span className="exp-sr-only">Mochi is at {where(seen.position)}. The bridge is at the {LANES[seen.bridge]} lane.</span>
      {feedback}
      </div>
      <div className="exp-current-controls"><div className="exp-directions" aria-label="Movement">
        {STEPS.map(move => <button key={move} className={`exp-${move}`} data-move={move} aria-label={`Move ${move}`} disabled={lockControls || !legal.includes(move)} onClick={() => take(move)}>{icon(ARROWS[move])}</button>)}
        <button className="exp-wait" data-move="wait" aria-label="Wait one move" disabled={lockControls} onClick={() => take("wait")}>Wait</button>
      </div><div className="exp-context-actions">
        <button ref={guideButton} className="exp-inspect-button" data-testid="tide-guide" disabled={lockControls} onClick={() => setGuide(true)}>How it works</button>
        {legal.includes("home") && state.moves.length > 0 && <button className="exp-text-button" data-move="home" aria-keyshortcuts="R" disabled={lockControls} onClick={() => take("home")}>Call it a day</button>}
      </div></div>
    </section>}
    {guide && <dialog ref={dialog} className="exp-panel passage-panel" aria-labelledby="tide-guide-title" onCancel={event => { event.preventDefault(); setGuide(false); }}>
      <button className="exp-close" autoFocus aria-label="Close panel" onClick={() => setGuide(false)}>{icon("m6 6 12 12M18 6 6 18")}</button>
      <h2 id="tide-guide-title">How the tide works</h2>
      <ul className="tide-guide">
        <li>{icon(WAVE)}<span>Every step or wait is one move. A wave lands after every third move, down the tinted lanes. The number on a lane is the moves left.</span></li>
        <li>{icon(HEART)}<span>Be out of those lanes, or on the quay, when it lands. A splash costs a heart and the last thing Mochi picked up, and washes her one platform toward home.</span></li>
        <li>{icon("m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z")}<span>The wave takes loose prizes in its lanes, then leaves the one that shimmers.</span></li>
        <li>{icon(BAG)}<span>A reed is worth 1, sea glass 3, a pearl 6. The pack holds {PACK_SLOTS}. Step on the dock to bank it.</span></li>
        <li>{icon("M3 18V6m18 12V6M3 8c4 6 14 6 18 0M3 18h18M7 12v6m5-5v5m5-6v6")}<span>The bridge moves to the wave’s lane. The channel can only be crossed there.</span></li>
        <li>{icon("M20 12a8 8 0 1 1-16 0 8 8 0 1 1 16 0M12 7v5l3 2")}<span>This tide is {waves} waves.{roughFrom < waves ? ` From wave ${roughFrom + 1}, each wave takes two lanes.` : ""} What is still in the pack when it ends is lost.</span></li>
      </ul>
      <p className="tide-guide-keys">Arrow keys or WASD move, Space waits, R calls it a day on the dock.</p>
    </dialog>}
  </main>;
}
