import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { createServer } from "vite";
import { TURN_LIMIT, type Command } from "../web/src/expedition/types";
import { cardStatus, replayRun, solve } from "../web/src/tide/asks";
import { askLine, cardForDay, TOOL_NOTE } from "../web/src/tide/cards";

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
const shots = resolve(process.argv[2] ?? await mkdtemp(join(tmpdir(), "tide-shots-")));
await mkdir(shots, { recursive: true });
const server = await createServer({
  root: resolve(import.meta.dir, "../web"), envDir: false, envPrefix: [],
  cacheDir: await mkdtemp(join(tmpdir(), "familiar-tide-")), logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});

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
    const heading = node.querySelector("h1")!, button = node.querySelector(".exp-primary")!.getBoundingClientRect();
    const text = [heading, node.querySelector("p")!].flatMap(element => {
      const range = document.createRange(); range.selectNodeContents(element); return [...range.getClientRects()];
    });
    return getComputedStyle(stamp).getPropertyValue("--stamp") === "72px"
      && (innerWidth !== 412 || heading.getBoundingClientRect().height <= parseFloat(getComputedStyle(heading).lineHeight) * 2 + 1)
      && text.every(rect => rect.right <= bounds.left || rect.bottom <= bounds.top || rect.top >= bounds.bottom)
      && bounds.bottom <= button.top;
  }), "harbor stamp is 72px, title uses at most two lines at 412px, and stamp overlaps neither text nor primary action");
}

