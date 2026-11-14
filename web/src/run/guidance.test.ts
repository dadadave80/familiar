import { expect, test } from "bun:test";
import { VALUE, applyMove, replayTide, startTide, type Move, type TideStart, type TideTransition } from "./engine";
import { cautiousMove } from "./bot";
import { consequence, storyStart } from "./story";
import { GUIDANCE_KEY, INITIAL_CUE, LENS_SAFE_CUE, guidanceEnabled, observeTransition, observedLessons, readGuidance, retainedCue, returnAdvice, writeGuidance, type GuidancePreferences } from "./guidance";

const defaults: GuidancePreferences = { version: 1, intro: null, buttons: false };
function memory() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}
function last(start: TideStart, moves: readonly Move[]): TideTransition {
  const before = replayTide(start, moves.slice(0, -1));
  expect(before).not.toBeNull();
  const transition = applyMove(before!, moves.at(-1));
  expect(transition).not.toBeNull();
  return transition!;
}

test("nullable introduction lets button preference survive reload without choosing Help or Skip", () => {
  const storage = memory();
  expect(readGuidance(storage)).toEqual(defaults);
  writeGuidance({ ...readGuidance(storage), buttons: true }, storage);
  expect(readGuidance(storage)).toEqual({ version: 1, intro: null, buttons: true });
  for (const intro of ["help", "skip"] as const) {
    writeGuidance({ ...readGuidance(storage), intro }, storage);
    expect(readGuidance(storage)).toEqual({ version: 1, intro, buttons: true });
    expect(guidanceEnabled(readGuidance(storage))).toBe(intro === "help");
  }
  expect(GUIDANCE_KEY).toBe("familiar.guidance.keep-wrens-light.v1");
  expect(GUIDANCE_KEY.startsWith("familiar.expedition.")).toBe(false);
});

test("malformed or unsupported preferences behave as unset without rewriting bytes", () => {
  for (const raw of ["{", "null", "[]", '{"version":2,"intro":"help","buttons":true}', '{"version":1,"buttons":false}', '{"version":1,"intro":"skip","buttons":0}', '{"version":1,"intro":true,"buttons":true}']) {
    const storage = memory(); storage.data.set(GUIDANCE_KEY, raw);
    expect(readGuidance(storage)).toEqual(defaults);
    expect(storage.data.get(GUIDANCE_KEY)).toBe(raw);
  }
});

test("blocked storage leaves the caller's in-memory choice usable", () => {
  const storage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  expect(readGuidance(storage)).toEqual(defaults);
  const choice: GuidancePreferences = { ...readGuidance(storage), intro: "help", buttons: true };
  expect(() => writeGuidance(choice, storage)).not.toThrow();
  expect(guidanceEnabled(choice)).toBe(true);
  expect(choice.buttons).toBe(true);
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("access blocked"); } });
  try { expect(readGuidance()).toEqual(defaults); expect(() => writeGuidance(choice)).not.toThrow(); }
  finally { if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor); else Reflect.deleteProperty(globalThis, "localStorage"); }
});

test("accepted first and second decisions teach move timing before the first wave", () => {
  const first = applyMove(startTide(storyStart("lens")), "wait")!;
  const one = observeTransition(first, observedLessons(first.before));
  expect(one.cue).toBe("Every step or wait advances the water by one move. Reading and menus do not.");
  const second = applyMove(first.after, "north")!;
  expect(second.events.some(event => event.kind === "wave")).toBe(false);
  expect(observeTransition(second, one.observed).cue).toBe("The numbers show moves until the next wave. Mochi moves first, then the wave lands.");
  const third = applyMove(second.after, "south")!;
  const lesson = observeTransition(third, observedLessons(third.before));
  expect(lesson.cue).toBe("That wave moved the bridge to the left lane. Cross the channel there.");
  expect(lesson.observed.has("wave")).toBe(true);
  expect(lesson.observed.has("bridge")).toBe(true);
});

test("observing and replaying guidance never modifies canonical traces or creates a lesson backlog", () => {
  let state = startTide(storyStart("lens"));
  while (state.outcome === "active") {
    const transition = applyMove(state, cautiousMove(state, { ...VALUE, lens: 60 }))!;
    const serialized = JSON.stringify(transition);
    const lesson = observeTransition(transition, observedLessons(state));
    expect(JSON.stringify(transition)).toBe(serialized);
    expect(observedLessons(transition.after)).toEqual(lesson.observed);
    expect(observeTransition(transition, lesson.observed).cue).toBeNull();
    expect(observeTransition(transition, lesson.observed).lensBanked).toBe(false);
    if (lesson.lensBanked) expect(lesson.cue).toBe(LENS_SAFE_CUE);
    state = transition.after;
  }
});

test("quiet accepted moves retain bridge teaching without reviving a dismissed cue", () => {
  const bridge = last(storyStart("lens"), ["wait", "north", "south"]);
  const cue = observeTransition(bridge, observedLessons(bridge.before)).cue;
  expect(cue).toBe("That wave moved the bridge to the left lane. Cross the channel there.");
  const quiet = applyMove(bridge.after, "wait")!;
  expect(quiet.events).toEqual([]);
  expect(observeTransition(quiet, observedLessons(quiet.before)).cue).toBeNull();
  expect(retainedCue(cue, quiet)).toBe(cue);
  expect(retainedCue(null, quiet)).toBeNull();
});

