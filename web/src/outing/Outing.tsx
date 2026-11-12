import { useEffect, useRef, useState, type RefObject } from "react";
import { planUrl } from "../plan-url";
import { MochiActor } from "../motion/MochiActor";
import { MOCHI_POSES, type MochiPoseName } from "../motion/mochi";
import { lanes, useCourtControls } from "./controls";
import {
  ACTION_LIMIT,
  applyAction,
  legalActions,
  packSlots,
  phaseOf,
  startOuting,
  waveExit,
  type Action,
  type Area,
  type Item,
  type Lane,
  type Outing as Run,
  type Tool,
} from "./engine";
import {
  bankRun,
  challengeMet,
  challengeRequested,
  challengeText,
  installLens,
  installVane,
  readHome,
  writeHome,
  type Home,
} from "./home";
import "./outing.css";

const art = "/assets/first-light-motion/";
const positions = { left: 20, center: 50, right: 79 };
const items: Record<Item, string> = {
  lens: "Beacon Lens",
  chart: "Moonpool Chart",
  moth: "Wind-moth",
  salvage: "Salvage",
  vane: "Signal Vane",
};
const title = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const checklist =
  "Open both shells with the Rope, then return to Center without losing Resolve.";

function actionLabel(action: Action) {
  if (action === "wait") return "Wait";
  if (action === "return") return "Return to harbor";
  if (action === "turn:vane") return "Turn vane";
  const [verb, target] = action.split(":");
  if (verb === "move" || verb === "lure")
    return `${title(verb)} ${title(target!)}`;
  if (action === "take:moth") return "Rescue wind-moth";
  if (action === "take:chart") return "Copy chart";
  return `${verb === "reel" ? "Reel" : "Take"} ${target}`;
}

function lastTurn(run: Run) {
  const action = run.actions.at(-1);
  if (!action)
    return run.area === "wind"
      ? "Mochi follows a channel with one paw. “The water goes in one way and comes out another.”"
      : "Mochi tests the stone with one paw. A hairline crack crosses the shell on the left.";
  const wave = run.waves.at(-1);
  const result: string[] = [];
  if (action.startsWith("take:") || action.startsWith("reel:")) {
    const item = action.split(":")[1] as Item;
    result.push(
      item === "moth"
        ? "The wind-moth settles in the pack."
        : `${items[item]} secured in the pack.`,
    );
  }
  if (wave?.turn === run.turn) {
    result.push(run.area === "wind"
      ? `The wave entered ${wave.source} and struck ${wave.lane}.`
      : `The wave struck ${wave.lane}.`);
    if (wave.opened) result.push(run.area === "wind"
      ? `The ${wave.lane} socket charged.`
      : `The ${wave.lane} shell split open.`);
    result.push(
      wave.hit
        ? `Mochi took a splash. ${run.resolve} Resolve left.`
        : "Mochi stayed dry.",
    );
  } else if (run.locked) {
    result.push(
      run.area === "wind"
        ? `The Tidekeeper marked ${run.locked}. The channel leads to ${waveExit(run)}.`
        : `The Tidekeeper marked ${run.locked}. Mochi watches its claws.`,
    );
  } else if (!result.length) {
    result.push(
      action.startsWith("move:")
        ? `Mochi crossed to ${run.lane}.`
        : `Mochi held position in ${run.lane}.`,
    );
  }
  return result.join(" ");
}

function LaneShell({
  lane,
  opened,
}: {
  lane: "left" | "right";
  opened: boolean;
}) {
  return (
    <span
      aria-hidden="true"
      className={`of-shell of-shell-${lane}${opened ? " is-open" : ""}`}
    >
      <img src={`${art}shell.webp`} alt="" />
      <img src={`${art}shell.webp`} alt="" />
    </span>
  );
}

function heldPose(
  run: Run | null,
  home: Home,
  resting: boolean,
): MochiPoseName {
  if (!run) {
    if (resting) return "neutral";
    if (home.lit) return "relieved";
    return home.bank.includes("lens") ? "look-right" : "curious";
  }
  const wave = run.waves.at(-1);
  if (wave?.turn === run.turn) return wave.hit ? "startled" : "relieved";
  const last = run.actions.at(-1);
  if (last?.startsWith("reel:")) return "pull-in";
  if (last?.startsWith("take:")) return "reach-ready";
  if (run.locked) return "brace";
  if (last === "move:left") return "turn-left";
  if (last === "move:right") return "look-right";
  return "curious";
}

