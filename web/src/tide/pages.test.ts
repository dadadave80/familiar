import { describe, expect, test } from "bun:test";
import { CONTENT_VERSION } from "../expedition/types";
import { replayRun, solve, startRun, stepRun, type Run } from "./asks";
import { cardForDay, TIDE_POOL } from "./cards";
import type { TideEntry } from "./log";
import type { DayResult } from "./run-day";
import {
  askFlips, devTideDay, earlierDays, harborTide, homeResult, logPages, outingNotice, pageForCard, pageForDay, restartTide,
  runPages, stampSheet, storyPages, storyTitle, tideObjective, tidePages, tideResult, todayView, type StoryRecord, type TideLink,
} from "./pages";

const today = 20771;
const card = cardForDay(today);
const next = cardForDay(today + 1);
const commands = solve(card.tool, card.asks)!;
const returned = replayRun(card.tool, commands)!;

function result(day = today, overrides: Partial<DayResult> = {}): DayResult {
  return { day, score: 6, guess: 6, banked: ["reed", "glass"], stamps: { home: true, guess: true, dry: true }, splashes: 0, ...overrides };
}

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
    expect(sheet.find(slot => slot.card.id === collected.cardId)).toEqual({ card, entry: collected, result: null, allThree: false });
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

describe("home result", () => {
  test("describes the actual return independently of the saved best", () => {
    expect(homeResult(returned, card)).toEqual({title:"All three asks kept.",body:"9 decisions · the Tidekeeper’s way"});
    expect(homeResult(replayRun(card.tool, ["return"])!, card)).toEqual({title:"An empty satchel keeps no asks.",body:"1 decision"});
    let rescued = startRun(card.tool);
    while (rescued.state.outcome === "active") rescued = stepRun(rescued, "wait")!;
    expect(homeResult(rescued, card)).toEqual({title:"Bram brought Mochi home.",body:"The asks can wait for another try."});
  });

  test("keeps slipped wording and only names a matched way", () => {
    expect(homeResult(returned, {...card, best:1})).toEqual({title:"All three asks kept.",body:"9 decisions"});
    const dry = {...card,asks:[card.asks[0],{kind:"style",style:"dry"},card.asks[2]] as const};
    expect(homeResult(returned,dry)).toEqual({title:"One ask slipped.",body:"9 decisions"});
  });
});

