import { CONTENT_VERSION, type BankedItem, type Tool } from "../expedition/types";
import type { ReturnRecord } from "../expedition/return-record";
import { askStatus, keptCount, replayRun, type Run, type TideCard } from "./asks";
import { askLine, cardForDay, TIDE_POOL } from "./cards";
import { betterTide, type TideEntry, type TidePending } from "./log";
import type { TideDayView } from "./TideAsk";
import type { LogPage } from "./TideLog";

export type StoryRecord = Pick<ReturnRecord, "id" | "contentVersion" | "outcome" | "cargo" | "area" | "tool" | "banked" | "commands">;

export function storyTitle(cargo: readonly BankedItem[]): string {
  if (cargo.includes("lens") && cargo.includes("moth")) return "The lens and the moth come home";
  if (cargo.includes("lens")) return "The lens comes home";
  if (cargo.includes("moth")) return "The moth comes home";
  if (cargo.includes("vane")) return "The vane comes home";
  return "Mochi comes home";
}

export function storyPages(records: readonly StoryRecord[]): Extract<LogPage, { kind: "story" }>[] {
  const seen = new Set<string>();
  return records.filter(record => {
    if (record.outcome !== "returned" || !record.cargo.length || record.contentVersion !== CONTENT_VERSION || seen.has(record.id)) return false;
    seen.add(record.id);
    return true;
  }).map(record => ({
    kind: "story", id: record.id, title: storyTitle(record.cargo),
    subtitle: `${record.area === "wind" ? "Wind Gate" : "Beacon Court"} · the ${record.tool} · ${record.commands.length} decisions`,
    area: record.area, tool: record.tool, banked: record.banked, commands: record.commands,
  }));
}

export function tidePages(entries: readonly TideEntry[]): Extract<LogPage, { kind: "tide" }>[] {
  return [...entries].sort((a, b) => a.day - b.day).map(entry => ({
    kind: "tide", day: entry.day, card: cardForDay(entry.day), entry,
  }));
}

export function logPages(records: readonly StoryRecord[], entries: readonly TideEntry[]): LogPage[] {
  return [...storyPages(records), ...tidePages(entries)];
}

export function pageForDay(pages: readonly LogPage[], day?: number): number {
  const index = day === undefined ? -1 : pages.findIndex(page => page.kind === "tide" && page.day === day);
  return index < 0 ? Math.max(0, pages.length - 1) : index;
}

function bestReturn(entries: readonly TideEntry[], cardId: string): TideEntry | null {
  let best: TideEntry | null = null;
  for (const entry of entries) {
    if (entry.cardId !== cardId || entry.outcome !== "returned") continue;
    if (!best || betterTide(entry, best) || !betterTide(best, entry) && entry.day < best.day) best = entry;
  }
  return best;
}

export interface StampSlot { card: TideCard; entry: TideEntry | null; allThree: boolean }

export function stampSheet(entries: readonly TideEntry[]): StampSlot[] {
  return TIDE_POOL.map(card => {
    const entry = bestReturn(entries, card.id);
    return { card, entry, allThree: entry?.kept.every(Boolean) ?? false };
  });
}

export function pageForCard(pages: readonly LogPage[], cardId: string): number {
  const best = bestReturn(pages.flatMap(page => page.kind === "tide" ? [page.entry] : []), cardId);
  return best ? pages.findIndex(page => page.kind === "tide" && page.entry === best) : -1;
}

export function todayView(today: number, entries: readonly TideEntry[]): TideDayView {
  return { day: today, card: cardForDay(today), entry: entries.find(entry => entry.day === today) ?? null };
}

export function earlierDays(today: number, entries: readonly TideEntry[], count = 6): TideDayView[] {
  const first = Math.min(today, ...entries.map(entry => entry.day));
  return Array.from({ length: Math.max(0, Math.min(6, count, today - first)) }, (_, index) => todayView(today - index - 1, entries));
}

const decisions = (count: number) => `${count} ${count === 1 ? "decision" : "decisions"}`;
const slippedTitle = (count: number) => count === 1 ? "One ask slipped" : count === 2 ? "Two asks slipped" : "All three asks slipped";

function returnResult(kept: number, turns: number, best: number, empty: boolean): string {
  if (empty) return "An empty satchel keeps no asks.";
  return `${kept === 3 ? "All three asks" : `${kept} of 3 asks`} kept in ${decisions(turns)}.`
    + (kept === 3 && turns <= best ? " The Tidekeeper’s way." : "");
}

