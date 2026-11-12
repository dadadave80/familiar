import { expect, test } from "bun:test";
import { replayOuting, type Action } from "./engine";
import { bankRun, challengeMet, challengeText, installLens, installVane, newHome, readHome, writeHome } from "./home";

const dry: Action[] = ["wait", "move:left", "move:center", "reel:lens", "return"];
const wet: Action[] = ["wait", "move:left", "wait", "take:lens", "move:center", "return"];
const two: Action[] = ["wait","move:left","move:center","move:right","reel:lens","move:center","move:right","take:moth","move:center","return"];

function memoryStore() {
  const data = new Map<string, string>();
  return { data, getItem:(key: string) => data.get(key) ?? null, setItem:(key: string,value: string) => { data.set(key,value); } };
}

test("home remembers a different real event for a clean dodge, mixed hit, or moth; restoration is deliberate", () => {
  const first = bankRun(newHome(), replayOuting("rope", [], dry)!);
  const second = bankRun(newHome(), replayOuting("rope", [], wet)!);
  const third = bankRun(newHome(), replayOuting("rope", [], two)!);
  expect(first.bank).toEqual(["lens"]);
  expect(first.lit).toBe(false);
  expect(new Set([first.memory,second.memory,third.memory]).size).toBe(3);
  expect(third.bank).toEqual(["lens","moth"]);
  expect(installLens(first).lit).toBe(true);
  expect(installLens(newHome()).lit).toBe(false);
  const rescued = replayOuting("rope", first.bank, Array(9).fill("wait"))!;
  expect(bankRun(installLens(first), rescued)).toMatchObject({ lit:true, bank:["lens"], active:null });
});

test("a reload reconstructs the exact pending wave; corrupt and diverged saves are preserved", () => {
  const store = memoryStore();
  const home = readHome(store).home;
  const active = replayOuting("rope", [], dry.slice(0,2))!;
  expect(writeHome({...home,active,challengeActive:true},store)).toBe(true);
  const entry = [...store.data.entries()][0]!;
  expect(JSON.parse(entry[1]).active).toEqual({ tool:"rope",actions:["wait","move:left"] });
  expect(readHome(store).home.active).toEqual(active);
  expect(readHome(store).home.challengeActive).toBe(true);
  store.setItem(entry[0], "a different tab wrote here");
  expect(writeHome(home,store)).toBe(false);
  expect(readHome(store).storage).toBe("invalid");
  expect(writeHome(home,store)).toBe(false);
  expect(store.getItem(entry[0])).toBe("a different tab wrote here");
});

test("challenge needs the named tool, both opened shells and a dry return; copy has no move transcript", () => {
  const win = replayOuting("rope", [], two)!;
  expect(challengeMet(win)).toBe(true);
  expect(challengeMet(replayOuting("rope", [], dry)!)).toBe(false);
  expect(challengeMet({...win,tool:"lantern"})).toBe(false);
  expect(challengeMet({...win,outcome:"active"})).toBe(false);
  const invitation = challengeText(win);
  expect(invitation).toContain("10 turns");
  expect(invitation).not.toContain("move:");
  expect(invitation).not.toContain("localhost");
});

test("editing dialogue does not invalidate a saved lighthouse or resurrect a rescued moth", () => {
  const store = memoryStore();
  const key = "familiar.first-light.beacon.v1";
  store.setItem(key, JSON.stringify({ version:1, bank:["lens","moth"], lit:true, memory:"An older line of dialogue.", active:null }));
  const result = readHome(store);
  expect(result.storage).toBe("ready");
  expect(result.home).toMatchObject({ bank:["lens","moth"], lit:true });
  const home = bankRun(newHome(), replayOuting("rope", [], two)!);
  expect(writeHome(home,store)).toBe(true);
  expect(JSON.parse(store.getItem(key)!).memoryId).toBe("moth");
  expect(readHome(store).home.memory).toBe(home.memory);
});

