/**
 * Two weeks of the Tidekeeper's asks. The day picks the card, so every harbor reads the same ask on the same day.
 * `best` is the fewest decisions that keep all three asks; `cards.test.ts` re-proves each one with the solver.
 */
import type { Tool } from "../expedition/types";
import { askStatus, type Ask, type Haul, type Run, type Style, type TideCard } from "./asks";

const card = (id: string, name: string, tool: Tool, haul: Haul, style: Style, third: Style | number, best: number): TideCard => ({
  id, name, tool, best,
  asks: [
    { kind: "haul", haul },
    { kind: "style", style },
    typeof third === "number" ? { kind: "within", decisions: third } : { kind: "style", style: third },
  ],
});

/** Order matters: `cardForDay` walks it one card a day and the tools alternate. */
export const TIDE_POOL: readonly TideCard[] = [
  card("wake-both-shells", "Wake both shells", "lantern", "lens", "both-shells", 12, 10),
  card("every-source", "Every source speaks", "rope", "lens", "all-marks", 14, 12),
  card("no-waiting", "No waiting", "lantern", "both", "no-wait", 13, 11),
  card("full-satchel", "A full satchel", "rope", "both", "dry", 19, 17),
  card("dry-paws", "Dry paws", "lantern", "lens", "dry", 13, 11),
  card("once-across", "Once across", "rope", "moth", "one-crossing", 13, 11),
  card("tidy-tide", "A tidy tide", "lantern", "lens", "all-marks", "bridge-center", 11),
  card("coiled-rope", "The rope stays coiled", "rope", "both", "coiled", 16, 14),
  card("quiet-shell", "The quiet shell", "lantern", "moth", "shut-left", 10, 8),
  card("surf-home", "Surf home", "rope", "lens", "splash", 10, 9),
  card("brams-bridge", "Bram’s bridge", "lantern", "moth", "bridge-left", 12, 10),
  card("dry-and-tidy", "Dry and tidy", "rope", "moth", "dry", "bridge-center", 15),
  card("lantern-haul", "The lantern haul", "lantern", "both", "dry", 17, 15),
  card("left-for-bram", "Left for Bram", "rope", "both", "no-wait", "bridge-left", 15),
];

/** The same day boundary as the season contract: whole days of UTC time. */
export const tideDay = (now: number = Date.now()) => Math.floor(now / 86_400_000);
export function cardForDay(day: number): TideCard {
  const size = TIDE_POOL.length;
  return TIDE_POOL[((Math.trunc(day) % size) + size) % size]!;
}
export const dayLabel = (day: number) =>
  new Date(day * 86_400_000).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

export const TOOL_NOTE: Record<Tool, string> = {
  rope: "Mochi carries the rope: it reels the lens in from two steps away.",
  lantern: "Mochi carries the lantern: on a surge turn it lures the marked wave to another lane, twice.",
};

const column = { left: "Left", center: "Center", right: "Right" } as const;
/** The full sentence, as the Tidekeeper asks it on the card. */
export function askLine(ask: Ask, tool: Tool): string {
  if (ask.kind === "within") return `Be home within ${ask.decisions} decisions.`;
  if (ask.kind === "haul") return ask.haul === "both" ? "Bring both finds home." : ask.haul === "lens" ? "Bring the lens home." : "Bring the moth home, and leave the lens in its shell.";
  switch (ask.style) {
    case "dry": return "Keep Mochi dry the whole way.";
    case "splash": return "Let one surge soak Mochi. Only one.";
    case "coiled": return tool === "rope" ? "Leave the rope coiled." : "Leave the lantern unlit.";
    case "no-wait": return "Never wait for the tide.";
    case "all-marks": return "Mark all three sources: left, center and right.";
    case "one-crossing": return "Cross the bridge once out and once home.";
    case "both-shells": return "Open both shells.";
    case "shut-left": return "Leave the left shell shut.";
    case "shut-right": return "Leave the right shell shut.";
    default: return `Leave the bridge at ${column[ask.style.slice(7) as keyof typeof column]} when Mochi comes home.`;
  }
}

/** A short live label for the outing: what the ask is and how far along it stands. */
export function askChip(ask: Ask, tool: Tool, run: Run): string {
  const { state, facts } = run, status = askStatus(ask, run);
  if (ask.kind === "within") return status === "slipped" ? `Within ${ask.decisions} · passed` : status === "kept" ? `Home in ${state.turn}` : `Within ${ask.decisions} · ${ask.decisions - state.turn} left`;
  if (ask.kind === "haul") {
    const lens = state.cargo.includes("lens"), moth = state.cargo.includes("moth");
    if (ask.haul === "both") return `Both finds · ${Number(lens) + Number(moth)} of 2`;
    return ask.haul === "lens" ? `Lens · ${lens ? "in the pack" : "still out"}` : `Moth only · ${moth ? "in the pack" : "still out"}`;
  }
  switch (ask.style) {
    case "dry": return "Dry paws";
    case "splash": return `One splash · ${3 - state.resolve} of 1`;
    case "coiled": return tool === "rope" ? "Rope coiled" : "Lantern unlit";
    case "no-wait": return "No waiting";
    case "all-marks": return `Three sources · ${facts.marks.length} of 3`;
    case "one-crossing": return `Once out, once home · ${Math.min(facts.crossings, 2)} of 2`;
    case "both-shells": return `Both shells · ${Number(state.opened.includes(0)) + Number(state.opened.includes(2))} of 2`;
    case "shut-left": return "Left shell shut";
    case "shut-right": return "Right shell shut";
    default: return `Bridge at ${column[ask.style.slice(7) as keyof typeof column]}`;
  }
}
