import { useEffect, useRef, useState } from "react";
import { planUrl } from "../plan-url";
import { MochiActor } from "../motion/MochiActor";
import { MOCHI_POSES, type MochiPoseName } from "../motion/mochi";
import {
  ACTION_LIMIT,
  applyAction,
  legalActions,
  packSlots,
  phaseOf,
  startOuting,
  type Action,
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
  readHome,
  writeHome,
  type Home,
} from "./home";
import "./outing.css";

const art = "/assets/first-light-motion/";
const lanes: Lane[] = ["left", "center", "right"];
const positions = { left: 20, center: 50, right: 79 };
const items: Record<Item, string> = {
  lens: "Beacon Lens",
  chart: "Moonpool Chart",
  moth: "Wind-moth",
  salvage: "Salvage",
};
const title = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
const checklist =
  "Open both shells with the Rope, then return to Center without losing Resolve.";

function actionLabel(action: Action) {
  if (action === "wait") return "Wait";
  if (action === "return") return "Return to harbor";
  const [verb, target] = action.split(":");
  if (verb === "move" || verb === "lure")
    return `${title(verb)} ${title(target!)}`;
  if (action === "take:moth") return "Rescue wind-moth";
  if (action === "take:chart") return "Copy chart";
  return `${verb === "reel" ? "Reel" : "Take"} ${target === "lens" ? "lens" : "salvage"}`;
}

