import { lazy, Suspense, useEffect, useRef, useState, type RefObject } from "react";
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
  newHome,
  bankRun,
  challengeMet,
  challengeRequested,
  challengeText,
  installLens,
  installVane,
  readHome,
  writeHome,
  previewLantern,
  provenanceBank,
  type Home,
} from "./home";
import { applyPlacement } from "../tidebound/domain";
import { LanternArt, Storycraft } from "../tidebound/Storycraft";
import "./outing.css";

import { preservePreview } from "../tidebound/adoption";
import type { ChainSnapshot } from "../tidebound/client";
import type { SocketId, MotifId } from "../tidebound/domain";
const AccountHarbor = lazy(()=>import("../account/HarborAccount").then(module=>({default:module.HarborAccount})));
type PlacedCraft = {motif:MotifId;socket:SocketId;polished:boolean};

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

function HarborIcon({kind}:{kind:"outing"|"workshop"|"account"|"menu"}) {
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="of-harbor-icon">
    {kind==="outing"?<><circle cx="12" cy="12" r="8.5"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2ZM12 1v2M12 21v2M1 12h2M21 12h2"/></>
      :kind==="workshop"?<><path d="M8 7V5a4 4 0 0 1 8 0v2M7 8h10l2 12H5L7 8ZM4 21h16M9 10v7M15 10v7"/><path d="m12 11-2 3 2 3 2-3-2-3Z"/></>
      :kind==="account"?<><path d="m3 11 9-8 9 8M5 10v11h14V10M9 21v-6h6v6"/><path d="M9 9h6"/></>
      :<><path d="M5 6h14M5 12h14M5 18h14"/><circle cx="3" cy="6" r=".5"/><circle cx="21" cy="18" r=".5"/></>}
  </svg>;
}

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
  if(run.outcome==="rescued") result.push(run.resolve===0
    ? "Mochi ran out of Resolve. Bram brought Mochi home; unbanked cargo stayed with the tide."
    : "The fifteenth action closed the route. Bram brought Mochi home; unbanked cargo stayed with the tide.");
  if(run.outcome==="returned") result.push("Mochi returned from Center before the incoming wave. The carried finds are safe at home.");
  return result.join(" ");
}

