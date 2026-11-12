const LANES = ["left", "center", "right"] as const;
const ITEMS = ["lens", "moth", "chart", "salvage"] as const;
export const ACTION_LIMIT = 15;
export type Lane = typeof LANES[number];
export type Item = typeof ITEMS[number];
export type Tool = "rope" | "lantern";
export type Action =
  | "wait" | "return"
  | `move:${Lane}` | `lure:${Lane}` | `take:${Item}`
  | "reel:lens" | "reel:salvage";

const itemLane: Record<Item, Lane> = { lens: "left", salvage: "left", moth: "right", chart: "center" };

export interface Outing {
  tool: Tool;
  lane: Lane;
  turn: number;
  resolve: number;
  uses: number;
  locked: Lane | null;
  opened: Lane[];
  banked: Item[];
  cargo: Item[];
  actions: Action[];
  waves: { turn: number; lane: Lane; hit: boolean; opened: boolean }[];
  outcome: "active" | "returned" | "rescued";
}

export function isTool(value: unknown): value is Tool {
  return value === "rope" || value === "lantern";
}

export function isItem(value: unknown): value is Item {
  return ITEMS.some(item => item === value);
}

export function startOuting(tool: Tool, banked: readonly Item[] = []): Outing {
  return {
    tool, banked: [...banked], lane: "center", turn: 0, resolve: 3, uses: 2,
    locked: null, opened: [], cargo: [], actions: [], waves: [], outcome: "active",
  };
}

export function phaseOf(run: Outing) {
  return (["Low", "Rising", "Surge"] as const)[run.turn % 3];
}

export function packSlots(items: readonly Item[]): number {
  return items.reduce((count, item) => count + (item === "moth" ? 2 : 1), 0);
}

export function legalActions(run: Outing): Action[] {
  if (run.outcome !== "active") return [];
  const actions: Action[] = ["wait"];
  const position = LANES.indexOf(run.lane);
  for (const [index, lane] of LANES.entries()) {
    if (Math.abs(position - index) === 1) actions.push(`move:${lane}`);
  }
  if (run.lane === "center") actions.push("return");
  if (run.tool === "lantern" && run.uses > 0 && phaseOf(run) === "Surge" && run.locked !== null) {
    for (const lane of LANES) actions.push(`lure:${lane}`);
  }
  for (const item of ITEMS) {
    if (run.banked.includes(item) || run.cargo.includes(item) || packSlots([...run.cargo, item]) > 3) continue;
    const source = itemLane[item];
    const exposed = item === "chart" ? run.tool === "lantern" : run.opened.includes(source);
    if (!exposed) continue;
    if (source === run.lane) actions.push(`take:${item}`);
    else if (run.tool === "rope" && run.uses > 0 && (item === "lens" || item === "salvage")) {
      actions.push(`reel:${item}`);
    }
  }
  return actions;
}

export function applyAction(run: Outing, candidate: unknown): Outing {
  const action = legalActions(run).find(legal => legal === candidate);
  if (!action) return run;
  const next: Outing = { ...run, turn: run.turn + 1, actions: [...run.actions, action] };
  // Extraction precedes both the wave and the flood, even on action fifteen.
  if (action === "return") return { ...next, outcome: "returned" };

  const [verb, target] = action.split(":");
  if (verb === "move") next.lane = target as Lane;
  if (verb === "lure") next.locked = target as Lane;
  if (verb === "take" || verb === "reel") next.cargo = [...run.cargo, target as Item];
  if (verb === "lure" || verb === "reel") next.uses--;

  switch (phaseOf(run)) {
    case "Rising":
      next.locked = next.lane;
      break;
    case "Surge": {
      const lane = next.locked;
      if (lane === null) break;
      const hit = next.lane === lane;
      const opened = lane !== "center" && !run.opened.includes(lane);
      if (hit) next.resolve--;
      if (opened) next.opened = [...run.opened, lane];
      next.waves = [...run.waves, { turn: next.turn, lane, hit, opened }];
      next.locked = null;
      break;
    }
  }
  if (next.resolve === 0 || next.turn === ACTION_LIMIT) {
    return { ...next, cargo: [], outcome: "rescued" };
  }
  return next;
}

/** Recompute a saved outing from player choices. Derived state is never read from storage. */
export function replayOuting(tool: unknown, banked: unknown, actions: unknown): Outing | null {
  if (!isTool(tool) || !Array.isArray(banked) || banked.length > ITEMS.length ||
      !banked.every(isItem) || new Set(banked).size !== banked.length ||
      !Array.isArray(actions) || actions.length > ACTION_LIMIT) return null;
  let run = startOuting(tool, banked);
  for (const action of actions) {
    const next = applyAction(run, action);
    if (next === run) return null;
    run = next;
  }
  return run;
}
