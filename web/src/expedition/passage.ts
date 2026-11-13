import { applyCommand, legalCommands, phaseOf, startCourt, waveExit } from "./engine";
import { TURN_LIMIT, type Command, type CourtEvent, type CourtState, type Position } from "./types";

export type PassageJob = "bell" | "reed";
export type PassageCommand = Command | "ride" | "listen" | "ring";
export interface PassageState {
  readonly job: PassageJob;
  readonly court: CourtState;
  readonly stage: "waiting" | "dispatched" | "delivered";
  readonly watched: boolean;
  readonly mothHome: boolean;
  readonly bellRigged: boolean;
  readonly archOpen: boolean;
  readonly heardBell: boolean;
  readonly commands: readonly PassageCommand[];
}
export interface PassageTransition {
  readonly before: PassageState;
  readonly after: PassageState;
  readonly events: readonly CourtEvent[];
}

export const PASSAGE_LANDINGS = {
  bell: { departure: { x: 0, y: 1 }, arrival: { x: 0, y: 3 } },
  reed: { departure: { x: 2, y: 3 }, arrival: { x: 2, y: 1 } },
} as const satisfies Record<PassageJob, { departure: Position; arrival: Position }>;

const at = (a: Position, b: Position) => a.x === b.x && a.y === b.y;

export function startPassage(job: PassageJob, mothHome = false, bellRigged = false, archOpen = false): PassageState {
  const court = startCourt({
    area: "beacon",
    tool: "rope",
    banked: mothHome ? ["lens", "vane", "moth"] : ["lens", "vane"],
  });
  return { job, court, stage: "waiting", watched: false, mothHome, bellRigged, archOpen, heardBell: false, commands: [] };
}

export function canWatchMoth({ job, court, watched, mothHome }: PassageState): boolean {
  return job === "reed" && !mothHome && !watched && court.outcome === "active" &&
    phaseOf(court) === "rising" && court.opened.includes(2) && at(court.position, { x: 1, y: 4 });
}

export function passageCommands(state: PassageState): PassageCommand[] {
  const { job, court, stage } = state;
  const commands: PassageCommand[] = legalCommands(court).filter(command =>
    command === "wait" || command === "return" || command.startsWith("step:"));
  if (court.outcome !== "active") return commands;
  const { departure } = PASSAGE_LANDINGS[job];
  if (stage === "dispatched" && at(court.position, departure) &&
      phaseOf(court) === "surge" && waveExit(court) === departure.x) {
    commands.push("ride");
  }
  if (job === "bell" && state.archOpen && !state.heardBell && court.opened.includes(0) &&
      phaseOf(court) === "low" && at(court.position, { x: 0, y: 4 })) {
    commands.push("listen");
  }
  if (state.bellRigged && !state.commands.includes("ring") && court.locked !== null && court.locked !== 0 &&
      phaseOf(court) === "surge" && at(court.position, { x: 1, y: 3 })) {
    commands.push("ring");
  }
  return commands;
}

export function applyPassage(before: PassageState, candidate: unknown): PassageTransition | null {
  const command = passageCommands(before).find(legal => legal === candidate);
  if (!command) return null;
  const { departure, arrival } = PASSAGE_LANDINGS[before.job];
  let court: CourtState;
  let events: readonly CourtEvent[];
  if (command === "ride") {
    // Resolve the edge-lane surge from a dry footing so v2 still handles every world effect, including the flood.
    const sheltered = { ...before.court, position: { x: 1 as const, y: arrival.y } };
    const surge = applyCommand(sheltered, "wait")!;
    court = { ...surge.after, position: arrival };
    events = [{ kind: "move", from: departure, to: arrival }, ...surge.events];
  } else if (command === "ring") {
    // Borrow the court's source-redirection rule. The installed bell has its own pull, independent of the carried tool.
    const signal = applyCommand({ ...before.court, tool: "lantern", uses: 1 }, "lure:left")!;
    court = { ...signal.after, tool: before.court.tool, uses: before.court.uses };
    events = signal.events;
  } else {
    const turn = applyCommand(before.court, command === "listen" ? "wait" : command)!;
    court = turn.after;
    events = turn.events;
  }

  let stage = before.stage;
  if (court.outcome === "rescued") stage = "waiting";
  else if (stage === "waiting" && at(court.position, departure)) stage = "dispatched";
  else if (stage === "dispatched" && at(court.position, arrival)) stage = "delivered";
  const watched = before.watched || (command === "wait" && canWatchMoth(before));
  const heardBell = before.heardBell || command === "listen";
  const after = { ...before, court, stage, watched, heardBell, commands: [...before.commands, command] };
  return { before, after, events };
}

export function passageDelivered(state: PassageState): boolean {
  return state.court.outcome === "returned" && state.stage === "delivered";
}

export function replayPassage(job: unknown, commands: unknown, mothHome: unknown = false, bellRigged: unknown = false, archOpen: unknown = false): PassageState | null {
  if ((job !== "bell" && job !== "reed") || typeof mothHome !== "boolean" || typeof bellRigged !== "boolean" ||
      typeof archOpen !== "boolean" || !Array.isArray(commands) || commands.length > TURN_LIMIT) return null;
  let state = startPassage(job, mothHome, bellRigged, archOpen);
  for (const command of commands) {
    const turn = applyPassage(state, command);
    if (!turn) return null;
    state = turn.after;
  }
  return state;
}
