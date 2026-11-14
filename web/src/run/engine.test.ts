import { describe, expect, test } from "bun:test";
import { DOCK, HEARTS, VALUE, applyMove, countdown, draw, haul, legalMoves, replayTide, seedState, startTide, tideShape, type Move, type TideEvent, type TideState } from "./engine";
import { bramsGuess, cautiousTide } from "./bot";

const play = (state: TideState, ...moves: Move[]) => moves.reduce((s, move) => {
  const turn = applyMove(s, move);
  if (!turn) throw new Error(`illegal ${move}`);
  return turn.after;
}, state);
const events = (state: TideState, move: Move): readonly TideEvent[] => applyMove(state, move)!.events;
/** A hand-set position inside a real tide, one beat before the wave in `lanes` lands. */
const poised = (start: Parameters<typeof startTide>[0], patch: Partial<TideState>): TideState => ({ ...startTide(start), beat: 2, ...patch });

describe("the tide run", () => {
  test("starts on the dock with the first wave already forecast", () => {
    const state = startTide({ seed: 20771 });
    expect(state.position).toEqual(DOCK);
    expect(countdown(state)).toBe(3);
    expect(state.next.lanes.length).toBe(1);
    expect(legalMoves(state)).toEqual(["north", "west", "east", "wait", "home"]);
  });

  test("the generator is pinned for the contract copy", () => {
    expect(seedState(20771)).toBe(2868735576);
    let rng = seedState(20771);
    const draws: number[] = [];
    for (let i = 0; i < 4; i++) { const [value, next] = draw(rng); draws.push(value); rng = next; }
    expect(draws).toEqual(PINNED_DRAWS);
  });

  test("a wave lands after every third move, moves the bridge and leaves its prize", () => {
    const start = startTide({ seed: 20771 }), { lanes, drops } = start.next;
    const after = play(start, "wait", "wait", "wait");
    expect(after.wave).toBe(1);
    expect(after.bridge).toBe(lanes[0]!);
    expect(after.items).toEqual([...drops]);
    expect(after.hearts).toBe(HEARTS);
    expect(countdown(after)).toBe(3);
  });

  test("standing in the wave's lane costs a heart, the last prize and a platform", () => {
    const state = poised({ seed: 3 }, { position: { x: 0, y: 4 }, pack: ["reed", "glass"], next: { lanes: [0], drops: [] } });
    const turn = applyMove(state, "wait")!;
    expect(turn.after.hearts).toBe(2);
    expect(turn.after.pack).toEqual(["reed"]);
    expect(turn.after.position).toEqual({ x: 0, y: 3 });
    expect(turn.events.find(e => e.kind === "splash")).toMatchObject({ lost: "glass", hearts: 2 });
    const across = applyMove({ ...state, position: { x: 0, y: 3 } }, "wait")!.after;
    expect(across.position).toEqual({ x: 0, y: 1 });
  });

  test("the quay is never hit, and a wave washing Mochi onto the dock banks her pack", () => {
    const quay = applyMove(poised({ seed: 3 }, { position: { x: 1, y: 0 }, next: { lanes: [1], drops: [] } }), "wait")!.after;
    expect(quay.hearts).toBe(HEARTS);
    const washed = applyMove(poised({ seed: 3 }, { position: { x: 1, y: 1 }, pack: ["glass", "reed"], next: { lanes: [1], drops: [] } }), "wait")!.after;
    expect(washed.position).toEqual(DOCK);
    expect(washed.banked).toEqual(["glass"]);
    expect(washed.score).toBe(VALUE.glass);
  });

  test("a wave sweeps loose prizes in its lane and spares the others", () => {
    const state = poised({ seed: 3 }, { items: [{ x: 0, y: 1, kind: "reed" }, { x: 2, y: 3, kind: "glass" }], next: { lanes: [0], drops: [] } });
    expect(applyMove(state, "wait")!.after.items).toEqual([{ x: 2, y: 3, kind: "glass" }]);
  });

  test("walking onto a prize takes it, a full pack leaves it, and the dock banks", () => {
    const state: TideState = { ...startTide({ seed: 3 }), position: { x: 0, y: 0 }, items: [{ x: 1, y: 1, kind: "pearl" }] };
    const carrying = play(state, "east");
    expect(carrying.position).toEqual(DOCK);
    const got = play({ ...state, position: { x: 0, y: 1 } }, "east");
    expect(got.pack).toEqual(["pearl"]);
    expect(got.items).toEqual([]);
    const banked = play(got, "south");
    expect(banked.pack).toEqual([]);
    expect(banked.score).toBe(VALUE.pearl);
    const full: TideState = { ...state, position: { x: 0, y: 1 }, pack: ["reed", "reed", "reed"] };
    expect(events(full, "east").map(e => e.kind)).toContain("full");
    expect(play(full, "east").items.length).toBe(1);
  });

  test("the channel is crossed in one move and only in the bridge's lane", () => {
    const state: TideState = { ...startTide({ seed: 3 }), position: { x: 1, y: 1 }, bridge: 1 };
    expect(play(state, "north").position).toEqual({ x: 1, y: 3 });
    expect(legalMoves({ ...state, bridge: 0 })).not.toContain("north");
    expect(play({ ...state, position: { x: 1, y: 3 } }, "south").position).toEqual({ x: 1, y: 1 });
  });

  test("calling it a day is only for the dock and spends no beat", () => {
    const start = startTide({ seed: 3 });
    const home = applyMove(start, "home")!.after;
    expect(home.outcome).toBe("home");
    expect(home.beat).toBe(0);
    expect(legalMoves(play(start, "north"))).not.toContain("home");
    expect(legalMoves(home)).toEqual([]);
  });

  test("a tide ends after its last wave and loses whatever is still in the pack", () => {
    let state = startTide({ seed: 3 });
    while (state.outcome === "active") state = play(state, "wait");
    expect(state.outcome).toBe("turned");
    expect(state.wave).toBe(12);
    expect(state.beat).toBe(36);
    const last: TideState = { ...startTide({ seed: 3 }), beat: 35, wave: 11, position: { x: 2, y: 1 }, pack: ["pearl"], next: { lanes: [0], drops: [] } };
    const end = applyMove(last, "wait")!;
    expect(end.after.outcome).toBe("turned");
    expect(end.after.score).toBe(0);
    expect(end.events.at(-1)).toEqual({ kind: "end", reason: "turned", lost: ["pearl"] });
  });

  test("the third splash ends the tide and Bram fetches Mochi", () => {
    const state = poised({ seed: 3 }, { hearts: 1, position: { x: 0, y: 3 }, pack: ["glass", "reed"], banked: ["pearl"], score: 6, next: { lanes: [0], drops: [] } });
    const end = applyMove(state, "wait")!.after;
    expect(end.outcome).toBe("rescued");
    expect(end.pack).toEqual([]);
    expect(end.score).toBe(6);
  });

  test("rough waves take two lanes and leave two prizes; the far-shore center never holds a pearl", () => {
    for (let seed = 1; seed <= 300; seed++) {
      let state = startTide({ seed });
      while (state.outcome === "active") {
        const { lanes, drops } = state.next, rough = state.wave >= 6, last = state.wave === 11;
        expect(lanes.length).toBe(rough ? 2 : 1);
        expect(new Set(lanes).size).toBe(lanes.length);
        expect(drops.length).toBe(last ? 0 : lanes.length);
        for (const drop of drops) {
          expect([1, 3, 4]).toContain(drop.y);
          expect(drop.kind).toBe(drop.y === 1 ? "reed" : drop.y === 3 || drop.x === 1 ? "glass" : "pearl");
        }
        state = play(state, "wait", "wait", "wait");
      }
    }
  });

  test("the same start and moves always give the same tide", () => {
    const tide = cautiousTide(20771);
    expect(replayTide({ seed: 20771 }, tide.moves)).toEqual(tide);
    expect(replayTide({ seed: 20771 }, [...tide.moves, "wait"])).toBeNull();
    expect(replayTide({ seed: 20771 }, ["fly"])).toBeNull();
    expect(replayTide({ seed: -1 }, [])).toBeNull();
    expect(replayTide({ seed: 1, story: "crown" }, [])).toBeNull();
  });

  test("the cautious bot stays dry, banks what it scores, and gives Bram a guess", () => {
    let total = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const tide = cautiousTide(seed);
      expect(tide.splashes).toBe(0);
      expect(tide.outcome).toBe("turned");
      expect(tide.score).toBe(tide.banked.reduce((sum, item) => sum + VALUE[item], 0));
      const h = haul(tide);
      expect(h.reed + h.glass + h.pearl).toBe(tide.banked.length);
      total += tide.score;
    }
    expect(total / 200).toBeGreaterThan(10);
    expect(bramsGuess(20771)).toBe(cautiousTide(20771).score);
  });
});

