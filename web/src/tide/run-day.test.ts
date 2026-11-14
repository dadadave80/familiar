import { expect, test } from "bun:test";
import { SHELF_CAP } from "../run/save";
import { allKept, haulCount, haulWords, keptCount, resultLine, resultTitle, runSummary, shelfGoods, STAMPS, type DayResult } from "./run-day";

const result: DayResult = {
  day: 20771, score: 6, guess: 6, banked: ["reed", "reed", "reed", "glass", "pearl"],
  stamps: { home: true, guess: true, dry: true }, splashes: 0,
};

test("haul counts preserve every prize while shelf goods are glass first and capped separately", () => {
  expect(haulCount(result)).toEqual({ reed: 3, glass: 1, pearl: 1 });
  expect(haulCount({ banked: [] })).toEqual({ reed: 0, glass: 0, pearl: 0 });
  expect(shelfGoods(result)).toEqual([1, 3]);
  expect(shelfGoods({ banked: ["pearl", "pearl"] })).toEqual([0, 0]);
  expect(shelfGoods({ banked: [] })).toEqual([0, 0]);
  expect(shelfGoods({ banked: [...Array<"glass">(SHELF_CAP + 2).fill("glass"), ...Array<"reed">(SHELF_CAP + 1).fill("reed"), "pearl"] })).toEqual([SHELF_CAP, SHELF_CAP]);
  expect(result.banked).toEqual(["reed", "reed", "reed", "glass", "pearl"]);
});

test("the three stamps retain their order, painted icons and exact asks", () => {
  expect(STAMPS.map(stamp => stamp.key)).toEqual(["home", "guess", "dry"]);
  expect(STAMPS.map(stamp => stamp.icon)).toEqual(["/assets/season/purse.webp", "/assets/ui/ask-all-marks.webp", "/assets/ui/ask-dry.webp"]);
  expect(STAMPS.map(stamp => stamp.ask(6))).toEqual([
    "Come home with something.", "Match or beat Bram’s guess of 6.", "Keep Mochi dry the whole tide.",
  ]);
  expect(STAMPS[1]!.ask(0)).toBe("Match or beat Bram’s guess of 0.");
  expect(STAMPS[1]!.ask(12)).toBe("Match or beat Bram’s guess of 12.");
});

test("kept stamp labels distinguish matching from beating Bram", () => {
  expect(STAMPS.map(stamp => stamp.label(result))).toEqual(["Came home with something", "Matched Bram’s guess", "Dry paws"]);
  expect(STAMPS[1]!.label({ ...result, score: 7 })).toBe("Beat Bram’s guess");
});

test("slipped stamp labels explain empty paws, a short score and splash counts", () => {
  const slipped = { ...result, score: 0, banked: [], stamps: { home: false, guess: false, dry: false }, splashes: 1 };
  expect(STAMPS.map(stamp => stamp.label(slipped))).toEqual(["Came home empty-pawed", "Short of Bram’s guess", "One splash"]);
  expect(STAMPS[2]!.label({ ...slipped, splashes: 2 })).toBe("2 splashes");
  expect(STAMPS[2]!.label({ ...slipped, splashes: 0 })).toBe("0 splashes");
});

test("kept counts and headlines cover every combination of three stamps", () => {
  for (let mask = 0; mask < 8; mask++) {
    const stamps = { home: !!(mask & 1), guess: !!(mask & 2), dry: !!(mask & 4) };
    const count = Number(stamps.home) + Number(stamps.guess) + Number(stamps.dry);
    const finished = { ...result, stamps };
    expect(keptCount(finished)).toBe(count);
    expect(allKept(finished)).toBe(count === 3);
    expect(resultTitle(finished)).toBe(["Nothing kept this time.", "1 of 3 kept.", "2 of 3 kept.", "All three kept."][count]!);
  }
});

test("the result line preserves score and Bram’s guess", () => {
  expect(resultLine(result)).toBe("Banked 6 · Bram guessed 6");
  expect(resultLine({ ...result, score: 0, guess: 12 })).toBe("Banked 0 · Bram guessed 12");
});

test("haul words join goods naturally, never pluralise reed and pluralise pearls", () => {
  expect(haulWords(result)).toBe("3 reed, 1 glass and 1 pearl");
  expect(haulWords({ banked: [] })).toBe("nothing");
  expect(haulWords({ banked: ["reed"] })).toBe("1 reed");
  expect(haulWords({ banked: ["reed", "reed"] })).toBe("2 reed");
  expect(haulWords({ banked: ["glass", "glass"] })).toBe("2 glass");
  expect(haulWords({ banked: ["pearl"] })).toBe("1 pearl");
  expect(haulWords({ banked: ["pearl", "pearl"] })).toBe("2 pearls");
  expect(haulWords({ banked: ["glass", "reed"] })).toBe("1 reed and 1 glass");
  expect(haulWords({ banked: ["pearl", "reed", "pearl"] })).toBe("1 reed and 2 pearls");
});

test("run summaries total sailed days, kept stamps and all-three days", () => {
  expect(runSummary([])).toEqual({ sailed: 0, kept: 0, allThree: 0 });
  const partial = { ...result, day: result.day + 1, stamps: { home: true, guess: false, dry: true } };
  const empty = { ...result, day: result.day + 2, stamps: { home: false, guess: false, dry: false } };
  expect(runSummary([result, partial, empty])).toEqual({ sailed: 3, kept: 5, allThree: 1 });
});
