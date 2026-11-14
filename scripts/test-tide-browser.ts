import { guide } from "./browser-controls";
import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { createServer } from "vite";
import { TURN_LIMIT, type Command } from "../web/src/expedition/types";
import { askHolds, cardStatus, replayRun, solve } from "../web/src/tide/asks";
import { askLine, cardForDay, dayLabel, TOOL_NOTE } from "../web/src/tide/cards";
import type { TideEntry } from "../web/src/tide/log";
import { bramsGuess, cautiousMove } from "../web/src/run/bot";
import { applyMove, startTide, type Move } from "../web/src/run/engine";
import { dayResult, readBook } from "../web/src/run/save";
import { STAMPS, haulWords, resultLine, resultTitle, shelfGoods } from "../web/src/tide/run-day";
import { haulLine } from "../web/src/season/model";

declare global { interface Window { tidePops: number[]; restartBusySeen: boolean } }

const day = 20771, card = cardForDay(day), route = solve(card.tool, card.asks, card.best);
assert.ok(route, "today’s card has a solution");
assert.equal(route.length, card.best, "the route uses the card’s best decision count");
const slipRoute = Array.from({ length: TURN_LIMIT }, (_, index) => Array<Command>(index + 1).fill("wait")).find(commands => {
  const run = replayRun(card.tool, commands);
  return run?.state.outcome === "active" && cardStatus(card, run).includes("slipped");
});
assert.ok(slipRoute, "the real engine finds an active outing with a slipped ask");
const nextDay = day + 1, nextCard = cardForDay(nextDay);
const saveKey = "familiar.expedition.local.v2";
const passageKey = `${saveKey}:shore-passages.v1`;
const logKey = "familiar.tide.log.v1:preview", pendingKey = "familiar.tide.pending.v1:preview";
const viewport = { width: 412, height: 860 }, tag = "412x860";
const artifacts = resolve(import.meta.dir, "../test-results/tide-browser");
await mkdir(artifacts, { recursive: true });
const shots = resolve(process.argv[2] ?? await mkdtemp(join(artifacts, "shots-")));
await mkdir(shots, { recursive: true });
const server = await createServer({
  root: resolve(import.meta.dir, "../web"), envDir: false, envPrefix: [],
  cacheDir: await mkdtemp(join(artifacts, "vite-")), logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});

function entryFor(tideDay: number, commands: Command[]): TideEntry {
  const tideCard = cardForDay(tideDay), run = replayRun(tideCard.tool, commands);
  assert.ok(run && run.state.outcome !== "active", "screenshot fixtures are legal finished outings");
  return { day: tideDay, cardId: tideCard.id, tool: tideCard.tool, commands,
    kept: cardStatus(tideCard, run).map(status => status === "kept") as TideEntry["kept"],
    decisions: run.state.turn, outcome: run.state.outcome, late: false, attempts: 1, savedAt: "" };
}

