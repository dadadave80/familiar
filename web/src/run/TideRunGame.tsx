import { useEffect, useMemo, useRef, useState } from "react";
import TideWorld from "./TideWorld";
import ControlHints from "../expedition/ControlHints";
import { scrollReadingRegion } from "../expedition/keyboard-scroll";
import type { TideSnapshot } from "./scene";
import { HEARTS, PACK_SLOTS, SLOTS, applyMove, countdown, legalMoves, stepDestination, tideShape, type Move, type Position, type StoryPrize, type TideEvent, type TideState, type TideTransition } from "./engine";
import { bramsGuess } from "./bot";
import { CHAPTERS, aPrize, consequence, itemName, laneNames } from "./story";
import { DISTANT_CUE, INITIAL_CUE, LENS_SAFE_CUE, observeTransition, observedLessons, retainedCue, returnAdvice } from "./guidance";
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
  guidance?: boolean;
  buttonsOpen?: boolean;
  onButtonsOpenChange?: (open: boolean) => void;
  onSkipGuidance?: () => void;
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

export function TideRunRules({ story }: { story?: StoryPrize }) {
  const { waves, roughFrom } = tideShape({ story });
  return <>
    <ul className="tide-guide">
      <li>{icon(WAVE)}<span>Every step or wait advances the water by one move. A wave arrives after every third move. Mochi moves first, then the wave lands.</span></li>
      <li>{icon(WAVE)}<span>Read the tinted lanes and the moves left. The quay is safe from waves.</span></li>
      <li>{icon(HEART)}<span>A splash costs a heart and the last item Mochi picked up, and washes her toward the quay.</span></li>
      <li>{icon(BAG)}<span>Prizes are collected when Mochi steps onto them. The pack holds three slots; the wind-moth needs two.</span></li>
      <li>{icon(BAG)}<span>Reed scores 1, sea glass 3, and a pearl 6. Story finds restore the harbor and add no points.</span></li>
      <li>{icon(HOME)}<span>Step onto the center dock to bank cargo. Choose Finish and return there to end the outing.</span></li>
      <li>{icon(HOME)}<span>Pause outing keeps the outing open. Reading, inspection, and menus spend no moves.</span></li>
      <li>{icon("M3 18V6m18 12V6M3 8c4 6 14 6 18 0M3 18h18M7 12v6m5-5v5m5-6v6")}<span>The bridge moves to the wave’s lane. The channel can only be crossed there.</span></li>
      <li>{icon(WAVE)}<span>This outing is {waves} waves.{roughFrom < waves ? ` From wave ${roughFrom + 1}, each wave takes two lanes.` : ""} What is still in the pack when it ends is lost.</span></li>
    </ul>
    <p className="tide-guide-keys">Swipe or tap a neighboring platform to move. Tap Wait beside Mochi to let one move pass. WASD or arrow keys to move. Space waits · R finishes at the dock · I opens the guide. Optional Button controls offer the same decisions without gestures.</p>
  </>;
}

