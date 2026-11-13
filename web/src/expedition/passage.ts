import { applyCommand, legalCommands, phaseOf, startCourt, waveExit } from "./engine";
import { TURN_LIMIT, type Command, type CourtEvent, type CourtState, type Position } from "./types";

export type PassageJob = "bell" | "reed";
export type PassageCommand = Command | "ride";
export interface PassageState {
  readonly job: PassageJob;
  readonly court: CourtState;
  readonly stage: "waiting" | "dispatched" | "delivered";
  readonly watched: boolean;
  readonly mothHome: boolean;
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

export function startPassage(job: PassageJob, mothHome = false): PassageState {
  const court = startCourt({
    area: "beacon",
    tool: "rope",
    banked: mothHome ? ["lens", "vane", "moth"] : ["lens", "vane"],
  });
  return { job, court, stage: "waiting", watched: false, mothHome, commands: [] };
}

export function canWatchMoth({ job, court, watched, mothHome }: PassageState): boolean {
  return job === "reed" && !mothHome && !watched && court.outcome === "active" &&
    phaseOf(court) === "rising" && court.opened.includes(2) && at(court.position, { x: 1, y: 4 });
}

export function passageCommands({ job, court, stage }: PassageState): PassageCommand[] {
  const commands: PassageCommand[] = legalCommands(court).filter(command =>
    command === "wait" || command === "return" || command.startsWith("step:"));
  const { departure } = PASSAGE_LANDINGS[job];
  if (court.outcome === "active" && stage === "dispatched" && at(court.position, departure) &&
      phaseOf(court) === "surge" && waveExit(court) === departure.x) {
    commands.push("ride");
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
  } else {
    const turn = applyCommand(before.court, command)!;
    court = turn.after;
    events = turn.events;
  }

  let stage = before.stage;
  if (court.outcome === "rescued") stage = "waiting";
  else if (stage === "waiting" && at(court.position, departure)) stage = "dispatched";
  else if (stage === "dispatched" && at(court.position, arrival)) stage = "delivered";
  const watched = before.watched || (command === "wait" && canWatchMoth(before));
  const after = { ...before, court, stage, watched, commands: [...before.commands, command] };
  return { before, after, events };
}

export function passageDelivered(state: PassageState): boolean {
  return state.court.outcome === "returned" && state.stage === "delivered";
}

export function replayPassage(job: unknown, commands: unknown, mothHome: unknown = false): PassageState | null {
  if ((job !== "bell" && job !== "reed") || typeof mothHome !== "boolean" ||
      !Array.isArray(commands) || commands.length > TURN_LIMIT) return null;
  let state = startPassage(job, mothHome);
  for (const command of commands) {
    const turn = applyPassage(state, command);
    if (!turn) return null;
    state = turn.after;
  }
  return state;
}
