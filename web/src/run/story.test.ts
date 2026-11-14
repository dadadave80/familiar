import { expect, test } from "bun:test";
import { VALUE, applyMove, replayTide, startTide, tideShape, type StoryPrize, type TideState, type TideTransition } from "./engine";
import { bramsGuess, cautiousMove, cautiousTide } from "./bot";
import { CHAPTERS, chapterFor, consequence, storyStart } from "./story";
import { closeTide, dayResult, emptyBook, readBook, shelved, todayResult, writeBook } from "./save";

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
  expect(said.some(line => line.includes("Mochi cradles the moth."))).toBe(true);
  expect(said.some(line => line.includes("The lens is home."))).toBe(true);
  expect(said).toContain("Banked three pieces of sea glass: +9.");
  expect(said.some(line => line.includes("The wave takes the sea glass and the reed back."))).toBe(true);
  const first = applyMove(startTide({ seed: 20771 }), "wait")!;
  expect(consequence(first)).toBe("");
});

function memory() {
  const data = new Map<string, string>();
  return { data, getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
}

test("a finished tide stays active until the player files it", () => {
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
  expect(today.guess).toBe(bramsGuess(20771));
  expect(today.stamps).toEqual({ home: true, guess: true, dry: true });
  expect(dayResult(again).stamps).toEqual({ home: false, guess: false, dry: true });
  expect(todayResult(book, 20772)).toBeNull();

});

test("the shelf takes three of each and a damaged book is refused", () => {
  const full = { banked: ["reed", "reed", "reed", "reed", "glass", "pearl", "lens"] } as unknown as TideState;
  expect(shelved(full)).toEqual({ reed: 3, glass: 1, pearl: 1 });
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