async function captureLayouts(page: Page, label: string, check?: () => Promise<void>) {
  const resize = async (size: { width: number; height: number }) => {
    await page.setViewportSize(size);
    // Phaser's resize arrives after the DOM layout, so wait before measuring its tiles.
    await expect.poll(() => page.locator(".exp-world canvas").evaluate((canvas: HTMLCanvasElement) =>
      canvas.width === canvas.parentElement!.clientWidth && canvas.height === canvas.parentElement!.clientHeight),
    { message: `${label}: canvas catches up with the viewport`, timeout: 15000 }).toBe(true);
  };
  for (const size of [viewport, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
    await resize(size);
    if (await page.locator(".exp-panel").count()) await checkPanel(page, `${label} ${size.width}x${size.height}`);
    await check?.();
    await page.screenshot({ path: join(shots, `rev-${label}-${size.width}x${size.height}.png`) });
  }
  await resize(viewport);
}

async function observePops(page: Page) {
  await page.evaluate(() => {
    window.tidePops = [];
    document.addEventListener("animationstart", event => {
      if ((event as AnimationEvent).animationName !== "tide-chip-pop") return;
      const chip = event.target as HTMLElement;
      window.tidePops.push([...chip.parentElement!.children].indexOf(chip));
    });
  });
}

async function checkPanel(page: Page, label: string) {
  const small = await page.locator(".exp-panel button:visible").evaluateAll(buttons => buttons.flatMap(button => {
    const { width, height } = button.getBoundingClientRect();
    return width < 44 || height < 44 ? [{ name: button.getAttribute("aria-label") ?? button.textContent, width, height }] : [];
  }));
  assert.deepEqual(small, [], `${label}: buttons under 44px`);
  const overflow = await page.locator(".exp-panel").evaluate(panel => panel.scrollWidth > panel.clientWidth + 1);
  assert.equal(overflow, false, `${label}: panel scrolls sideways`);
}

async function checkHarborStamp(page: Page) {
  const harbor = page.locator(".exp-departure");
  await expect(harbor.locator(".tide-stamp-paper > img")).toHaveAttribute("alt", "");
  assert.ok(await harbor.evaluate(node => {
    const stamp = node.querySelector<HTMLElement>(".tide-stamp")!, bounds = stamp.getBoundingClientRect();
    const heading = node.querySelector("h1")!, action = node.querySelector(".exp-primary,.exp-secondary")!.getBoundingClientRect();
    const text = [heading, node.querySelector("p")!].flatMap(element => {
      const range = document.createRange(); range.selectNodeContents(element); return [...range.getClientRects()];
    });
    return getComputedStyle(stamp).getPropertyValue("--stamp") === "88px"
      && text.every(rect => rect.right <= bounds.left || rect.left >= bounds.right || rect.bottom <= bounds.top || rect.top >= bounds.bottom)
      && (bounds.bottom <= action.top || bounds.right <= action.left)
      && node.getBoundingClientRect().left >= 0 && node.getBoundingClientRect().right <= innerWidth;
  }), "harbor stamp is 88px and overlaps neither text nor an action at every viewport");
  assert.ok(await harbor.locator(".exp-primary").count() <= 1, "one primary per harbor card");
  assert.ok(await harbor.locator(".exp-secondary").count() <= 2, "at most two secondary actions per harbor card");
  const size = page.viewportSize()!, dockActive = size.width < 900 && (size.height >= size.width || size.height > 500);
  const navigation = page.locator(dockActive ? ".exp-phone-dock" : ".exp-harbor-tools");
  await expect(navigation.getByRole("button", { name: "Harbor chart", exact: true })).toBeVisible();
  await expect(navigation.getByRole("button", { name: "Open the tide log", exact: true })).toBeVisible();
  if (dockActive) {
    await expect(navigation.getByRole("button")).toHaveCount(4);
    const card = await harbor.boundingBox(), dock = await navigation.boundingBox();
    assert.ok(card && dock && card.y + card.height <= dock.y + 1, "phone harbor card stays above its dock");
  }
  await expect(harbor.getByRole("button", { name: "Change preparation", exact: true })).toBeVisible();
}

async function checkStickyPanel(page: Page, label: string) {
  const panel = page.locator(".exp-panel");
  await panel.evaluate(node => node.scrollTo({ top: node.scrollHeight, behavior: "instant" }));
  const bounds = await panel.boundingBox(), close = await panel.getByRole("button", { name: "Close panel", exact: true }).boundingBox();
  const heading = await panel.getByRole("heading").first().boundingBox();
  assert.ok(bounds && close && heading && close.y >= bounds.y && close.y + close.height <= bounds.y + bounds.height
    && heading.y >= bounds.y && heading.y + heading.height <= bounds.y + bounds.height, `${label}: close and heading stay in view after scrolling`);
  await panel.evaluate(node => node.scrollTo({ top: 0, behavior: "instant" }));
}

async function checkTrayAsks(page: Page, label: string) {
  const tray = page.locator(".exp-command-tray"), asks = tray.locator(".exp-tray-reading > .tide-outing .tide-asks");
  await expect(asks).toBeVisible();
  await expect(tray.locator(".exp-tray-scroll .tide-outing")).toHaveCount(0);
  const bounds = await tray.boundingBox(), strip = await asks.boundingBox(), actions = await tray.locator(".exp-control-hints").boundingBox();
  assert.ok(bounds && strip && actions, `${label}: tray, asks and actions have visible bounds`);
  assert.ok(strip.x >= bounds.x - 1 && strip.x + strip.width <= bounds.x + bounds.width + 1
    && strip.y >= bounds.y - 1 && strip.y + strip.height <= bounds.y + bounds.height + 1,
    `${label}: asks lie inside the move tray`);
  assert.ok(strip.y + strip.height <= actions.y + 1 || strip.x + strip.width <= actions.x + 1 || strip.x >= actions.x + actions.width - 1,
    `${label}: asks do not overlap movement or context actions`);
  const chips = await asks.locator("li").evaluateAll(nodes => nodes.map(node => {
    const bounds = node.getBoundingClientRect();
    return { top: bounds.top, left: bounds.left, right: bounds.right, height: bounds.height,
      font: parseFloat(getComputedStyle(node).fontSize), fits: node.scrollWidth <= node.clientWidth + 1 };
  }));
  assert.ok(chips.every(chip => chip.left >= strip.x - 1 && chip.right <= strip.x + strip.width + 1 && chip.fits),
    `${label}: every chip fits without clipping its status words at ${page.viewportSize()!.width}x${page.viewportSize()!.height}: ${JSON.stringify(await asks.locator("li").allInnerTexts())}`);
  assert.ok(chips.every(chip => chip.font >= 13), `${label}: ask text is at least 13px`);
  const size = page.viewportSize()!;
  if (size.width < 900) {
    const rows = new Set(chips.map(chip => Math.round(chip.top))).size;
    if (size.height > size.width) assert.equal(rows, 1, `${label}: portrait phone asks use one row`);
    else assert.ok(rows <= 3, `${label}: all three landscape asks fit the narrow hint tray`);
    assert.ok(chips.every(chip => chip.height <= 36), `${label}: phone chips stay at most 36px tall`);
  } else assert.equal(new Set(chips.map(chip => Math.round(chip.top))).size, 3, `${label}: desktop asks use three stacked rows`);
  const reading = tray.locator(".exp-tray-scroll");
  assert.ok(await reading.evaluate(node => {
    node.scrollTo({ top: node.scrollHeight, behavior: "instant" });
    return node.scrollHeight <= node.clientHeight + 1 || node.scrollTop > 0;
  }), `${label}: overflowing reading text actually scrolls`);
  const afterScroll = await asks.boundingBox();
  assert.ok(afterScroll && Math.abs(afterScroll.y - strip.y) <= 1, `${label}: scrolling the reading text leaves the asks in place`);
  await reading.evaluate(node => node.scrollTo({ top: 0, behavior: "instant" }));
}

async function checkRestartLayout(page: Page, label: string) {
  const asks = page.locator(".tide-asks"), restart = page.locator(".tide-outing > .tide-restart.exp-text-button");
  const strip = await asks.boundingBox(), button = await restart.boundingBox();
  const tray = await page.locator(".exp-command-tray").boundingBox(), actions = await page.locator(".exp-control-hints").boundingBox();
  assert.ok(strip && button && tray && actions, `${label}: asks, restart, tray and actions have visible bounds`);
  assert.ok(button.y >= strip.y + strip.height - 1 || button.y + button.height <= strip.y + 1
    || button.x >= strip.x + strip.width - 1 || button.x + button.width <= strip.x + 1,
    `${label}: restart and ask chips do not overlap`);
  assert.ok(button.x >= tray.x - 1 && button.x + button.width <= tray.x + tray.width + 1
    && button.y >= tray.y - 1 && button.y + button.height <= tray.y + tray.height + 1, `${label}: restart stays inside the tray`);
  assert.ok(button.y + button.height <= actions.y + 1 || button.x + button.width <= actions.x + 1 || button.x >= actions.x + actions.width - 1,
    `${label}: restart stays clear of input hints`);
  assert.ok(button.height >= 44, `${label}: restart has a 44px target`);
  await expect(restart).toBeInViewport({ ratio: 1 });
  await checkTrayAsks(page, label);
  await page.locator(".exp-tray-scroll").evaluate(node => node.scrollTo({ top: node.scrollHeight, behavior: "instant" }));
  const afterScroll = await restart.boundingBox();
  assert.ok(afterScroll && Math.abs(afterScroll.y - button.y) <= 1, `${label}: scrolling the reading text leaves restart in place`);
  await expect(restart).toBeInViewport({ ratio: 1 });
  await page.locator(".exp-tray-scroll").evaluate(node => node.scrollTo({ top: 0, behavior: "instant" }));
  assert.equal(await asks.evaluate(node => getComputedStyle(node).pointerEvents), "none");
  assert.equal(await restart.evaluate(node => getComputedStyle(node).pointerEvents), "auto");
  await restart.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(restart).toBeFocused();
  assert.ok(await restart.evaluate(node => {
    const style = getComputedStyle(node);
    return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
  }), `${label}: keyboard focus is visible`);
}

async function openClassic(page: Page) {
  await page.getByRole("button", { name: "Harbor chart", exact: true }).and(page.locator(":visible")).click();
  const beacon = page.locator('.exp-panel[data-surface="chart"] .harbor-routes > li').filter({ hasText: "Beacon Court" });
  await expect(beacon).toHaveCount(1);
  await beacon.getByRole("button").click();
  await expect(page.locator('.exp-panel[data-surface="court-tide"]')).toBeVisible();
}

async function checkDaily(page: Page, origin: string) {
  const today = Math.floor(Date.now() / 86_400_000), todayCard = cardForDay(today), tomorrow = cardForDay(today + 1);
  const guardDay = () => assert.equal(Math.floor(Date.now() / 86_400_000), today, "UTC midnight crossed during the daily flow; rerun with the new day");
  let final = startTide({ seed: today });
  while (final.outcome === "active") final = applyMove(final, cautiousMove(final))!.after;
  const result = dayResult(final), goods = shelfGoods(result);
  assert.equal(result.guess, bramsGuess(today));
  assert.ok(goods[0] + goods[1] > 0, "the cautious daily route brings reed or glass to Bram");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(({ saveKey, passageKey }) => {
    localStorage.setItem(saveKey, JSON.stringify({
      version: 2, home: { banked: ["lens", "moth", "vane"], lit: true, signaled: true, lantern: null }, active: null, last: null,
    }));
    localStorage.setItem(passageKey, JSON.stringify({
      version: 1, services: ["bell", "reed"], watchedReeds: true, heardBell: false, active: null,
    }));
  }, { saveKey, passageKey });
  await page.goto(new URL("/outing/?play", origin).href);
  await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready", "true", { timeout: 30000 });
  const harbor = page.locator(".exp-departure"), panel = page.locator(".exp-panel");
  const before = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).home, saveKey);
  await expect(harbor.getByRole("heading", { name: `Today’s tide: ${todayCard.name}.`, exact: true })).toBeVisible();
  await expect(harbor.locator(".exp-primary")).toHaveCount(1);
  await expect(harbor.locator(".exp-primary")).toHaveText("See today’s tide");
  await captureLayouts(page, "daily-harbor", () => checkHarborStamp(page));
  await harbor.getByRole("button", { name: "See today’s tide", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Today’s tide", exact: true })).toBeVisible();
  await expect(panel.getByRole("heading", { name: todayCard.name, exact: true })).toBeVisible();
  await expect(panel.locator(".tide-list > li")).toHaveCount(3);
  for (const stamp of STAMPS) await expect(panel.getByText(stamp.ask(result.guess), { exact: true })).toBeVisible();
  await expect(panel.locator(".exp-primary")).toHaveCount(1);
  await expect(panel.locator(".exp-primary")).toHaveText("Sail today’s tide");
  await captureLayouts(page, "daily-ask");
  guardDay();
  await panel.getByRole("button", { name: "Sail today’s tide", exact: true }).click();
  const run = page.getByTestId("tide-run");
  await expect(run).toHaveAttribute("data-seed", String(today));
  await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready", "true", { timeout: 30000 });
  for (const move of final.moves) {
    await expect(run).toHaveAttribute("data-busy", "false", { timeout: 15000 });
    await guide(page,move);
  }
  await expect(page.getByRole("dialog", { name: "Home", exact: true })).toBeVisible({ timeout: 15000 });
  guardDay();
  await expect(panel.getByRole("heading", { name: resultTitle(result), exact: true })).toBeVisible();
  await expect(panel.locator(".tide-home-sub")).toHaveText(resultLine(result));
  const checkStamps = async () => {
    await expect(panel.locator(".tide-list > li")).toHaveCount(3);
    for (const [index, stamp] of STAMPS.entries()) {
      const kept = result.stamps[stamp.key], row = panel.locator(".tide-list > li").nth(index);
      await expect(row).toHaveAttribute("data-kept", String(kept));
      await expect(row).toHaveText(`${stamp.label(result)} (${kept ? "kept" : "slipped"})`);
    }
    await expect(panel.locator(".tide-haul .tide-sr")).toHaveText(`Haul: ${haulWords(result)}.`);
  };
  await checkStamps();
  await expect(panel.getByRole("button", { name: "Take it to Bram", exact: true })).toHaveClass(/exp-primary/);
  await expect(panel.getByRole("button", { name: "See the tide log", exact: true })).toHaveClass(/exp-secondary/);
  await captureLayouts(page, "daily-home", async () => {
    if (page.viewportSize()!.height === 390) {
      assert.equal(await panel.evaluate(node => node.scrollHeight > node.clientHeight + 1), false, "landscape daily Home needs no scrolling");
      for (const name of ["Take it to Bram", "See the tide log"]) {
        await expect(panel.getByRole("button", { name, exact: true })).toBeInViewport({ ratio: 1 });
      }
    }
    await checkStickyPanel(page, "daily Home");
  });
  const bookKey = `${saveKey}:tide-run.v1`, raw = await page.evaluate(key => localStorage.getItem(key), bookKey);
  const book = readBook({ getItem: () => raw }, bookKey);
  assert.equal(book.active, null);
  assert.equal(book.days.length, 1);
  assert.deepEqual(book.days[0], final, "the saved daily trace reproduces the engine result");
  await panel.getByRole("button", { name: "See the tide log", exact: true }).click();
  await expect(panel.locator(".tide-log-run")).toBeVisible();
  await expect(panel.getByRole("heading", { name: todayCard.name, exact: true })).toBeVisible();
  await expect(panel.getByText(`${dayLabel(today)} · tide run`, { exact: true })).toBeVisible();
  for (const [name, value] of [["Banked", result.score], ["Bram’s guess", result.guess], ["Splashes", result.splashes]] as const) {
    await expect(panel.locator(".tide-facts > div").filter({ has: page.getByText(name, { exact: true }) }).locator("dd")).toHaveText(String(value));
  }
  await checkStamps();
  await captureLayouts(page, "daily-log", () => checkStickyPanel(page, "daily log"));
  await panel.getByRole("button", { name: "Close panel", exact: true }).click();
  await expect(harbor.getByRole("heading", { name: resultTitle(result), exact: true })).toBeVisible();
  await expect(harbor.locator("p").first()).toHaveText(`${resultLine(result)}.`);
  await expect(harbor.locator(".exp-primary")).toHaveCount(1);
  await expect(harbor.locator(".exp-primary")).toHaveText("Take it to Bram");
  await captureLayouts(page, "daily-result", () => checkHarborStamp(page));
  await harbor.getByRole("button", { name: "Take it to Bram", exact: true }).click();
  const shelve = panel.getByRole("button", { name: `Shelve ${haulLine(goods)}`, exact: true });
  await expect(shelve).toBeVisible({ timeout: 15000 });
  await expect(panel.locator(".ss-run-haul")).toContainText(`From today’s tide run: ${resultLine(result)}.`);
  await captureLayouts(page, "daily-bram");
  guardDay();
  await shelve.click();
  await expect(panel.locator('.ss-docked[data-docked="true"]')).toContainText("Today’s haul is on Bram’s shelf.");
  await captureLayouts(page, "daily-shelved");
  await panel.getByRole("button", { name: "Close panel", exact: true }).click();
  await expect(harbor.getByRole("heading", { name: `Tomorrow: ${tomorrow.name}.`, exact: true })).toBeVisible();
  await captureLayouts(page, "daily-tomorrow", () => checkHarborStamp(page));
  assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).home, saveKey), before, "the daily run and shelving leave story progress unchanged");
  guardDay();
}