function waveConsequence(run:Run) {
  const wave=run.waves.at(-1)!;
  const opened=wave.opened ? `${title(wave.lane)} ${run.area==="wind"?"socket charged":"shell opened"}. ` : "";
  const route=run.area==="wind" ? `${title(wave.source)} → ${title(wave.lane)}. ` : `${title(wave.lane)} wave. `;
  return `${opened||route}${wave.hit?`Splash: ${run.resolve} Resolve left.`:"Mochi stayed dry."}`;
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
  canonicalLantern,
}: {
  board: RefObject<HTMLElement | null>;
  run: Run | null;
  home: Home;
  resting: boolean;
  igniting: boolean;
  inspected: Lane | null;
  inspect: (lane: Lane) => void;
  canonicalLantern?:PlacedCraft|null;
}) {
  const wave = run?.waves.at(-1);
  const arrival = run && wave?.turn === run.turn ? wave : null;
  const atCourt = !!run;
  const wind = run?.area === "wind";
  const name = heldPose(run, home, resting);
  const lantern = canonicalLantern === undefined ? home.storycraft.lantern : canonicalLantern;
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
      data-turn={run?run.turn+1:undefined}
      data-lit={home.lit}
      data-source={run?.locked??""}
      data-exit={run?waveExit(run)??"":""}
      data-orientation={run?.orientation}
      data-signaled={home.signaled}
      data-igniting={igniting}
      aria-label={atCourt ? `${wind ? "Wind Gate" : "Beacon Court"} playfield` : "Pocket Harbor"}
      aria-describedby={atCourt ? "of-control-hint" : undefined}
    >
      <img className="of-world-backdrop" src={`${art}${wind ? "wind-gate-v1" : atCourt ? "arena" : "harbor"}.webp`} alt=""/>
      <div className="of-scene-frame">
      <div className="of-stage-art" aria-hidden="true">
        <img
          className="of-backdrop"
          key={wind?"wind":atCourt?"beacon":"harbor"}
          src={`${art}${wind ? "wind-gate-v1" : atCourt ? "arena" : "harbor"}.webp`}
          alt=""
        />
        {run ? (
          <>
            <img
              key="tidekeeper"
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
                <span key={lane} className={`of-socket of-socket-${lane}`} data-testid={`wind-socket-${lane}`} data-charged={run.opened.includes(lane)}>
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
            <img key="bram" className="of-home-bram" src={`${art}bram.webp`} alt="" />
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
            {lantern && <span className="tb-home-lantern" data-testid="placed-lantern" data-socket={lantern.socket}>
              <LanternArt motif={lantern.motif} polished={canonicalLantern?.polished} />
            </span>}
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
      </div>
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
    data-testid="wind-channel-map" data-source={run.locked ?? ""}
    data-exit={waveExit(run) ?? ""} data-orientation={run.orientation}>
    <h2>Follow the channel</h2>
    <dl className="of-channel-map">
      {lanes.map(source => <div key={source} data-locked={run.locked === source}>
        <dt>{title(source)} source</dt><dd>→ {title(waveExit(run, source)!)}</dd>
      </div>)}
    </dl>
    <div className="of-socket-status" aria-label="Required sockets">
      {(["left", "center"] as const).map(lane => <span key={lane}
        data-charged={run.opened.includes(lane)}>
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
  const [accountStore,setAccountStore]=useState<Pick<Storage,"getItem"|"setItem">|undefined>();
  const [canonical,setCanonical]=useState<ChainSnapshot|null>(null);
  const ownedPlacement = canonical?.journey.placement;
  const placedItem = canonical?.items.find(item=>item.mint.token_id===ownedPlacement?.item_id);
  const canonicalLantern:PlacedCraft|null|undefined = canonical && accountStore ? placedItem && ownedPlacement
    ? {motif:placedItem.mint.motif,socket:ownedPlacement.socket,polished:placedItem.finish_used}:null : undefined;
  function accountSnapshot(next:ChainSnapshot|null) {
    setCanonical(next);
    if(!next && accountStore){const local=readHome();setHome(local.home);setStorage(local.storage);setAccountStore(undefined);setVisited(null);}
  }
  function useSavedHarbor(snapshot:ChainSnapshot) {
    if(home.active)return;
    const key=`familiar.tidebound.run.v1:${snapshot.binding.nearAccountId}`;
    const store={getItem:()=>localStorage.getItem(key),setItem:(_key:string,value:string)=>localStorage.setItem(key,value)};
    const cached=readHome(store);
    const j=snapshot.journey;
    const sameBank=JSON.stringify(cached.home.bank)===JSON.stringify(j.banked);
    const active=cached.home.active;
    const resumable=active && JSON.stringify(active.banked)===JSON.stringify(j.banked) && (active.area!=="wind" || j.lit);
    const next={...newHome(),bank:j.banked as Item[],lit:j.lit,signaled:j.signaled,
      ...(sameBank ? {active:resumable?active:null,storycraft:cached.home.storycraft,memory:cached.home.memory,challengeActive:cached.home.challengeActive}:{}),
    };
    preservePreview(localStorage,key,j.revision);
    const saved=cached.storage==="ready" && writeHome(next,store);
    setHome(next);setStorage(saved?"ready":cached.storage==="invalid"?"invalid":"unavailable");setAccountStore(store);setVisited(null);setCanonical(snapshot);setResting(false);
  }
  const [panel,setPanel] = useState<"outing"|"workshop"|"account"|"menu">("outing");
  const [view,setView] = useState("play");
  const [guidePage,setGuidePage] = useState(0);
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
    if (storage === "ready" && !writeHome(next,accountStore)) setStorage("unsaved");
    setHome(next);
  }

  function restore(next: Home) {
    // Durable installation keeps the earned relic available when storage needs a retry.
    if ((storage === "ready" || storage === "unsaved") && !writeHome(next,accountStore)) {
      setRestoreProblem(true);
      return;
    }
    if (storage === "unsaved") setStorage("ready");
    setRestoreProblem(false);
    setHome(next);
    setIgniting(true);
    focusChapter();
  }

  function changeStorycraft(next:Home): boolean {
    if (next === home) return false;
    if ((storage === "ready" || storage === "unsaved") && !writeHome(next,accountStore)) return false;
    if (storage === "unsaved") setStorage("ready");
    setHome(next);
    return true;
  }

  function focusChapter() {
    requestAnimationFrame(() =>
      heading.current?.focus({ preventScroll: true }),
    );
  }

  function begin(selected: Tool, asChallenge = false, recordOrigin = false) {
    if (home.active) return;
    setPanel("outing");setView("play");
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
      active: startOuting(selected, recordOrigin ? provenanceBank(home) : home.bank, asChallenge || recordOrigin ? "beacon" : destination),
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

  useEffect(()=>{
    if(!toolMenu&&!inspected)return;
    const close=(event:KeyboardEvent)=>{if(event.key!=="Escape")return;event.preventDefault();setToolMenu(false);setInspected(null);requestAnimationFrame(()=>{if(toolMenu)toolToggle.current?.focus({preventScroll:true});else heading.current?.focus({preventScroll:true});});};
    window.addEventListener("keydown",close);return()=>window.removeEventListener("keydown",close);
  },[toolMenu,inspected]);

  const board = useCourtControls(panel!=="outing" || view!=="play" || toolMenu || inspected || busy ? null : run, commit);
  const actionButton = (action: Action, label = actionLabel(action)) => (
    <button
      key={action}
      type="button"
      data-action={action}
      className={action === "return" ? "of-return" : "of-action"}
      disabled={!legal.includes(action)}
      aria-disabled={busy || !legal.includes(action)}
      onClick={(event) => commit(action, event.detail === 0)}
      aria-label={action === "turn:vane" ? `${label}. Moves all channel exits one lane onward.` : undefined}
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
  const resolvedWave=run?.waves.at(-1)?.turn===run?.turn && !!run?.waves.length;
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
      const text=document.querySelector(".of-invitation");
      if(text){const range=document.createRange();range.selectNodeContents(text);window.getSelection()?.removeAllRanges();window.getSelection()?.addRange(range);}
    }
  }

  function chooseChallenge() {
    setPanel("outing");setView("play");
    setDestination("beacon");
    setChallenge(true);
    setTool("rope");
    setVisited(null);
    setResting(false);
    setSharing(false);
    focusChapter();
  }

  function show(next:string) {
    setPanel("outing");setView(next);setInspected(null);setToolMenu(false);focusChapter();
  }
  const homeTitle = resting ? "At the water’s edge." : declaringGoal ? "Two shells. Dry paws." : canInstallVane ? "A way through." : canInstall ? "The lens is home." : escaped ? visited!.turn>=ACTION_LIMIT?"The tide closed in.":"Carried home." : home.signaled ? "The harbor finds its bearings." : home.lit ? "Home by first light." : "The broken beacon.";
  const homeIntent = resting ? quietGesture : declaringGoal ? checklist : canInstallVane ? "The Signal Vane is home. Fit it to the harbor’s signal post." : canInstall ? "The missing lens is safe. Restore the beacon so the boats can find home." : escaped ? visited!.turn>=ACTION_LIMIT?"The tide closed the route. Mochi is safe; the satchel is empty.":"Mochi is safe with Bram. The unbanked cargo stayed with the tide." : signalRestoredNow ? "The signal post points toward Echo Basin. That outing is still being built." : restoredNow ? "The light crosses the bay. Bram puts the kettle on." : visited ? visited.cargo.length ? `Brought home: ${visited.cargo.map(i=>items[i]).join(", ")}.` : `Mochi returned after ${visited.turn} actions.` : home.lit ? "Choose your next outing, or make a little light for home." : "Bring the missing lens back from Beacon Court and light the harbor again.";
  const tideGuide = [
    "Every action advances the tide: Low, Rising, Surge. At Rising, the guardian marks Mochi’s lane after your action. Inspection and menus spend no turns.",
    "On Surge, the marked wave arrives after your action. A wave can open a shell even when it splashes Mochi. Return from Center extracts before the wave, even on action fifteen.",
    run?.tool === "lantern" ? "The Lantern redirects a locked wave during Surge. At Beacon Court’s Center, it can copy the chart even with no charges. The wind-moth needs two free pack slots." : "The Rope reels an exposed lens, salvage or vane from another lane. The wind-moth needs a personal visit and two free pack slots. Bring any finds home before the tide closes.",
  ];
  return (
    <main className="outing-root" data-panel={panel} data-run={!!run} data-view={view} data-primary={panel==="outing"&&view==="play"&&!note&&!toolMenu}>
      <header className="of-mast">
        <a className="of-brand" href="/" aria-label="Familiar home"><span className="of-wordmark">familiar<span>.</span></span><span className="of-chapter">{canonical&&accountStore?"NEAR testnet":storage==="ready"?"Local preview":"This visit only"}</span></a>
        <button className="of-menu-toggle" onClick={()=>{setPanel(panel==="menu"?"outing":"menu");setView("play");setInspected(null);setToolMenu(false);}}><HarborIcon kind="menu"/><span>Menu</span></button>
      </header>
      <div className="of-layout">
        <div className="of-world">
          <Stage board={board} run={run} home={home} resting={resting} igniting={igniting} inspected={inspected}
            inspect={lane=>{setPanel("outing");setView("play");setToolMenu(false);setInspected(lane===inspected?null:lane);}}
            canonicalLantern={canonicalLantern}/>
          {run ? <div className="of-inventory" aria-label="Supplies">
            <span><b>Resolve</b> {run.resolve} / 3</span><span><b>Pack</b> {packSlots(run.cargo)} / 3</span><span><b>{title(run.tool)}</b> {run.uses} uses</span>
          </div> : <div className="of-harbor-state"><span className={home.lit?"of-lit-dot":"of-dark-dot"}/><span>{home.lit?"Beacon lit":"Beacon dark"}</span>{home.lit&&<span>{home.signaled?"Signal post repaired":"Signal post missing its vane"}</span>}{home.bank.includes("moth")&&<span>Wind-moth in the garden</span>}</div>}
        </div>
        <aside className="of-panel" aria-label="Game controls">
          <div className="of-panel-tabs" role="tablist" aria-label="Harbor panels">
            {(["outing","workshop","account"] as const).map(tab=><button key={tab} role="tab" id={`of-tab-${tab}`} aria-controls={`of-panel-${tab}`} aria-selected={panel===tab} onClick={()=>{setPanel(tab);setInspected(null);setToolMenu(false);setView("play");}}><HarborIcon kind={tab}/><span>{title(tab)}</span></button>)}
          </div>
          <section className="of-controls of-panel-page" id="of-panel-outing" role="tabpanel" aria-labelledby="of-tab-outing" hidden={panel!=="outing"}>
            {run ? note ? <>
              <h1 ref={heading} tabIndex={-1}>{title(inspected!)} lane</h1><p className="of-intent of-inspection">{note}</p>
              <button className="of-primary" onClick={()=>setInspected(null)}>Close inspection</button>
            </> : toolMenu ? <>
              <h1 ref={heading} tabIndex={-1}>Lure the wave</h1><p className="of-intent">Choose a new {run.area==="wind"?"source; the channel decides its exit":"target"}. Mochi stays here. Uses one charge.</p>
              <div className="of-tool-choices">{legal.filter(a=>a.startsWith("lure:")).map(a=>actionButton(a,run.area==="wind"?`Lure ${title(a.split(":")[1]!)} → exit ${title(waveExit(run,a.split(":")[1] as Lane)!)}`:actionLabel(a)))}</div>
              <button className="of-secondary" onClick={()=>{setToolMenu(false);toolToggle.current?.focus();}}>Cancel</button>
            </> : view==="channels" ? <><WindRouting run={run}/><button className="of-primary" onClick={()=>show("play")}>Back to outing</button></>
            : view==="notes" ? <>
              <h1 ref={heading} tabIndex={-1}>Field notes</h1><p>Tap a lane to inspect. Arrows or a horizontal scene swipe move one lane.</p><div className="of-choice-grid">
                <button onClick={()=>show("tide")}>Tide guide</button><button onClick={()=>show("pack")}>Pack & finds</button><button onClick={()=>show("result")}>Last turn</button>
                {run.area==="wind"&&<button onClick={()=>show("channels")}>Channel map</button>}
              </div><button className="of-primary" onClick={()=>show("play")}>Back to outing</button>
            </> : view==="tide" ? <>
              <h1 ref={heading} tabIndex={-1}>The tide · {guidePage+1} / 3</h1><p className="of-intent">{tideGuide[guidePage]}</p>
              <div className="of-choice-grid"><button disabled={guidePage===0} onClick={()=>setGuidePage(guidePage-1)}>Previous</button><button disabled={guidePage===2} onClick={()=>setGuidePage(guidePage+1)}>Next</button></div><button className="of-primary" onClick={()=>show("play")}>Back to outing</button>
            </> : view==="pack" ? <>
              <h1 ref={heading} tabIndex={-1}>Mochi’s pack</h1><p className="of-intent">{run.cargo.length?run.cargo.map(i=>items[i]).join(" · "):"The pack is empty."} {free} of 3 slots free.</p>
              <p>{missingPack?"The lens needs one slot. The wind-moth needs two. You can bring these finds home and return for another." : "Finds are only banked after returning from Center. A failed outing loses only this unbanked cargo."}</p><button className="of-primary" onClick={()=>show("play")}>Back to outing</button>
            </> : view==="result" ? <>
              <h1 ref={heading} tabIndex={-1}>The last turn</h1><p className="of-intent">{lastTurn(run)}</p><button className="of-primary" onClick={()=>show("play")}>Back to outing</button>
            </> : <>
              <div className="of-decision"><h1 ref={heading} tabIndex={-1}>{nextTide==="Surge"?"Surge":`${nextTide} tide`}</h1><div className="of-turn"><span>Turn {run.turn+1} of {ACTION_LIMIT}</span><span>{title(run.lane)} lane</span></div></div>
              <p className="of-intent of-forecast" data-testid={resolvedWave?"turn-consequence":undefined}>{resolvedWave?waveConsequence(run):nextTide==="Low"?"Choose where Mochi stands. The water is quiet.":nextTide==="Rising"?"After this action, the Tidekeeper marks Mochi’s lane.":run.locked?run.area==="wind"?`Source ${title(run.locked)} → exit ${title(waveExit(run)!)} after your action.`:`The wave strikes ${title(run.locked)} after your action.`:"The water passes without a marked lane."}</p>
              <p className="of-next-goal">{run.area==="wind"?run.cargo.includes("vane")?"Vane secured. Return at Center.":run.banked.includes("vane")?"Practice the channels. The vane is already home.":"Charge Left + Center; bring the vane home.":challenge?"Open both shells. Bring Mochi home dry.":run.cargo.includes("lens")?"Lens secured. Return at Center.":run.banked.includes("lens")?"Practice, or recover a missing discovery.":"Open the left shell. Bring its lens home."}</p>
              <div className="of-moves" aria-label="Choose a lane">{lanes.map(lane=>actionButton(`move:${lane}`))}</div>
              <div className="of-actions">
                {actionButton("wait")}
                {run.area==="wind"&&actionButton("turn:vane",run.locked&&run.lane==="center"?`Turn vane → ${title(waveExit({...run,orientation:((run.orientation+1)%3) as 0|1|2})!)}`:"Turn vane")}
                {run.tool==="lantern"&&<button ref={toolToggle} disabled={busy||!legal.some(a=>a.startsWith("lure:"))} onClick={()=>setToolMenu(true)}>Lure wave</button>}
                {legal.filter(a=>a.startsWith("take:")||a.startsWith("reel:")).map(a=>actionButton(a))}
                {actionButton("return",run.lane==="center"?"Return to harbor":"Return at Center")}
              </div>
              <p id="of-control-hint" className="of-control-hint"><span className="of-key-hint">← / → moves one lane · one turn.</span><span className="of-touch-hint">Swipe a lane · each move spends one turn.</span></p>
              <p className="of-announcement" aria-live="polite" aria-atomic="true">{lastTurn(run)}</p>
            </> : view==="result" && visited ? <>
              <h1 ref={heading} tabIndex={-1}>The final turn</h1><p className="of-intent" data-testid="final-turn-result">{lastTurn(visited)}</p><button className="of-primary" onClick={()=>show("play")}>Back to harbor</button>
            </> : view==="prepare" ? <>
              <h1 ref={heading} tabIndex={-1}>Prepare an outing</h1><p className="of-intent">{destination==="wind"?"Wind Gate":"Beacon Court"} · {title(tool)}. Choose a different route or tool before setting out.</p><div className="of-choice-grid"><button onClick={()=>show("destinations")}>Change outing</button><button onClick={()=>show("loadout")}>Change tool</button></div><button className="of-primary" onClick={()=>show("play")}>Back to harbor</button>
            </> : view==="loadout" ? <>
              <h1 ref={heading} tabIndex={-1}>Choose your tool</h1><fieldset className="of-kits"><legend className="of-announcement">Outing tool</legend>{(["rope","lantern"] as const).map(kit=><label key={kit} className={tool===kit?"selected":""}><input type="radio" name="outing-tool" value={kit} checked={tool===kit} onChange={()=>setTool(kit)}/><span><b>{title(kit)}</b><small>{kit==="rope"?"Reel a distant find. Two uses.":"Redirect a marked wave. Two uses."}</small></span></label>)}</fieldset><button className="of-primary" onClick={()=>show("play")}>Use {title(tool)}</button>
            </> : view==="destinations" ? <>
              <h1 ref={heading} tabIndex={-1}>Choose an outing</h1><div className="of-destinations"><button aria-pressed={destination==="beacon"} onClick={()=>{setDestination("beacon");show("play");}}>Beacon Court</button><button disabled={!home.lit} aria-pressed={destination==="wind"} onClick={()=>{setDestination("wind");show("play");}}>Wind Gate</button></div><p className="of-intent">{home.lit?"Wind Gate changes the tide’s entrance into a different exit. Route two channels and recover the Signal Vane.":"Restore the beacon to open the route to Wind Gate."}</p>{home.bank.includes("chart")&&<button onClick={()=>show("chart")}>Moonpool Chart · Wind Gate</button>}<button className="of-secondary" onClick={()=>show("play")}>Back to harbor</button>
            </> : view==="chart" ? <>
              <h1 ref={heading} tabIndex={-1}>Moonpool Chart · Wind Gate</h1><p className="of-intent">On arrival, Left exits Center, Center exits Right, and Right exits Left.</p><p>Turning the vane moves every exit one lane onward. Charge the Left and Center sockets, then bring the Signal Vane home.</p><button className="of-primary" onClick={()=>show("destinations")}>Back to outings</button>
            </> : view==="memory" ? <>
              <h1 ref={heading} tabIndex={-1}>Mochi remembers</h1><blockquote className="of-memory"><p>“{home.memory||"The beacon’s dark. The tide left something shining across the bay."}”</p></blockquote><button className="of-primary" onClick={()=>show("play")}>Back to harbor</button>
            </> : view==="discoveries" ? <>
              <h1 ref={heading} tabIndex={-1}>Discoveries at home ({home.bank.length})</h1><p className="of-intent">{home.bank.length?home.bank.map(i=>items[i]).join(" · "):"The harbor is waiting for its first find."}</p><button className="of-primary" onClick={()=>show("play")}>Back to harbor</button>
            </> : view==="share" && visited ? <>
              <h1 ref={heading} tabIndex={-1}>A tide puzzle to share</h1><p className="of-invitation" role="textbox" aria-label="Challenge invitation" aria-readonly="true">{challengeText(visited)}</p><button className="of-secondary" onClick={copy}>Copy invitation</button><span role="status">{copied?"Copied.":"You can also select the text."}</span><button className="of-primary" onClick={()=>show("play")}>Back to harbor</button>
            </> : <>
              <h1 ref={heading} tabIndex={-1}>{homeTitle}</h1><p className="of-intent">{homeIntent}</p>
              {visited&&<div className="of-result-row"><p className="of-result">{visited.turn} actions · {visited.resolve} / 3 Resolve{visited.waves.length&&!visited.waves.some(w=>w.hit)?" · dry paws":""}{challengeMet(visited)?" · two-shell challenge complete":""}</p><button onClick={()=>show("result")}>Last turn</button></div>}
              {canInstall&&<button className="of-primary" data-action="install" onClick={()=>restore(installLens(home))}>Restore the beacon</button>}
              {canInstallVane&&<button className="of-primary" data-action="install-vane" onClick={()=>restore(installVane(home))}>Repair signal post</button>}
              {restoreProblem&&<p role="alert" className="of-pressure">The repair could not be saved. Your find is safe. Retry the repair, or reload the device save.</p>}
              {!visited&&!resting&&!canInstall&&!canInstallVane&&<>
                <button className="of-primary" data-action="depart" onClick={()=>begin(declaringGoal?"rope":tool,declaringGoal)}>{declaringGoal?"Start challenge":"Set out with Mochi"}</button>
                <p className="of-destination-note">{declaringGoal?"Rope · Beacon Court":`${destination==="wind"?"Wind Gate":"Beacon Court"} · ${title(tool)}`}</p>
                {!declaringGoal&&<button className="of-text" onClick={()=>show("prepare")}>Prepare outing</button>}
                {declaringGoal&&<button className="of-text" onClick={()=>setChallenge(false)}>Choose a regular outing</button>}
                {invite&&!declaringGoal&&<button className="of-secondary" onClick={chooseChallenge}>Accept two-shell challenge</button>}
              </>}
              {visited&&!canInstall&&!canInstallVane&&<div className="of-home-actions"><button className="of-primary" onClick={()=>{setVisited(null);setResting(false);setSharing(false);focusChapter();}}>{escaped?"Try again":"Prepare another outing"}</button><button onClick={()=>{setVisited(null);setResting(true);}}>Rest at the harbor</button></div>}
              {resting&&<button className="of-primary" onClick={()=>{setResting(false);focusChapter();}}>Prepare another outing</button>}
              <div className="of-choice-grid of-harbor-notes"><button onClick={()=>show("memory")}>Mochi’s memory</button><button onClick={()=>show("discoveries")}>Discoveries</button>{visited?.area==="beacon"&&visited.outcome==="returned"&&<button onClick={()=>show("share")}>Make a challenge</button>}{home.storycraft.origins.crest&&<button onClick={()=>setPanel("workshop")}>Lantern workshop</button>}</div>
            </>}
          </section>
          <section className="of-panel-page" id="of-panel-workshop" role="tabpanel" aria-labelledby="of-tab-workshop" hidden={panel!=="workshop"}>
            {run ? <><h2>The outing is still open.</h2><p>Bring Mochi home before opening the workbench.</p><button className="of-primary" onClick={()=>setPanel("outing")}>Back to outing</button></> : <Storycraft preview={home.storycraft} accountPanel={<button className="of-secondary" onClick={()=>setPanel("account")}>Account & recovery</button>}
              hasEarlierDiscoveries={(home.bank.includes("lens")&&!home.storycraft.origins.crest)||(home.bank.includes("moth")&&!home.storycraft.origins.moth)} temporary={storage!=="ready"}
              onCraft={motif=>changeStorycraft(previewLantern(home,motif))} onPlace={socket=>{const result=applyPlacement(home.storycraft,socket,home.storycraft.revision);return result.ok&&changeStorycraft({...home,storycraft:result.preview});}}
              onRecordOrigin={()=>{setDestination("beacon");begin("rope",false,true);}}/>}
          </section>
          <section className="of-panel-page" id="of-panel-account" role="tabpanel" aria-labelledby="of-tab-account" hidden={panel!=="account"}>
            {import.meta.env.VITE_TIDEBOUND_ENABLED==="true" ? <Suspense fallback={<p>Opening account controls…</p>}><AccountHarbor home={home} returned={visited} onSnapshot={accountSnapshot} onUseSaved={useSavedHarbor}/></Suspense> : <><h2>Keep your harbor on all your devices</h2><p>Recoverable sign-in and NEAR ownership are not connected here yet. Your lantern remains a local preview.</p><p>Local preview · not backed up or transferable.</p></>}
          </section>
          <section className="of-panel-page of-game-menu" aria-label="Game menu" hidden={panel!=="menu"}><h2>Familiar · First Light</h2><p>A harbor, a familiar, and a tide worth understanding.</p>{run&&<button onClick={()=>show("notes")}>Outing notes</button>}{!run&&<div className="of-choice-grid"><button onClick={()=>show("prepare")}>Prepare outing</button>{visited?.area==="beacon"&&<button onClick={chooseChallenge}>Try the two-shell challenge</button>}<button onClick={()=>show("memory")}>Mochi’s memory</button><button onClick={()=>show("discoveries")}>Discoveries</button>{visited?.area==="beacon"&&visited.outcome==="returned"&&<button onClick={()=>show("share")}>Make a challenge</button>}{home.storycraft.origins.crest&&<button onClick={()=>setPanel("workshop")}>Lantern workshop</button>}</div>}<div className="of-choice-grid"><a href={planUrl}>Design book</a><a href="/motion">Motion study</a></div><button className="of-primary" onClick={()=>setPanel("outing")}>Back to game</button></section>
        </aside>
      </div>
      <footer className="of-footer"><span>{canonical&&accountStore?`NEAR testnet checkpoint ${canonical.journey.revision} · current outing on this device`:storageLabel}</span><span>First Light · {run?.area==="wind"?"A Way Through":"The Broken Beacon"}</span></footer>
    </main>
  );
}
