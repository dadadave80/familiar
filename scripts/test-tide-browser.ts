import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { createServer } from "vite";
import { solve } from "../web/src/tide/asks";
import { askLine, cardForDay, TOOL_NOTE } from "../web/src/tide/cards";

const day = 20771, card = cardForDay(day), route = solve(card.tool, card.asks, card.best);
assert.ok(route, "today’s card has a solution");
assert.equal(route.length, card.best, "the route uses the card’s best decision count");
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
  define: { "import.meta.env.VITE_SEASON2_ENABLED": JSON.stringify("true") },
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
    await page.screenshot({ path: join(shots, `harbor-ask-${tag}.png`) });

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
  } finally {
    await browser.close();
    assert.deepEqual(errors, [], "uncaught browser errors");
  }
  console.info(`${tag}: daily ask, solved outing, tide log, unchanged home, next day and title entry passed`);
} finally {
  await server.close();
  console.info(`Screenshots: ${shots}`);
}
