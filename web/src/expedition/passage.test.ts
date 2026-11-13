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

test("Mochi can hear the bell once in the exposed west hollow on low tide", () => {
  const approach = [N,W,"ride",N,E,W] as const;
  const earlyTrip = replayPassage("bell", approach)!;
  expect(passageCommands(earlyTrip)).not.toContain("listen");
  expect(replayPassage("bell", [...approach, "listen"])).toBeNull();
  const state = replayPassage("bell", approach, false, false, true)!;
  expect(passageCommands(state)).toContain("listen");
  const listening = applyPassage(state, "listen")!;
  expect(listening.after.heardBell).toBe(true);
  expect(listening.after.bellRigged).toBe(false);
  expect(listening.after.court).toEqual(applyPassage(state, "wait")!.after.court);
  expect(listening.events).toEqual(applyPassage(state, "wait")!.events);
  expect(applyPassage(state, "wait")!.after.heardBell).toBe(false);
  expect(passageCommands({ ...state, heardBell: true })).not.toContain("listen");
  expect(passageCommands({ ...state, job: "reed" })).not.toContain("listen");
  expect(passageCommands({ ...state, court: { ...state.court, opened: [] } })).not.toContain("listen");
  expect(passageCommands(applyPassage(state, "wait")!.after)).not.toContain("listen");
  expect(passageCommands(replayPassage("bell", [N,W,"ride"], false, false, true)!)).not.toContain("listen");
});

test("a rigged bell changes a marked surge, keeps the rope and enables different dry routes", () => {
  const unrigged = replayPassage("bell", [N,N])!;
  const atBell = replayPassage("bell", [N,N], false, true)!;
  expect(applyPassage(unrigged, "ring")).toBeNull();
  const wait = applyPassage(atBell, "wait")!;
  expect(wait.after.court).toMatchObject({ bridge: 1, resolve: 2, opened: [] });
  const ring = applyPassage(atBell, "ring")!;
  expect(ring.events).toEqual([
    { kind:"redirect", from:1, to:0 }, { kind:"wave", source:0, exit:0 },
    { kind:"bridge", from:1, to:0 }, { kind:"open", column:0 },
  ]);
  expect(ring.after.court).toMatchObject({ position:{x:1,y:3}, bridge:0, resolve:3, turn:3, tool:"rope", uses:2 });
  expect(applyPassage(replayPassage("bell", [N,N,"ring","wait","wait"], false, true)!, "ring")).toBeNull();
  expect(applyPassage(replayPassage("bell", [N,W], false, true)!, "ring")).toBeNull();
  expect(replayPassage("reed", [N,N,"ring"], false, 1)).toBeNull();
  for (const [job, route] of [
    ["bell", [N,N,"ring",W,S,"ride",S,S,E,"return"]],
    ["reed", [N,N,"ring","wait",E,"ride",S,W,"return"]],
  ] as const) {
    const safe = replayPassage(job, route, false, true)!;
    expect(safe.court.resolve).toBe(3);
    expect(passageDelivered(safe)).toBe(true);
    expect(replayPassage(job, route)).toBeNull();
  }
});
