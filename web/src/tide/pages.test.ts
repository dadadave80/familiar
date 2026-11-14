import { describe, expect, test } from "bun:test";
import { CONTENT_VERSION } from "../expedition/types";
import { replayRun, solve, startRun, stepRun, type Run } from "./asks";
import { cardForDay } from "./cards";
import type { TideEntry } from "./log";
import {
  askFlips, devTideDay, earlierDays, harborTide, logPages, outingNotice, pageForDay,
  storyPages, storyTitle, tideObjective, tidePages, tideResult, todayView, type StoryRecord,
} from "./pages";

const today = 20771;
const card = cardForDay(today);
const commands = solve(card.tool, card.asks)!;
const returned = replayRun(card.tool, commands)!;

function entry(day = today, overrides: Partial<TideEntry> = {}): TideEntry {
  const daily = cardForDay(day);
  const route = day === today ? commands : solve(daily.tool, daily.asks)!;
  return {
    day, cardId: daily.id, tool: daily.tool, commands: [...route],
    kept: [true, true, true], decisions: route.length, outcome: "returned",
    late: false, attempts: 1, savedAt: "2026-11-14T00:00:00.000Z", ...overrides,
  };
}

function story(id: string, overrides: Partial<StoryRecord> = {}): StoryRecord {
  return {
    id, contentVersion: CONTENT_VERSION, outcome: "returned", cargo: ["lens"],
    area: "beacon", tool: "rope", banked: ["chart"], commands: ["wait", "return"],
    ...overrides,
  };
}

function waits(count: number): Run {
  return replayRun(card.tool, Array.from({ length: count }, () => "wait"))!;
}

describe("story pages", () => {
  test("titles follow the cargo priority", () => {
    expect(storyTitle(["moth", "vane", "lens"])).toBe("The lens and the moth come home");
    expect(storyTitle(["lens", "vane"])).toBe("The lens comes home");
    expect(storyTitle(["moth", "vane"])).toBe("The moth comes home");
    expect(storyTitle(["vane"])).toBe("The vane comes home");
    expect(storyTitle(["chart", "salvage"])).toBe("Mochi comes home");
    expect(storyTitle([])).toBe("Mochi comes home");
  });

  test("filters incompatible and empty returns, keeps stored order and the first id", () => {
    const first = story("z");
    const second = story("a", { area: "wind", tool: "lantern", cargo: ["vane"] });
    const records = [
      story("rescued", { outcome: "rescued" }), story("empty", { cargo: [] }),
      story("old", { contentVersion: "first_light_v1" }), first, second,
      story("z", { cargo: ["moth"] }),
    ];
    const pages = storyPages(records);
    expect(pages).toEqual([
      {
        kind: "story", id: "z", title: "The lens comes home",
        subtitle: "Beacon Court · the rope · 2 decisions",
        area: first.area, tool: first.tool, banked: first.banked, commands: first.commands,
      },
      {
        kind: "story", id: "a", title: "The vane comes home",
        subtitle: "Wind Gate · the lantern · 2 decisions",
        area: second.area, tool: second.tool, banked: second.banked, commands: second.commands,
      },
    ]);
    expect(pages[0]!.banked).toBe(first.banked);
    expect(pages[0]!.commands).toBe(first.commands);
    expect(records[3]).toBe(first);
    expect(storyPages([])).toEqual([]);
  });
});

describe("tide history", () => {
  test("sorts a copy by day and derives cards from the day", () => {
    const later = entry(today + 1, { cardId: "stale-card" });
    const earlier = entry();
    const entries = Object.freeze([later, earlier]);
    expect(tidePages(entries)).toEqual([
      { kind: "tide", day: today, card, entry: earlier },
      { kind: "tide", day: today + 1, card: cardForDay(today + 1), entry: later },
    ]);
    expect(entries).toEqual([later, earlier]);
    expect(tidePages([])).toEqual([]);
  });

  test("places stories before tides and finds requested or final pages", () => {
    const records = [story("z"), story("a")];
    const entries = [entry(today + 1), entry()];
    const pages = logPages(records, entries);
    expect(pages).toEqual([...storyPages(records), ...tidePages(entries)]);
    expect(pageForDay(pages, today)).toBe(2);
    expect(pageForDay(pages, today + 1)).toBe(3);
    expect(pageForDay(pages, -1)).toBe(3);
    expect(pageForDay(pages)).toBe(3);
    expect(pageForDay([], today)).toBe(0);
    expect(pageForDay([])).toBe(0);
    expect(logPages([], [])).toEqual([]);
  });

  test("matches today and the six earlier days, most recent first", () => {
    const current = entry();
    const previous = entry(today - 2);
    const entries = [previous, current, entry(today + 1)];
    expect(todayView(today, entries)).toEqual({ day: today, card, entry: current });
    expect(todayView(today, entries).entry).toBe(current);
    expect(todayView(today, entries).card.id).toBe("surf-home");
    expect(todayView(today + 1, []).card.id).toBe("brams-bridge");
    expect(todayView(today + 1, []).entry).toBeNull();
    const earlier = earlierDays(today, entries);
    expect(earlier.map(view => view.day)).toEqual([20770, 20769, 20768, 20767, 20766, 20765]);
    expect(earlier.map(view => view.entry)).toEqual([null, previous, null, null, null, null]);
    expect(earlier.map(view => view.card)).toEqual(earlier.map(view => cardForDay(view.day)));
    expect(earlierDays(today, entries, 2)).toEqual(earlier.slice(0, 2));
    expect(earlierDays(today, entries, 0)).toEqual([]);
  });
});

