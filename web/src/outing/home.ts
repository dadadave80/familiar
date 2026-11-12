import { isItem, replayOuting, type Item, type Outing } from "./engine";

export interface Home {
  bank: Item[];
  lit: boolean;
  memory: string;
  active: Outing | null;
  challengeActive: boolean;
}
type Store = Pick<Storage, "getItem" | "setItem">;
type ReadResult = { home: Home; storage: "ready" | "unavailable" | "invalid" };
const KEY = "familiar.first-light.beacon.v1";
const observed = new WeakMap<Store, string | null>();
const memoryLines = {
  moth: "I could feel those little wings all the way home.",
  soaked: "I wrung out my scarf twice. We still brought that lens all the way home.",
  lantern: "Remember the light on the water? The wave turned. We never had to outrun it.",
  reel: "You held the line; I felt the lens catch. That's the part I keep thinking about.",
  carry: "It fit in the crook of my paw. Funny that a whole lighthouse needs something that small.",
  chart: "The lines on the chart looked different once we'd seen the tide move.",
  salvage: "That driftwood knocked against the buckle every step of the way back.",
  shells: "Two shells open, and look. The ends of my scarf are still dry.",
  rescue: "The tide put us back on the dock. Next time I'm watching the mark in the water.",
  retreat: "The tide is still there. We can sit here a while.",
} as const;
type MemoryId = keyof typeof memoryLines;
const memoryIds = Object.keys(memoryLines) as MemoryId[];

export function newHome(): Home {
  return { bank: [], lit: false, memory: "", active: null, challengeActive: false };
}

export function challengeMet(run: Outing) {
  return run.outcome === "returned" && run.tool === "rope" && run.resolve === 3 &&
    run.opened.includes("left") && run.opened.includes("right");
}

export function bankRun(home: Home, run: Outing): Home {
  if (run.outcome === "active") return home;
  const brought = run.outcome === "returned" ? run.cargo : [];
  const bank = [...new Set([...home.bank, ...brought])];
  let memory = home.memory;
  if (brought.includes("moth")) memory = memoryLines.moth;
  else if (brought.includes("lens")) {
    if (run.waves.some(w => w.hit)) memory = memoryLines.soaked;
    else if (run.actions.some(a => a.startsWith("lure:"))) memory = memoryLines.lantern;
    else if (run.actions.includes("reel:lens")) memory = memoryLines.reel;
    else memory = memoryLines.carry;
  } else if (challengeMet(run)) memory = memoryLines.shells;
  else if (brought.includes("chart")) memory = memoryLines.chart;
  else if (brought.includes("salvage")) memory = memoryLines.salvage;
  else if (!memory) memory = run.outcome === "rescued" ? memoryLines.rescue : memoryLines.retreat;
  return { ...home, bank, memory, active: null, challengeActive: false };
}

export function installLens(home: Home): Home {
  return home.bank.includes("lens") && !home.lit ? { ...home, lit: true } : home;
}

function decode(raw: string): Home | null {
  const data = JSON.parse(raw);
  if (data?.version !== 1 || !Array.isArray(data.bank) || data.bank.length > 4 ||
      !data.bank.every(isItem) || new Set(data.bank).size !== data.bank.length ||
      typeof data.lit !== "boolean" || (data.lit && !data.bank.includes("lens"))) return null;
  // Earlier prototype saves held the line itself. Editing dialogue must never erase a harbor.
  const memoryId = memoryIds.find(id => id === data.memoryId || memoryLines[id] === data.memory);
  let active: Outing | null = null;
  if (data.active !== null) {
    active = replayOuting(data.active?.tool, data.bank, data.active?.actions);
    if (active?.outcome !== "active") return null;
  }
  const challengeActive = data.challengeActive ?? false;
  if (typeof challengeActive !== "boolean" || (challengeActive && active?.tool !== "rope")) return null;
  return { bank: data.bank, lit: data.lit, memory: memoryId ? memoryLines[memoryId] : "", active, challengeActive };
}

export function readHome(storage?: Store): ReadResult {
  let raw: string | null;
  let store: Store;
  try {
    store = storage ?? window.localStorage;
    raw = store.getItem(KEY);
  } catch {
    return { home: newHome(), storage: "unavailable" };
  }
  try {
    const home = raw === null ? newHome() : decode(raw);
    if (home) {
      observed.set(store, raw);
      return { home, storage: "ready" };
    }
  } catch { /* An unreadable save stays available for recovery. */ }
  observed.delete(store);
  return { home: newHome(), storage: "invalid" };
}

export function writeHome(home: Home, storage?: Store): boolean {
  try {
    const store = storage ?? window.localStorage;
    if (!observed.has(store) || store.getItem(KEY) !== observed.get(store)) return false;
    const active = home.active && { tool: home.active.tool, actions: home.active.actions };
    const memoryId = memoryIds.find(id => memoryLines[id] === home.memory) ?? null;
    const raw = JSON.stringify({ version: 1, bank: home.bank, lit: home.lit, memoryId, challengeActive: home.challengeActive, active });
    store.setItem(KEY, raw);
    observed.set(store, raw);
    return true;
  } catch {
    return false;
  }
}

const challenge = "two-shells-v1";
export function challengeRequested() {
  return new URLSearchParams(window.location.search).get("challenge") === challenge;
}

export function challengeText(run: Outing): string {
  const lead = challengeMet(run) ? `Mochi and I made it home dry in ${run.turn} turns.` : "I've got a tide puzzle for you.";
  const text = `${lead} Can you open both shells at Beacon Court with the Rope and bring Mochi home dry within 15 turns?`;
  // A localhost URL would send a recipient to their own computer.
  if (typeof window === "undefined") return text;
  const url = new URL(window.location.href);
  if (url.protocol !== "https:" || url.pathname.replace(/\/$/, "") !== "/outing" ||
      /^(localhost|127\.|\[::1\]$)|\.localhost$/i.test(url.hostname)) return text;
  return text + "\n" + new URL("/outing/?challenge=" + challenge, url.origin).href;
}