async function checkRestartLayout(page: Page, label: string) {
  const asks = page.locator(".tide-asks"), restart = page.locator(".tide-outing > .tide-restart.exp-text-button");
  const strip = await asks.boundingBox(), button = await restart.boundingBox();
  const hud = await page.locator('.exp-hud[aria-label="Expedition status"]').boundingBox();
  const controls = await page.locator(".exp-command-tray").boundingBox();
  assert.ok(strip && button && hud && controls, `${label}: asks, restart, HUD and controls have visible bounds`);
  assert.ok(strip.y >= hud.y + hud.height, `${label}: asks stay below the status HUD`);
  assert.ok(button.y >= strip.y + strip.height, `${label}: restart stays below the asks`);
  assert.ok(button.x >= strip.x - 1 && button.x + button.width <= strip.x + strip.width + 1, `${label}: restart stays in the asks column`);
  assert.ok(button.y + button.height <= controls.y, `${label}: restart stays above court controls`);
  assert.ok(button.height >= 44, `${label}: restart has a 44px target`);
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

try {
  await server.listen();
  const origin = server.resolvedUrls!.local[0]!;
  const browser = await chromium.launch();
  const errors: string[] = [];
  try {
    const page = await browser.newPage({ viewport });
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
    await expect(harbor.getByRole("heading", { name: "The Tidekeeper has an ask.", exact: true })).toBeVisible();
    await expect(harbor).toContainText(card.name);
    await expect(harbor.locator(".tide-stamp img")).toHaveAttribute("alt", "");
    await checkHarborStamp(page);
    await page.screenshot({ path: join(shots, `harbor-ask-${tag}.png`) });
    await page.setViewportSize({ width: 1280, height: 800 });
    await checkHarborStamp(page);
    await page.screenshot({ path: join(shots, "harbor-ask-1280x800.png") });
    await page.setViewportSize(viewport);

    await harbor.locator('[data-action="tide"]').click();
    await expect(panel.getByRole("heading", { name: "Today’s tide", exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: card.name, exact: true })).toBeVisible();
    await expect(panel).toContainText(TOOL_NOTE[card.tool]);
    for (const ask of card.asks) await expect(panel.getByText(askLine(ask, card.tool), { exact: true })).toBeVisible();
    await checkPanel(page, "ask card");
    await page.screenshot({ path: join(shots, `ask-card-${tag}.png`) });

    await panel.getByRole("button", { name: "Sail today’s tide", exact: true }).click();
    await expect(game).toHaveAttribute("data-mode", "court");
    const active = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), saveKey);
    assert.equal(active.active.season, true);
    assert.deepEqual(active.active.state.banked, []);
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "null"), pendingKey), { day, late: false });
    const asks = page.locator(".tide-asks");
    await expect(asks).toBeVisible();
    await expect(asks.locator("li[data-status]")).toHaveCount(3);
    for (const [index, command] of route.entries()) {
      await page.locator(`button[data-command="${command}"]`).click();
      await expect(game).toHaveAttribute("data-busy", "false", { timeout: 15000 });
      if (index + 1 === Math.ceil(route.length / 2)) {
        await expect(asks).toBeVisible();
        const strip = await asks.boundingBox(), hud = await page.locator('.exp-hud[aria-label="Expedition status"]').boundingBox();
        assert.ok(strip && hud, "the asks and status HUD have visible bounds");
        assert.ok(strip.y >= hud.y + hud.height, "the asks do not overlap the status HUD");
        assert.ok(strip.x >= 0 && strip.x + strip.width <= viewport.width + 1, "the asks fit the viewport width");
        await page.screenshot({ path: join(shots, `court-mid-outing-${tag}.png`) });
      }
    }

    await expect(game).toHaveAttribute("data-mode", "harbor", { timeout: 15000 });
    await expect(panel.getByRole("heading", { name: "Bram’s tide log", exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: card.name, exact: true })).toBeVisible();
    await expect(panel.locator('.tide-list > li[data-kept="true"]')).toHaveCount(3);
    await expect(panel.locator(".tide-page-stamp .tide-stamp")).toHaveAttribute("data-press", "true");
    await expect(panel.locator(".tide-sub").first()).toHaveText("1 tide sailed · 3 asks kept · 1 with all three");
    await expect(panel.locator(".tide-facts > div").filter({ hasText: "Decisions" }).locator("dd")).toHaveText(String(route.length));
    await expect(panel.locator(".tide-facts > div").filter({ hasText: "The Tidekeeper’s way" }).locator("dd")).toHaveText(String(card.best));
    const entries = await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]"), logKey);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].day, day);
    assert.equal(entries[0].cardId, card.id);
    assert.deepEqual(entries[0].kept, [true, true, true]);
    assert.equal(entries[0].decisions, route.length);
    assert.equal(entries[0].outcome, "returned");
    assert.deepEqual(entries[0].commands, route);
    assert.equal(await page.evaluate(key => localStorage.getItem(key), pendingKey), null);
    await checkPanel(page, "log page");
    await expect(panel.locator(".tide-home")).toHaveText("home", { timeout: 15000 });
    await page.screenshot({ path: join(shots, `log-page-${tag}.png`) });

    await panel.getByRole("button", { name: "Close panel", exact: true }).click();
    await expect(harbor.getByRole("heading", { name: "Today’s tide is in the log.", exact: true })).toBeVisible();
    await expect(harbor.locator(".tide-stamp-seal")).toHaveAttribute("alt", "");
    await checkHarborStamp(page);
    await page.screenshot({ path: join(shots, `harbor-result-${tag}.png`) });
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).home, saveKey), before, "the tide outing leaves home progress unchanged");

    await page.goto(new URL(`/outing/?play&tide-day=${nextDay}`, origin).href);
    await expect(world).toHaveAttribute("data-ready", "true", { timeout: 30000 });
    await expect(harbor.getByRole("heading", { name: "The Tidekeeper has an ask.", exact: true })).toBeVisible();
    await expect(harbor).toContainText(nextCard.name);
    await expect(harbor).not.toContainText(card.name);
    await harbor.locator('[data-action="tide"]').click();
    await expect(panel.getByRole("heading", { name: nextCard.name, exact: true })).toBeVisible();
    await expect(panel).toContainText(TOOL_NOTE[nextCard.tool]);
    for (const ask of nextCard.asks) await expect(panel.getByText(askLine(ask, nextCard.tool), { exact: true })).toBeVisible();
    await page.screenshot({ path: join(shots, `harbor-next-day-${tag}.png`) });
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!).home, saveKey), before, "next day leaves home progress unchanged");

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(new URL(`/outing/?tide-day=${nextDay}`, origin).href);
    const opening = page.getByTestId("opening");
    await expect(opening).toHaveAttribute("data-mode", "title", { timeout: 30000 });
    await page.keyboard.press("Enter");
    await opening.getByRole("menuitem", { name: "Today’s Tide", exact: true }).click();
    const titleTide = opening.getByRole("dialog", { name: "Today’s Tide", exact: true });
    await expect(titleTide.getByText("One ask a day from the Tidekeeper, on a fresh Beacon Court.", { exact: true })).toBeVisible();
    await titleTide.getByRole("button", { name: "Continue to today’s ask", exact: true }).click();
    await expect(opening).toHaveCount(0, { timeout: 30000 });
    await expect(world).toHaveAttribute("data-ready", "true", { timeout: 30000 });
    await expect(panel.getByRole("heading", { name: "Today’s tide", exact: true })).toBeVisible();
    await expect(panel.getByRole("heading", { name: nextCard.name, exact: true })).toBeVisible();

    await panel.getByRole("button", { name: "Open the tide log", exact: true }).click();
    await expect(panel.locator(".tide-page-stamp .tide-stamp")).not.toHaveAttribute("data-press", "true");
    await panel.getByRole("button", { name: "Close panel", exact: true }).click();
    await harbor.locator('[data-action="tide"]').click();
    await panel.getByText("Earlier tides", { exact: true }).click();
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
      await page.locator(`button[data-command="${command}"]`).click();
      await expect(game).toHaveAttribute("data-busy", "false", { timeout: 15000 });
    }
    await expect(asks.locator('li[data-status="slipped"]')).not.toHaveCount(0);
    await expect(restart).toHaveText("Start this tide over");
    await page.locator('button[data-command="wait"]').click();
    await expect(restart).toBeDisabled();
    await expect(game).toHaveAttribute("data-busy", "false", { timeout: 15000 });
    await expect(restart).toBeEnabled();
    await checkRestartLayout(page, tag);
    await page.screenshot({ path: join(shots, `restart-${tag}.png`) });
    await page.setViewportSize({ width: 1280, height: 800 });
    await checkRestartLayout(page, "1280x800");
    await page.screenshot({ path: join(shots, "restart-1280x800.png") });
    await page.setViewportSize(viewport);
    await restart.click();

    const assertRestarted = async (label: string) => {
      await expect(game).toHaveAttribute("data-mode", "court");
      await expect(game).toHaveAttribute("data-busy", "false");
      await expect(asks.locator('li[data-status="open"]')).toHaveCount(3);
      // The HUD numbers the next decision, so an untouched outing shows 1/24.
      await expect(page.locator('.exp-hud[aria-label="Expedition status"] strong > span').last()).toHaveText(`1/${TURN_LIMIT}`);
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

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator('button[data-command="wait"]').click();
    await expect(game).toHaveAttribute("data-busy", "false", { timeout: 15000 });
    await page.getByRole("button", { name: "Game menu", exact: true }).click();
    const menuRestart = panel.getByRole("button", { name: "Start this tide over", exact: true });
    const back = panel.getByRole("button", { name: "Back to Mochi", exact: true });
    await expect(menuRestart).toBeVisible();
    const menuButton = await menuRestart.boundingBox(), backButton = await back.boundingBox();
    assert.ok(menuButton && backButton && menuButton.y + menuButton.height <= backButton.y, "menu restart is above Back to Mochi");
    await menuRestart.click();
    await expect(panel).toHaveCount(0);
    await assertRestarted("menu restart");
  } finally {
    await browser.close();
    assert.deepEqual(errors, [], "uncaught browser errors");
  }
  console.info(`${tag} / 1280x800: daily ask, solved outing, tide log, unchanged home, next day, title entry and both restart paths passed`);
} finally {
  await server.close();
  console.info(`Screenshots: ${shots}`);
}
