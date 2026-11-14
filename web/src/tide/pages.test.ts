import { describe, expect, test } from "bun:test";
import { CONTENT_VERSION } from "../expedition/types";
import { replayRun, solve, startRun, stepRun, type Run } from "./asks";
import { cardForDay, TIDE_POOL } from "./cards";
import type { TideEntry } from "./log";
import {
  askFlips, devTideDay, earlierDays, harborTide, logPages, outingNotice, pageForCard, pageForDay, restartTide,
  stampSheet, storyPages, storyTitle, tideObjective, tidePages, tideResult, todayView, type StoryRecord,
} from "./pages";

const today = 20771;
const card = cardForDay(today);
const next = cardForDay(today + 1);
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

  test("matches today and earlier logged days, including gaps, most recent first", () => {
    const current = entry();
    const previous = entry(today - 2);
    const entries = [previous, current, entry(today + 1)];
    expect(todayView(today, entries)).toEqual({ day: today, card, entry: current });
    expect(todayView(today, entries).entry).toBe(current);
    expect(todayView(today, entries).card.id).toBe("surf-home");
    expect(todayView(today + 1, []).card.id).toBe("brams-bridge");
    expect(todayView(today + 1, []).entry).toBeNull();
    const earlier = earlierDays(today, entries);
    expect(earlier.map(view => view.day)).toEqual([20770, 20769]);
    expect(earlier.map(view => view.entry)).toEqual([null, previous]);
    expect(earlier.map(view => view.card)).toEqual(earlier.map(view => cardForDay(view.day)));
    expect(earlierDays(today, entries, 2)).toEqual(earlier.slice(0, 2));
    expect(earlierDays(today, entries, 0)).toEqual([]);
    expect(earlierDays(today, [])).toEqual([]);
    const yesterday = entry(today - 1);
    expect(earlierDays(today, [yesterday])).toEqual([{ day: today - 1, card: cardForDay(today - 1), entry: yesterday }]);
    expect(earlierDays(today, [current])).toEqual([]);
    expect(earlierDays(today, [entry(today - 10)], 20).map(view => view.day)).toEqual([20770, 20769, 20768, 20767, 20766, 20765]);
  });
});

describe("stamp sheet", () => {
  test("keeps all fourteen slots in pool order, hiding cards without returned outings", () => {
    const collected = entry(today, { kept: [false, false, false] });
    const rescued = entry(today + 1, { outcome: "rescued" });
    const entries = Object.freeze([rescued, collected]);
    const sheet = stampSheet(entries);
    expect(sheet.map(slot => slot.card)).toEqual([...TIDE_POOL]);
    expect(sheet).toHaveLength(14);
    expect(sheet.find(slot => slot.card.id === collected.cardId)).toEqual({ card, entry: collected, allThree: false });
    expect(sheet.filter(slot => slot.entry !== null)).toHaveLength(1);
    expect(sheet.find(slot => slot.card.id === rescued.cardId)?.entry).toBeNull();
    expect(stampSheet([]).every(slot => slot.entry === null && !slot.allThree)).toBe(true);
    expect(entries).toEqual([rescued, collected]);
  });

  test("collects the best returned run across repeated fourteen-day cycles", () => {
    const partial = entry(today, { kept: [true, false, true], decisions: 3 });
    const complete = entry(today + 14, { decisions: 12 });
    const quicker = entry(today + 28, { decisions: 10 });
    const rescued = entry(today + 42, { outcome: "rescued", decisions: 1 });
    expect(cardForDay(partial.day)).toBe(cardForDay(quicker.day));
    const slot = stampSheet([rescued, quicker, partial, complete]).find(slot => slot.card.id === card.id)!;
    expect(slot.entry).toBe(quicker);
    expect(slot.allThree).toBe(true);
  });

  test("breaks exact score ties by earlier day regardless of input order", () => {
    const earlier = entry(today, { decisions: 11, kept: [true, false, true] });
    const later = entry(today + 14, { decisions: 11, kept: [false, true, true] });
    for (const entries of [[later, earlier], [earlier, later]]) {
      const slot = stampSheet(entries).find(slot => slot.card.id === card.id)!;
      expect(slot.entry).toBe(earlier);
      expect(slot.allThree).toBe(false);
    }
  });

  test("finds a card’s best returned page among story pages and repeated days", () => {
    const partial = entry(today, { kept: [true, false, true], decisions: 3 });
    const best = entry(today + 14, { decisions: 10 });
    const tiedLater = entry(today + 28, { decisions: 10 });
    const rescued = entry(today + 42, { outcome: "rescued", decisions: 1 });
    const pages = [...storyPages([story("first")]), ...tidePages([partial, best, tiedLater, rescued])];
    expect(pageForCard(pages, card.id)).toBe(2);
    const reversed = [...pages].reverse();
    expect(pageForCard(reversed, card.id)).toBe(2);
    expect(pageForCard(pages, cardForDay(today + 1).id)).toBe(-1);
    expect(pageForCard(tidePages([rescued]), card.id)).toBe(-1);
    expect(pageForCard([], card.id)).toBe(-1);
  });
});