describe("outing copy", () => {
  test("reports saved returns and rescues", () => {
    expect(tideResult(entry(today, { kept: [true, false, true], decisions: 12 })))
      .toBe("2 of 3 asks kept in 12 decisions.");
    expect(tideResult(entry(today, { outcome: "rescued" })))
      .toBe("Bram brought Mochi home. The asks can wait for another try.");
  });

  test("describes this return, then compares it with the saved best", () => {
    const best = entry();
    const partial = stepRun(startRun(card.tool), "return")!;
    expect(returned.state.outcome).toBe("returned");
    expect(outingNotice(returned, card, { entry: best, improved: true, previous: null }))
      .toBe(`3 of 3 asks kept in ${commands.length} decisions.`);
    expect(outingNotice(returned, card, { entry: best, improved: true, previous: entry(today, { decisions: 10 }) }))
      .toBe(`3 of 3 asks kept in ${commands.length} decisions. A new best for the day.`);
    expect(outingNotice(partial, card, { entry: best, improved: false, previous: best }))
      .toBe(`1 of 3 asks kept in 1 decisions. The day’s best stays at 3 of 3 in ${commands.length}.`);
  });

  test("describes this rescue even when the stored best returned", () => {
    const rescued = waits(9);
    expect(rescued.state.outcome).toBe("rescued");
    const best = entry();
    expect(outingNotice(rescued, card, { entry: best, improved: false, previous: best }))
      .toBe("Bram brought Mochi home. The asks slipped this time; the tide log keeps the try.");
  });

  test("chooses the first open ask, using the outing’s actual tool", () => {
    expect(tideObjective(card, startRun(card.tool))).toBe("Bring the lens home.");
    const coiled = cardForDay(7);
    const withoutHaul = { ...coiled, asks: [coiled.asks[1], coiled.asks[0], coiled.asks[2]] as const };
    expect(tideObjective(withoutHaul, startRun("lantern"))).toBe("Leave the lantern unlit.");
    const slippedFirst = { ...card, asks: [{ kind: "style", style: "dry" }, card.asks[0], card.asks[2]] as const };
    expect(tideObjective(slippedFirst, waits(3))).toBe("Bring the lens home.");
    expect(tideObjective(card, returned)).toBe("Bring Mochi home at the center dock.");
  });

  test("announces a second soaking as a slip and ignores unsettled steps", () => {
    const before = waits(5);
    const after = stepRun(before, "wait")!;
    expect(before.state.resolve).toBe(2);
    expect(after.state.resolve).toBe(1);
    expect(askFlips(card, before, after)).toBe("One ask slipped: Let one surge soak Mochi. Only one.");
    const start = startRun(card.tool);
    expect(askFlips(card, start, stepRun(start, "wait")!)).toBe("");
    expect(askFlips(card, after, after)).toBe("");
  });

  test("joins kept transitions in ask order and uses the actual tool", () => {
    const before = replayRun(card.tool, commands.slice(0, -1))!;
    expect(askFlips(card, before, returned)).toBe(
      "Ask kept: Bring the lens home. Ask kept: Let one surge soak Mochi. Only one. Ask kept: Be home within 10 decisions.",
    );
    const coiled = cardForDay(7);
    const start = startRun("lantern");
    expect(askFlips(coiled, start, stepRun(start, "return")!)).toBe(
      "One ask slipped: Bring both finds home. Ask kept: Leave the lantern unlit. Ask kept: Be home within 16 decisions.",
    );
  });
});

describe("harbor tide", () => {
  test("keeps the harbor quiet before the light", () => {
    expect(harborTide({ lit: false, storyStep: false, card, entry: null })).toBeNull();
    expect(harborTide({ lit: false, storyStep: true, card, entry: entry() })).toBeNull();
  });

  test("offers only a link during a story step", () => {
    expect(harborTide({ lit: true, storyStep: true, card, entry: entry() })).toEqual({
      kind: "link", links: [{ label: "Today’s tide", action: "tide" }],
    });
  });

  test("introduces an unrecorded ask", () => {
    expect(harborTide({ lit: true, storyStep: false, card, entry: null })).toEqual({
      kind: "panel", title: "The Tidekeeper has an ask.",
      body: "Surf home: Bring the lens home. Let one surge soak Mochi. Only one. Be home within 10 decisions.",
      primary: { label: "See today’s ask", target: "tide" }, links: [],
    });
  });

  test("offers the log and a repeat outing once recorded", () => {
    const saved = entry(today, { kept: [true, false, true], decisions: 11 });
    expect(harborTide({ lit: true, storyStep: false, card, entry: saved })).toEqual({
      kind: "panel", title: "Today’s tide is in the log.",
      body: "2 of 3 asks kept in 11 decisions. Tomorrow the Tidekeeper asks something new.",
      primary: { label: "Open the tide log", target: "log" },
      links: [{ label: "Sail today’s tide again", action: "sail" }],
    });
  });
});

describe("development tide day", () => {
  test("accepts only signed safe integer query values", () => {
    expect(devTideDay("?tide-day=20771")).toBe(20771);
    expect(devTideDay("?other=1&tide-day=-12")).toBe(-12);
    expect(devTideDay("?tide-day=0")).toBe(0);
    expect(devTideDay("?tide-day=9007199254740991")).toBe(Number.MAX_SAFE_INTEGER);
    expect(devTideDay("?tide-day=-9007199254740991")).toBe(Number.MIN_SAFE_INTEGER);
    for (const value of ["", "1.5", "1e3", "NaN", "Infinity", "%2B1", "%201", "1%20", "1%0A", "12x", "--1", "9007199254740992", "-9007199254740992"]) {
      expect(devTideDay(`?tide-day=${value}`)).toBeNull();
    }
    expect(devTideDay("")).toBeNull();
    expect(devTideDay("?other=20771")).toBeNull();
  });
});
