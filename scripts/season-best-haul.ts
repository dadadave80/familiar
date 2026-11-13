import { applyCommand, legalCommands, startCourt } from "../web/src/expedition/engine";
import { applyAction, legalActions, startOuting, type Outing } from "../web/src/compatibility/return-rules";
import { courtStateKey } from "./court-solver";
import type { CourtState } from "../web/src/expedition/types";

/** Season 2 cargo-to-goods table; must match CARGO_GOODS in contracts/season/src/lib.rs. */
export const CARGO_GOODS: Record<string, "glass" | "reed" | null> = { lens: "glass", moth: "reed", chart: "reed", salvage: "reed", vane: null };
export const SEASON_COURTS = ["first_light_v1", "first_light_v2"] as const;

function goods(cargo: readonly string[]): [number, number] {
  let glass = 0, reed = 0;
  for (const item of cargo) { if (CARGO_GOODS[item] === "glass") glass++; if (CARGO_GOODS[item] === "reed") reed++; }
  return [glass, reed];
}
function pareto(points: Set<string>): [number, number][] {
  const all = [...points].map(p => p.split(",").map(Number) as [number, number]);
  return all.filter(([g, r]) => !all.some(([g2, r2]) => g2 >= g && r2 >= r && (g2 > g || r2 > r)))
    .sort((a, b) => b[0] - a[0] || b[1] - a[1]);
}
function outingKey(run: Outing): string {
  return [run.lane, run.turn % 3, run.resolve, run.uses, run.orientation, run.locked ?? "-", [...run.opened].sort().join(""), [...run.cargo].sort().join("")].join("/");
}

/**
 * Exhaustive breadth-first search over every legal fresh beacon outing (the court solver's state key, without a goal),
 * returning the maximal (glass, reed) hauls. Breadth-first order reaches each key at its earliest turn, so deduplication
 * never hides a reachable return.
 */
export function bestHaul(content: typeof SEASON_COURTS[number], tool: "rope" | "lantern"): [number, number][] {
  const hauls = new Set<string>();
  if (content === "first_light_v2") {
    const initial = startCourt({ area: "beacon", tool, banked: [] }), queue: CourtState[] = [initial], seen = new Set([courtStateKey(initial)]);
    for (let i = 0; i < queue.length; i++) for (const command of legalCommands(queue[i]!)) {
      const next = applyCommand(queue[i]!, command)!.after;
      if (next.outcome === "returned") { hauls.add(goods(next.cargo).join(",")); continue; }
      if (next.outcome !== "active") continue;
      const key = courtStateKey(next); if (seen.has(key)) continue; seen.add(key); queue.push(next);
    }
  } else {
    const initial = startOuting(tool, [], "beacon"), queue: Outing[] = [initial], seen = new Set([outingKey(initial)]);
    for (let i = 0; i < queue.length; i++) for (const action of legalActions(queue[i]!)) {
      const next = applyAction(queue[i]!, action);
      if (next.outcome === "returned") { hauls.add(goods(next.cargo).join(",")); continue; }
      if (next.outcome !== "active") continue;
      const key = outingKey(next); if (seen.has(key)) continue; seen.add(key); queue.push(next);
    }
  }
  return pareto(hauls);
}

export function bestHaulTable() {
  return SEASON_COURTS.map(content => ({ content_version: content, area: "beacon",
    tools: (["rope", "lantern"] as const).map(tool => ({ tool, hauls: bestHaul(content, tool) })) }));
}

if (import.meta.main) {
  await Bun.write(new URL("../contracts/season/fixtures/best-haul.json", import.meta.url), JSON.stringify(bestHaulTable()) + "\n");
  console.info(JSON.stringify(bestHaulTable()));
}