describe("story tides", () => {
  test("the first tide is eight calm waves", () => {
    expect(tideShape({ story: "lens" })).toEqual({ waves: 8, roughFrom: 8 });
    let state = startTide({ seed: 5, story: "lens" });
    while (state.outcome === "active") { expect(state.next.lanes.length).toBe(1); state = play(state, "wait"); }
    expect(state.wave).toBe(8);
  });

  test("the second wave opens the story shell, and the prize is never swept", () => {
    for (const [story, lane] of [["lens", 0], ["vane", 2], ["moth", 2]] as const) {
      let state = play(startTide({ seed: 9, story }), "wait", "wait", "wait");
      expect(state.next).toEqual({ lanes: [lane], drops: [] });
      const turn = applyMove(play(state, "wait", "wait"), "wait")!;
      expect(turn.events).toContainEqual({ kind: "open", lane, item: story });
      state = turn.after;
      while (state.outcome === "active") state = play(state, "wait");
      expect(state.items).toContainEqual({ x: lane, y: 4, kind: story });
    }
  });

  test("a story tide walks the generator exactly as the daily tide on the same seed does", () => {
    const daily = play(startTide({ seed: 9 }), ...Array<Move>(9).fill("wait")), story = play(startTide({ seed: 9, story: "vane" }), ...Array<Move>(9).fill("wait"));
    expect(story.rng).toBe(daily.rng);
    expect(story.next).toEqual(daily.next);
  });

  test("a splashed story prize goes back to its shell, and a banked one scores nothing", () => {
    const state = poised({ seed: 5, story: "lens" }, { wave: 3, position: { x: 0, y: 4 }, pack: ["glass", "lens"], next: { lanes: [0], drops: [] } });
    const after = applyMove(state, "wait")!.after;
    expect(after.pack).toEqual(["glass"]);
    expect(after.items).toContainEqual({ x: 0, y: 4, kind: "lens" });
    const home = play({ ...startTide({ seed: 5, story: "lens" }), position: { x: 0, y: 0 }, pack: ["lens"] }, "east");
    expect(home.banked).toEqual(["lens"]);
    expect(home.score).toBe(0);
  });

  test("the moth takes two slots, and the Tidekeeper turns one wave aside while Mochi carries it", () => {
    const beside: TideState = { ...startTide({ seed: 5, story: "moth" }), position: { x: 1, y: 4 }, pack: ["reed", "reed"], items: [{ x: 2, y: 4, kind: "moth" }] };
    expect(events(beside, "east").map(e => e.kind)).toContain("full");
    expect(play({ ...beside, pack: ["reed"] }, "east").pack).toEqual(["reed", "moth"]);
    const carrying = poised({ seed: 5, story: "moth" }, { wave: 3, position: { x: 2, y: 3 }, pack: ["moth"], next: { lanes: [2], drops: [] } });
    const first = applyMove(carrying, "wait")!;
    expect(first.events).toContainEqual({ kind: "shield", lane: 2 });
    expect(first.after.hearts).toBe(HEARTS);
    expect(first.after.pack).toEqual(["moth"]);
    const second = applyMove({ ...first.after, beat: 2, next: { lanes: [2], drops: [] } }, "wait")!.after;
    expect(second.hearts).toBe(HEARTS - 1);
    expect(second.items).toContainEqual({ x: 2, y: 4, kind: "moth" });
  });
});

const PINNED_DRAWS = [691653857, 2339662837, 1525025796, 254531113];
