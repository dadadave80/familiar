import { useEffect, useMemo, useRef, useState } from "react";
import TideWorld from "./TideWorld";
import { HEARTS, PACK_SLOTS, SLOTS, applyMove, countdown, legalMoves, stepDestination, tideShape, type Move, type Position, type TideEvent, type TideState, type TideTransition } from "./engine";
import { bramsGuess } from "./bot";
import { CHAPTERS, aPrize, consequence, itemName, laneNames } from "./story";
import { dayResult } from "./save";
import type { HarborAudio } from "../expedition/audio";
import type { CourtEvent } from "../expedition/types";
import "../expedition/passage-game.css";
import "./tide-run.css";

interface Props {
  initial: TideState; reduced: boolean; sound: boolean; audio: HarborAudio | null; blocked: boolean;
  /** Persists every accepted move. False means the browser could not save it. */
  onSave: (next: TideState) => boolean;
  /** The tide has ended. `again` asks for the same tide once more. */
  onFinish: (state: TideState, again: boolean) => void;
  /** Back to the harbor with the tide still in progress and saved. */
  onLeave: () => void;
  onToggleSound: () => void;
}

const STEPS = ["north", "west", "east", "south"] as const;
const ARROWS = { north: "↑", west: "←", east: "→", south: "↓" };
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
  const chapter = initial.story ? CHAPTERS[initial.story] : null;
  const [notice, setNotice] = useState(() => initial.moves.length ? "" : chapter ? `Bram: “${chapter.before}”` : `The Tidekeeper turns to the ${laneNames(initial.next.lanes).toLowerCase()} lane.`);
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
  function leave() {
    if (blocked) return;
    if (current.current.outcome !== "active") onFinish(current.current, false); else onLeave();
  }
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
  const objective = lastWave ? "The last wave. Get to the dock." : chapter ? (prizeHome ? "The rest of the tide is yours. Bank what you can." : chapter.goal) : `Bram’s guess for today is ${guess}. Beat it.`;
  const finished = over ? dayResult(state) : null;
  const title = state.outcome === "rescued" ? "Bram wades out for Mochi." : state.outcome === "turned" ? "The tide turns." : "Home for the day.";
  const stamps = finished && !state.story ? [["Came home with something", finished.stamps.home], [`Matched Bram’s guess of ${finished.guess}`, finished.stamps.guess], ["Dry paws", finished.stamps.dry]] as const : [];
  const lockControls = !ready || paused || busy;

  return <main className="exp-game passage-game tide-run" data-mode="court" data-testid="tide-run" data-story={state.story} data-seed={state.seed} data-beat={state.beat} data-wave={state.wave}
      data-outcome={state.outcome} data-busy={busy} data-score={state.score} data-hearts={state.hearts}>
    <TideWorld key={sceneKey} snapshot={snapshot} transition={result} presentationId={serial.current} paused={paused}
      onReady={() => setReady(true)} onFault={message => { setFault(message); setReady(false); pending.current = null; setResult(null); }}
      onBeat={beat} onSettled={settle} onTarget={target} />
    <header className="exp-mast"><div className="exp-brand">familiar.<small>Played and saved on this device</small></div>
      <h1 className="exp-place">{chapter ? chapter.title : "Today’s tide"}</h1>
      <div className="passage-header-actions">
        <button aria-pressed={soundOn} aria-label={soundOn ? "Mute game audio" : "Enable game audio"} onClick={onToggleSound}>{soundOn ? "Sound on" : "Sound off"}</button>
        <button className="passage-leave" data-testid="tide-leave" onClick={leave} disabled={blocked || busy}>Harbor</button>
      </div></header>
    <section className="exp-hud tide-hud" aria-label="Tide status">
      <strong>Wave {Math.min(seen.wave + 1, waves)}/{waves}</strong>
      <span className="tide-hearts" role="img" aria-label={`${seen.hearts} of ${HEARTS} hearts`}>{"♥".repeat(seen.hearts)}<i>{"♥".repeat(HEARTS - seen.hearts)}</i></span>
      <span>Pack {used}/{PACK_SLOTS}</span>
      <span>Banked <b data-testid="tide-score">{seen.score}</b></span>
    </section>
    {fault ? <section className="exp-fault" role="alert"><p>{fault}</p><button onClick={() => { setFault(""); setSceneKey(key => key + 1); }}>Reopen the tide</button></section>
      : !ready && !over ? <section className="exp-paused" role="status">Opening the tide…</section> : null}
    {blocked ? <p className="exp-paused" role="status">This tide is paused while another view holds the harbor.</p> : away && !guide ? <p className="exp-paused">Mochi is waiting. Return to this window to continue.</p> : null}
    {over ? <section className="exp-departure passage-finish tide-finish" aria-label="The tide is over">
      <div><h2>{title}</h2>
        {state.story ? <p>{prizeHome ? `The ${itemName(state.story)} is home. Banked ${state.score} besides.` : `The ${itemName(state.story)} is still in its shell. The same tide comes again.`}</p>
          : <p>Banked {state.score}. Bram guessed {finished?.guess}.</p>}
        {stamps.length > 0 && <ul className="tide-stamps">{stamps.map(([label, earned]) => <li key={label} data-earned={earned}>{label}</li>)}</ul>}
      </div>
      <div className="tide-finish-actions">
        <button className="exp-primary" data-testid="tide-finish" disabled={blocked} onClick={() => onFinish(current.current, false)}>Back to the harbor</button>
        {!prizeHome && <button data-testid="tide-again" disabled={blocked} onClick={() => onFinish(current.current, true)}>{state.story ? "Try this tide again" : "Sail it again for practice"}</button>}
      </div>
    </section> : <section className="exp-command-tray passage-tray" aria-label="Guide Mochi">
      <div className="exp-objective-row"><p className="exp-objective">{objective}</p><button ref={guideButton} className="exp-inspect-button" data-testid="tide-guide" disabled={lockControls} onClick={() => setGuide(true)}>How it works</button></div>
      <p className="exp-forecast" data-testid="tide-forecast" aria-live="polite">{state.outcome === "active" ? forecast(seen.outcome === "active" ? seen : state) : ""}</p>
      <span className="exp-sr-only">Mochi is at {where(seen.position)}. The bridge is at the {LANES[seen.bridge]} lane.</span>
      <div className="exp-current-controls"><div className="exp-directions" aria-label="Movement">
        {STEPS.map(move => <button key={move} className={`exp-${move}`} data-move={move} aria-label={`Move ${move}`} disabled={lockControls || !legal.includes(move)} onClick={() => take(move)}>{ARROWS[move]}</button>)}
        <button className="exp-wait" data-move="wait" aria-label="Wait one move" disabled={lockControls} onClick={() => take("wait")}>Wait</button>
      </div><div className="exp-context-actions">
        {legal.includes("home") && state.moves.length > 0 && <button data-move="home" aria-keyshortcuts="R" disabled={lockControls} onClick={() => take("home")}>Call it a day</button>}
      </div></div>
    </section>}
    <div className="exp-feedback passage-feedback" data-testid="tide-feedback" role="status" aria-live="polite">{notice}</div>
    {guide && <dialog ref={dialog} className="exp-panel passage-panel" aria-labelledby="tide-guide-title" onCancel={event => { event.preventDefault(); setGuide(false); }}>
      <button className="exp-close" autoFocus aria-label="Close panel" onClick={() => setGuide(false)}>×</button>
      <h2 id="tide-guide-title">How the tide works</h2>
      <ul className="tide-guide">
        <li>Every step or wait is one move. A wave lands after every third move, down the tinted lanes. The number on a lane is the moves left.</li>
        <li>Be out of those lanes, or on the quay, when it lands. A splash costs a heart and the last thing Mochi picked up, and washes her one platform toward home.</li>
        <li>The wave takes loose prizes in its lanes, then leaves the one that shimmers.</li>
        <li>A reed is worth 1, sea glass 3, a pearl 6. The pack holds {PACK_SLOTS}. Step on the dock to bank it.</li>
        <li>The bridge moves to the wave’s lane. The channel can only be crossed there.</li>
        <li>This tide is {waves} waves.{roughFrom < waves ? ` From wave ${roughFrom + 1}, each wave takes two lanes.` : ""} What is still in the pack when it ends is lost.</li>
      </ul>
      <p className="tide-guide-keys">Arrow keys or WASD move, Space waits, R calls it a day on the dock.</p>
    </dialog>}
  </main>;
}
