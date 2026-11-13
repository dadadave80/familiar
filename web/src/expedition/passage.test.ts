import { expect, test } from "bun:test";
import { applyPassage, canWatchMoth, passageCommands, passageDelivered, replayPassage, startPassage } from "./passage";
import type { PassageCommand } from "./passage";

const N = "step:north", E = "step:east", S = "step:south", W = "step:west";

test("a matching surge carries the boat even when the old bridge is elsewhere", () => {
  const state = replayPassage("bell", [N, W])!;
  const before = structuredClone(state);
  expect(state.stage).toBe("dispatched");
  expect(state.court.bridge).toBe(1);
  const ride = applyPassage(state, "ride")!;
  expect(ride.events.map(event => event.kind)).toEqual(["move", "wave", "bridge", "open"]);
  expect(ride.after.court).toMatchObject({ position: { x: 0, y: 3 }, turn: 3, resolve: 3, bridge: 0, opened: [0] });
  expect(ride.after.stage).toBe("delivered");
  expect(passageCommands(ride.after)).not.toContain("ride");
  expect(state).toEqual(before);
  const wet = applyPassage(state, "wait")!;
  expect(wet.after.court.resolve).toBe(2);
  expect(wet.after.stage).toBe("dispatched");
  expect(passageDelivered(ride.after)).toBe(false);
});

test("each landing supports a dry safe return by boat and by the ordinary bridge", () => {
  const trips = [
    ["bell", [N,W,"ride",S,S,E,"return"]],
    ["bell", [N,W,E,W,N,E,W,S,E,S,"return"]],
    ["reed", [N,N,W,E,E,"ride",S,W,"return"]],
    ["reed", [N,N,E,W,S,E,S,W,"return"]],
  ] as const;
  for (const [job, commands] of trips) {
    const home = replayPassage(job, commands)!;
    expect(passageDelivered(home)).toBe(true);
    expect(home.court.resolve).toBe(3);
    expect(home.court.cargo).toEqual([]);
    expect(passageCommands(home)).toEqual([]);
    expect(replayPassage(home.job, JSON.parse(JSON.stringify(home.commands)), home.mothHome)).toEqual(home);
  }
  expect(replayPassage("reed", [E,N])!.stage).toBe("waiting"); // Visiting the receiving lip first.
  expect(passageDelivered(replayPassage("reed", ["return"])!)).toBe(false);
});

test("the moth observation takes a chosen rising turn and respects the moth already at home", () => {
  const approach: PassageCommand[] = [N,N,W,E,E,W,N];
  const state = replayPassage("reed", approach)!;
  expect(canWatchMoth(state)).toBe(true);
  expect(applyPassage(state, "step:east")!.after.watched).toBe(false);
  const observed = applyPassage(state, "wait")!.after;
  expect(observed.watched).toBe(true);
  expect(observed.court.locked).toBe(1);
  expect(observed.commands.length).toBe(state.commands.length + 1);
  expect(applyPassage(state, "take:moth")).toBeNull();
  for (const job of ["bell", "reed"] as const) {
    const returnedMoth = replayPassage(job, approach, true)!;
    expect(canWatchMoth(returnedMoth)).toBe(false);
    expect(applyPassage(returnedMoth, "wait")!.after.watched).toBe(false);
  }
  const home = replayPassage("reed", [...approach, "wait", E, "wait", S, "ride", S, W, "return"])!;
  expect(passageDelivered(home) && home.watched).toBe(true);
});

test("the final turn still floods a protected ride and a late rescue cannot bank the service", () => {
  const commands: PassageCommand[] = [
    ...Array<PassageCommand>(8).fill("wait"), W, "wait", "wait", E,
    "wait", "wait", W, "wait", "wait", E, "wait", "wait", W, "wait", N,
  ];
  const state = replayPassage("bell", commands)!;
  expect(state.court.turn).toBe(23);
  expect(state.court.resolve).toBe(1);
  const ride = applyPassage(state, "ride")!;
  expect(ride.events.at(-1)).toEqual({ kind: "rescue", reason: "flood" });
  expect(ride.after.court.resolve).toBe(1);
  expect(ride.after.stage).toBe("waiting");
  expect(passageDelivered(ride.after)).toBe(false);
  const unfinished = replayPassage("bell", [N, W, "ride", ...Array<PassageCommand>(9).fill("wait")])!;
  expect(unfinished.court.outcome).toBe("rescued");
  expect(passageDelivered(unfinished)).toBe(false);
});

test("an illegal command or invalid saved start never becomes an accepted action", () => {
  const state = startPassage("bell");
  expect(applyPassage(state, "ride")).toBeNull();
  expect(applyPassage(state, "turn:vane")).toBeNull();
  expect(replayPassage("reed", ["return", "wait"])).toBeNull();
  expect(replayPassage("unknown", [])).toBeNull();
  expect(replayPassage("bell", null)).toBeNull();
  expect(replayPassage("bell", [], "false")).toBeNull();
  expect(replayPassage("bell", Array(25).fill("wait"))).toBeNull();
});