function lastTurn(run: Run) {
  const action = run.actions.at(-1);
  if (!action)
    return "Mochi tests the stone with one paw. A hairline crack crosses the shell on the left.";
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
    result.push(`The wave struck ${wave.lane}.`);
    if (wave.opened) result.push(`The ${wave.lane} shell split open.`);
    result.push(
      wave.hit
        ? `Mochi took a splash. ${run.resolve} Resolve left.`
        : "Mochi stayed dry.",
    );
  } else if (run.locked) {
    result.push(
      `The Tidekeeper marked ${run.locked}. Mochi watches its claws.`,
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
  run,
  home,
  resting,
  igniting,
  inspected,
  inspect,
}: {
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
      className={`of-stage ${atCourt ? "at-court" : "at-home"}`}
      data-testid="outing-scene"
      data-lit={home.lit}
      data-igniting={igniting}
      aria-label={atCourt ? "Beacon Court playfield" : "Pocket Harbor"}
    >
      <div className="of-stage-art" aria-hidden="true">
        <img
          className="of-backdrop"
          src={`${art}${atCourt ? "arena" : "harbor"}.webp`}
          alt=""
        />
        {run ? (
          <>
            <img
              className={`of-guardian phase-${phaseOf(run).toLowerCase()}`}
              src={`${art}tidekeeper.webp`}
              alt=""
            />
            {(["left", "right"] as const).map((lane) => (
              <LaneShell
                key={lane}
                lane={lane}
                opened={run.opened.includes(lane)}
              />
            ))}
            {run.opened.includes("left") &&
              ![...run.cargo, ...run.banked].includes("lens") && (
                <img className="of-lens" src={`${art}lens.webp`} alt="" />
              )}
            {run.opened.includes("right") &&
              ![...run.cargo, ...run.banked].includes("moth") && (
                <img className="of-wild-moth" src={`${art}moth.webp`} alt="" />
              )}
            {run.locked && (
              <div
                className="of-strike"
                style={{ left: `${positions[run.locked]}%` }}
              >
                <span>Wave target</span>
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
          </>
        )}
      </div>
      <div className="of-place">
        {atCourt ? "Beacon Court" : "Pocket Harbor"}
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
                {run.locked === lane
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

export function Outing() {
  const [initial] = useState(readHome);
  const [home, setHome] = useState(initial.home);
  const [storage, setStorage] = useState<string>(initial.storage);
  const [visited, setVisited] = useState<Run | null>(null);
  const [tool, setTool] = useState<Tool>("rope");
  const [inspected, setInspected] = useState<Lane | null>(null);
  const [toolMenu, setToolMenu] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resting, setResting] = useState(false);
  const [igniting, setIgniting] = useState(false);
  const [invite] = useState(challengeRequested);
  const [challenge, setChallenge] = useState(initial.home.challengeActive);
  const [busy, setBusy] = useState(false);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const toolToggle = useRef<HTMLButtonElement>(null);
  const run = home.active;
  const legal = run ? legalActions(run) : [];
  const free = run ? 3 - packSlots(run.cargo) : 3;
  const escaped = visited?.outcome === "rescued";
  const canInstall = home.bank.includes("lens") && !home.lit;
  const declaringGoal = challenge && !run;
  const restoredNow =
    !!visited && !escaped && visited.cargo.includes("lens") && home.lit;
  const quietGesture = home.bank.includes("moth")
    ? "Mochi scoots over. The wind-moth settles on the stone between you."
    : home.lit
      ? "Mochi pats the stone beside him. You sit together until the beam comes round again."
      : "Mochi leaves a paw’s width of space beside him. A little water drips through the boards.";

  useEffect(() => {
    document.title = "The Broken Beacon · Familiar";
    return () => {
      if (settle.current) clearTimeout(settle.current);
    };
  }, []);

  function save(next: Home) {
    if (storage === "ready" && !writeHome(next)) setStorage("unsaved");
    setHome(next);
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
      active: startOuting(selected, home.bank),
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

  const actionButton = (action: Action, label = actionLabel(action)) => (
    <button
      key={action}
      type="button"
      data-action={action}
      className={action === "return" ? "of-return" : "of-action"}
      disabled={!legal.includes(action)}
      aria-disabled={busy || !legal.includes(action)}
      onClick={(event) => commit(action, event.detail === 0)}
    >
      {label}
    </button>
  );
  const missingPack =
    run &&
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
                      ? `After your action, the wave will strike ${title(run.locked)}.`
                      : "The water will pass without a marked lane."}
              </p>
              <p className="of-next-goal">
                {challenge
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
              {note && (
                <div className="of-inspection">
                  <b>{title(inspected!)} lane</b>
                  <p>{note}</p>
                  <button onClick={() => setInspected(null)}>
                    Close inspection
                  </button>
                </div>
              )}
              <div className="of-moves" aria-label="Choose a lane">
                {lanes.map((lane) => actionButton(`move:${lane}`))}
              </div>
              <div className="of-actions">
                {actionButton("wait")}
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
                  <p>Redirect the lock. Mochi stays here. Uses one charge.</p>
                  {legal
                    .filter((a) => a.startsWith("lure:"))
                    .map((a) => actionButton(a))}
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
                  opens a shell in its path. Spend one action at Center to
                  return, even on the last turn.
                </p>
                <p>
                  {run.tool === "rope"
                    ? "Rope reels an exposed lens or salvage from another lane. The moth needs a personal visit."
                    : "The Lantern redirects a locked wave during Surge. At Center it can also copy the chart, even with no charges left."}{" "}
                  Inspect any lane freely.
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
                    : canInstall
                      ? "The lens is home."
                      : escaped
                        ? visited!.resolve === 0
                          ? "Carried home."
                          : "The tide closed in."
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
                    : canInstall
                      ? "Bram lifts the glass from Mochi’s satchel. It fits the empty lantern room."
                      : escaped
                        ? visited!.resolve === 0
                          ? "The last wave carried Mochi back to the dock. An empty satchel, a dry towel, and Bram waiting."
                          : "The tide closed the route before Mochi could return. His satchel is empty. Bram has put the kettle on."
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
                    setIgniting(true);
                    save(installLens(home));
                    focusChapter();
                  }}
                >
                  Restore the beacon
                </button>
              )}
              {!visited && !resting && !canInstall && (
                <>
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
              {visited && !canInstall && (
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
                  <button className="of-secondary" onClick={chooseChallenge}>
                    Try the two-shell challenge
                  </button>
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
              {visited && visited.outcome === "returned" && (
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
        <span>First Light · The Broken Beacon</span>
      </footer>
    </main>
  );
}
