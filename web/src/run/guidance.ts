import { applyMove, startTide, tideShape, type TideState, type TideTransition } from "./engine";

export const GUIDANCE_KEY = "familiar.guidance.keep-wrens-light.v1";
export interface GuidancePreferences { version: 1; intro: null | "help" | "skip"; buttons: boolean }
const unset = (): GuidancePreferences => ({ version: 1, intro: null, buttons: false });

export function readGuidance(storage?: Pick<Storage, "getItem">): GuidancePreferences {
  try {
    const raw = (storage ?? localStorage).getItem(GUIDANCE_KEY);
    if (raw === null) return unset();
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return unset();
    const preference = value as Partial<GuidancePreferences>;
    if (preference.version !== 1 || (preference.intro !== null && preference.intro !== "help" && preference.intro !== "skip") || typeof preference.buttons !== "boolean") return unset();
    return { version: 1, intro: preference.intro, buttons: preference.buttons };
  } catch { return unset(); }
}

export function writeGuidance(preferences: GuidancePreferences, storage?: Pick<Storage, "setItem">): void {
  try { (storage ?? localStorage).setItem(GUIDANCE_KEY, JSON.stringify(preferences)); } catch { /* Guidance never blocks play. */ }
}
export const guidanceEnabled = (preferences: GuidancePreferences) => preferences.intro !== "skip";

export const INITIAL_CUE = "Swipe on the board, or tap a glowing neighboring stone. Mochi moves one step at a time.";
export const DISTANT_CUE = "Choose a glowing neighboring stone. Mochi moves one step at a time.";
export const LENS_SAFE_CUE = "Lens safe. Story finds restore the harbor; they add no points. Finish and return when you’re ready to fit it.";
const PICKUP_CUE = "Mochi picks up a find by stepping onto it. Carry it to the center dock to bank it.";
const LENS_PICKUP_CUE = "Mochi has the Beacon Lens. Bring it to the center dock before taking more risks.";
const LENS_LOSS_CUE = "The wave returned the Beacon Lens to the left shell. It is still there to collect.";
const bridgeCue = (lane: number) => `That wave moved the bridge to the ${["left", "center", "right"][lane]} lane. Cross the channel there.`;
type Lesson = "move" | "countdown" | "wave" | "bridge" | "crossing" | "pickup" | "lens-pickup" | "bank" | "lens-bank" | "lens-loss";

/** Observe all facts once, even when a more urgent fact supplies this move's single cue. */
export function observeTransition(transition: TideTransition, previous: ReadonlySet<Lesson>) {
  const { before, after, events } = transition, observed = new Set(previous);
  const candidates: string[] = [];
  const offer = (lesson: Lesson, condition: boolean, line: string) => {
    if (!condition) return;
    if (!observed.has(lesson)) candidates.push(line);
    observed.add(lesson);
  };
  offer("move", after.beat > before.beat, "Every step or wait advances the water by one move. Reading and menus do not.");
  offer("countdown", after.beat === 2, "The numbers show moves until the next wave. Mochi moves first, then the wave lands.");
  const wave = events.some(event => event.kind === "wave"), bridge = events.find(event => event.kind === "bridge");
  offer("wave", wave, "A wave arrives after every third move. Read the tinted lanes and the moves left before you move.");
  offer("bridge", !!bridge, bridgeCue(after.bridge));
  offer("crossing", events.some(event => event.kind === "move" && Math.abs(event.to.y - event.from.y) === 2), "Mochi crossed the bridge in one move.");
  const ordinaryPickup = events.some(event => event.kind === "pickup" && !["lens", "vane", "moth"].includes(event.item) && after.pack.includes(event.item) && !events.some(later => later.kind === "splash" && later.lost === event.item));
  offer("pickup", ordinaryPickup, PICKUP_CUE);
  offer("lens-pickup", events.some(event => event.kind === "pickup" && event.item === "lens") && after.pack.includes("lens"), LENS_PICKUP_CUE);
  offer("bank", events.some(event => event.kind === "bank" && event.gained > 0), "Cargo banked. Those points stay safe if the rest of the outing goes badly.");
  const lensBanked = events.some(event => event.kind === "bank" && event.items.includes("lens")) && after.banked.includes("lens");
  offer("lens-bank", lensBanked, LENS_SAFE_CUE);
  const lensLost = events.some(event => event.kind === "pickup" && event.item === "lens") && events.some(event => event.kind === "splash" && event.lost === "lens") && after.items.some(item => item.kind === "lens");
  offer("lens-loss", lensLost, LENS_LOSS_CUE);
  const loss = events.some(event => event.kind === "splash" && event.lost !== null);
  // Loss, protection and endings are already narrated by consequence(); never obscure them with an obsolete lesson.
  const cue = after.outcome !== "active" || events.some(event => event.kind === "shield") || loss && !lensLost ? null : candidates.at(-1) ?? null;
  return { observed, cue, lensBanked: lensBanked && !previous.has("lens-bank") && after.outcome === "active" };
}

/** Preserve a displayed lesson only while its state-dependent wording remains factual. */
export function retainedCue(cue: string | null, transition: TideTransition): string | null {
  const { after, events } = transition;
  if (after.outcome !== "active" || events.some(event => event.kind === "shield" || event.kind === "splash" && event.lost !== null)) return null;
  if (cue === LENS_PICKUP_CUE && !after.pack.includes("lens")) return null;
  if (cue === PICKUP_CUE && !after.pack.some(item => item === "reed" || item === "glass" || item === "pearl")) return null;
  if (cue === LENS_LOSS_CUE && !after.items.some(item => item.kind === "lens")) return null;
  if ([0, 1, 2].some(lane => cue === bridgeCue(lane)) && cue !== bridgeCue(after.bridge)) return null;
  return cue;
}

/** Replaying a saved trace marks history observed without presenting any old lesson. */
export function observedLessons(state: TideState): ReadonlySet<Lesson> {
  let current = startTide({ seed: state.seed, ...(state.story ? { story: state.story } : {}) });
  let observed: ReadonlySet<Lesson> = new Set();
  for (const move of state.moves) {
    const transition = applyMove(current, move);
    if (!transition) break;
    observed = observeTransition(transition, observed).observed;
    current = transition.after;
  }
  return observed;
}

export function returnAdvice(state: TideState): string | null {
  if (state.outcome !== "active" || !state.pack.length) return null;
  if (state.pack.includes("lens")) return "Mochi carries the Beacon Lens. Bring it to the center dock to bank it.";
  if (state.pack.includes("vane")) return "Mochi carries the Signal Vane. Bring it to the center dock to bank it.";
  if (state.pack.includes("moth")) return "Mochi cradles the wind-moth. Bring it to the center dock to bank it.";
  const remainingMoves = (tideShape(state).waves - state.wave) * 3 - state.beat % 3;
  return remainingMoves <= 3 ? "Last wave. Bank what you can at the center dock." : remainingMoves <= 9 ? "Three waves or fewer remain. Start bringing the pack to the center dock now; the bridge may move." : null;
}