async function checkMidnight(page: Page, origin: string, mode: "harbor" | "wake" | "outing" | "unmarked-outing" | "override") {
  const midnight = nextDay * 86_400_000;
  const outing = mode === "outing" || mode === "unmarked-outing";
  const expectedPending = mode === "unmarked-outing" ? null : { day, late: false };
  await page.clock.install({ time: new Date(midnight - 10_000) });
  // Keep a slow asset load from crossing midnight before the scenario starts.
  await page.clock.setFixedTime(new Date(midnight - 10_000));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(({ saveKey, passageKey, pendingKey, blockPending }) => {
    localStorage.setItem(saveKey, JSON.stringify({
      version: 2, home: { banked: ["lens", "moth", "vane"], lit: true, signaled: true, lantern: null }, active: null, last: null,
    }));
    localStorage.setItem(passageKey, JSON.stringify({
      version: 1, services: ["bell", "reed"], watchedReeds: true, heardBell: false, active: null,
    }));
    if (blockPending) {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === pendingKey) throw new DOMException("Site data is blocked", "QuotaExceededError");
        setItem.call(this, key, value);
      };
    }
  }, { saveKey, passageKey, pendingKey, blockPending: mode === "unmarked-outing" });
  await page.goto(new URL(`/outing/?play${mode === "override" ? `&tide-day=${day}` : ""}`, origin).href);
  await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready", "true", { timeout: 30000 });
  await page.clock.setSystemTime(new Date(midnight - 10_000));
  await page.clock.pauseAt(new Date(midnight - 1_000));
  const harbor = page.locator(".exp-departure"), panel = page.locator(".exp-panel");
  await expect(harbor).toContainText(card.name);
  await openClassic(page);
  await expect(panel.getByRole("heading", { name: card.name, exact: true })).toBeVisible();
  const asks = page.locator(".tide-asks");
  if (outing) {
    await panel.getByRole("button", { name: "Sail today’s tide", exact: true }).click();
    await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-mode", "court");
    await expect(asks).toBeVisible();
    await expect(asks.locator("li[data-status]")).toHaveCount(3);
  }
  const beforeAsks = await asks.allTextContents();
  if (mode === "wake") {
    await page.clock.setSystemTime(new Date(midnight + 1_000));
    await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  } else await page.clock.fastForward(2_000);
  if (outing) {
    assert.deepEqual(await asks.allTextContents(), beforeAsks, "midnight keeps the active card’s asks");
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), pendingKey), expectedPending, "midnight keeps the outing’s original marker");
    await page.getByRole("button", { name: "Game menu", exact: true }).click();
    await panel.getByRole("button", { name: "Start this tide over", exact: true }).click();
    assert.deepEqual(await asks.allTextContents(), beforeAsks, "restart after midnight keeps the original card’s asks");
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), pendingKey), expectedPending, "restart after midnight keeps the outing’s original marker");
    await guide(page,"return");
    await page.clock.runFor(1_000);
    await expect(page.getByRole("dialog", { name: "Home", exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "See the tide log", exact: true }).click();
    await expect(panel.getByRole("heading", { name: card.name, exact: true })).toBeVisible();
    const entries = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]"), logKey);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].day, day, "a return after midnight is logged on the day it started");
    assert.equal(entries[0].cardId, card.id);
  } else {
    const expectedDay = mode === "override" ? day : nextDay, expectedCard = cardForDay(expectedDay);
    await expect(panel.getByRole("heading", { name: expectedCard.name, exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Close panel", exact: true }).click();
    await expect(harbor).toContainText(expectedCard.name);
    await openClassic(page);
    await panel.getByRole("button", { name: "Sail today’s tide", exact: true }).click();
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), pendingKey), { day: expectedDay, late: false }, "the first Sail after midnight uses the displayed day");
  }
}