describe("outing copy", () => {
  test("reports saved returns and rescues", () => {
    expect(tideResult(entry(today, { kept: [true, false, true], decisions: 12 })))
      .toBe("2 of 3 asks kept in 12 decisions.");
    expect(tideResult(entry())).toBe(`All three asks kept in ${commands.length} decisions. The Tidekeeper’s way.`);
    expect(tideResult(entry(today, { decisions: card.best + 1 }))).toBe(`All three asks kept in ${card.best + 1} decisions.`);
    expect(tideResult(entry(today, { kept: [true, false, false], decisions: 1 }))).toBe("1 of 3 asks kept in 1 decision.");
    expect(tideResult(entry(today, { commands: ["return"], kept: [false, false, false], decisions: 1 }))).toBe("An empty satchel keeps no asks.");
    expect(tideResult(entry(today, { outcome: "rescued" })))
      .toBe("Bram brought Mochi home. The asks can wait for another try.");
  });

  test("describes this return, then compares it with the saved best", () => {
    const best = entry();
    const partial = stepRun(startRun(card.tool), "return")!;
    expect(returned.state.outcome).toBe("returned");
    expect(outingNotice(returned, card, { entry: best, improved: true, previous: null }))
      .toBe(`All three asks kept in ${commands.length} decisions. The Tidekeeper’s way.`);
    expect(outingNotice(returned, card, { entry: best, improved: true, previous: entry(today, { decisions: 10 }) }))
      .toBe(`All three asks kept in ${commands.length} decisions. The Tidekeeper’s way. A new best for the day.`);
    expect(outingNotice(partial, card, { entry: best, improved: false, previous: best }))
      .toBe(`An empty satchel keeps no asks. The day’s best stays at 3 of 3 in ${commands.length} decisions.`);
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
    const route = ["wait", "step:west", "wait", "step:north", "step:north", "take:lens", "step:south", "step:east", "return"];
    const home = replayRun("lantern", route)!;
    expect(home.state.cargo).toEqual(["lens"]);
    expect(askFlips(coiled, replayRun("lantern", route.slice(0, -1))!, home)).toBe(
      "One ask slipped: Bring both finds home. Ask kept: Leave the lantern unlit. Ask kept: Be home within 16 decisions.",
    );
    const start = startRun("lantern");
    expect(askFlips(coiled, start, stepRun(start, "return")!)).toBe(
      "All three asks slipped: Bring both finds home. Leave the lantern unlit. Be home within 16 decisions.",
    );
  });

  test("groups two asks that slip in the same decision", () => {
    const double = { ...card, asks: [{ kind: "style", style: "no-wait" }, { kind: "within", decisions: 1 }, card.asks[0]] as const };
    const start = startRun(card.tool);
    expect(askFlips(double, start, stepRun(start, "wait")!)).toBe("Two asks slipped: Never wait for the tide. Be home within 1 decision.");
  });
});

