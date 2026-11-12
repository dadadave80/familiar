import { expect, test } from "bun:test";
import { replayOuting, type Action } from "./engine";
import { bankRun, challengeMet, challengeText, installLens, newHome, readHome, writeHome } from "./home";

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
