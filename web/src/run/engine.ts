/**
 * The tide run: the Tidekeeper aims the waves, each wave leaves a prize, Mochi brings what she can home.
 * Pure rules. State comes only from `startTide` and `applyMove`; a tide is rebuilt from its start and moves.
 * All randomness is 32-bit integer arithmetic so the season contract can replay a tide exactly.
 */
export const RULES_VERSION = "tide_run_v1" as const;

export type Lane = 0 | 1 | 2;
export type Prize = "reed" | "glass" | "pearl";
export type StoryPrize = "lens" | "vane" | "moth";
export type Item = Prize | StoryPrize;
export type Move = "north" | "south" | "west" | "east" | "wait" | "home";
export interface Position { readonly x: Lane; readonly y: number }
export interface Placed extends Position { readonly kind: Item }
export interface Wave { readonly lanes: readonly Lane[]; readonly drops: readonly Placed[] }
/** A daily tide has only a seed. A story tide also names the prize waiting in its shell. */
export interface TideStart { readonly seed: number; readonly story?: StoryPrize }

export interface TideState extends TideStart {
  readonly rulesVersion: typeof RULES_VERSION;
  /** Generator state after the forecast in `next` was rolled. */
  readonly rng: number;
  readonly position: Position;
  readonly hearts: number;
  readonly pack: readonly Item[];
  readonly banked: readonly Item[];
  readonly score: number;
  readonly beat: number;
  readonly wave: number;
  readonly bridge: Lane;
  readonly items: readonly Placed[];
  /** The wave that lands next. Shown to the player from the moment the previous one lands. */
  readonly next: Wave;
  readonly splashes: number;
  /** The Tidekeeper turns one wave aside while Mochi carries the moth. */
  readonly shielded: boolean;
  readonly moves: readonly Move[];
  readonly outcome: "active" | "turned" | "rescued" | "home";
}

export type TideEvent =
  | { readonly kind: "move"; readonly from: Position; readonly to: Position }
  | { readonly kind: "pickup"; readonly item: Item; readonly at: Position }
  | { readonly kind: "full"; readonly item: Item }
  | { readonly kind: "bank"; readonly items: readonly Item[]; readonly gained: number }
  | { readonly kind: "wave"; readonly lanes: readonly Lane[] }
  | { readonly kind: "sweep"; readonly items: readonly Placed[] }
  | { readonly kind: "shield"; readonly lane: Lane }
  | { readonly kind: "splash"; readonly from: Position; readonly to: Position; readonly lost: Item | null; readonly hearts: number }
  | { readonly kind: "bridge"; readonly from: Lane; readonly to: Lane }
  | { readonly kind: "open"; readonly lane: Lane; readonly item: StoryPrize }
  | { readonly kind: "leave"; readonly items: readonly Placed[] }
  | { readonly kind: "forecast"; readonly wave: Wave }
  | { readonly kind: "end"; readonly reason: "turned" | "rescued" | "home"; readonly lost: readonly Item[] };

export interface TideTransition { readonly before: TideState; readonly after: TideState; readonly events: readonly TideEvent[] }

export const HEARTS = 3;
export const PACK_SLOTS = 3;
export const BEATS_PER_WAVE = 3;
export const MOVE_LIMIT = 36;
export const VALUE: Readonly<Record<Item, number>> = { reed: 1, glass: 3, pearl: 6, lens: 0, vane: 0, moth: 0 };
export const SLOTS: Readonly<Record<Item, number>> = { reed: 1, glass: 1, pearl: 1, lens: 1, vane: 1, moth: 2 };
export const DOCK: Position = { x: 1, y: 0 };
/** Where each story prize waits. The second wave of its tide always takes this lane. */
export const STORY_SHELL: Readonly<Record<StoryPrize, Position>> = { lens: { x: 0, y: 4 }, vane: { x: 2, y: 4 }, moth: { x: 2, y: 4 } };
const STORY_WAVE = 1;
/** [row, weight out of 100]. Reeds wash up on the near landing, glass on the far landing, pearls in the far-shore shells. */
const ROWS_CALM: readonly (readonly [number, number])[] = [[1, 50], [3, 35], [4, 15]];
const ROWS_ROUGH: readonly (readonly [number, number])[] = [[1, 25], [3, 40], [4, 35]];
const DIRECTIONS: Readonly<Record<Exclude<Move, "wait" | "home">, readonly [number, number]>> = { north: [0, 1], south: [0, -1], west: [-1, 0], east: [1, 0] };
const MOVES = ["north", "south", "west", "east", "wait", "home"] as const;

