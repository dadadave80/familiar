import { expect, test } from "bun:test";
import { applyAction, legalActions, packSlots, phaseOf, replayOuting, startOuting } from "./engine";

test("the rising tide commits to the post-move lane and a successful dodge exposes the lens", () => {
  const start = startOuting("rope");
  expect(phaseOf(start)).toBe("Low");
  const ready = replayOuting("rope", [], ["wait", "move:left"])!;
  expect(phaseOf(ready)).toBe("Surge");
  expect(ready.locked).toBe("left");
  const dodge = applyAction(ready, "move:center");
  expect(dodge.waves).toEqual([{ turn: 3, lane: "left", hit: false, opened: true }]);
  expect(dodge.opened).toEqual(["left"]);
  expect(dodge.locked).toBeNull();
  const hit = applyAction(ready, "wait");
  expect(hit.waves).toEqual([{ turn: 3, lane: "left", hit: true, opened: true }]);
  expect(hit.resolve).toBe(2);
  expect(ready.opened).toEqual([]);
  const home = applyAction(applyAction(dodge, "reel:lens"), "return");
  expect(home).toMatchObject({ turn: 5, resolve: 3, uses: 1, outcome: "returned", cargo: ["lens"] });
  expect(legalActions(home)).toEqual([]);
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
