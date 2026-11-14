/** A finished daily tide run as the harbor's screens show it: its score, Bram's guess, the haul and the three stamps. */
import type { Prize } from "../run/engine";
import { SHELF_CAP } from "../run/save";

/** The same shape run/save.ts exports; declared here so these screens depend only on the record, not the run's storage. */
export interface DayResult {
  readonly day: number;
  readonly score: number;
  readonly guess: number;
  readonly banked: readonly Prize[];
  /** Came home with something; matched or beat Bram's guess; no splash. */
  readonly stamps: { readonly home: boolean; readonly guess: boolean; readonly dry: boolean };
  readonly splashes: number;
}

export type StampKey = keyof DayResult["stamps"];
export interface Stamp { key: StampKey; icon: string; ask: (guess: number) => string; label: (result: DayResult) => string }

export const STAMPS: readonly Stamp[] = [
  { key: "home", icon: "/assets/season/purse.webp", ask: () => "Come home with something.",
    label: r => r.stamps.home ? "Came home with something" : "Came home empty-pawed" },
  { key: "guess", icon: "/assets/ui/ask-all-marks.webp", ask: guess => `Match or beat Bram’s guess of ${guess}.`,
    label: r => !r.stamps.guess ? "Short of Bram’s guess" : r.score > r.guess ? "Beat Bram’s guess" : "Matched Bram’s guess" },
  { key: "dry", icon: "/assets/ui/ask-dry.webp", ask: () => "Keep Mochi dry the whole tide.",
    label: r => r.stamps.dry ? "Dry paws" : r.splashes === 1 ? "One splash" : `${r.splashes} splashes` },
];

export function haulCount(result: Pick<DayResult, "banked">): Record<Prize, number> {
  const count = { reed: 0, glass: 0, pearl: 0 };
  for (const prize of result.banked) count[prize]++;
  return count;
}
/** What Bram can shelve, as the season model's [glass, reed]. Pearls never reach the shelf. */
export function shelfGoods(result: Pick<DayResult, "banked">): [number, number] {
  const count = haulCount(result);
  return [Math.min(count.glass, SHELF_CAP), Math.min(count.reed, SHELF_CAP)];
}
export const keptCount = (result: Pick<DayResult, "stamps">) => Object.values(result.stamps).filter(Boolean).length;
export const allKept = (result: Pick<DayResult, "stamps">) => keptCount(result) === 3;

export function resultTitle(result: DayResult): string {
  const kept = keptCount(result);
  return kept === 3 ? "All three kept." : kept === 0 ? "Nothing kept this time." : `${kept} of 3 kept.`;
}
export const resultLine = (result: DayResult) => `Banked ${result.score} · Bram guessed ${result.guess}`;

export function haulWords(result: Pick<DayResult, "banked">): string {
  const { reed, glass, pearl } = haulCount(result);
  const parts = [reed ? `${reed} reed` : "", glass ? `${glass} glass` : "", pearl ? `${pearl} pearl${pearl === 1 ? "" : "s"}` : ""].filter(Boolean);
  return parts.length ? parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : "nothing";
}

export function runSummary(results: readonly DayResult[]): { sailed: number; kept: number; allThree: number } {
  return { sailed: results.length, kept: results.reduce((sum, result) => sum + keptCount(result), 0), allThree: results.filter(allKept).length };
}
