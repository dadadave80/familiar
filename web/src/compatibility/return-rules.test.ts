import { expect, test } from "bun:test";
import { applyAction, legalActions, packSlots, phaseOf, replayOuting, startOuting, waveExit, type Lane } from "./return-rules";

test("the rising tide commits to the post-move lane and a successful dodge exposes the lens", () => {
  const start = startOuting("rope");
  expect(phaseOf(start)).toBe("Low");
  const ready = replayOuting("rope", [], ["wait", "move:left"])!;
  expect(phaseOf(ready)).toBe("Surge");
  expect(ready.locked).toBe("left");
  const dodge = applyAction(ready, "move:center");
  expect(dodge.waves).toEqual([{ turn: 3, source: "left", lane: "left", hit: false, opened: true }]);
  expect(dodge.opened).toEqual(["left"]);
  expect(dodge.locked).toBeNull();
  const hit = applyAction(ready, "wait");
  expect(hit.waves).toEqual([{ turn: 3, source: "left", lane: "left", hit: true, opened: true }]);
  expect(hit.resolve).toBe(2);
  expect(ready.opened).toEqual([]);
  const home = applyAction(applyAction(dodge, "reel:lens"), "return");
  expect(home).toMatchObject({ turn: 5, resolve: 3, uses: 1, outcome: "returned", cargo: ["lens"] });
  expect(legalActions(home)).toEqual([]);
});

test("Wind Gate exposes all three source mappings and starts one channel clockwise", () => {
  const run = startOuting("rope", ["lens"], "wind");
  expect(run).toMatchObject({ area: "wind", orientation: 1, opened: [], uses: 2 });
  const lanes: Lane[] = ["left", "center", "right"];
  const mappings: Lane[][] = [lanes, ["center", "right", "left"], ["right", "left", "center"]];
  for (const orientation of [0, 1, 2] as const) {
    expect(lanes.map(source => waveExit({ ...run, orientation }, source))).toEqual(mappings[orientation]);
  }
  expect(waveExit(run)).toBeNull();
  expect(waveExit(startOuting("rope"), "left")).toBe("left");
});

test("turning the vane on Surge changes the exit before the locked wave resolves", () => {
  const ready = replayOuting("rope", [], ["wait", "wait"], "wind")!;
  expect(ready.locked).toBe("center");
  expect(waveExit(ready)).toBe("right");
  const turned = applyAction(ready, "turn:vane");
  expect(turned).toMatchObject({ orientation: 2, turn: 3, resolve: 3, uses: 2, opened: ["left"] });
  expect(turned.waves).toEqual([{ turn: 3, source: "center", lane: "left", hit: false, opened: true }]);
  const wrapped = applyAction(turned, "turn:vane");
  expect(wrapped.orientation).toBe(0);
  expect(wrapped.opened).toEqual(["left"]);
  expect(ready).toMatchObject({ orientation: 1, opened: [] });
  const outside = applyAction(startOuting("rope", [], "wind"), "move:left");
  expect(applyAction(outside, "turn:vane")).toBe(outside);
  const beacon = startOuting("rope");
  expect(applyAction(beacon, "turn:vane")).toBe(beacon);
});

test("Lantern replaces the source and still routes through Wind Gate's current orientation", () => {
  const ready = replayOuting("lantern", [], ["wait", "wait"], "wind")!;
  const hit = applyAction(ready, "lure:left");
  expect(hit).toMatchObject({ lane: "center", uses: 1, resolve: 2, opened: ["center"] });
  expect(hit.waves).toEqual([{ turn: 3, source: "left", lane: "center", hit: true, opened: true }]);
  const right = applyAction(ready, "lure:center");
  expect(right).toMatchObject({ opened: [], resolve: 3 });
  expect(right.waves[0]).toMatchObject({ source: "center", lane: "right", opened: false });
  expect(legalActions(right)).not.toContain("take:vane");
});

test("either kit can charge both sockets, recover the vane and return dry in eight actions", () => {
  const route = ["wait", "move:left", "wait", "wait", "move:center", "turn:vane", "take:vane", "return"];
  for (const tool of ["rope", "lantern"] as const) {
    const before = replayOuting(tool, ["lens"], route.slice(0, 5), "wind")!;
    expect(before.opened).toEqual(["center"]);
    expect(legalActions(before)).not.toContain("take:vane");
    const ready = applyAction(before, "turn:vane");
    expect(ready.opened).toEqual(["center", "left"]);
    expect(legalActions(ready)).toContain("take:vane");
    const returned = replayOuting(tool, ["lens"], route, "wind")!;
    expect(returned).toMatchObject({ turn: 8, resolve: 3, uses: 2, cargo: ["vane"], outcome: "returned" });
    expect(returned.waves.map(wave => wave.lane)).toEqual(["center", "left"]);
    expect(replayOuting(tool, ["lens"], route)).toBeNull();
  }
});