describe("harbor tide", () => {
  const base = {lit:true,card,next,returnedToday:false,shelved:false};
  const links: TideLink[] = [{label:"Sail today’s tide again",action:"sail"},{label:"Open the tide log",action:"log"}];

  test("keeps the harbor quiet before the light", () => {
    expect(harborTide({...base,lit:false,entry:null})).toBeNull();
    expect(harborTide({...base,lit:false,entry:entry()})).toBeNull();
  });

  test("introduces an unrecorded ask", () => {
    expect(harborTide({...base,entry:null})).toEqual({
      kind:"panel",title:"The Tidekeeper has an ask.",body:"Surf home. Three asks for one tide, with the rope.",
      primary:{label:"See today’s ask",target:"tide"},links:[],
    });
  });

  test("keeps the next step honest even when the separate tide log is missing", () => {
    expect(harborTide({...base,returnedToday:true,entry:null})).toMatchObject({
      primary:{label:"Take it to Bram",target:"bram"},links:[],
    });
    expect(harborTide({...base,shelved:true,entry:null})).toMatchObject({
      title:"Tomorrow: Bram’s bridge.",body:"Today’s haul is on Bram’s shelf.",primary:null,links,
    });
  });

  test("makes today's unshelved find the next step", () => {
    expect(harborTide({...base,returnedToday:true,entry:entry()})).toEqual({
      kind:"panel",title:"All three asks kept.",body:"9 decisions · the Tidekeeper’s way",
      primary:{label:"Take it to Bram",target:"bram"},links,
    });
  });

  test("a sailed tide offers replay and log as secondaries", () => {
    expect(harborTide({...base,entry:entry()})).toEqual({
      kind:"panel",title:"All three asks kept.",body:"9 decisions · the Tidekeeper’s way",primary:null,links,
    });
    expect(harborTide({...base,entry:entry(today,{decisions:11})})).toMatchObject({body:"11 decisions; the Tidekeeper’s way takes 9."});
    expect(harborTide({...base,card:{...card,best:1},entry:entry(today,{decisions:1})})).toMatchObject({body:"1 decision · the Tidekeeper’s way"});
  });

  test("names tomorrow only after Bram has shelved today's haul", () => {
    expect(harborTide({...base,returnedToday:true,shelved:true,entry:entry()})).toEqual({
      kind:"panel",title:"Tomorrow: Bram’s bridge.",body:"All three asks kept. 9 decisions · the Tidekeeper’s way",primary:null,links,
    });
  });

  test("names one, two or all three slipped asks honestly", () => {
    for (const [kept,title,lines] of [
      [[true,false,true],"One ask slipped.","Let one surge soak Mochi. Only one."],
      [[true,false,false],"Two asks slipped.","Let one surge soak Mochi. Only one. Be home within 10 decisions."],
      [[false,false,false],"All three asks slipped.","Bring the lens home. Let one surge soak Mochi. Only one. Be home within 10 decisions."],
    ] as const) {
      expect(harborTide({...base,entry:entry(today,{kept:[...kept],decisions:11})})).toEqual({
        kind:"panel",title,body:`Slipped: ${lines}`,primary:null,links,
      });
    }
  });

  test("a rescue and an empty return never invent a find", () => {
    expect(harborTide({...base,entry:entry(today,{outcome:"rescued"})})).toEqual({
      kind:"panel",title:"Bram brought Mochi home.",body:"The asks can wait for another try.",primary:null,links,
    });
    expect(harborTide({...base,entry:entry(today,{commands:["return"],kept:[false,false,false]})})).toMatchObject({
      title:"All three asks slipped.",primary:null,links,
    });
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

describe("tide-run pages and stamps", () => {
  test("sorts run pages without changing the input and derives the day's card", () => {
    const earlier = result(today - 1), later = result();
    const results = Object.freeze([later, earlier]);
    expect(runPages(results)).toEqual([
      { kind: "run", day: today - 1, card: cardForDay(today - 1), result: earlier },
      { kind: "run", day: today, card, result: later },
    ]);
    expect(results).toEqual([later, earlier]);
    expect(runPages([])).toEqual([]);
  });

  test("merges daily pages after stories with legacy pages first on the same day", () => {
    const records = [story("first")];
    const pages = logPages(records, [entry(today + 1), entry()], [result(today + 2), result(), result(today - 1)]);
    expect(pages.map(page => page.kind === "story" ? page.id : `${page.kind}:${page.day}`)).toEqual([
      "first", `run:${today - 1}`, `tide:${today}`, `run:${today}`, `tide:${today + 1}`, `run:${today + 2}`,
    ]);
    expect(pageForDay(pages, today)).toBe(3);
    expect(pageForDay(pages, today + 1)).toBe(4);
    expect(pageForDay(pages, today - 1)).toBe(1);
    expect(pageForDay(pages, -1)).toBe(5);
    expect(pageForDay(pages)).toBe(5);
  });

  test("a run alone collects a stamp, even when no stamp was kept", () => {
    const empty = result(today, { banked: [], stamps: { home: false, guess: false, dry: false } });
    const slot = stampSheet([], [empty]).find(slot => slot.card.id === card.id)!;
    expect(slot).toEqual({ card, entry: null, result: empty, allThree: false });
    expect(stampSheet([]).every(slot => slot.result === null)).toBe(true);
  });

  test("legacy slots carry a null run result", () => {
    expect(stampSheet([entry()]).find(slot => slot.card.id === card.id)!.result).toBeNull();
  });

  test("chooses a card's run by kept count, then score, then earlier day", () => {
    const partial = result(today, { score: 100, stamps: { home: true, guess: false, dry: true } });
    const complete = result(today + 14, { score: 5 });
    const high = result(today + 28, { score: 8 });
    const tiedLater = result(today + 42, { score: 8 });
    for (const results of [[partial, complete, tiedLater, high], [high, tiedLater, complete, partial]]) {
      const slot = stampSheet([], results).find(slot => slot.card.id === card.id)!;
      expect(slot.result).toBe(high);
      expect(slot.allThree).toBe(true);
    }
    const exactEarly = result(today, { score: 8 });
    expect(stampSheet([], [tiedLater, exactEarly]).find(slot => slot.card.id === card.id)?.result).toBe(exactEarly);
  });

  test("legacy and run results each contribute their best record and brass seals", () => {
    const legacy = entry();
    const partial = result(today + 14, { stamps: { home: true, guess: false, dry: false } });
    const mixed = stampSheet([legacy], [partial]).find(slot => slot.card.id === card.id)!;
    expect(mixed.entry).toBe(legacy);
    expect(mixed.result).toBe(partial);
    expect(mixed.allThree).toBe(true);
    const legacyPartial = entry(today, { kept: [true, false, false] });
    expect(stampSheet([legacyPartial], [result()]).find(slot => slot.card.id === card.id)?.allThree).toBe(true);
  });

  test("page selection prefers more kept, then run pages, then each flow's best", () => {
    const legacy = entry();
    const partial = result(today + 14, { score: 100, stamps: { home: true, guess: true, dry: false } });
    expect(pageForCard(logPages([], [legacy], [partial]), card.id)).toBe(0);
    const complete = result(today + 28, { score: 8 });
    const tiedLater = result(today + 42, { score: 8 });
    const pages = logPages([story("first")], [legacy], [partial, tiedLater, complete]);
    for (const ordered of [pages, [...pages].reverse()]) {
      const best = ordered[pageForCard(ordered, card.id)];
      expect(best?.kind).toBe("run");
      if (best?.kind === "run") expect(best.result).toBe(complete);
    }
    expect(pageForCard(runPages([partial, complete]), next.id)).toBe(-1);
    const rescued = entry(today, { outcome: "rescued" });
    expect(pageForCard(logPages([], [rescued], [partial]), card.id)).toBe(1);
  });
});

describe("tide-run harbor card", () => {
  const base = { lit: true, card, next, guess: 6, returnedToday: false, shelved: false };
  const practice: TideLink[] = [{ label: "Sail again for practice", action: "sail" }, { label: "Open the tide log", action: "log" }];

  test("stays quiet before the light, before and after a result", () => {
    expect(harborTide({ ...base, lit: false, result: null })).toBeNull();
    expect(harborTide({ ...base, lit: false, result: result() })).toBeNull();
  });

  test("introduces today's tide and Bram's guess", () => {
    expect(harborTide({ ...base, result: null })).toEqual({
      kind: "panel", title: "Today’s tide: Surf home.", body: "Twelve waves. Bram guesses 6.",
      primary: { label: "See today’s tide", target: "tide" }, links: [],
    });
  });

  test("a shelved day with a missing result still shows tomorrow", () => {
    expect(harborTide({ ...base, shelved: true, result: null })).toEqual({
      kind: "panel", title: "Tomorrow: Bram’s bridge.", body: "Today’s haul is on Bram’s shelf.", primary: null,
      links: [{ label: "Sail today’s tide", action: "sail" }, { label: "Open the tide log", action: "log" }],
    });
  });

  test("an unshelved return offers Bram, then the practice and log links", () => {
    expect(harborTide({ ...base, returnedToday: true, result: result() })).toEqual({
      kind: "panel", title: "All three kept.", body: "Banked 6 · Bram guessed 6.",
      primary: { label: "Take it to Bram", target: "bram" }, links: practice,
    });
  });

  test("a shelved result shows tomorrow with the day's score", () => {
    for (const returnedToday of [false, true]) expect(harborTide({ ...base, returnedToday, shelved: true, result: result() })).toEqual({
      kind: "panel", title: "Tomorrow: Bram’s bridge.",
      body: "All three kept. Banked 6 · Bram guessed 6. Today’s haul is on Bram’s shelf.", primary: null, links: practice,
    });
  });

  test("a result without a fresh return offers only practice and the log", () => {
    expect(harborTide({ ...base, result: result(today, { stamps: { home: true, guess: false, dry: false } }) })).toEqual({
      kind: "panel", title: "1 of 3 kept.", body: "Banked 6 · Bram guessed 6.", primary: null, links: practice,
    });
  });
});
