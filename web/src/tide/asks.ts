/**
 * The Tidekeeper's ask: one card a day for a fresh Beacon Court outing.
 * Pure functions over the canonical court engine. Nothing here changes a rule; an ask only reads what a run did.
 */
import { applyCommand, legalCommands, phaseOf, startCourt } from "../expedition/engine";
import { TURN_LIMIT, type Column, type Command, type CourtState, type Tool } from "../expedition/types";

export type Haul = "lens" | "moth" | "both";
export type Style =
  | "dry" | "splash" | "coiled" | "no-wait" | "all-marks" | "one-crossing" | "both-shells"
  | "bridge-left" | "bridge-center" | "bridge-right" | "shut-left" | "shut-right";
export type Ask =
  | { readonly kind: "haul"; readonly haul: Haul }
  | { readonly kind: "style"; readonly style: Style }
  | { readonly kind: "within"; readonly decisions: number };
export interface TideCard {
  readonly id: string;
  readonly name: string;
  readonly tool: Tool;
  readonly asks: readonly [Ask, Ask, Ask];
  /** Fewest decisions that keep all three asks, found by search and re-proved in the tests. */
  readonly best: number;
}

/** What a run has done so far that the engine state alone does not remember. */
export interface RunFacts {
  readonly waits: number;
  readonly marks: readonly Column[];
  readonly crossings: number;
}
export const NO_FACTS: RunFacts = { waits: 0, marks: [], crossings: 0 };

export function nextFacts(facts: RunFacts, before: CourtState, command: Command, after: CourtState): RunFacts {
  const marked = phaseOf(before) === "rising" && after.locked !== null && !facts.marks.includes(after.locked);
  // A splash can wash Mochi back over the bridge row; only a walked crossing counts.
  const crossed = command.startsWith("step:") && Math.abs(after.position.y - before.position.y) > 1 && after.resolve === before.resolve;
  return {
    waits: facts.waits + (command === "wait" ? 1 : 0),
    marks: marked ? [...facts.marks, after.locked!] : facts.marks,
    crossings: facts.crossings + (crossed ? 1 : 0),
  };
}

export interface Run { readonly state: CourtState; readonly facts: RunFacts }
export const startRun = (tool: Tool): Run => ({ state: startCourt({ area: "beacon", tool, banked: [] }), facts: NO_FACTS });
export function stepRun(run: Run, command: Command): Run | null {
  const turn = applyCommand(run.state, command);
  return turn ? { state: turn.after, facts: nextFacts(run.facts, run.state, command, turn.after) } : null;
}
/** Rebuilds a run from its saved commands. Null when the commands are not a legal fresh Beacon Court outing. */
export function replayRun(tool: unknown, commands: unknown): Run | null {
  if ((tool !== "rope" && tool !== "lantern") || !Array.isArray(commands) || commands.length > TURN_LIMIT) return null;
  let run = startRun(tool);
  for (const command of commands) {
    const next = stepRun(run, command as Command);
    if (!next) return null;
    run = next;
  }
  return run;
}

export type AskStatus = "open" | "kept" | "slipped";
const home = (state: CourtState) => state.outcome === "returned";
const over = (state: CourtState) => state.outcome !== "active";

/** `open` can still go either way; `kept` and `slipped` are final for this outing. */
export function askStatus(ask: Ask, { state, facts }: Run): AskStatus {
  const settle = (holds: boolean, broken = !holds): AskStatus => broken ? "slipped" : over(state) ? (home(state) && holds ? "kept" : "slipped") : "open";
  if (state.outcome === "rescued") return "slipped";
  if (ask.kind === "within") return settle(state.turn <= ask.decisions, state.turn > ask.decisions || (!over(state) && state.turn === ask.decisions));
  if (ask.kind === "haul") {
    const lens = state.cargo.includes("lens"), moth = state.cargo.includes("moth");
    if (ask.haul === "moth") return settle(moth && !lens, lens);
    return settle(ask.haul === "both" ? lens && moth : lens, false);
  }
  switch (ask.style) {
    case "dry": return settle(state.resolve === 3);
    case "splash": return settle(state.resolve === 2, state.resolve < 2);
    case "coiled": return settle(state.uses === 2);
    case "no-wait": return settle(facts.waits === 0);
    case "all-marks": return settle(facts.marks.length === 3, false);
    case "one-crossing": return settle(facts.crossings === 2, facts.crossings > 2);
    case "both-shells": return settle(state.opened.includes(0) && state.opened.includes(2), false);
    case "bridge-left": return settle(state.bridge === 0, false);
    case "bridge-center": return settle(state.bridge === 1, false);
    case "bridge-right": return settle(state.bridge === 2, false);
    case "shut-left": return settle(!state.opened.includes(0));
    case "shut-right": return settle(!state.opened.includes(2));
  }
}
export const cardStatus = (card: TideCard, run: Run) => card.asks.map(ask => askStatus(ask, run)) as [AskStatus, AskStatus, AskStatus];
export const keptCount = (card: TideCard, run: Run) => cardStatus(card, run).filter(status => status === "kept").length;

const key = ({ state: s, facts: f }: Run) =>
  `${s.position.x}${s.position.y}${s.turn % 3}${s.bridge}${s.locked ?? "n"}${s.opened.join("")}|${[...s.cargo].sort().join("")}|${s.uses}${s.resolve}|${Math.min(f.waits, 1)}${[...f.marks].sort().join("")}|${Math.min(f.crossings, 3)}`;

/** Breadth-first over the real engine: the shortest command list that comes home with every ask kept. */
export function solve(tool: Tool, asks: readonly Ask[], limit = TURN_LIMIT): Command[] | null {
  let frontier: { run: Run; path: Command[] }[] = [{ run: startRun(tool), path: [] }];
  const seen = new Set<string>([key(frontier[0]!.run)]);
  for (let depth = 0; depth < limit && frontier.length; depth++) {
    const next: typeof frontier = [];
    for (const { run, path } of frontier) {
      for (const command of legalCommands(run.state)) {
        const after = stepRun(run, command);
        if (!after || after.state.outcome === "rescued") continue;
        if (asks.some(ask => askStatus(ask, after) === "slipped")) continue;
        const route = [...path, command];
        if (after.state.outcome === "returned") {
          if (asks.every(ask => askStatus(ask, after) === "kept")) return route;
          continue;
        }
        const id = key(after);
        if (seen.has(id)) continue;
        seen.add(id);
        next.push({ run: after, path: route });
      }
    }
    frontier = next;
  }
  return null;
}
