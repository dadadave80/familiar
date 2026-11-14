/** A harbor's tide runs: the one in progress and each day's finished tide. Only starts and moves are stored; the rest is replayed. */
import { haul, replayTide, type Move, type Prize, type StoryPrize, type TideState } from "./engine";
import { bramsGuess } from "./bot";

export type { Prize } from "./engine";

export interface TideBook {
  /** The tide in progress, rebuilt from its start and moves. */
  readonly active: TideState | null;
  /** The first finished daily tide of each day, newest last. */
  readonly days: readonly TideState[];
}
export const emptyBook = (): TideBook => ({ active: null, days: [] });
export const DAYS_KEPT = 30;
/** The UTC day number, the same boundary the season contract uses. */
export const tideDay = (now = Date.now()) => Math.floor(now / 86_400_000);

type Trace = { seed: number; story?: StoryPrize; moves: readonly Move[] };
const trace = (state: TideState): Trace => ({ seed: state.seed, ...(state.story ? { story: state.story } : {}), moves: state.moves });
const bad = () => new Error("The saved tide could not be read. Its original record is still on this device.");

export function readBook(storage: Pick<Storage, "getItem">, key: string): TideBook {
  const raw = storage.getItem(key);
  if (raw === null) return emptyBook();
  if (raw.length > 65_536) throw bad();
  let value;
  try { value = JSON.parse(raw); } catch { throw bad(); }
  if (value?.version !== 1 || !Array.isArray(value.days) || value.days.length > DAYS_KEPT) throw bad();
  const restore = (entry: Trace | null): TideState => {
    const state = entry && replayTide({ seed: entry.seed, ...(entry.story ? { story: entry.story } : {}) }, entry.moves);
    if (!state) throw bad();
    return state;
  };
  const active = value.active === null ? null : restore(value.active);
  const days = (value.days as Trace[]).map(restore);
  if (days.some((day, i) => day.story || day.outcome === "active" || (i > 0 && day.seed <= days[i - 1]!.seed))) throw bad();
  return { active, days };
}

export function writeBook(storage: Pick<Storage, "getItem" | "setItem">, key: string, book: TideBook) {
  const raw = JSON.stringify({ version: 1, active: book.active ? trace(book.active) : null, days: book.days.map(trace) });
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error("The tide could not be saved.");
}

/** Ends the tide in progress. A daily tide is kept only if it is that day's first: the first tide docked each day counts. */
export function closeTide(book: TideBook, finished: TideState): TideBook {
  if (finished.outcome === "active") throw new Error("This tide has not ended.");
  if (finished.story || book.days.some(day => day.seed === finished.seed)) return { ...book, active: null };
  return { active: null, days: [...book.days, finished].sort((a, b) => a.seed - b.seed).slice(-DAYS_KEPT) };
}

export interface DayResult {
  day: number;
  score: number;
  guess: number;
  banked: readonly Prize[];
  /** Came home with something; matched Bram's guess; dry paws. */
  stamps: { home: boolean; guess: boolean; dry: boolean };
  splashes: number;
}
export function dayResult(tide: TideState): DayResult {
  const guess = bramsGuess(tide.seed);
  return { day: tide.seed, score: tide.score, guess,
    banked: tide.banked.filter((item): item is Prize => item === "reed" || item === "glass" || item === "pearl"),
    stamps: { home: tide.score > 0, guess: tide.score >= guess, dry: tide.splashes === 0 }, splashes: tide.splashes };
}
export function todayResult(book: TideBook, day: number): DayResult | null {
  const tide = book.days.find(entry => entry.seed === day);
  return tide ? dayResult(tide) : null;
}
export function dayResults(book: TideBook): readonly DayResult[] {
  return [...book.days].reverse().map(dayResult);
}

/** What reaches Bram's shelf from one tide: room for three reeds and three pieces of glass a day. */
export const SHELF_CAP = 3;
export function shelfHaul(result: DayResult): { reed: number; glass: number; pearl: number } {
  const h = haul(result);
  return { reed: Math.min(h.reed, SHELF_CAP), glass: Math.min(h.glass, SHELF_CAP), pearl: h.pearl };
}
