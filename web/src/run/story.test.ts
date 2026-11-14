import { expect, test } from "bun:test";
import { STORY_SHELL, VALUE, applyMove, replayTide, startTide, tideShape, type StoryPrize, type TideTransition } from "./engine";
import { bramsGuess, cautiousMove, cautiousTide } from "./bot";
import { CHAPTERS, chapterFor, consequence, storyStart } from "./story";
import { closeTide, dayResult, dayResults, emptyBook, readBook, shelfHaul, todayResult, writeBook, type DayResult } from "./save";

const careful = (prize: StoryPrize) => {
  let state = startTide(storyStart(prize)), homeWave = -1;
  const turns: TideTransition[] = [];
  while (state.outcome === "active") {
    const turn = applyMove(state, cautiousMove(state, { ...VALUE, [prize]: 60 }))!;
    turns.push(turn); state = turn.after;
    if (homeWave < 0 && state.banked.includes(prize)) homeWave = state.wave;
  }
  return { state, homeWave, turns };
};

test("every story tide brings its prize home dry with three waves to spare", () => {
  for (const prize of ["lens", "vane", "moth"] as const) {
    const { state, homeWave } = careful(prize);
    expect(state.banked).toContain(prize);
    expect(state.splashes).toBe(0);
    expect(tideShape({ story: prize }).waves - homeWave).toBeGreaterThanOrEqual(3);
  }
});

test("the chapter follows what the harbor already saves", () => {
  expect(chapterFor({ banked: [], lit: false, signaled: false })).toBe("lens");
  expect(chapterFor({ banked: ["lens"], lit: false, signaled: false })).toBeNull();
  expect(chapterFor({ banked: ["lens"], lit: true, signaled: false })).toBe("vane");
  expect(chapterFor({ banked: ["lens", "vane"], lit: true, signaled: false })).toBeNull();
  expect(chapterFor({ banked: ["lens", "vane"], lit: true, signaled: true })).toBe("moth");
  expect(chapterFor({ banked: ["lens", "vane", "moth"], lit: true, signaled: true })).toBeNull();
  expect(Object.values(CHAPTERS).map(chapter => chapter.number)).toEqual([1, 2, 3]);
});

test("every line said during a tide is about something that happened", () => {
  const said = (["lens", "vane", "moth"] as const).flatMap(prize => careful(prize).turns.map(consequence));
  expect(said.every(line => !line.includes("undefined"))).toBe(true);
  expect(said.some(line => line.includes("The left shell opens. The lens is inside."))).toBe(true);
  expect(said.some(line => line.includes("Mochi cradles the wind-moth."))).toBe(true);
  expect(said.some(line => line.includes("Lens safe. Finish and return to fit it into the beacon."))).toBe(true);
  expect(said).toContain("Banked three pieces of sea glass: +9.");
  expect(said.some(line => line.includes("The wave takes the sea glass and the reed back."))).toBe(true);
  const first = applyMove(startTide({ seed: 20771 }), "wait")!;
  expect(consequence(first)).toBe("");
});

test("chapter briefings name the errand and preserve its established tide", () => {
  expect(CHAPTERS.lens.before).toBe("The storm carried the Beacon Lens into the left shell. Bring it back so we can light the beacon.");
  expect(CHAPTERS.vane.before).toBe("The beacon is lit. Bram needs the Signal Vane to read the wind. Bring it home from the right shell.");
  expect(CHAPTERS.lens.goal).toBe("Bring the Beacon Lens home from the left shell.");
  expect(CHAPTERS.vane.goal).toBe("Bring the Signal Vane home from the right shell.");
  expect(CHAPTERS.moth.goal).toBe("Bring the wind-moth home from the right shell. It needs two pack slots.");
  expect(Object.values(CHAPTERS).map(chapter => chapter.seed)).toEqual([5, 4, 15]);
  expect(CHAPTERS.vane.after).toContain("Reeds from Wren’s garden. Glass from her windows. That’s not flotsam. The crab is bringing her house back.");
});

test("consequences describe settled possession instead of an obsolete same-move pickup", () => {
  const state = startTide(storyStart("lens")), at = STORY_SHELL.lens;
  const pickup = { kind: "pickup", item: "lens", at } as const;
  const splash = { kind: "splash", from: at, to: { x: 0, y: 3 }, lost: "lens", hearts: 2 } as const;
  const active: TideTransition = { before: state, after: { ...state, items: [{ ...at, kind: "lens" }] }, events: [pickup, splash] };
  expect(consequence(active)).not.toContain("Mochi carries");
  expect(consequence(active)).toContain("goes back to its shell");
  const ended: TideTransition = { before: state, after: { ...state, outcome: "turned" }, events: [pickup, { kind: "end", reason: "turned", lost: ["lens"] }] };
  expect(consequence(ended)).not.toContain("Mochi carries");
  expect(consequence(ended)).toContain("The tide turns and takes what was still in the pack.");
  const carried: TideTransition = { before: state, after: { ...state, pack: ["lens"] }, events: [pickup] };
  expect(consequence(carried)).toBe("Mochi carries the Beacon Lens. Bring it to the center dock to bank it.");
  const banked: TideTransition = { before: state, after: { ...state, banked: ["lens"] }, events: [pickup, { kind: "bank", items: ["lens"], gained: 0 }] };
  expect(consequence(banked)).toBe("Lens safe. Finish and return to fit it into the beacon.");
  expect(consequence({ ...ended, events: [pickup, splash, { kind: "end", reason: "rescued", lost: [] }] })).not.toContain("goes back to its shell");
});