export function tideResult(entry: TideEntry): string {
  return entry.outcome === "rescued"
    ? "Bram brought Mochi home. The asks can wait for another try."
    : returnResult(entry.kept.filter(Boolean).length, entry.decisions, cardForDay(entry.day).best,
      replayRun(entry.tool, entry.commands)?.state.cargo.length === 0);
}

export function outingNotice(run: Run, card: TideCard, recorded: { entry: TideEntry; improved: boolean; previous: TideEntry | null }): string {
  if (run.state.outcome === "rescued") return "Bram brought Mochi home. The asks slipped this time; the tide log keeps the try.";
  const result = returnResult(keptCount(card, run), run.state.turn, card.best, run.state.cargo.length === 0);
  if (!recorded.previous) return result;
  return result + (recorded.improved
    ? " A new best for the day."
    : ` The day’s best stays at ${recorded.entry.kept.filter(Boolean).length} of 3 in ${decisions(recorded.entry.decisions)}.`);
}

export type TideLink = { label: string; action: "tide" | "log" | "sail" | "bram" };
export type HarborTide =
  | { kind: "link"; links: TideLink[] }
  | { kind: "panel"; title: string; body: string; primary: { label: string; target: "tide" | "log" | "sail" }; links: TideLink[] };

export function harborTide(input: { lit: boolean; storyStep: boolean; card: TideCard; next: TideCard; entry: TideEntry | null }): HarborTide | null {
  const { lit, storyStep, card, next, entry } = input;
  if (!lit) return null;
  if (storyStep) return { kind: "link", links: [{ label: "Today’s tide", action: "tide" }] };
  if (!entry) return {
    kind: "panel", title: "The Tidekeeper has an ask.",
    body: `${card.name}. Three asks for one tide, with the ${card.tool}.`,
    primary: { label: "See today’s ask", target: "tide" }, links: [],
  };
  const allThree = entry.outcome === "returned" && entry.kept.every(Boolean);
  const links: TideLink[] = allThree
    ? [{ label: "Sail today’s tide again", action: "sail" }]
    : [{ label: "Open the tide log", action: "log" }];
  if (entry.outcome === "returned" && replayRun(entry.tool, entry.commands)?.state.cargo.length) {
    links.push({ label: "Take it to Bram", action: "bram" });
  }
  const tomorrow = `Tomorrow: ${next.name}.`;
  if (entry.outcome === "rescued") return {
    kind: "panel", title: "Bram brought Mochi home.", body: `The asks can wait for another try. ${tomorrow}`,
    primary: { label: "Sail today’s tide again", target: "sail" }, links,
  };
  if (allThree) return {
    kind: "panel", title: "All three asks kept.",
    body: `${decisions(entry.decisions)}${entry.decisions <= card.best ? ": the Tidekeeper’s way." : `; the Tidekeeper’s way takes ${card.best}.`} ${tomorrow}`,
    primary: { label: "Open the tide log", target: "log" }, links,
  };
  const slipped = card.asks.filter((_, index) => !entry.kept[index]);
  return {
    kind: "panel", title: `${slippedTitle(slipped.length)}.`,
    body: `Slipped: ${slipped.map(ask => askLine(ask, card.tool)).join(" ")} ${tomorrow}`,
    primary: { label: "Sail today’s tide again", target: "sail" }, links,
  };
}

export function tideObjective(card: TideCard, run: Run): string {
  const ask = card.asks.find(ask => askStatus(ask, run) === "open");
  return ask ? askLine(ask, run.state.tool) : "Bring Mochi home at the center dock.";
}

export function askFlips(card: TideCard, before: Run, after: Run): string {
  const changes = card.asks.flatMap(ask => {
    if (askStatus(ask, before) !== "open") return [];
    const status = askStatus(ask, after);
    return status === "open" ? [] : [{ status, line: askLine(ask, after.state.tool) }];
  });
  const slipped = changes.filter(change => change.status === "slipped");
  const firstSlip = changes.findIndex(change => change.status === "slipped");
  return changes.flatMap((change, index) => change.status === "kept" ? [`Ask kept: ${change.line}`]
    : index === firstSlip ? [`${slippedTitle(slipped.length)}: ${slipped.map(item => item.line).join(" ")}`] : []).join(" ");
}

export function restartTide(pending: TidePending | null, today: number, tool: Tool): { tool: Tool; day: number } {
  return { tool, day: pending?.day ?? today };
}

export function devTideDay(search: string): number | null {
  const value = new URLSearchParams(search).get("tide-day");
  if (value === null || !/^-?\d+$/.test(value)) return null;
  const day = Number(value);
  return Number.isSafeInteger(day) ? day : null;
}