function Stage({
  board,
  run,
  home,
  resting,
  igniting,
  inspected,
  inspect,
}: {
  board: RefObject<HTMLElement | null>;
  run: Run | null;
  home: Home;
  resting: boolean;
  igniting: boolean;
  inspected: Lane | null;
  inspect: (lane: Lane) => void;
}) {
  const wave = run?.waves.at(-1);
  const arrival = run && wave?.turn === run.turn ? wave : null;
  const atCourt = !!run;
  const wind = run?.area === "wind";
  const name = heldPose(run, home, resting);
  const actor = (
    <MochiActor
      x={run ? positions[run.lane] : 44}
      y={run ? 61 : 83}
      pose={{
        pose: name,
        ...MOCHI_POSES[name],
        lift: 0,
        rotate: 0,
        scaleX: 1,
        scaleY: 1,
      }}
    />
  );
  return (
    <section
      ref={board}
      className={`of-stage ${atCourt ? "at-court" : "at-home"}${wind ? " at-wind" : ""}`}
      data-testid="outing-scene"
      data-lit={home.lit}
      data-signaled={home.signaled}
      data-igniting={igniting}
      aria-label={atCourt ? `${wind ? "Wind Gate" : "Beacon Court"} playfield` : "Pocket Harbor"}
      aria-describedby={atCourt ? "of-control-hint" : undefined}
    >
      <div className="of-stage-art" aria-hidden="true">
        <img
          className="of-backdrop"
          src={`${art}${wind ? "wind-gate-v1" : atCourt ? "arena" : "harbor"}.webp`}
          alt=""
        />
        {run ? (
          <>
            <img
              className={`of-guardian phase-${phaseOf(run).toLowerCase()}`}
              src={`${art}tidekeeper.webp`}
              alt=""
            />
            {!wind && (["left", "right"] as const).map((lane) => (
              <LaneShell
                key={lane}
                lane={lane}
                opened={run.opened.includes(lane)}
              />
            ))}
            {!wind && run.opened.includes("left") &&
              ![...run.cargo, ...run.banked].includes("lens") && (
                <img className="of-lens" src={`${art}lens.webp`} alt="" />
              )}
            {!wind && run.opened.includes("right") &&
              ![...run.cargo, ...run.banked].includes("moth") && (
                <img className="of-wild-moth" src={`${art}moth.webp`} alt="" />
              )}
            {wind && <>
              <div className="of-vane" data-orientation={run.orientation}>
                <i style={{ transform: `rotate(${run.orientation * 120}deg)` }} />
              </div>
              {(["left", "center"] as const).map(lane => (
                <span key={lane} className={`of-socket of-socket-${lane}`} data-charged={run.opened.includes(lane)}>
                  {run.opened.includes(lane) ? "Charged" : "Unlit"}
                </span>
              ))}
              {run.opened.includes("left") && run.opened.includes("center") &&
                ![...run.cargo, ...run.banked].includes("vane") &&
                <span className="of-vane-find">Vane ready</span>}
            </>}
            {run.locked && wind && (
              <div className="of-source" style={{ left: `${positions[run.locked]}%` }}>
                Source
              </div>
            )}
            {run.locked && (
              <div
                className="of-strike"
                style={{ left: `${positions[waveExit(run)!]}%` }}
              >
                <span>{wind ? "Wave exit" : "Wave target"}</span>
              </div>
            )}
            {actor}
            {arrival && (
              <img
                key={arrival.turn}
                className="of-wave"
                style={{ left: `${positions[arrival.lane]}%` }}
                src={`${art}wave.webp`}
                alt=""
              />
            )}
          </>
        ) : (
          <>
            <img className="of-home-bram" src={`${art}bram.webp`} alt="" />
            {actor}
            {home.lit && (
              <>
                <i className="of-beam" />
                <i className="of-lamp" />
              </>
            )}
            {home.bank.includes("moth") && (
              <img className="of-home-moth" src={`${art}moth.webp`} alt="" />
            )}
            {home.lit && <div className="of-signal-post" data-repaired={home.signaled}><i /></div>}
          </>
        )}
      </div>
      <div className="of-place">
        {atCourt ? wind ? "Wind Gate" : "Beacon Court" : "Pocket Harbor"}
      </div>
      {run && (
        <div className="of-lanes" aria-label="Inspect a lane for free">
          {lanes.map((lane) => (
            <button
              key={lane}
              type="button"
              onClick={() => inspect(lane)}
              aria-label={`Inspect ${title(lane)}`}
              aria-pressed={inspected === lane}
              data-here={run.lane === lane}
            >
              {title(lane)}
              <small>
                {wind && waveExit(run) === lane
                  ? "Exit"
                  : run.locked === lane
                  ? "Marked"
                  : run.lane === lane
                    ? "Mochi"
                    : "Inspect"}
              </small>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function inspection(run: Run, lane: Lane) {
  const found = (item: Item) =>
    run.banked.includes(item) || run.cargo.includes(item);
  if (run.area === "wind") {
    const mapping = `${title(lane)} source exits ${title(waveExit(run, lane)!)}.`;
    const socket = lane === "right" ? "No required socket here."
      : `The ${lane} socket is ${run.opened.includes(lane) ? "charged" : "unlit"}.`;
    const center = lane === "center"
      ? ` Turn the vane here for one action. Return here to bank your finds. ${found("vane")
        ? "The Signal Vane is already secured."
        : run.opened.includes("left") && run.opened.includes("center")
          ? "The Signal Vane is exposed. Take it here, or Reel from another lane."
          : "Charge Left and Center to release the Signal Vane."}`
      : "";
    return `${mapping} ${socket}${center}`;
  }
  if (lane === "center") {
    return found("chart")
      ? "The center steps lead home. The Moonpool Chart is already recorded."
      : "The center steps lead home. With the Lantern, you can copy the Moonpool Chart here for one slot.";
  }

  const opened = run.opened.includes(lane);
  if (lane === "right") {
    if (found("moth")) return "The old nest is empty. The wind-moth is safe.";
    return opened
      ? "The wind-moth waits in its open nest. Rescue it here with two free slots."
      : "Wings stir behind the right shell. A wave here can open the nest.";
  }
  const finds = [];
  if (!found("lens")) finds.push("the Beacon Lens");
  if (!found("salvage")) finds.push("a piece of salvage");
  if (!finds.length)
    return opened
      ? "The shell is open. The lens cradle and salvage shelf are empty."
      : "The lens cradle and salvage shelf are empty. You can still open the shell for practice.";
  return opened
    ? `The shell is open. You can recover ${finds.join(" and ")} here. Each uses one slot.`
    : `A crack runs through this shell. A wave here can expose ${finds.join(" and ")}.`;
}

function WindRouting({ run }: { run: Run }) {
  const turned = { ...run, orientation: ((run.orientation + 1) % 3) as 0 | 1 | 2 };
  return <section className="of-routing" aria-label="Wind Gate channels"
    data-testid="wind-routing" data-source={run.locked ?? ""}
    data-exit={waveExit(run) ?? ""} data-orientation={run.orientation}>
    <h2>Follow the channel</h2>
    <dl className="of-channel-map">
      {lanes.map(source => <div key={source} data-locked={run.locked === source}>
        <dt>{title(source)} source</dt><dd>→ {title(waveExit(run, source)!)}</dd>
      </div>)}
    </dl>
    <div className="of-socket-status" aria-label="Required sockets">
      {(["left", "center"] as const).map(lane => <span key={lane}
        data-testid={`wind-socket-${lane}`} data-charged={run.opened.includes(lane)}>
        {title(lane)} socket · {run.opened.includes(lane) ? "charged" : "unlit"}
      </span>)}
    </div>
    <p id="of-vane-preview">{run.lane !== "center"
      ? "Turn the vane at Center. Each turn moves all exits one lane onward."
      : run.locked
        ? `Turning now sends source ${title(run.locked)} to exit ${title(waveExit(turned)!)}. ${phaseOf(run) === "Surge" ? "It strikes after this turn." : "The channel changes before the next lock."}`
        : `After a turn, Left exits ${title(waveExit(turned, "left")!)}, Center exits ${title(waveExit(turned, "center")!)}, Right exits ${title(waveExit(turned, "right")!)}. Costs one action.`}</p>
  </section>;
}

export function Outing() {
  const [initial] = useState(readHome);
  const [home, setHome] = useState(initial.home);
  const [storage, setStorage] = useState<string>(initial.storage);
  const [visited, setVisited] = useState<Run | null>(null);
  const [tool, setTool] = useState<Tool>("rope");
  const [destination, setDestination] = useState<Area>("beacon");
  const [inspected, setInspected] = useState<Lane | null>(null);
  const [toolMenu, setToolMenu] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resting, setResting] = useState(false);
  const [igniting, setIgniting] = useState(false);
  const [invite] = useState(challengeRequested);
  const [challenge, setChallenge] = useState(initial.home.challengeActive);
  const [busy, setBusy] = useState(false);
  const [restoreProblem, setRestoreProblem] = useState(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const toolToggle = useRef<HTMLButtonElement>(null);
  const run = home.active;
  const legal = run ? legalActions(run) : [];
  const free = run ? 3 - packSlots(run.cargo) : 3;
  const escaped = visited?.outcome === "rescued";
  const canInstall = home.bank.includes("lens") && !home.lit;
  const canInstallVane = home.lit && home.bank.includes("vane") && !home.signaled;
  const declaringGoal = challenge && !run;
  const restoredNow =
    !!visited && !escaped && visited.cargo.includes("lens") && home.lit;
  const signalRestoredNow =
    !!visited && !escaped && visited.cargo.includes("vane") && home.signaled;
  const quietGesture = home.bank.includes("moth")
    ? "Mochi scoots over. The wind-moth settles on the stone between you."
    : home.lit
      ? "Mochi pats the stone beside him. You sit together until the beam comes round again."
      : "Mochi leaves a paw’s width of space beside him. A little water drips through the boards.";

  useEffect(() => {
    document.title = `${run?.area === "wind" ? "Wind Gate" : "The Broken Beacon"} · Familiar`;
  }, [run?.area]);

  useEffect(() => {
    return () => {
      if (settle.current) clearTimeout(settle.current);
    };
  }, []);

  function save(next: Home) {
    if (storage === "ready" && !writeHome(next)) setStorage("unsaved");
    setHome(next);
  }

  function restore(next: Home) {
    // Durable installation keeps the earned relic available when storage needs a retry.
    if ((storage === "ready" || storage === "unsaved") && !writeHome(next)) {
      setRestoreProblem(true);
      return;
    }
    if (storage === "unsaved") setStorage("ready");
    setRestoreProblem(false);
    setHome(next);
    setIgniting(true);
    focusChapter();
  }

  function focusChapter() {
    requestAnimationFrame(() =>
      heading.current?.focus({ preventScroll: true }),
    );
  }

  function begin(selected: Tool, asChallenge = false) {
    if (home.active) return;
    setChallenge(asChallenge);
    setIgniting(false);
    setVisited(null);
    setResting(false);
    setSharing(false);
    setInspected(null);
    setToolMenu(false);
    save({
      ...home,
      challengeActive: asChallenge,
      active: startOuting(selected, home.bank, asChallenge ? "beacon" : destination),
    });
    focusChapter();
  }

  function commit(action: Action, fromKeyboard = false) {
    if (!run || settle.current) return;
    const next = applyAction(run, action);
    if (next === run) return;
    setInspected(null);
    setToolMenu(false);
    if (next.outcome !== "active") {
      save(bankRun(home, next));
      setVisited(next);
      setResting(false);
      setSharing(false);
      setCopied(false);
      setChallenge(false);
      focusChapter();
      return;
    }
    save({ ...home, active: next });
    if (fromKeyboard)
      requestAnimationFrame(() => {
        if (document.activeElement === document.body)
          heading.current?.focus({ preventScroll: true });
      });
    setBusy(true);
    settle.current = setTimeout(() => {
      settle.current = null;
      setBusy(false);
    }, 220);
  }

  const board = useCourtControls(toolMenu || inspected || busy ? null : run, commit);
  const actionButton = (action: Action, label = actionLabel(action)) => (
    <button
      key={action}
      type="button"
      data-action={action}
      className={action === "return" ? "of-return" : "of-action"}
      disabled={!legal.includes(action)}
      aria-disabled={busy || !legal.includes(action)}
      onClick={(event) => commit(action, event.detail === 0)}
      aria-describedby={action === "turn:vane" ? "of-vane-preview" : undefined}
    >
      {label}
    </button>
  );
  const missingPack =
    run &&
    run.area === "beacon" &&
    !run.cargo.includes("lens") &&
    !run.banked.includes("lens") &&
    free <= 1;
  const nextTide = run ? phaseOf(run) : null;
  const note = run && inspected ? inspection(run, inspected) : null;
  const storageLabel =
    storage === "ready"
      ? home.active || home.memory || home.bank.length
        ? "Saved on this device"
        : "Local play · saves on this device"
      : storage === "invalid"
        ? "Earlier save unreadable · this visit only"
        : storage === "unsaved"
          ? "Progress only in this tab · reload to read the device save"
          : "This visit only · storage unavailable";

  async function copy() {
    if (!visited) return;
    try {
      await navigator.clipboard.writeText(challengeText(visited));
      setCopied(true);
    } catch {
      setCopied(false);
      document.querySelector<HTMLTextAreaElement>("#of-invite-text")?.select();
    }
  }

  function chooseChallenge() {
    setDestination("beacon");
    setChallenge(true);
    setTool("rope");
    setVisited(null);
    setResting(false);
    setSharing(false);
    focusChapter();
  }

  return (
    <main className="outing-root">
      <header className="of-mast">
        <a className="of-wordmark" href="/">
          familiar<span>.</span>
        </a>
        <nav aria-label="Familiar">
          <a href={planUrl}>Design book</a>
          <a href="/motion">Motion study</a>
        </nav>
      </header>
      <div className="of-layout">
        <div className="of-world">
          <Stage
            board={board}
            run={run}
            home={home}
            resting={resting}
            igniting={igniting}
            inspected={inspected}
            inspect={(lane) => setInspected(lane === inspected ? null : lane)}
          />
          {run ? (
            <div className="of-inventory" aria-label="Supplies">
              <span>
                <b>Resolve</b> {run.resolve} / 3
              </span>
              <span>
                <b>Pack</b> {packSlots(run.cargo)} / 3
              </span>
              <span>
                <b>{title(run.tool)}</b> {run.uses} uses
              </span>
            </div>
          ) : (
            <div className="of-harbor-state">
              <span className={home.lit ? "of-lit-dot" : "of-dark-dot"} />
              <span>{home.lit ? "Beacon lit" : "Beacon dark"}</span>
              {home.lit && <span>{home.signaled ? "Signal post repaired" : "Signal post missing its vane"}</span>}
              {home.bank.includes("moth") && (
                <span>Wind-moth in the garden</span>
              )}
            </div>
          )}
        </div>
        <section
          className="of-controls"
          aria-label={run ? "Outing controls" : "Harbor controls"}
        >
          {run ? (
            <>
              <div className="of-turn">
                <span>
                  Turn {run.turn + 1} of {ACTION_LIMIT}
                </span>
                <span>{title(run.lane)} lane</span>
              </div>
              <h1 ref={heading} tabIndex={-1}>
                {nextTide === "Low"
                  ? "Low tide"
                  : nextTide === "Rising"
                    ? "Rising tide"
                    : "Surge"}
              </h1>
              <p className="of-intent">
                {nextTide === "Low"
                  ? "The water is quiet. Choose where Mochi stands."
                  : nextTide === "Rising"
                    ? "After your action, the Tidekeeper will mark Mochi’s lane."
                    : run.locked
                      ? run.area === "wind"
                        ? `Source ${title(run.locked)}. After your action, the wave exits ${title(waveExit(run)!)}.`
                        : `After your action, the wave will strike ${title(run.locked)}.`
                      : "The water will pass without a marked lane."}
              </p>
              <p className="of-next-goal">
                {run.area === "wind"
                  ? run.cargo.includes("vane")
                    ? "Vane in the pack. Return at Center to bring it home."
                    : run.banked.includes("vane")
                      ? "Practice the channels. The Signal Vane is already home."
                      : run.opened.includes("left") && run.opened.includes("center")
                        ? "The Signal Vane is exposed at Center. Take or Reel it, then return."
                        : "The channel turns the wave. Charge the Left and Center sockets to release the Signal Vane."
                  : challenge
                  ? "Two-shell challenge: open both shells and bring Mochi home dry."
                  : run.cargo.includes("lens")
                    ? "Lens in the pack. Return at Center to bring it home."
                    : run.banked.includes("lens")
                      ? "Practice: open the left shell, or find a missing discovery."
                      : run.opened.includes("left")
                        ? run.tool === "rope" &&
                          run.uses > 0 &&
                          run.lane !== "left"
                          ? "The Beacon Lens is exposed. Reel it from here, or pick it up in Left."
                          : "The Beacon Lens is exposed. Pick it up in Left, then return at Center."
                        : "A wave can crack the left shell. Bring its Beacon Lens home."}
              </p>
              {run.area === "wind" && <WindRouting run={run} />}
              {note && (
                <div className="of-inspection">
                  <b>{title(inspected!)} lane</b>
                  <p>{note}</p>
                  <button onClick={() => setInspected(null)}>
                    Close inspection
                  </button>
                </div>
              )}
              <p id="of-control-hint" className="of-control-hint">
                <span className="of-key-hint">Use ← or → to move one lane.</span>
                <span className="of-touch-hint">Swipe across the scene to move one lane.</span>{" "}
                Each move spends one turn.
              </p>
              <div className="of-moves" aria-label="Choose a lane">
                {lanes.map((lane) => actionButton(`move:${lane}`))}
              </div>
              <div className="of-actions">
                {actionButton("wait")}
                {run.area === "wind" && actionButton("turn:vane", run.locked && run.lane === "center"
                  ? `Turn vane → exit ${title(waveExit({ ...run, orientation: ((run.orientation + 1) % 3) as 0 | 1 | 2 })!)}`
                  : "Turn vane")}
                {run.tool === "lantern" && (
                  <button
                    ref={toolToggle}
                    disabled={busy || !legal.some((a) => a.startsWith("lure:"))}
                    aria-expanded={toolMenu}
                    onClick={() => setToolMenu(!toolMenu)}
                  >
                    Lure wave
                  </button>
                )}
                {legal
                  .filter((a) => a.startsWith("take:") || a.startsWith("reel:"))
                  .map((a) => actionButton(a))}
                {actionButton(
                  "return",
                  run.lane === "center"
                    ? "Return to harbor"
                    : "Return at Center",
                )}
              </div>
              {toolMenu && (
                <div
                  className="of-tool-choices"
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setToolMenu(false);
                      toolToggle.current?.focus();
                    }
                  }}
                >
                  <p>{run.area === "wind"
                    ? "Choose a new source. The vane routes it to the shown exit. Mochi stays here. Uses one charge."
                    : "Redirect the lock. Mochi stays here. Uses one charge."}</p>
                  {legal
                    .filter((a) => a.startsWith("lure:"))
                    .map((a) => actionButton(a, run.area === "wind"
                      ? `Lure ${title(a.split(":")[1]!)} → exit ${title(waveExit(run, a.split(":")[1] as Lane)!)}`
                      : actionLabel(a)))}
                  <button
                    onClick={() => {
                      setToolMenu(false);
                      toolToggle.current?.focus();
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
              {run.turn >= 12 && (
                <p className="of-pressure">
                  {ACTION_LIMIT - run.turn} actions left, including the return
                  from Center.
                </p>
              )}
              {missingPack && (
                <p className="of-pressure">
                  {free === 1
                    ? "One slot left. Taking another find can fill the pack before the lens."
                    : "Pack full. You can bring these finds home and revisit the lens."}
                </p>
              )}
              <p className="of-event" aria-live="polite" aria-atomic="true">
                {lastTurn(run)}
              </p>
              <details className="of-guide">
                <summary>Pack & tide guide</summary>
                <p>
                  {run.cargo.length
                    ? run.cargo.map((i) => items[i]).join(" · ")
                    : "The pack is empty."}{" "}
                  {free} of 3 slots free.
                </p>
                <p>
                  Every action advances the tide once: Low, Rising, Surge. At
                  Rising, the guardian marks your lane after you act. A Surge
                  {run.area === "wind" ? "charges a socket at its exit." : "opens a shell in its path."} Spend one action at Center to
                  return, even on the last turn.
                </p>
                <p>
                  {run.area === "wind"
                    ? run.tool === "rope"
                      ? "Rope reels the exposed vane from another lane. Turn the vane at Center to change all three channels for one action."
                      : "Lantern chooses the locked source during Surge. The channel still decides its exit. Turn the vane at Center for one action."
                    : run.tool === "rope"
                    ? "Rope reels an exposed lens or salvage from another lane. The moth needs a personal visit."
                    : "The Lantern redirects a locked wave during Surge. At Center it can also copy the chart, even with no charges left."}{" "}
                  Tap or select a lane label to inspect it for free.
                </p>
              </details>
            </>
          ) : (
            <>
              <h1 ref={heading} tabIndex={-1}>
                {resting
                  ? "At the water’s edge."
                  : declaringGoal
                    ? "Two shells. Dry paws."
                    : canInstallVane
                      ? "A way through."
                    : canInstall
                      ? "The lens is home."
                      : escaped
                        ? visited!.resolve === 0
                          ? "Carried home."
                          : "The tide closed in."
                        : home.signaled
                          ? "The harbor finds its bearings."
                        : home.lit
                          ? "Home by first light."
                          : visited
                            ? visited.cargo.length
                              ? "Something came home."
                              : "Back on the dock."
                            : "The broken beacon."}
              </h1>
              <p className="of-intent">
                {resting
                  ? quietGesture
                  : declaringGoal
                    ? checklist
                    : canInstallVane
                      ? "Bram turns the little pointer in his hands. “That’s our missing vane. Let’s see where it was trying to send us.”"
                    : canInstall
                      ? "Bram lifts the glass from Mochi’s satchel. It fits the empty lantern room."
                      : escaped
                        ? visited!.resolve === 0
                          ? "The last wave carried Mochi back to the dock. An empty satchel, a dry towel, and Bram waiting."
                          : "The tide closed the route before Mochi could return. His satchel is empty. Bram has put the kettle on."
                        : signalRestoredNow
                          ? "The signal post turns toward the far channel. Mochi follows its point. Echo Basin lies beyond. That outing is still being built."
                        : restoredNow
                          ? "The light brushes the water. Bram sets down his towel. “There. The boats can find us again.”"
                          : visited && visited.cargo.length
                            ? `Brought home: ${visited.cargo.map((i) => items[i]).join(", ")}.`
                            : visited
                              ? `Mochi returned after ${visited.turn} ${visited.turn === 1 ? "action" : "actions"}.`
                              : home.lit
                                ? "The light crosses the bay. Mochi settles on the warm stone beside Bram."
                                : "Bring the missing lens back from Beacon Court and light the harbor again."}
              </p>
              {visited && (
                <p className="of-result">
                  {visited.turn} actions · {visited.resolve} / 3 Resolve
                  {visited.waves.length && !visited.waves.some((w) => w.hit)
                    ? " · dry paws"
                    : ""}
                  {challengeMet(visited)
                    ? " · two-shell challenge complete"
                    : ""}
                </p>
              )}
              {!resting && (home.memory || !home.lit) && (
                <div className="of-memory">
                  <b>
                    {home.memory ? "Mochi remembers" : "Bram, harbor baker"}
                  </b>
                  <p>
                    “
                    {home.memory ||
                      "The beacon’s dark. The tide left something shining across the bay."}
                    ”
                  </p>
                </div>
              )}
              {canInstall && (
                <button
                  className="of-primary"
                  data-action="install"
                  onClick={() => {
                    restore(installLens(home));
                  }}
                >
                  Restore the beacon
                </button>
              )}
              {canInstallVane && <button className="of-primary" data-action="install-vane" onClick={() => {
                restore(installVane(home));
              }}>Repair signal post</button>}
              {restoreProblem && <p role="alert" className="of-pressure">The repair could not be saved. Your find is still here. Try the repair again, or reload to read the device save.</p>}
              {!visited && !resting && !canInstall && !canInstallVane && (
                <>
                  {!declaringGoal && <>
                    <div className="of-destinations" role="group" aria-label="Choose destination">
                      <button aria-pressed={destination === "beacon"} onClick={() => setDestination("beacon")}>Beacon Court</button>
                      <button disabled={!home.lit} aria-pressed={destination === "wind"} onClick={() => setDestination("wind")}>Wind Gate</button>
                    </div>
                    <p className="of-destination-note">{destination === "wind"
                      ? "A Way Through. Route the tide into two sockets and bring the missing signal vane home."
                      : home.lit ? "Revisit the shells, or follow the light to Wind Gate."
                      : "Restore the beacon to open the route to Wind Gate."}</p>
                    {destination === "wind" && home.bank.includes("chart") && <details className="of-guide">
                      <summary>Moonpool Chart · Wind Gate</summary>
                      <p>The chart follows each inlet through the channel. On arrival, Left exits Center, Center exits Right, and Right exits Left. A turn moves each exit one lane onward, wrapping Right to Left.</p>
                      <p>The same live mapping is always available at the gate. Charge the Left and Center sockets to release the vane.</p>
                    </details>}
                  </>}
                  {!declaringGoal && (
                    <fieldset className="of-kits">
                      <legend>Choose your tool</legend>
                      {(["rope", "lantern"] as const).map((kit) => (
                        <label
                          key={kit}
                          className={tool === kit ? "selected" : ""}
                        >
                          <input
                            type="radio"
                            name="outing-tool"
                            value={kit}
                            checked={tool === kit}
                            onChange={() => setTool(kit)}
                          />
                          <span>
                            <b>{title(kit)}</b>
                            <small>
                              {kit === "rope"
                                ? "Reel a distant find. Two uses per outing."
                                : "Redirect a marked wave. Two uses per outing."}
                            </small>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                  )}
                  <button
                    className="of-primary"
                    data-action="depart"
                    onClick={() =>
                      begin(declaringGoal ? "rope" : tool, declaringGoal)
                    }
                  >
                    {declaringGoal ? "Start challenge" : "Set out with Mochi"}
                  </button>
                  {declaringGoal && (
                    <button
                      className="of-text"
                      onClick={() => setChallenge(false)}
                    >
                      Choose a regular outing
                    </button>
                  )}
                  {invite && !declaringGoal && (
                    <button className="of-secondary" onClick={chooseChallenge}>
                      Accept two-shell challenge
                    </button>
                  )}
                </>
              )}
              {visited && !canInstall && !canInstallVane && (
                <div className="of-home-actions">
                  <button
                    className="of-primary"
                    onClick={() => {
                      setVisited(null);
                      setResting(false);
                      setSharing(false);
                      focusChapter();
                    }}
                  >
                    {escaped ? "Try again" : "Prepare another outing"}
                  </button>
                  {visited.area === "beacon" && <button className="of-secondary" onClick={chooseChallenge}>
                    Try the two-shell challenge
                  </button>}
                  {!resting && (
                    <button
                      className="of-text"
                      onClick={() => {
                        setVisited(null);
                        setResting(true);
                        setSharing(false);
                      }}
                    >
                      Rest at the harbor
                    </button>
                  )}
                </div>
              )}
              {resting && (
                <button
                  className="of-text"
                  onClick={() => {
                    setResting(false);
                    focusChapter();
                  }}
                >
                  Prepare another outing
                </button>
              )}
              {visited?.area === "beacon" && visited.outcome === "returned" && (
                <div className="of-share">
                  <button
                    className="of-text"
                    aria-expanded={sharing}
                    onClick={() => {
                      setSharing(!sharing);
                      setCopied(false);
                    }}
                  >
                    Make a challenge
                  </button>
                  {sharing && (
                    <div>
                      <label htmlFor="of-invite-text">
                        Challenge invitation
                      </label>
                      <textarea
                        id="of-invite-text"
                        readOnly
                        value={challengeText(visited)}
                      />
                      <button className="of-secondary" onClick={copy}>
                        Copy invitation
                      </button>
                      <span role="status">
                        {copied ? "Copied." : "You can also select the text."}
                      </span>
                    </div>
                  )}
                </div>
              )}
              {!resting && !!home.bank.length && (
                <details className="of-guide">
                  <summary>Discoveries at home ({home.bank.length})</summary>
                  <p>{home.bank.map((i) => items[i]).join(" · ")}</p>
                </details>
              )}
            </>
          )}
        </section>
      </div>
      <footer className="of-footer">
        <span>{storageLabel}</span>
        <span>First Light · {run?.area === "wind" ? "A Way Through" : "The Broken Beacon"}</span>
      </footer>
    </main>
  );
}