function memory() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

test("a finished tide stays active until it is filed", () => {
  const storage = memory(), key = "tide";
  for (const finished of [careful("lens").state, cautiousTide(20771)]) {
    expect(finished.outcome).not.toBe("active");
    const book = { active: finished, days: [] };
    writeBook(storage, key, book);
    expect(readBook(storage, key)).toEqual(book);
  }
});

test("a tide book survives a reload and keeps each day's first tide", () => {
  const storage = memory(), key = "tide";
  expect(readBook(storage, key)).toEqual(emptyBook());
  const underway = applyMove(startTide(storyStart("lens")), "north")!.after;
  writeBook(storage, key, { active: underway, days: [] });
  expect(readBook(storage, key).active).toEqual(underway);

  const first = cautiousTide(20771), again = replayTide({ seed: 20771 }, ["home"])!;
  let book = closeTide({ active: first, days: [] }, first);
  book = closeTide(book, again);
  book = closeTide(book, careful("lens").state);
  expect(book).toEqual({ active: null, days: [first] });
  writeBook(storage, key, book);
  expect(readBook(storage, key)).toEqual(book);

  const today = todayResult(book, 20771)!;
  expect(today).toEqual(dayResult(first));
  expect(today).toEqual({ day: 20771, score: 6, guess: 6, banked: ["reed", "glass", "reed", "reed"],
    stamps: { home: true, guess: true, dry: true }, splashes: 0 });
  expect(today.guess).toBe(bramsGuess(20771));
  expect(today.stamps).toEqual({ home: true, guess: true, dry: true });
  expect(dayResult(again).stamps).toEqual({ home: false, guess: false, dry: true });
  expect(todayResult(book, 20772)).toBeNull();

});

test("a rescued or voluntary zero-score first result survives better practice and reload", () => {
  const seed = 20771;
  let rescued = startTide({ seed });
  while (rescued.outcome === "active") {
    const move = rescued.position.y === 0 ? "north" : "wait";
    rescued = applyMove(rescued, move)!.after;
  }
  expect(rescued.outcome).toBe("rescued");
  expect(rescued.score).toBe(0);
  const voluntary = applyMove(startTide({ seed }), "home")!.after;
  const better = cautiousTide(seed);
  expect(better.score).toBeGreaterThan(0);
  for (const first of [rescued, voluntary]) {
    const storage = memory(), key = "tide";
    writeBook(storage, key, closeTide({ active: first, days: [] }, first));
    const restored = readBook(storage, key);
    const practiced = closeTide({ ...restored, active: better }, better);
    writeBook(storage, key, practiced);
    expect(readBook(storage, key).days).toEqual([first]);
    expect(todayResult(readBook(storage, key), seed)).toEqual(dayResult(first));
  }
});

test("day results put the newest day first without changing the book", () => {
  const first = cautiousTide(20771), second = cautiousTide(20772);
  const book = { active: null, days: [first, second] };
  expect(dayResults(book)).toEqual([dayResult(second), dayResult(first)]);
  expect(book.days).toEqual([first, second]);
  expect(dayResults(emptyBook())).toEqual([]);
});

test("a daily result keeps every prize in banked order and records splashes", () => {
  const daily = { ...cautiousTide(20771), banked: ["glass", "pearl", "reed", "glass", "reed"] as const, splashes: 2 };
  const result = dayResult(daily);
  expect(result.banked).toEqual(["glass", "pearl", "reed", "glass", "reed"]);
  expect(result.splashes).toBe(2);
  expect(result.stamps).toEqual({ home: true, guess: true, dry: false });
});

test("day results exclude story prizes while keeping the other prizes in order", () => {
  const tide = { ...careful("lens").state, banked: ["glass", "lens", "pearl", "vane", "reed", "moth", "glass"] as const };
  expect(dayResult(tide).banked).toEqual(["glass", "pearl", "reed", "glass"]);
});

test("the shelf caps reed and glass at three and leaves pearls uncapped", () => {
  const result: DayResult = { day: 20771, score: 40, guess: 6,
    banked: ["reed", "glass", "pearl", "reed", "glass", "pearl", "reed", "glass", "pearl", "reed", "glass", "pearl"],
    stamps: { home: true, guess: true, dry: true }, splashes: 0 };
  expect(shelfHaul(result)).toEqual({ reed: 3, glass: 3, pearl: 4 });
  expect(shelfHaul({ ...result, banked: ["reed", "pearl"] })).toEqual({ reed: 1, glass: 0, pearl: 1 });
  expect(shelfHaul({ ...result, banked: [] })).toEqual({ reed: 0, glass: 0, pearl: 0 });
});

test("a damaged book is refused", () => {
  for (const raw of [
    "{", JSON.stringify({ version: 2, active: null, days: [] }),
    JSON.stringify({ version: 1, active: { seed: 5, moves: ["north", "north", "north", "north", "north"] }, days: [] }),
    JSON.stringify({ version: 1, active: null, days: [{ seed: 5, moves: ["north"] }] }),
    JSON.stringify({ version: 1, active: null, days: [{ seed: 5, story: "lens", moves: ["home"] }] }),
    JSON.stringify({ version: 1, active: null, days: [{ seed: 6, moves: ["home"] }, { seed: 5, moves: ["home"] }] }),
  ]) {
    const storage = memory(); storage.data.set("tide", raw);
    expect(() => readBook(storage, "tide")).toThrow();
  }
});
