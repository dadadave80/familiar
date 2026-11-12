const LANES = ["left", "center", "right"] as const;
const ITEMS = ["lens", "moth", "chart", "salvage", "vane"] as const;
export const ACTION_LIMIT = 15;
export type Area = "beacon" | "wind";
export type Lane = typeof LANES[number];
export type Item = typeof ITEMS[number];
export type Tool = "rope" | "lantern";
export type Action =
  | "wait" | "return" | "turn:vane"
  | `move:${Lane}` | `lure:${Lane}` | `take:${Item}`
  | "reel:lens" | "reel:salvage" | "reel:vane";

const itemLane: Record<Item, Lane> = { lens: "left", salvage: "left", moth: "right", chart: "center", vane: "center" };

export interface Outing {
  area: Area;
  orientation: 0 | 1 | 2;
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
  waves: { turn: number; source: Lane; lane: Lane; hit: boolean; opened: boolean }[];
  outcome: "active" | "returned" | "rescued";
}

export function isTool(value: unknown): value is Tool {
  return value === "rope" || value === "lantern";
}

export function isItem(value: unknown): value is Item {
  return ITEMS.some(item => item === value);
}

export function startOuting(tool: Tool, banked: readonly Item[] = [], area: Area = "beacon"): Outing {
  return {
    area, orientation: area === "wind" ? 1 : 0,
    tool, banked: [...banked], lane: "center", turn: 0, resolve: 3, uses: 2,
    locked: null, opened: [], cargo: [], actions: [], waves: [], outcome: "active",
  };
}

/** The marked source passes through the channel before striking an exit. */
export function waveExit(run: Outing, source: Lane | null = run.locked): Lane | null {
  if (source === null) return null;
  return LANES[(LANES.indexOf(source) + run.orientation) % LANES.length]!;
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
  if (run.area === "wind" && run.lane === "center") actions.push("turn:vane");
  if (run.tool === "lantern" && run.uses > 0 && phaseOf(run) === "Surge" && run.locked !== null) {
    for (const lane of LANES) actions.push(`lure:${lane}`);
  }
  for (const item of ITEMS) {
    if ((run.area === "wind") !== (item === "vane")) continue;
    if (run.banked.includes(item) || run.cargo.includes(item) || packSlots([...run.cargo, item]) > 3) continue;
    const source = itemLane[item];
    const exposed = item === "vane"
      ? run.opened.includes("left") && run.opened.includes("center")
      : item === "chart" ? run.tool === "lantern" : run.opened.includes(source);
    if (!exposed) continue;
    if (source === run.lane) actions.push(`take:${item}`);
    else if (run.tool === "rope" && run.uses > 0 && (item === "lens" || item === "salvage" || item === "vane")) {
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
  if (action === "turn:vane") next.orientation = ((run.orientation + 1) % 3) as 0 | 1 | 2;
  if (verb === "take" || verb === "reel") next.cargo = [...run.cargo, target as Item];
  if (verb === "lure" || verb === "reel") next.uses--;

  switch (phaseOf(run)) {
    case "Rising":
      next.locked = next.lane;
      break;
    case "Surge": {
      const source = next.locked;
      const lane = waveExit(next);
      if (lane === null) break;
      const hit = next.lane === lane;
      const objective = run.area === "wind" ? lane !== "right" : lane !== "center";
      const opened = objective && !run.opened.includes(lane);
      if (hit) next.resolve--;
      if (opened) next.opened = [...run.opened, lane];
      next.waves = [...run.waves, { turn: next.turn, source: source!, lane, hit, opened }];
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
export function replayOuting(tool: unknown, banked: unknown, actions: unknown, area: unknown = "beacon"): Outing | null {
  if ((area !== "beacon" && area !== "wind") || !isTool(tool) || !Array.isArray(banked) || banked.length > ITEMS.length ||
      !banked.every(isItem) || new Set(banked).size !== banked.length ||
      !Array.isArray(actions) || actions.length > ACTION_LIMIT) return null;
  let run = startOuting(tool, banked, area);
  for (const action of actions) {
    const next = applyAction(run, action);
    if (next === run) return null;
    run = next;
  }
  return run;
}