try {
  await server.listen();
  const origin = server.resolvedUrls!.local[0]!;
  const browser = await chromium.launch();
  const errors: string[] = [];
  try {
    const dailyPage = await browser.newPage({ viewport });
    dailyPage.on("pageerror", error => errors.push(error.message));
    try { await checkDaily(dailyPage, origin); }
    finally { await dailyPage.close(); }
    const page = await browser.newPage({ viewport });
    await page.clock.install({ time: new Date(day * 86_400_000 + 43_200_000) });
    page.on("pageerror", error => errors.push(error.message));
    const game = page.getByTestId("expedition-game"), world = page.getByTestId("expedition-world");
    const harbor = page.locator(".exp-departure"), panel = page.locator(".exp-panel");
    await page.goto(new URL("/outing/?play", origin).href);
    await expect(world).toHaveAttribute("data-ready", "true", { timeout: 30000 });
    const before = await page.evaluate(({ saveKey, passageKey }) => {
      localStorage.clear();
      localStorage.setItem(saveKey, JSON.stringify({
        version: 2, home: { banked: ["lens", "moth", "vane"], lit: true, signaled: true, lantern: null }, active: null, last: null,
      }));
      localStorage.setItem(passageKey, JSON.stringify({
        version: 1, services: ["bell", "reed"], watchedReeds: true, heardBell: false, active: null,
      }));
      return JSON.parse(localStorage.getItem(saveKey)!).home;
    }, { saveKey, passageKey });

    await page.goto(new URL(`/outing/?play&tide-day=${day}`, origin).href);
    await expect(world).toHaveAttribute("data-ready", "true", { timeout: 30000 });
    for (const size of [viewport, { width: 1280, height: 800 }]) {
      await page.setViewportSize(size);
      const chartOpener = page.getByRole("button", { name: "Harbor chart", exact: true }).and(page.locator(":visible")).first();
      await chartOpener.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("dialog", { name: "Chart", exact: true })).toBeVisible();
      await captureLayouts(page, "harbor-chart", () => checkStickyPanel(page, "harbor chart"));
      await page.setViewportSize(size);
      await page.keyboard.press("Escape");
      await expect(chartOpener).toBeFocused();
      await chartOpener.click();
      await panel.getByRole("button", { name: "Close panel", exact: true }).click();
      await expect(chartOpener).toBeFocused();
    }
    await page.setViewportSize(viewport);
    for (const place of await page.locator(".exp-home-places button:visible").all()) {
      await place.hover();
      assert.ok(await place.evaluate(button => {
        const style = getComputedStyle(button), text = style.color.match(/[\d.]+/g)!.map(Number), surface = style.backgroundColor.match(/[\d.]+/g)!.map(Number);
        const luminance = (rgb: number[]) => rgb.slice(0, 3).map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, i) => sum + value * [.2126, .7152, .0722][i]!, 0);
        const alpha = surface[3] ?? 1, backdrop = surface.slice(0, 3).map(channel => channel * alpha + 255 * (1 - alpha));
        const light = luminance(text), dark = luminance(backdrop);
        return (Math.max(light, dark) + .05) / (Math.min(light, dark) + .05) >= 4.5;
      }), "hover keeps every harbor place label readable, even over the lightest scene background");
    }
    await page.screenshot({ path: join(shots, `harbor-ask-${tag}.png`) });
    await page.setViewportSize({ width: 1280, height: 800 });
    await checkHarborStamp(page);
    await page.screenshot({ path: join(shots, "harbor-ask-1280x800.png") });
    await page.setViewportSize(viewport);

    await openClassic(page);
    await expect(panel.getByRole("heading", { name: "Today’s tide", exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: card.name, exact: true })).toBeVisible();
    await expect(panel).toContainText(TOOL_NOTE[card.tool]);
    for (const ask of card.asks) await expect(panel.getByText(askLine(ask, card.tool), { exact: true })).toBeVisible();
    await expect(panel.locator(".tide-earlier")).toHaveCount(0);
    await captureLayouts(page, "classic-ask");
    assert.ok(await panel.locator(".tide-card").evaluate(card => {
      const bounds = card.getBoundingClientRect(), primary = card.querySelector(".exp-primary")!.getBoundingClientRect();
      return Math.abs(primary.left - bounds.left) <= 1 && Math.abs(primary.right - bounds.right) <= 1;
    }), "Today’s tide primary pill fills the phone card width");
    await page.screenshot({ path: join(shots, `ask-card-${tag}.png`) });

    await observePops(page);
    await panel.getByRole("button", { name: "Sail today’s tide", exact: true }).click();
    await expect(game).toHaveAttribute("data-mode", "court");
    const active = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), saveKey);
    assert.equal(active.active.season, true);
    assert.deepEqual(active.active.state.banked, []);
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null"), pendingKey), { day, late: false });
    const asks = page.locator(".tide-asks");
    await expect(asks).toBeVisible();
    await expect(asks.locator("li[data-status]")).toHaveCount(3);
    assert.deepEqual(await page.evaluate(() => window.tidePops), [], "first render does not pop asks already holding");
    await expect(asks.locator("[data-motion]")).toHaveCount(0);
    const initialRun = replayRun(card.tool, [])!;
    for (let index = 0; index < 3; index++) {
      const holding = askHolds(card.asks[index]!, initialRun), chip = asks.locator("li").nth(index);
      await expect(chip).toHaveAttribute("data-holding", String(holding));
      await expect(chip.locator(".tide-sr")).toHaveText(holding ? " (holding)" : " (not yet)");
      await expect(chip.locator("svg path")).toHaveCount(holding ? 1 : 0);
    }
    await captureLayouts(page, "court-start", () => checkTrayAsks(page, "outing start"));
    for (const [index, command] of route.entries()) {
      await guide(page,command);
      await expect(game).toHaveAttribute("data-busy", "false", { timeout: 15000 });
      if (index + 1 === Math.ceil(route.length / 2)) {
        await expect(asks).toBeVisible();
        const strip = await asks.boundingBox(), hud = await page.locator('.exp-hud[aria-label="Expedition status"]').boundingBox();
        assert.ok(strip && hud, "the asks and status HUD have visible bounds");
        assert.ok(strip.y >= hud.y + hud.height, "the asks do not overlap the status HUD");
        assert.ok(strip.x >= 0 && strip.x + strip.width <= viewport.width + 1, "the asks fit the viewport width");
        await captureLayouts(page, "court-mid-outing", () => checkTrayAsks(page, "mid-outing"));
        const chips = await asks.locator("li").evaluateAll(nodes => nodes.map(node => ({ top: Math.round(node.getBoundingClientRect().top), font: parseFloat(getComputedStyle(node).fontSize) })));
        assert.ok(new Set(chips.map(chip => chip.top)).size <= 2, "phone asks use at most two rows");
        assert.ok(chips.every(chip => chip.font >= 13), "phone ask text is at least 13px");
        const feedback = await page.getByTestId("expedition-feedback").boundingBox(), tray = await page.locator(".exp-command-tray").boundingBox();
        const reading = await page.locator(".exp-tray-scroll").boundingBox(), actions = await page.locator(".exp-control-hints").boundingBox();
        const directions = await page.locator(".exp-control-hints").boundingBox();
        const dockBottom = await world.evaluate(node => {
          const ys = (JSON.parse(node.getAttribute("data-tiles")!) as { y: number }[]).map(tile => tile.y);
          const bottom = Math.max(...ys), step = (bottom - Math.min(...ys)) / 4;
          return bottom + Math.max(33, Math.min(step * .65, 72)) / 2;
        });
        assert.ok(tray && tray.y >= dockBottom, "the phone tray clears the complete dock platform");
        assert.ok(feedback && reading && directions && Math.max(feedback.y, reading.y) >= tray!.y
          && Math.min(feedback.y + feedback.height, reading.y + reading.height) <= directions.y,
          "visible phone feedback stays inside its scrolling region above the input hints");
        assert.ok(actions && actions.y >= tray!.y && actions.y + actions.height <= viewport.height,
          "phone input hints stay visible without scrolling the tray");
        await page.screenshot({ path: join(shots, `court-mid-outing-${tag}.png`) });
      }
    }

    await expect(game).toHaveAttribute("data-mode", "harbor", { timeout: 15000 });
    await expect(page.getByRole("dialog", { name: "Home", exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "All three asks kept.", exact: true })).toBeVisible();
    await expect(panel.locator('.tide-list > li[data-kept="true"]')).toHaveCount(3);
    await expect(panel.locator(".tide-home-stamp .tide-stamp")).toHaveAttribute("data-press", "true");
    await expect(panel.locator(".tide-home-sub")).toHaveText(`${route.length} decisions · the Tidekeeper’s way`);
    await expect(panel.getByRole("button", { name: "Take it to Bram", exact: true })).toHaveClass(/exp-primary/);
    await expect(panel.getByRole("button", { name: "See the tide log", exact: true })).toHaveClass(/exp-secondary/);
    await expect(page.getByTestId("expedition-feedback")).toHaveClass(/exp-sr-only/);
    await expect(panel.locator(".tide-home-note")).toHaveText("Home with Beacon Lens. Bram can shelve it today.");
    assert.ok(await panel.evaluate(panel => {
      const viewport = panel.getBoundingClientRect();
      return [...panel.querySelectorAll(".tide-list .tide-ask-mark, .tide-home-stamp .tide-stamp")].every(marker => {
        const bounds = marker.getBoundingClientRect();
        return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom && bounds.left >= viewport.left && bounds.right <= viewport.right;
      });
    }), "automatic return shows every arrival marker and the stamp");
    await expect(panel.locator(".tide-list")).toHaveAttribute("data-arrival", "true");
    assert.deepEqual(await panel.locator(".tide-list .tide-ask-mark").evaluateAll(markers => markers.map(marker => getComputedStyle(marker).animationDelay)), ["0.36s", "0.48s", "0.6s"]);
    await checkPanel(page, "Home sheet");
    await captureLayouts(page, "coming-home", async () => {
      await checkPanel(page, "Home sheet");
      if (page.viewportSize()!.height <= 500) {
        assert.equal(await panel.evaluate(node => node.scrollHeight > node.clientHeight + 1), false, "landscape Home sheet needs no scrolling");
        await expect(panel.getByRole("button", { name: "Take it to Bram", exact: true })).toBeInViewport({ ratio: 1 });
        await expect(panel.getByRole("button", { name: "See the tide log", exact: true })).toBeInViewport({ ratio: 1 });
        assert.ok(await panel.evaluate(node => {
          const bounds = node.getBoundingClientRect();
          return [...node.querySelectorAll(".tide-home button")].every(button => {
            const action = button.getBoundingClientRect();
            return action.top >= bounds.top && action.bottom <= bounds.bottom && action.left >= bounds.left && action.right <= bounds.right;
          });
        }), "landscape Home actions fit inside the panel without clipping");
      }
      await checkStickyPanel(page, "Home sheet");
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.deepEqual(await panel.locator(".tide-list .tide-ask-mark, .tide-home-stamp .tide-stamp").evaluateAll(markers => markers.map(marker => getComputedStyle(marker).animationName)), ["none", "none", "none", "none"], "reduced motion shows the complete Home result without arrival animations");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await panel.getByRole("button", { name: "See the tide log", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "Bram’s tide log", exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: card.name, exact: true })).toBeVisible();
    await expect.poll(() => panel.evaluate(node => node.scrollTop)).toBe(0);
    const disabledPages = panel.locator('.tide-pages button[aria-disabled="true"]');
    await expect(disabledPages).not.toHaveCount(0);
    assert.ok(await disabledPages.evaluateAll(buttons => buttons.every(button => {
      const style = getComputedStyle(button);
      const luminance = (color: string) => color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(channel => {
        const value = channel / 255;
        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
      }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0);
      const ink = luminance(style.color), surface = luminance(style.backgroundColor);
      return Number(style.opacity) === 1 && (Math.max(ink, surface) + .05) / (Math.min(ink, surface) + .05) >= 3;
    })), "disabled page pills keep at least 3:1 text contrast without opacity fading");
    await expect(panel.locator(".tide-sub").first()).toHaveText("1 tide sailed · 3 asks kept · 1 with all three");
    await expect(panel.locator(".tide-facts > div").filter({ has: page.locator("dt", { hasText: /^Decisions$/ }) }).locator("dd")).toHaveText(String(route.length));
    await expect(panel.getByText("Mochi matched the Tidekeeper’s way.", { exact: true })).toBeVisible();
    await expect(panel.locator(".tide-list")).not.toHaveAttribute("data-arrival", "true");
    await expect(panel.locator(".tide-page-stamp .tide-stamp")).not.toHaveAttribute("data-press", "true");
    await checkStickyPanel(page, "tide log");
    let entries = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]"), logKey);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].day, day);
    assert.equal(entries[0].cardId, card.id);
    assert.deepEqual(entries[0].kept, [true, true, true]);
    assert.equal(entries[0].decisions, route.length);
    assert.equal(entries[0].outcome, "returned");
    assert.deepEqual(entries[0].commands, route);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), pendingKey), null);
    await checkPanel(page, "log page");
    await page.screenshot({ path: join(shots, `log-page-${tag}.png`) });
    await captureLayouts(page, "log-three-kept", async () => {
      await panel.locator(".tide-list").evaluate(asks => asks.scrollIntoView({ block: "end", behavior: "instant" }));
      await checkPanel(page, "three-kept log");
    });

    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).home, saveKey), before, "the classic tide outing leaves home progress unchanged");
    await panel.getByRole("button", { name: "Sail this tide again", exact: true }).click();
    await expect(game).toHaveAttribute("data-mode", "court");
    await guide(page,"return");
    await expect(page.getByRole("dialog", { name: "Home", exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "An empty satchel keeps no asks.", exact: true })).toBeVisible();
    await expect(panel.locator('.tide-list > li[data-kept="true"]')).toHaveCount(0);
    await captureLayouts(page, "classic-empty-home");
    await panel.getByRole("button", { name: "See the tide log", exact: true }).click();
    await expect(panel.locator('.tide-list > li[data-kept="true"]')).toHaveCount(3);
    entries = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), logKey);
    assert.equal(entries[0].attempts, 2, "a weaker replay gets its own Home result while the log retains the best");

    await page.goto(new URL(`/outing/?play&tide-day=${nextDay}`, origin).href);
    await expect(world).toHaveAttribute("data-ready", "true", { timeout: 30000 });
    await openClassic(page);
    await expect(panel.getByRole("heading", { name: nextCard.name, exact: true })).toBeVisible();
    await expect(panel).toContainText(TOOL_NOTE[nextCard.tool]);
    for (const ask of nextCard.asks) await expect(panel.getByText(askLine(ask, nextCard.tool), { exact: true })).toBeVisible();
    await expect(panel.locator(".tide-earlier > ul > li")).toHaveCount(1);
    await captureLayouts(page, "classic-next-day");
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).home, saveKey), before, "next day leaves home progress unchanged");
    await panel.getByText("Earlier tides", { exact: true }).click();
    await observePops(page);
    await panel.locator(".tide-earlier > ul > li").filter({ has: page.getByRole("heading", { name: card.name, exact: true }) }).getByRole("button", { name: "Sail again", exact: true }).click();
    await expect(game).toHaveAttribute("data-mode", "court");
    const restartBefore = await page.evaluate(({ logKey, pendingKey, saveKey }) => ({
      log: localStorage.getItem(logKey), pending: localStorage.getItem(pendingKey),
      returns: localStorage.getItem("familiar.expedition.returns.v2:preview"),
      tideReturns: localStorage.getItem("familiar.season.tide.v1:preview"),
      home: JSON.parse(localStorage.getItem(saveKey)!).home,
    }), { logKey, pendingKey, saveKey });
    assert.deepEqual(JSON.parse(restartBefore.pending!), { day, late: true }, "a late sailing keeps its original day");
    const restart = page.locator(".tide-outing > .tide-restart.exp-text-button");
    await expect(restart).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    for (const command of slipRoute) {
      await guide(page,command);
      await expect(game).toHaveAttribute("data-busy", "false", { timeout: 15000 });
    }
    await expect(asks.locator('li[data-status="slipped"]')).not.toHaveCount(0);
    await expect(restart).toHaveText("Start this tide over");
    await page.evaluate(() => {
      window.restartBusySeen = false;
      const game = document.querySelector('[data-testid="expedition-game"]')!;
      new MutationObserver(() => {
        const restart = document.querySelector<HTMLButtonElement>(".tide-outing > .tide-restart");
        if (game.getAttribute("data-busy") === "true" && restart?.disabled) window.restartBusySeen = true;
      }).observe(game, { attributes: true, subtree: true, attributeFilter: ["data-busy", "disabled"] });
    });
    await guide(page,"wait");
    await expect(game).toHaveAttribute("data-busy", "false", { timeout: 15000 });
    await expect(restart).toBeEnabled();
    assert.equal(await page.evaluate(() => window.restartBusySeen), true, "restart was disabled during the observed busy window");
    await expect(asks.locator('[data-holding="true"]')).not.toHaveCount(0);
    await expect(asks.locator('[data-status="slipped"] .tide-sr').first()).toHaveText(" (slipped)");
    await captureLayouts(page, "holding-slipped", () => checkRestartLayout(page, "holding/slipped strip"));
    await checkRestartLayout(page, tag);
    await page.screenshot({ path: join(shots, `restart-${tag}.png`) });
    await page.setViewportSize({ width: 1280, height: 800 });
    await checkRestartLayout(page, "1280x800");
    await page.screenshot({ path: join(shots, "restart-1280x800.png") });
    await page.setViewportSize(viewport);
    const popsBeforeRestart = await page.evaluate(() => window.tidePops.length);
    await restart.click();

    const assertRestarted = async (label: string) => {
      await expect(game).toHaveAttribute("data-mode", "court");
      await expect(game).toHaveAttribute("data-busy", "false");
      await expect(asks.locator('li[data-status="open"]')).toHaveCount(3);
      // The HUD names the next decision, so an untouched outing shows 1 of 24.
      await expect(page.locator('.exp-hud[aria-label="Expedition status"]')).toContainText(`Low tide · 1 of ${TURN_LIMIT}`);
      await expect(page.getByTestId("expedition-feedback")).toHaveText("Mochi sets out again. The asks are open.");
      await expect(restart).toHaveCount(0);
      const after = await page.evaluate(({ logKey, pendingKey, saveKey }) => ({
        log: localStorage.getItem(logKey), pending: localStorage.getItem(pendingKey),
        returns: localStorage.getItem("familiar.expedition.returns.v2:preview"),
        tideReturns: localStorage.getItem("familiar.season.tide.v1:preview"),
        home: JSON.parse(localStorage.getItem(saveKey)!).home,
        active: JSON.parse(localStorage.getItem(saveKey)!).active,
      }), { logKey, pendingKey, saveKey });
      const { active, ...unchanged } = after;
      assert.deepEqual(unchanged, restartBefore, `${label}: log, pending marker, both return records and home are unchanged`);
      assert.equal(JSON.parse(after.log!).length, entries.length, `${label}: no log entry was added`);
      assert.deepEqual(JSON.parse(after.log!), entries, `${label}: log contents are unchanged`);
      assert.equal(active.state.turn, 0);
      assert.deepEqual(active.state.commands, []);
      assert.equal(active.state.tool, card.tool);
    };
    await assertRestarted("text restart");
    await expect(asks.locator("[data-motion]")).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.tidePops.length), popsBeforeRestart, "restart does not pop the reset strip");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await guide(page,"wait");
    await expect(game).toHaveAttribute("data-busy", "false", { timeout: 15000 });
    await page.getByRole("button", { name: "Game menu", exact: true }).click();
    const menuRestart = panel.getByRole("button", { name: "Start this tide over", exact: true });
    const back = panel.getByRole("button", { name: "Back to Mochi", exact: true });
    await expect(menuRestart).toBeVisible();
    await captureLayouts(page, "classic-restart-menu");
    const menuButton = await menuRestart.boundingBox(), backButton = await back.boundingBox();
    assert.ok(menuButton && backButton && menuButton.y + menuButton.height <= backButton.y, "menu restart is above Back to Mochi");
    await menuRestart.click();
    await expect(panel).toHaveCount(0);
    await assertRestarted("menu restart");

    const seedHarbor = async (tideDay: number, log: TideEntry[]) => {
      await page.evaluate(({ saveKey, logKey, pendingKey, log }) => {
        const save = JSON.parse(localStorage.getItem(saveKey)!);
        localStorage.setItem(saveKey, JSON.stringify({ ...save, active: null, last: null }));
        localStorage.setItem(logKey, JSON.stringify(log));
        localStorage.removeItem(pendingKey);
        localStorage.removeItem("familiar.season.tide.v1:preview");
        localStorage.removeItem("familiar.season.preview.v1");
      }, { saveKey, logKey, pendingKey, log });
      await page.goto(new URL(`/outing/?play&tide-day=${tideDay}`, origin).href);
      await expect(world).toHaveAttribute("data-ready", "true", { timeout: 30000 });
      await expect(game).toHaveAttribute("data-mode", "harbor");
    };
    const partialRoute = solve(card.tool, [card.asks[0]])!;
    const partial = entryFor(day, partialRoute);
    assert.deepEqual(partial.kept, [true, false, true]);

    const oldDay = day - 2, oldCard = cardForDay(oldDay);
    await seedHarbor(nextDay, [entryFor(oldDay, solve(oldCard.tool, oldCard.asks)!), partial]);
    await openClassic(page);
    await panel.getByText("Earlier tides", { exact: true }).click();
    const rows = panel.locator(".tide-earlier > ul > li");
    await expect(rows).toHaveCount(3);
    const missed = rows.filter({ hasText: "Not sailed" });
    await expect(missed).toHaveCount(1);
    const sailLate = missed.getByRole("button", { name: "Sail late", exact: true });
    await expect(sailLate).toHaveClass("exp-text-button");
    assert.ok(await sailLate.evaluate(button => button.getBoundingClientRect().width < button.closest("li")!.getBoundingClientRect().width / 2), "missed tide's sail action is a small row button");
    await captureLayouts(page, "classic-earlier-gap");
    await sailLate.click();
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), pendingKey), { day: day - 1, late: true }, "missed day sails with its own late marker");

    await seedHarbor(nextDay, [partial]);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await openClassic(page);
    await observePops(page);
    await panel.getByRole("button", { name: "Sail today’s tide", exact: true }).click();
    await expect(game).toHaveAttribute("data-mode", "court");
    await expect(asks.locator("[data-motion]")).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.tidePops), [], "holding on first render has no pop");
    const bridgeRoute: Command[] = ["step:west", "wait", "step:east", "wait", "wait", "wait", "step:west", "wait", "step:east"];
    const bridgeChip = asks.locator("li").nth(1);
    for (const [index, command] of bridgeRoute.entries()) {
      await guide(page,command);
      await expect(game).toHaveAttribute("data-busy", "false", { timeout: 15000 });
      const holding = askHolds(nextCard.asks[1], replayRun(nextCard.tool, bridgeRoute.slice(0, index + 1))!);
      await expect(bridgeChip).toHaveAttribute("data-holding", String(holding));
      await expect(bridgeChip.locator(".tide-sr")).toHaveText(holding ? " (holding)" : " (not yet)");
      await expect(bridgeChip.locator("svg path")).toHaveCount(holding ? 1 : 0);
      await expect.poll(() => page.evaluate(() => window.tidePops)).toEqual([]);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Another bridge cycle changes the status, with no animation under reduced motion.
    for (const command of ["wait", "wait", "wait"] as Command[]) {
      await guide(page,command);
      await expect(game).toHaveAttribute("data-busy", "false", { timeout: 15000 });
    }
    await expect(bridgeChip).toHaveAttribute("data-holding", "false");
    assert.deepEqual(await asks.locator("li").evaluateAll(chips => chips.map(chip => getComputedStyle(chip).animationName)), ["none", "none", "none"], "reduced motion removes chip animations");
    for (const command of ["step:west", "wait", "step:east"] as Command[]) {
      await guide(page,command);
      await expect(game).toHaveAttribute("data-busy", "false", { timeout: 15000 });
    }
    await expect(bridgeChip).toHaveAttribute("data-holding", "true");
    await expect(asks.locator("[data-motion]")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(asks.locator("[data-motion]")).toHaveCount(0);
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    assert.deepEqual(await page.evaluate(() => window.tidePops), [], "ask status changes stay still; the Home sheet owns the arrival motion");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await guide(page,"return");
    await expect(page.getByRole("dialog", { name: "Home", exact: true })).toBeVisible();
    await expect(panel.locator(".tide-list")).toHaveAttribute("data-arrival", "true");
    await expect(panel.locator(".tide-home-stamp .tide-stamp")).not.toHaveAttribute("data-press", "true");
    assert.deepEqual(await panel.locator(".tide-list .tide-ask-mark, .tide-home-stamp .tide-stamp").evaluateAll(markers => markers.map(marker => getComputedStyle(marker).animationName)), ["none", "none", "none", "none"], "reduced-motion return is present without stamping animations");
    await captureLayouts(page, "classic-reduced-home");
    await panel.getByRole("button", { name: "See the tide log", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "Bram’s tide log", exact: true })).toBeVisible();
    await expect.poll(() => panel.evaluate(node => node.scrollTop)).toBe(0);
    await panel.getByRole("button", { name: "Earlier page", exact: true }).click();
    await expect(panel.getByRole("heading", { name: card.name, exact: true })).toBeVisible();
    await expect(panel.locator(".tide-list")).not.toHaveAttribute("data-arrival", "true");
    await panel.getByRole("button", { name: "Later page", exact: true }).click();
    await expect(panel.getByRole("heading", { name: nextCard.name, exact: true })).toBeVisible();
    await expect(panel.locator(".tide-list")).not.toHaveAttribute("data-arrival", "true");
    await expect(panel.locator(".tide-page-stamp .tide-stamp")).not.toHaveAttribute("data-press", "true");
    await panel.getByRole("button", { name: "Close panel", exact: true }).click();
    await page.getByRole("button", { name: "Open the tide log", exact: true }).and(page.locator(":visible")).click();
    await expect(panel.locator(".tide-list")).not.toHaveAttribute("data-arrival", "true");
    await expect(panel.locator(".tide-page-stamp .tide-stamp")).not.toHaveAttribute("data-press", "true");
    for (const mode of ["harbor", "wake", "outing", "unmarked-outing", "override"] as const) {
      const midnightPage = await browser.newPage({ viewport });
      midnightPage.on("pageerror", error => errors.push(error.message));
      try { await checkMidnight(midnightPage, origin, mode); }
      finally { await midnightPage.close(); }
    }
  } finally {
    await browser.close();
    assert.deepEqual(errors, [], "uncaught browser errors");
  }
  console.info(`${tag}, 390x844, 844x390, 1280x800, 1440x900: daily harbor/ask, cautious run, engine-matched Home/haul/stamps, run log, Bram shelving/tomorrow; classic Chart court, tray/holding layouts, solved/best log, earlier-day range, both restarts, UTC midnight rollover; 44px panels/no sideways overflow passed`);
} finally {
  await server.close();
  console.info(`Screenshots: ${shots}`);
}
