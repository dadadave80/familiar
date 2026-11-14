/** Bram's guess: what a cautious player banks on a tide. It never ends a wave beat in the water and takes no risks. */
import { DOCK, PACK_SLOTS, SLOTS, VALUE, applyMove, countdown, legalMoves, startTide, stepDestination, tideShape, type Item, type Move, type Position, type TideState } from "./engine";

/** Sideways steps to the nearest lane the next wave spares; the quay is always safe. */
const toSafety = (state: TideState, position: Position) => position.y === 0 ? 0 :
  Math.min(...[0, 1, 2].filter(lane => !state.next.lanes.includes(lane as 0 | 1 | 2)).map(lane => Math.abs(lane - position.x)));

function steps(state: TideState, from: Position, to: Position): number {
  const seen = new Set([`${from.x},${from.y}`]);
  let frontier = [from];
  for (let distance = 0; frontier.length; distance++) {
    const next: Position[] = [];
    for (const position of frontier) {
      if (position.x === to.x && position.y === to.y) return distance;
      for (const move of ["north", "south", "west", "east"] as const) {
        const step = stepDestination({ position, bridge: state.bridge }, move);
        if (step && !seen.has(`${step.x},${step.y}`)) { seen.add(`${step.x},${step.y}`); next.push(step); }
      }
    }
    frontier = next;
  }
  return 99;
}

/** `worth` lets a caller chase something else (the fixture's pearl diver); Bram's guess uses the real values. */
export function cautiousMove(state: TideState, worth: Readonly<Record<Item, number>> = VALUE): Move {
  const left = countdown(state) - 1;
  const all = legalMoves(state).filter(move => move !== "home").map(move => ({ move, position: stepDestination(state, move) ?? state.position }));
  const safe = all.filter(option => toSafety(state, option.position) <= left), options = safe.length ? safe : all;
  const used = state.pack.reduce((sum, item) => sum + SLOTS[item], 0), wavesLeft = tideShape(state).waves - state.wave;
  const goals = used >= PACK_SLOTS || (used > 0 && wavesLeft <= 2) ? [{ ...DOCK, worth: 99 }] :
    [...state.items.map(item => ({ x: item.x, y: item.y, worth: worth[item.kind] })), ...(used > 0 ? [{ ...DOCK, worth: 1 }] : [])];
  let best = options[0]!, score = -1;
  for (const option of options) for (const goal of goals) {
    const value = goal.worth / (1 + steps(state, option.position, goal));
    if (value > score) { score = value; best = option; }
  }
  return best.move;
}

export function cautiousTide(seed: number): TideState {
  let state = startTide({ seed });
  while (state.outcome === "active") state = applyMove(state, cautiousMove(state))!.after;
  return state;
}
export const bramsGuess = (seed: number) => cautiousTide(seed).score;