export default function TideRunGame({ initial, reduced, sound: soundOn, audio, blocked, onSave, onFinish, onLeave, onToggleSound, guidance = false, buttonsOpen, onButtonsOpenChange, onSkipGuidance }: Props) {
  const [state, setState] = useState(initial), [result, setResult] = useState<TideTransition | null>(null);
  const current = useRef(initial), pending = useRef<TideTransition | null>(null), serial = useRef(0);
  const [ready, setReady] = useState(false), [fault, setFault] = useState(""), [sceneKey, setSceneKey] = useState(0);
  const [away, setAway] = useState(document.hidden), [guide, setGuide] = useState(false);
  const [finishError, setFinishError] = useState(false);
  const [cue, setCue] = useState<string | null>(() => guidance && initial.outcome === "active" && !initial.moves.length ? INITIAL_CUE : null);
  const lessons = useRef(observedLessons(initial)), acceptedLesson = useRef<ReturnType<typeof observeTransition> | null>(null);
  const [lensDecision, setLensDecision] = useState(false), [localButtonsOpen, setLocalButtonsOpen] = useState(false);
  const [guidanceOff, setGuidanceOff] = useState(false);
  const teaching = guidance && !guidanceOff;
  const openButtons = buttonsOpen ?? localButtonsOpen;
  const decisionDialog = useRef<HTMLDialogElement>(null), decisionHeading = useRef<HTMLHeadingElement>(null);
  const finishAttempted = useRef(false), filed = useRef(false), explicitFinish = useRef(false);
  const chapter = initial.story ? CHAPTERS[initial.story] : null;
  const [notice, setNotice] = useState(() => initial.outcome !== "active" || initial.moves.length ? "" : chapter ? chapter.before : `The Tidekeeper turns to the ${laneNames(initial.next.lanes).toLowerCase()} lane.`);
  const dialog = useRef<HTMLDialogElement>(null), guideButton = useRef<HTMLButtonElement>(null), gameRef = useRef<HTMLElement>(null), guideOpener = useRef<HTMLElement | null>(null);
  const guess = useMemo(() => initial.story ? null : bramsGuess(initial.seed), [initial.seed, initial.story]);
  const busy = !!result, paused = away || blocked || guide || lensDecision || !!fault;
  // The board catches up before the numbers do: the status shows the tide as drawn.
  const seen = result ? result.before : state, over = state.outcome !== "active" && !busy;
  const { waves } = tideShape(initial), legal = legalMoves(state);
  const used = seen.pack.reduce((sum, item) => sum + SLOTS[item], 0);
  const worldActions = useMemo(() => legalMoves(state).filter((move): move is "wait" | "home" => move === "wait" || move === "home" && state.moves.length > 0), [state]);
  const snapshot = useMemo<TideSnapshot>(() => ({ tide: state, reducedMotion: reduced, worldActions }), [state, reduced, worldActions]);

  useEffect(() => { setGuidanceOff(false); if (!guidance) { setCue(null); setLensDecision(false); } }, [guidance]);
  useEffect(() => {
    if (!lensDecision) return;
    decisionDialog.current?.showModal(); decisionHeading.current?.focus({ preventScroll: true });
    return () => { decisionDialog.current?.close(); gameRef.current?.focus({ preventScroll: true }); };
  }, [lensDecision]);

  useEffect(() => {
    const hide = () => setAway(true), show = () => setAway(document.hidden);
    document.addEventListener("visibilitychange", show); window.addEventListener("blur", hide); window.addEventListener("focus", show);
    return () => { document.removeEventListener("visibilitychange", show); window.removeEventListener("blur", hide); window.removeEventListener("focus", show); };
  }, []);
  useEffect(() => {
    if (!guide) { if (guideOpener.current) { (guideOpener.current.isConnected ? guideOpener.current : gameRef.current)?.focus({ preventScroll: true }); guideOpener.current = null; } return; }
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, [guide]);
  useEffect(() => {
    if (!ready || guide || current.current.outcome !== "active") return;
    const frame = requestAnimationFrame(() => gameRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [ready]);

  function openGuide(source: HTMLElement | null = gameRef.current) {
    if (!ready || paused || pending.current || current.current.outcome !== "active") return;
    guideOpener.current = source;
    setGuide(true);
  }

  function take(move: Move, fromDecision = false) {
    if (!ready || away || blocked || guide || !!fault || lensDecision && !fromDecision || pending.current || current.current.outcome !== "active" || document.hidden) return;
    const next = applyMove(current.current, move);
    if (!next) return;
    if (!onSave(next.after)) { setCue(null); setNotice("This move could not be saved. Try it again when this browser can save."); return; }
    acceptedLesson.current = observeTransition(next, lessons.current);
    lessons.current = acceptedLesson.current.observed;
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
    const lesson = acceptedLesson.current;
    if (teaching && lesson && accepted.after.outcome === "active") {
      setCue(previous => lesson.cue ?? retainedCue(previous, accepted));
      if (lesson.lensBanked) { setCue(null); setLensDecision(true); }
    } else setCue(null);
    acceptedLesson.current = null;
    if (accepted.after.moves.at(-1) === "home") explicitFinish.current = true;
    pending.current = null; setResult(null);
  }
  function target(position: Position) {
    if (!ready || paused || pending.current || current.current.outcome !== "active") return;
    if (same(position, current.current.position)) return;
    const move = moveToward(current.current, position);
    if (move) take(move); else { if (teaching) setCue(DISTANT_CUE); else setNotice(DISTANT_CUE); }
  }
  function skipGuidance() { setGuidanceOff(true); setCue(null); setLensDecision(false); onSkipGuidance?.(); }
  function gather() { setLensDecision(false); gameRef.current?.focus({ preventScroll: true }); }
  function finish(again: boolean) {
    if (current.current.outcome === "active" || pending.current || (!ready && !current.current.story) || blocked || filed.current) return;
    finishAttempted.current = true;
    const saved = onFinish(current.current, again);
    if (saved) filed.current = true;
    setFinishError(!saved);
  }
  function leave() {
    if (blocked) return;
    if (current.current.outcome !== "active") finish(false); else onLeave();
  }
  useEffect(() => {
    if ((!state.story || explicitFinish.current) && over && ready && !blocked && !finishAttempted.current) finish(false);
  }, [state.story, over, ready, blocked, onFinish]);
  useEffect(() => {
    function keys(event: KeyboardEvent) {
      if (event.defaultPrevented || event.isComposing || event.repeat || event.metaKey || event.ctrlKey || event.altKey || guide || current.current.outcome !== "active") return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !gameRef.current?.contains(target) || !gameRef.current.contains(document.activeElement)) return;
      if (event.key === "Escape" && cue) { event.preventDefault(); setCue(null); return; }
      if (target.closest("button,a,summary,input,textarea,select,[contenteditable]:not([contenteditable=false]),dialog,[role=dialog],[role=slider],[role=tablist],.exp-input-reading")) return;
      const key = event.key.toLowerCase(), move = KEYS[key];
      if (!move && key !== "i") return;
      event.preventDefault();
      if (move) take(move); else openGuide();
    }
    window.addEventListener("keydown", keys); return () => window.removeEventListener("keydown", keys);
  });

  const prizeHome = !!state.story && state.banked.includes(state.story);
  const prizeSafety = seen.story && (seen.banked.includes(seen.story) ? "safe" : seen.pack.includes(seen.story) ? "carried" : null);
  const prizeLabel = seen.story === "lens" ? "Lens" : seen.story === "vane" ? "Vane" : "Moth";
  const advice = returnAdvice(seen);
  const title = state.outcome === "rescued" ? "Bram wades out for Mochi." : state.outcome === "turned" ? "The tide turns." : "Home for the day.";
  const lockControls = !ready || paused || busy;
  const feedback = <div className="exp-feedback passage-feedback" data-testid="tide-feedback" role="status" aria-live="polite">{cue ?? notice}</div>;

  return <main ref={gameRef} tabIndex={0} aria-describedby={!over ? "tide-input-hints" : undefined} onPointerDownCapture={event => { if (event.target instanceof HTMLCanvasElement) gameRef.current?.focus({ preventScroll: true }); }} className="exp-game passage-game tide-run" data-mode="court" data-testid="tide-run" data-story={state.story} data-seed={state.seed} data-beat={state.beat} data-wave={state.wave}
      data-outcome={state.outcome} data-busy={busy} data-score={state.score} data-hearts={state.hearts} data-buttons-open={openButtons}>
    <TideWorld key={sceneKey} snapshot={snapshot} transition={result} presentationId={serial.current} paused={paused}
      onReady={() => setReady(true)} onFault={message => { setFault(message); setReady(false); pending.current = null; acceptedLesson.current = null; setResult(null); setCue(null); setNotice(""); }}
      onBeat={beat} onSettled={settle} onTarget={target} onMove={take} onInspect={openGuide} />
    <header className="exp-mast"><div className="exp-brand">familiar.<small>Played and saved on this device</small></div>
      <h1 className="exp-place">{chapter ? chapter.title : "Today’s Tide Run"}</h1>
      <div className="passage-header-actions">
        <button className="tide-sound" aria-pressed={soundOn} aria-label={soundOn ? "Mute game audio" : "Enable game audio"} onClick={onToggleSound}>{icon(soundOn ? "m11 4-6 5H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" : "m11 4-6 5H2v6h3l6 5V4Zm5 5 6 6m0-6-6 6")}</button>
        <button className="passage-leave" data-testid="tide-leave" aria-describedby={!over ? "tide-pause-explanation" : undefined} onClick={leave} disabled={blocked || busy}>{over ? "Return to the harbor" : "Pause outing"}</button>
      </div></header>
    <section className="exp-hud tide-hud" aria-label="Tide status">
      <img className="tide-portrait" src={seen.hearts < HEARTS ? "/assets/ui/mochi-portrait-splashed.webp" : "/assets/ui/mochi-portrait.webp"} width="48" height="48" alt=""/>
      <div className="tide-vitals"><strong>Wave {Math.min(seen.wave + 1, waves)}/{waves}</strong>
        <span className="tide-hearts" role="img" aria-label={`${seen.hearts} of ${HEARTS} hearts`}>{Array.from({ length: HEARTS }, (_, i) => <span key={i} className={i < seen.hearts ? "tide-heart-full" : "tide-heart-empty"}>{icon(HEART)}</span>)}</span>
      </div>
      <span className="tide-tally">{icon(BAG)}<span>Pack <b>{used}/{PACK_SLOTS}</b></span></span>
      <span className="tide-tally">{icon(HOME)}<span>Score <b data-testid="tide-score">{seen.score}</b></span></span>
      <span className="tide-sr">Mochi: wave {Math.min(seen.wave + 1, waves)} of {waves}, {seen.hearts} of {HEARTS} hearts, pack {used} of {PACK_SLOTS} slots, score {seen.score}, {seen.splashes === 0 ? "dry paws" : `splashed ${seen.splashes} ${seen.splashes === 1 ? "time" : "times"}`}.</span>
    </section>
    {fault ? <section className="exp-fault" role="alert"><p>{fault}</p><button onClick={() => { setFault(""); setSceneKey(key => key + 1); }}>Reopen the tide</button></section>
      : !ready && !over ? <section className="exp-paused" role="status">Opening the tide…</section> : null}
    {blocked ? <p className="exp-paused" role="status">This tide is paused while another view holds the harbor.</p> : away && !guide ? <p className="exp-paused">Mochi is waiting. Return to this window to continue.</p> : null}
    {over && (state.story || finishError) && <section className="exp-departure passage-finish tide-finish" aria-label="The tide is over">
      <div><img className="tide-finish-portrait" src={state.outcome === "rescued" ? "/assets/ui/mochi-portrait-splashed.webp" : "/assets/ui/mochi-portrait-proud.webp"} width="80" height="80" alt=""/><h2>{title}</h2>
        {state.story ? <p>{prizeHome ? `The ${itemName(state.story)} is safe. Score: ${state.score}. Return to the harbor to continue.` : `The ${itemName(state.story)} is back in its shell. You can try the same tide again.`}</p>
          : <p>Score: {state.score}. Bram guessed {guess}.</p>}
        {feedback}
        {finishError && <p role="alert">This return could not be saved. Keep this finished outing open and try again when this browser can save.</p>}
      </div>
      <div className="tide-finish-actions">
        <button className="exp-primary" data-testid="tide-finish" disabled={blocked} onClick={() => finish(false)}>{icon(HOME)}Return to the harbor</button>
        {state.story && !prizeHome && <button className="exp-text-button" data-testid="tide-again" disabled={blocked} onClick={() => finish(true)}>Try this tide again</button>}
      </div>
    </section>}
    {!over && <section className="exp-command-tray passage-tray" aria-label="Guide Mochi" tabIndex={openButtons ? 0 : undefined} onKeyDown={scrollReadingRegion}>
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
      {prizeSafety && <p className="tide-prize-status" data-testid="tide-prize-status" role="status">{prizeLabel} {prizeSafety}</p>}
      {prizeSafety === "safe" && <div className="tide-bank-actions"><button className="exp-primary" data-testid="tide-finish-return" data-move="home" disabled={lockControls || !legal.includes("home")} onClick={() => take("home")}>Finish and return</button><button className="exp-text-button" disabled={lockControls} onClick={() => gameRef.current?.focus({ preventScroll: true })}>Keep gathering</button></div>}
      <div className="tide-controls">
      <ControlHints reading={<div className="tide-tray-reading">
      {chapter && <div className="exp-objective-row"><p className="exp-objective">{chapter.goal}</p></div>}
      {advice && <p className="tide-return-advice">{advice}</p>}
      <p className={`exp-forecast${countdown(seen) === 1 ? " tide-forecast-soon" : ""}`} data-testid="tide-forecast" aria-live="polite">{icon(WAVE)}<span>{state.outcome === "active" ? forecast(seen.outcome === "active" ? seen : state) : ""}</span></p>
      <span className="exp-sr-only">Mochi is at {where(seen.position)}. The bridge is at the {LANES[seen.bridge]} lane.</span>
      {feedback}
      {cue && <button className="exp-text-button tide-dismiss-cue" onClick={() => setCue(null)}>Dismiss cue</button>}
      <p className="tide-dock-instruction">Step onto the center dock to bank cargo. Banking keeps the outing open.</p>
      <p className="tide-pause-explanation" id="tide-pause-explanation">Pause returns you to the harbor with this outing still open.</p>
      </div>} id="tide-input-hints" buttonsOpen={openButtons} onButtonsOpenChange={open => { setLocalButtonsOpen(open); onButtonsOpenChange?.(open); }} context={worldActions.includes("home") ? "Tap Finish to end the outing · tap Wait." : "Tap Wait · prizes collect as you step."} keyboardContext="Space waits · R finishes at the dock · I opens the guide">
      <div className="exp-current-controls"><div className="exp-directions" aria-label="Movement">
        {STEPS.map(move => <button key={move} className={`exp-${move}`} data-move={move} aria-label={`Move ${move}`} disabled={lockControls || !legal.includes(move)} onClick={() => take(move)}>{icon(ARROWS[move])}</button>)}
        <button className="exp-wait" data-move="wait" aria-label="Wait one move" disabled={lockControls} onClick={() => take("wait")}>Wait</button>
      </div><div className="exp-context-actions">
        {legal.includes("home") && state.moves.length > 0 && prizeSafety !== "safe" && <button className="exp-text-button" data-move="home" aria-keyshortcuts="R" disabled={lockControls} onClick={() => take("home")}>Finish and return</button>}
      </div></div>
      </ControlHints>
      <button ref={guideButton} className="exp-inspect-button tide-guide-control" data-testid="tide-guide" disabled={lockControls} onClick={() => openGuide(guideButton.current)}>How it works</button>
      </div>
    </section>}
    {guide && <dialog ref={dialog} className="exp-panel passage-panel" aria-labelledby="tide-guide-title" onCancel={event => { event.preventDefault(); setGuide(false); }}>
      <header className="exp-panel-header"><h2 id="tide-guide-title">How Tide Run works</h2><button className="exp-close" autoFocus aria-label="Close panel" onClick={() => setGuide(false)}>{icon("m6 6 12 12M18 6 6 18")}</button></header>
      <div className="exp-panel-body" tabIndex={0} role="region" aria-label="Tide Run rules" onKeyDown={scrollReadingRegion}><TideRunRules story={initial.story}/></div>
      {teaching && <button className="exp-text-button" onClick={skipGuidance}>Skip guidance</button>}
    </dialog>}
    {lensDecision && <dialog ref={decisionDialog} data-testid="tide-lens-decision" className="exp-panel passage-panel tide-lens-decision" aria-labelledby="lens-decision-title" aria-describedby="lens-decision-copy" onCancel={event => { event.preventDefault(); gather(); }}>
      <h2 ref={decisionHeading} tabIndex={-1} id="lens-decision-title">Lens safe</h2>
      <p id="lens-decision-copy">{LENS_SAFE_CUE}</p>
      <div className="tide-finish-actions">
        <button className="exp-primary" onClick={() => { setLensDecision(false); take("home", true); }}>Finish and return</button>
        <button className="exp-secondary" onClick={gather}>Keep gathering</button>
        <button className="exp-text-button" onClick={skipGuidance}>Skip guidance</button>
      </div>
    </dialog>}
  </main>;
}