/** The first tide is eight calm waves; every other tide is twelve, two lanes at a time from the seventh. */
export function tideShape(start: Pick<TideStart, "story">): { readonly waves: number; readonly roughFrom: number } {
  return start.story === "lens" ? { waves: 8, roughFrom: 8 } : { waves: 12, roughFrom: 6 };
}
const isStory = (item: Item): item is StoryPrize => item === "lens" || item === "vane" || item === "moth";
const at = (a: Position, b: Position) => a.x === b.x && a.y === b.y;
const slotsUsed = (pack: readonly Item[]) => pack.reduce((sum, item) => sum + SLOTS[item], 0);

/** mulberry32 on unsigned 32-bit integers: returns the draw and the next generator state. */
export function draw(rng: number): readonly [number, number] {
  const state = (rng + 0x6D2B79F5) >>> 0;
  let t = Math.imul(state ^ (state >>> 15), state | 1) >>> 0;
  t = ((t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t) >>> 0;
  return [(t ^ (t >>> 14)) >>> 0, state];
}
export const seedState = (seed: number) => ((Math.imul(seed >>> 0, 0x9E3779B1) ^ 0x85EBCA6B) >>> 0);

function rollWave(start: TideStart, rngIn: number, wave: number): readonly [Wave, number] {
  const { waves, roughFrom } = tideShape(start), rough = wave >= roughFrom;
  let rng = rngIn, value: number;
  [value, rng] = draw(rng);
  const lanes: Lane[] = [value % 3 as Lane];
  if (rough) { [value, rng] = draw(rng); lanes.push((lanes[0]! + 1 + value % 2) % 3 as Lane); }
  const drops: Placed[] = [];
  if (wave < waves - 1) for (const x of lanes) {
    [value, rng] = draw(rng);
    let n = value % 100, y = 4;
    for (const [row, weight] of rough ? ROWS_ROUGH : ROWS_CALM) { if (n < weight) { y = row; break; } n -= weight; }
    drops.push({ x, y, kind: y === 1 ? "reed" : y === 3 || x === 1 ? "glass" : "pearl" });
  }
  // The draws above are always spent, so a story tide and a daily tide walk the generator alike.
  if (start.story && wave === STORY_WAVE) return [{ lanes: [STORY_SHELL[start.story].x], drops: [] }, rng];
  return [{ lanes, drops }, rng];
}

export function startTide(input: TideStart): TideState {
  if (!input || !Number.isSafeInteger(input.seed) || input.seed < 0 || input.seed > 0xFFFFFFFF ||
      !(input.story === undefined || isStory(input.story as Item))) throw new RangeError("Unsupported tide.");
  const start: TideStart = input.story ? { seed: input.seed, story: input.story } : { seed: input.seed };
  const [next, rng] = rollWave(start, seedState(start.seed), 0);
  return {
    ...start, rulesVersion: RULES_VERSION, rng, position: DOCK, hearts: HEARTS, pack: [], banked: [], score: 0, beat: 0, wave: 0,
    bridge: 1, items: [], next, splashes: 0, shielded: false, moves: [], outcome: "active",
  };
}

/** Moves left before the next wave lands: 3, 2 or 1. */
export const countdown = (state: Pick<TideState, "beat">) => BEATS_PER_WAVE - state.beat % BEATS_PER_WAVE;

/** Row 2 is the channel: crossing is one move, and only in the bridge's lane. */
export function stepDestination(state: Pick<TideState, "position" | "bridge">, move: Move): Position | null {
  if (move === "wait" || move === "home") return null;
  const [dx, dy] = DIRECTIONS[move], { x, y } = state.position;
  if (dx) { const nx = x + dx; return nx < 0 || nx > 2 ? null : { x: nx as Lane, y }; }
  if ((dy === 1 && y === 1) || (dy === -1 && y === 3)) return x === state.bridge ? { x, y: y + 2 * dy } : null;
  const ny = y + dy;
  return ny < 0 || ny > 4 ? null : { x, y: ny };
}

export function legalMoves(state: TideState): Move[] {
  if (state.outcome !== "active") return [];
  return MOVES.filter(move => move === "wait" || (move === "home" ? at(state.position, DOCK) : !!stepDestination(state, move)));
}

function arrive(state: TideState, events: TideEvent[]): TideState {
  let next = state;
  const here = next.items.find(item => at(item, next.position));
  if (here && slotsUsed(next.pack) + SLOTS[here.kind] <= PACK_SLOTS) {
    next = { ...next, items: next.items.filter(item => item !== here), pack: [...next.pack, here.kind] };
    events.push({ kind: "pickup", item: here.kind, at: next.position });
  } else if (here) events.push({ kind: "full", item: here.kind });
  if (at(next.position, DOCK) && next.pack.length) {
    const gained = next.pack.reduce((sum, item) => sum + VALUE[item], 0);
    events.push({ kind: "bank", items: next.pack, gained });
    next = { ...next, banked: [...next.banked, ...next.pack], score: next.score + gained, pack: [] };
  }
  return next;
}

function land(state: TideState, events: TideEvent[]): TideState {
  const { lanes, drops } = state.next;
  let next = state;
  events.push({ kind: "wave", lanes });
  const swept = next.items.filter(item => lanes.includes(item.x) && !isStory(item.kind));
  if (swept.length) { events.push({ kind: "sweep", items: swept }); next = { ...next, items: next.items.filter(item => !swept.includes(item)) }; }
  // The quay is out of the water's reach.
  if (lanes.includes(next.position.x) && next.position.y > 0) {
    if (next.pack.includes("moth") && !next.shielded) {
      next = { ...next, shielded: true };
      events.push({ kind: "shield", lane: next.position.x });
    } else {
      const from = next.position, to: Position = { x: from.x, y: from.y === 4 ? 3 : from.y === 3 ? 1 : 0 };
      const lost = next.pack.at(-1) ?? null;
      next = { ...next, position: to, hearts: next.hearts - 1, splashes: next.splashes + 1, pack: next.pack.slice(0, -1) };
      // A story prize is never lost for good: it goes back to its shell.
      if (lost && isStory(lost)) next = { ...next, items: [...next.items, { ...STORY_SHELL[lost], kind: lost }] };
      events.push({ kind: "splash", from, to, lost, hearts: next.hearts });
    }
  }
  if (lanes[0]! !== next.bridge) { events.push({ kind: "bridge", from: next.bridge, to: lanes[0]! }); next = { ...next, bridge: lanes[0]! }; }
  if (next.story && next.wave === STORY_WAVE) {
    events.push({ kind: "open", lane: STORY_SHELL[next.story].x, item: next.story });
    next = { ...next, items: [...next.items, { ...STORY_SHELL[next.story], kind: next.story }] };
  }
  // A shell holds one thing: nothing is left on a platform that already has a prize.
  const left = drops.filter(drop => !next.items.some(item => at(item, drop)));
  if (left.length) { events.push({ kind: "leave", items: left }); next = { ...next, items: [...next.items, ...left] }; }
  next = { ...next, wave: next.wave + 1 };
  if (next.hearts <= 0) { events.push({ kind: "end", reason: "rescued", lost: next.pack }); return { ...next, pack: [], outcome: "rescued" }; }
  next = arrive(next, events);
  if (next.wave >= tideShape(next).waves) { events.push({ kind: "end", reason: "turned", lost: next.pack }); return { ...next, pack: [], outcome: "turned" }; }
  const [wave, rng] = rollWave(next, next.rng, next.wave);
  events.push({ kind: "forecast", wave });
  return { ...next, next: wave, rng };
}

export function applyMove(before: TideState, candidate: unknown): TideTransition | null {
  const move = legalMoves(before).find(legal => legal === candidate);
  if (!move) return null;
  const events: TideEvent[] = [];
  if (move === "home") {
    events.push({ kind: "end", reason: "home", lost: [] });
    return { before, after: { ...before, moves: [...before.moves, move], outcome: "home" }, events };
  }
  let after: TideState = { ...before, beat: before.beat + 1, moves: [...before.moves, move] };
  const to = stepDestination(before, move);
  if (to) { events.push({ kind: "move", from: before.position, to }); after = { ...after, position: to }; }
  after = arrive(after, events);
  if (after.beat % BEATS_PER_WAVE === 0) after = land(after, events);
  return { before, after, events };
}

/** Persist the start and the moves, then derive everything else on reload. Null when the moves are not a legal tide. */
export function replayTide(start: unknown, moves: unknown): TideState | null {
  if (!Array.isArray(moves) || moves.length > MOVE_LIMIT) return null;
  let state: TideState;
  try { state = startTide(start as TideStart); } catch { return null; }
  for (const move of moves) {
    const turn = applyMove(state, move);
    if (!turn) return null;
    state = turn.after;
  }
  return state;
}

/** What a finished tide brought home, for Bram's shelf and the season contract. */
export function haul(state: Pick<TideState, "banked">): Readonly<Record<Prize, number>> {
  const count = (kind: Prize) => state.banked.filter(item => item === kind).length;
  return { reed: count("reed"), glass: count("glass"), pearl: count("pearl") };
}