test("the Rope can reel an exposed vane from another lane, and each room keeps its own discoveries", () => {
  const ready = replayOuting("rope", [], ["wait", "move:left", "wait", "wait", "move:center", "turn:vane"], "wind")!;
  expect(legalActions(ready)).not.toContain("reel:vane");
  const left = applyAction(ready, "move:left");
  expect(applyAction(left, "reel:vane")).toMatchObject({ cargo: ["vane"], uses: 1 });
  expect(legalActions({ ...left, uses: 0 })).not.toContain("reel:vane");
  expect(legalActions({ ...ready, banked: ["vane"] })).not.toContain("take:vane");
  expect(legalActions(ready).filter(action => action.startsWith("take:") || action.startsWith("reel:"))).toEqual(["take:vane"]);
  expect(legalActions(startOuting("lantern", [], "wind"))).not.toContain("take:chart");
  expect(legalActions({ ...startOuting("rope"), opened: ["left", "center"] })).not.toContain("take:vane");
});

test("Wind Gate replay rejects unknown areas and illegal traces, with extraction still preceding the final wave", () => {
  expect(replayOuting("rope", [], [], "echo")).toBeNull();
  expect(replayOuting("rope", [], ["take:vane"], "wind")).toBeNull();
  const ready = replayOuting("rope", [], ["wait", "move:left", "wait", "wait", "move:center", "turn:vane", "take:vane"], "wind")!;
  const atLimit = { ...ready, turn: 14, locked: "right" as const };
  expect(applyAction(atLimit, "return")).toMatchObject({ outcome: "returned", resolve: 3, cargo: ["vane"], turn: 15 });
  expect(applyAction(atLimit, "wait")).toMatchObject({ outcome: "rescued", cargo: [], turn: 15 });
});

test("a wrong lock can be redirected after it is visible; the chart needs no remaining Lure", () => {
  const start = startOuting("lantern");
  expect(applyAction(start, "lure:left")).toBe(start);
  const after = replayOuting("lantern", [], ["wait", "wait", "lure:right", "wait", "wait", "lure:left"])!;
  expect(after).toMatchObject({ lane: "center", resolve: 3, uses: 0, opened: ["right", "left"] });
  const withChart = applyAction(after, "take:chart");
  expect(withChart).toMatchObject({ turn: 7, uses: 0, cargo: ["chart"] });
  expect(legalActions(withChart)).not.toContain("take:chart");
  expect(applyAction(withChart, "reel:lens")).toBe(withChart);
});

test("Mochi can bring the lens and living moth home dry in three slots", () => {
  const atNest = replayOuting("rope", [], [
    "wait", "move:left", "move:center", "move:right", "reel:lens", "move:center", "move:right",
  ])!;
  expect(atNest.lane).toBe("right");
  expect(legalActions(atNest)).not.toContain("move:left");
  const rescue = applyAction(atNest, "take:moth");
  expect(packSlots(rescue.cargo)).toBe(3);
  expect(legalActions(rescue)).not.toContain("reel:salvage");
  const home = applyAction(applyAction(rescue, "move:center"), "return");
  expect(home).toMatchObject({ turn: 10, resolve: 3, uses: 1, outcome: "returned", cargo: ["lens", "moth"] });
});

test("prior discoveries stay home, and an optional-only return banks its cargo", () => {
  const practice = replayOuting("rope", ["lens", "moth"], ["wait", "move:left", "move:center"])!;
  expect(legalActions(practice)).not.toContain("reel:lens");
  const result = applyAction(applyAction(practice, "reel:salvage"), "return");
  expect(result).toMatchObject({ outcome: "returned", cargo: ["salvage"], banked: ["lens", "moth"] });
  expect(replayOuting("lantern", [], ["take:chart", "return"])).toMatchObject({ outcome: "returned", cargo: ["chart"] });
});

test("the last action can extract safely before a locked wave; spending it elsewhere floods the pack", () => {
  const atLimit = replayOuting("rope", ["moth"], [
    "wait", "move:left", "move:center", "reel:lens",
    "move:right", "move:center", "wait", "move:left", "move:center",
    "wait", "move:right", "move:center", "wait", "wait",
  ])!;
  expect(atLimit).toMatchObject({ turn: 14, locked: "center", cargo: ["lens"] });
  expect(applyAction(atLimit, "return")).toMatchObject({ turn: 15, resolve: 3, cargo: ["lens"], outcome: "returned" });
  const flooded = applyAction(atLimit, "wait");
  expect(flooded).toMatchObject({ turn: 15, resolve: 2, cargo: [], banked: ["moth"], outcome: "rescued" });
  expect(applyAction(flooded, "return")).toBe(flooded);
});

test("losing all Resolve ends the outing immediately and discards unbanked cargo", () => {
  const result = replayOuting("lantern", ["salvage"], ["take:chart", ...Array(8).fill("wait")])!;
  expect(result).toMatchObject({ turn: 9, resolve: 0, outcome: "rescued", cargo: [], banked: ["salvage"] });
});

test("illegal inputs never spend a turn and corrupted traces are rejected", () => {
  const run = startOuting("rope");
  for (const illegal of ["take:lens", "lure:left", "reel:moth", "move:center", "reel:chart", "unknown", null]) {
    expect(applyAction(run, illegal)).toBe(run);
  }
  for (const trace of [["return", "wait"], ["take:lens"], Array(16).fill("wait"), {}, ["toString"]]) {
    expect(replayOuting("rope", [], trace)).toBeNull();
  }
  expect(replayOuting("axe", [], ["wait"])).toBeNull();
  expect(replayOuting("rope", ["moth", "moth"], [])).toBeNull();
  expect(replayOuting("rope", ["gold"], [])).toBeNull();
});
