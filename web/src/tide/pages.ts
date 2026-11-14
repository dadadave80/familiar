import { CONTENT_VERSION, type BankedItem } from "../expedition/types";
import type { ReturnRecord } from "../expedition/return-record";
import { askStatus, keptCount, type Run, type TideCard } from "./asks";
import { askLine, cardForDay, TIDE_POOL } from "./cards";
import { betterTide, type TideEntry } from "./log";
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
  return Array.from({ length: count }, (_, index) => todayView(today - index - 1, entries));
}

export function tideResult(entry: Pick<TideEntry, "kept" | "decisions" | "outcome">): string {
  return entry.outcome === "rescued"
    ? "Bram brought Mochi home. The asks can wait for another try."
    : `${entry.kept.filter(Boolean).length} of 3 asks kept in ${entry.decisions} decisions.`;
}

export function outingNotice(run: Run, card: TideCard, recorded: { entry: TideEntry; improved: boolean; previous: TideEntry | null }): string {
  if (run.state.outcome === "rescued") return "Bram brought Mochi home. The asks slipped this time; the tide log keeps the try.";
  const result = `${keptCount(card, run)} of 3 asks kept in ${run.state.turn} decisions.`;
  if (!recorded.previous) return result;
  return result + (recorded.improved
    ? " A new best for the day."
    : ` The day’s best stays at ${recorded.entry.kept.filter(Boolean).length} of 3 in ${recorded.entry.decisions}.`);
}

export type TideLink = { label: string; action: "tide" | "log" | "sail" };
export type HarborTide =
  | { kind: "link"; links: TideLink[] }
  | { kind: "panel"; title: string; body: string; primary: { label: string; target: "tide" | "log" }; links: TideLink[] };

export function harborTide(input: { lit: boolean; storyStep: boolean; card: TideCard; entry: TideEntry | null }): HarborTide | null {
  const { lit, storyStep, card, entry } = input;
  if (!lit) return null;
  if (storyStep) return { kind: "link", links: [{ label: "Today’s tide", action: "tide" }] };
  if (!entry) return {
    kind: "panel", title: "The Tidekeeper has an ask.",
    body: `${card.name}: ${card.asks.map(ask => askLine(ask, card.tool)).join(" ")}`,
    primary: { label: "See today’s ask", target: "tide" }, links: [],
  };
  return {
    kind: "panel", title: "Today’s tide is in the log.",
    body: `${tideResult(entry)} Tomorrow the Tidekeeper asks something new.`,
    primary: { label: "Open the tide log", target: "log" },
    links: [{ label: "Sail today’s tide again", action: "sail" }],
  };
}

export function tideObjective(card: TideCard, run: Run): string {
  const ask = card.asks.find(ask => askStatus(ask, run) === "open");
  return ask ? askLine(ask, run.state.tool) : "Bring Mochi home at the center dock.";
}

export function askFlips(card: TideCard, before: Run, after: Run): string {
  return card.asks.flatMap(ask => {
    if (askStatus(ask, before) !== "open") return [];
    const status = askStatus(ask, after);
    return status === "open" ? [] : [`${status === "kept" ? "Ask kept" : "One ask slipped"}: ${askLine(ask, after.state.tool)}`];
  }).join(" ");
}

export function devTideDay(search: string): number | null {
  const value = new URLSearchParams(search).get("tide-day");
  if (value === null || !/^-?\d+$/.test(value)) return null;
  const day = Number(value);
  return Number.isSafeInteger(day) ? day : null;
}