test("carried lens guidance survives a quiet move and clears when a real splash loses it", () => {
  const pickup = last(storyStart("lens"), ["north", "north", "north", "south", "north", "west", "north"]);
  const cue = observeTransition(pickup, observedLessons(pickup.before)).cue;
  expect(cue).toBe("Mochi has the Beacon Lens. Bring it to the center dock before taking more risks.");
  const quiet = applyMove(pickup.after, "wait")!;
  expect(quiet.events).toEqual([]);
  expect(retainedCue(cue, quiet)).toBe(cue);
  const splash = applyMove(quiet.after, "east")!;
  expect(splash.after.outcome).toBe("active");
  expect(splash.events.some(event => event.kind === "splash" && event.lost === "lens")).toBe(true);
  expect(observeTransition(splash, observedLessons(splash.before)).cue).toBeNull();
  expect(retainedCue(cue, splash)).toBeNull();
  expect(consequence(splash)).toContain("Splashed.");
});

test("persistent cues yield to protection, endings, banking and changed bridge lanes", () => {
  const cue = "Mochi has the Beacon Lens. Bring it to the center dock before taking more risks.";
  const bank = last(storyStart("lens"), ["north", "north", "north", "south", "north", "west", "north", "south", "south", "south", "east"]);
  expect(bank.events.some(event => event.kind === "bank" && event.items.includes("lens"))).toBe(true);
  expect(retainedCue(cue, bank)).toBeNull();
  const shield = last(storyStart("moth"), ["north", "north", "north", "south", "east", "west", "north", "east", "wait"]);
  expect(shield.events.some(event => event.kind === "shield")).toBe(true);
  expect(retainedCue(INITIAL_CUE, shield)).toBeNull();
  const end = last(storyStart("lens"), Array<Move>(24).fill("wait"));
  expect(end.after.outcome).toBe("turned");
  expect(retainedCue(INITIAL_CUE, end)).toBeNull();
  const bridge = last(storyStart("lens"), Array<Move>(9).fill("wait"));
  expect(bridge.after.bridge).toBe(1);
  expect(retainedCue("That wave moved the bridge to the left lane. Cross the channel there.", bridge)).toBeNull();
  expect(retainedCue(INITIAL_CUE, bridge)).toBe(INITIAL_CUE);
});

test("a real pickup and splash teaches the returned lens instead of obsolete possession", () => {
  // Seed 59 exercises a legal engine edge case; the authored Chapter 1 seed stays 5.
  const transition = last({ seed: 59, story: "lens" }, ["east", "west", "north", "wait", "east", "south", "west", "wait", "east", "north", "north", "wait", "west", "west", "north"]);
  expect(transition.events.some(event => event.kind === "pickup" && event.item === "lens")).toBe(true);
  expect(transition.events.some(event => event.kind === "splash" && event.lost === "lens")).toBe(true);
  expect(transition.after.outcome).toBe("active");
  expect(observeTransition(transition, observedLessons(transition.before)).cue).toBe("The wave returned the Beacon Lens to the left shell. It is still there to collect.");
  expect(consequence(transition)).not.toContain("Mochi carries");
});

test("real terminal pickup and terminal banked lens transitions never show queued lessons", () => {
  const pickup = last(storyStart("lens"), ["north", "east", "south", "west", "north", "wait", "east", "west", "south", "wait", "east", "north", "wait", "west", "wait", "west", "east", "wait", "east", "south", "west", "wait", "east", "north"]);
  expect(pickup.events.some(event => event.kind === "pickup")).toBe(true);
  expect(pickup.after.outcome).toBe("turned");
  expect(observeTransition(pickup, observedLessons(pickup.before)).cue).toBeNull();
  expect(consequence(pickup)).not.toContain("Mochi takes");
  const banked = last(storyStart("lens"), ["wait", "east", "wait", "north", "wait", "west", "west", "north", "wait", "north", "south", "east", "west", "wait", "wait", "wait", "south", "wait", "wait", "east", "wait", "east", "west", "north"]);
  expect(banked.after.banked).toContain("lens");
  expect(banked.after.outcome).toBe("turned");
  expect(observeTransition(banked, observedLessons(banked.before))).toMatchObject({ cue: null, lensBanked: false });
});

test("a real splash and bank keeps safety factual and does not teach a lost pickup", () => {
  const transition = last({ seed: 20771 }, ["west", "east", "wait", "east", "wait", "west", "wait", "east", "west", "north", "wait", "east", "south", "north", "wait", "west", "north", "west", "east", "east", "south", "wait", "north", "west"]);
  expect(transition.events.some(event => event.kind === "splash")).toBe(true);
  expect(transition.events.some(event => event.kind === "bank")).toBe(true);
  expect(transition.after.score).toBeGreaterThan(transition.before.score);
  expect(transition.after.pack).toEqual([]);
  expect(observeTransition(transition, observedLessons(transition.before)).cue).toBeNull();
  expect(consequence(transition)).toContain("Banked");
  expect(consequence(transition)).toContain("Splashed.");
});

test("return advice starts at nine timed moves, keeps story names and suppresses empty packs", () => {
  const initial = startTide(storyStart("lens"));
  expect(returnAdvice({ ...initial, wave: 5, beat: 15 })).toBeNull();
  expect(returnAdvice({ ...initial, wave: 4, beat: 14, pack: ["reed"] })).toBeNull();
  expect(returnAdvice({ ...initial, wave: 5, beat: 15, pack: ["reed"] })).toBe("Three waves or fewer remain. Start bringing the pack to the center dock now; the bridge may move.");
  expect(returnAdvice({ ...initial, wave: 7, beat: 21, pack: ["reed"] })).toBe("Last wave. Bank what you can at the center dock.");
  expect(returnAdvice({ ...initial, pack: ["lens"] })).toBe("Mochi carries the Beacon Lens. Bring it to the center dock to bank it.");
  expect(returnAdvice({ ...initial, outcome: "turned", pack: ["lens"] })).toBeNull();
  const daily = startTide({ seed: 20771 });
  expect(returnAdvice({ ...daily, wave: 9, beat: 27, pack: ["glass"] })).toContain("Three waves or fewer");
});