test("old Beacon saves retain the pending wave and unlock Wind only after installation", () => {
  const store = memoryStore();
  const key = "familiar.first-light.beacon.v1";
  store.setItem(key, JSON.stringify({ version:1, bank:[], lit:false, active:{ tool:"rope", actions:dry.slice(0,2) } }));
  const old = readHome(store);
  expect(old.storage).toBe("ready");
  expect(old.home).toMatchObject({ signaled:false, active:{ area:"beacon", locked:"left", turn:2 } });
  expect(writeHome(old.home,store)).toBe(true);
  expect(JSON.parse(store.getItem(key)!).version).toBe(2);
  expect(readHome(store).home).toEqual(old.home);
  expect(installVane(old.home)).toBe(old.home);
});

test("Wind return banks a unique vane, whose installation needs the beacon and is idempotent", () => {
  const windActions: Action[] = ["move:right", "wait", "move:center", "move:left", "wait", "move:center", "take:vane", "return"];
  const run = replayOuting("rope", ["lens"], windActions, "wind")!;
  expect(run.outcome).toBe("returned");
  const lit = installLens({ ...newHome(), bank:["lens"] });
  const home = bankRun(lit, run);
  expect(home).toMatchObject({ bank:["lens","vane"], lit:true, signaled:false, active:null });
  expect(home.memory).toContain("vane");
  const restored = installVane(home);
  expect(restored.signaled).toBe(true);
  expect(installVane(restored)).toBe(restored);
  expect(installVane(lit)).toBe(lit);
  expect(installVane({ ...newHome(), bank:["vane"] }).signaled).toBe(false);
  expect(bankRun(newHome(), run).bank).toEqual([]);
  expect(challengeMet({ ...run, opened:["left","right"] })).toBe(false);
});

test("Wind reload replays rotation and sockets, preserving installed signal and existing discoveries", () => {
  const store = memoryStore();
  readHome(store);
  const home = installVane({ ...newHome(), bank:["lens","moth","chart","salvage","vane"], lit:true });
  const active = replayOuting("lantern", home.bank, ["turn:vane","wait","turn:vane"], "wind")!;
  expect(writeHome({ ...home, active },store)).toBe(true);
  expect(JSON.parse([...store.data.values()][0]!).active.area).toBe("wind");
  expect(readHome(store).home).toEqual({ ...home, active });
});

test("invalid Wind progression, areas and challenges preserve the original save", () => {
  const key = "familiar.first-light.beacon.v1";
  const valid = { version:2, bank:["lens"], lit:true, signaled:false, active:null };
  const invalid = [
    { ...valid, active:{ tool:"rope", area:"wind", actions:[] }, lit:false },
    { ...valid, active:{ tool:"rope", area:"elsewhere", actions:[] } },
    { ...valid, active:{ tool:"rope", area:null, actions:[] } },
    { ...valid, signaled:true },
    { ...valid, bank:["vane"], lit:false },
    { ...valid, bank:["lens","vane"], lit:false },
    { ...valid, signaled:"yes" },
    { ...valid, bank:["lens","lens"] },
    { ...valid, active:{ tool:"rope", area:"wind", actions:[] }, challengeActive:true },
    { ...valid, active:{ tool:"rope", area:"wind", actions:["take:vane"] } },
    { ...valid, version:3 },
    { ...valid, version:1, active:{ tool:"rope", area:"wind", actions:[] } },
  ];
  for (const data of invalid) {
    const store = memoryStore();
    const raw = JSON.stringify(data);
    store.setItem(key,raw);
    expect(readHome(store).storage).toBe("invalid");
    expect(writeHome(newHome(),store)).toBe(false);
    expect(store.getItem(key)).toBe(raw);
  }
});

test("a failed signal write can retry with the earned vane still available", () => {
  const saved = memoryStore();
  let refuse = false;
  const store = {
    getItem: saved.getItem,
    setItem(key: string, value: string) {
      if (refuse) throw new Error("storage quota");
      saved.setItem(key,value);
    },
  };
  readHome(store);
  const home = { ...newHome(), bank:["lens","vane"] as ("lens"|"vane")[], lit:true };
  expect(writeHome(home,store)).toBe(true);
  const installed = installVane(home);
  refuse = true;
  expect(writeHome(installed,store)).toBe(false);
  expect(readHome(store).home).toMatchObject({ bank:["lens","vane"], signaled:false });
  refuse = false;
  expect(writeHome(installed,store)).toBe(true);
  expect(readHome(store).home.signaled).toBe(true);
});