describe("harbor tide", () => {
  test("keeps the harbor quiet before the light", () => {
    expect(harborTide({ lit: false, storyStep: false, card, next, entry: null })).toBeNull();
    expect(harborTide({ lit: false, storyStep: true, card, next, entry: entry() })).toBeNull();
  });

  test("offers only a link during a story step", () => {
    expect(harborTide({ lit: true, storyStep: true, card, next, entry: entry() })).toEqual({
      kind: "link", links: [{ label: "Today’s tide", action: "tide" }],
    });
  });

  test("introduces an unrecorded ask", () => {
    expect(harborTide({ lit: true, storyStep: false, card, next, entry: null })).toEqual({
      kind: "panel", title: "The Tidekeeper has an ask.",
      body: "Surf home. Three asks for one tide, with the rope.",
      primary: { label: "See today’s ask", target: "tide" }, links: [],
    });
  });

  test("offers the log after all three, names tomorrow and keeps the Bram link last", () => {
    expect(harborTide({ lit: true, storyStep: false, card, next, entry: entry() })).toEqual({
      kind: "panel", title: "All three asks kept.",
      body: `${commands.length} decisions: the Tidekeeper’s way. Tomorrow: Bram’s bridge.`,
      primary: { label: "Open the tide log", target: "log" },
      links: [{ label: "Sail today’s tide again", action: "sail" }, { label: "Take it to Bram", action: "bram" }],
    });
    expect(harborTide({ lit: true, storyStep: false, card, next, entry: entry(today, { decisions: 11 }) }))
      .toMatchObject({ body: "11 decisions; the Tidekeeper’s way takes 9. Tomorrow: Bram’s bridge." });
    expect(harborTide({ lit: true, storyStep: false, card: { ...card, best: 1 }, next, entry: entry(today, { decisions: 1 }) }))
      .toMatchObject({ body: "1 decision: the Tidekeeper’s way. Tomorrow: Bram’s bridge." });
    expect(harborTide({ lit: true, storyStep: false, card: { ...card, best: 1 }, next, entry: entry(today, { decisions: 2 }) }))
      .toMatchObject({ body: "2 decisions; the Tidekeeper’s way takes 1. Tomorrow: Bram’s bridge." });
  });

  test("names one, two or all three slipped asks and makes another sail primary", () => {
    for (const [kept, title, lines] of [
      [[true, false, true], "One ask slipped.", "Let one surge soak Mochi. Only one."],
      [[true, false, false], "Two asks slipped.", "Let one surge soak Mochi. Only one. Be home within 10 decisions."],
      [[false, false, false], "All three asks slipped.", "Bring the lens home. Let one surge soak Mochi. Only one. Be home within 10 decisions."],
    ] as const) {
      const saved = entry(today, { kept: [...kept], decisions: 11 });
      expect(harborTide({ lit: true, storyStep: false, card, next, entry: saved })).toEqual({
        kind: "panel", title,
        body: `Slipped: ${lines} Tomorrow: Bram’s bridge.`,
        primary: { label: "Sail today’s tide again", target: "sail" },
        links: [{ label: "Open the tide log", action: "log" }, { label: "Take it to Bram", action: "bram" }],
      });
    }
  });

  test("offers another sail after rescue, without a find to take to Bram", () => {
    expect(harborTide({ lit: true, storyStep: false, card, next, entry: entry(today, { outcome: "rescued" }) })).toEqual({
      kind: "panel", title: "Bram brought Mochi home.",
      body: "The asks can wait for another try. Tomorrow: Bram’s bridge.",
      primary: { label: "Sail today’s tide again", target: "sail" },
      links: [{ label: "Open the tide log", action: "log" }],
    });
    expect(harborTide({ lit: true, storyStep: false, card, next, entry: entry(today, { commands: ["return"], kept: [false, false, false] }) }))
      .toMatchObject({ title: "All three asks slipped.", links: [{ label: "Open the tide log", action: "log" }] });
  });
});

describe("restart tide", () => {
  test("keeps the pending day and the outing’s tool across rollover", () => {
    for (const late of [false, true]) {
      const pending = Object.freeze({ day: today, late });
      expect(restartTide(pending, today + 1, "rope")).toEqual({ tool: "rope", day: today });
      expect(pending).toEqual({ day: today, late });
    }
    expect(restartTide({ day: today + 1, late: true }, today + 2, "rope")).toEqual({ tool: "rope", day: today + 1 });
    expect(restartTide({ day: today, late: false }, today, "lantern")).toEqual({ tool: "lantern", day: today });
  });

  test("uses today and keeps the outing’s tool when no marker remains", () => {
    expect(restartTide(null, today, "lantern")).toEqual({ tool: "lantern", day: today });
    expect(restartTide(null, today + 1, "rope")).toEqual({ tool: "rope", day: today + 1 });
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
