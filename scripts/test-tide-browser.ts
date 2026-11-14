import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { createServer } from "vite";
import { TURN_LIMIT, type Command } from "../web/src/expedition/types";
import { askHolds, cardStatus, replayRun, solve } from "../web/src/tide/asks";
import { askLine, cardForDay, TOOL_NOTE } from "../web/src/tide/cards";
import type { TideEntry } from "../web/src/tide/log";

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
const shots = resolve(process.argv[2] ?? await mkdtemp(join(tmpdir(), "tide-shots-")));
await mkdir(shots, { recursive: true });
const server = await createServer({
  root: resolve(import.meta.dir, "../web"), envDir: false, envPrefix: [],
  cacheDir: await mkdtemp(join(tmpdir(), "familiar-tide-")), logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});

function entryFor(tideDay: number, commands: Command[]): TideEntry {
  const tideCard = cardForDay(tideDay), run = replayRun(tideCard.tool, commands);
  assert.ok(run && run.state.outcome !== "active", "screenshot fixtures are legal finished outings");
  return { day: tideDay, cardId: tideCard.id, tool: tideCard.tool, commands,
    kept: cardStatus(tideCard, run).map(status => status === "kept") as TideEntry["kept"],
    decisions: run.state.turn, outcome: run.state.outcome, late: false, attempts: 1, savedAt: "" };
}

async function capturePair(page: Page, label: string, check?: () => Promise<void>) {
  for (const size of [viewport, { width: 1280, height: 800 }]) {
    await page.setViewportSize(size);
    await check?.();
    await page.screenshot({ path: join(shots, `rev-${label}-${size.width}x${size.height}.png`) });
  }
  await page.setViewportSize(viewport);
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
    await expect(harbor.locator("p").first()).toHaveText(`${card.name}. Three asks for one tide, with the ${card.tool}.`);
    await capturePair(page, "harbor-unsailed", () => checkHarborStamp(page));
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
    await expect(panel.locator(".tide-earlier")).toHaveCount(0);
    await checkPanel(page, "ask card");
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
    assert.ok(await panel.evaluate(panel => {
      const viewport = panel.getBoundingClientRect();
      return [...panel.querySelectorAll(".tide-list .tide-ask-mark, .tide-page-stamp .tide-stamp")].every(marker => {
        const bounds = marker.getBoundingClientRect();
        return bounds.top >= viewport.top && bounds.bottom <= viewport.bottom && bounds.left >= viewport.left && bounds.right <= viewport.right;
      });
    }), "automatic return opens with every arrival marker and the page stamp in view");
    await expect(panel.locator(".tide-sub").first()).toHaveText("1 tide sailed · 3 asks kept · 1 with all three");
    await expect(panel.locator(".tide-facts > div").filter({ has: page.locator("dt", { hasText: /^Decisions$/ }) }).locator("dd")).toHaveText(String(route.length));
    await expect(panel.locator(".tide-facts > div").filter({ has: page.locator("dt", { hasText: /^The Tidekeeper’s way$/ }) }).locator("dd")).toHaveText(`${card.best} decisions`);
    await expect(panel.getByText("Mochi matched the Tidekeeper’s way.", { exact: true })).toBeVisible();
    await expect(panel.locator(".tide-list")).toHaveAttribute("data-arrival", "true");
    assert.deepEqual(await panel.locator(".tide-list .tide-ask-mark").evaluateAll(markers => markers.map(marker => getComputedStyle(marker).animationDelay)), ["0s", "0.12s", "0.24s"]);
    assert.equal(await panel.locator(".tide-page-stamp .tide-stamp").evaluate(stamp => getComputedStyle(stamp).animationDelay), "0.5s");
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
    await capturePair(page, "log-three-kept", async () => {
      await panel.locator(".tide-list").evaluate(asks => asks.scrollIntoView({ block: "end", behavior: "instant" }));
      await checkPanel(page, "three-kept log");
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.deepEqual(await panel.locator(".tide-list .tide-ask-mark, .tide-page-stamp .tide-stamp").evaluateAll(markers => markers.map(marker => getComputedStyle(marker).animationName)), ["none", "none", "none", "none"], "reduced motion removes arrival animations");
    await page.emulateMedia({ reducedMotion: "no-preference" });

    await panel.getByRole("button", { name: "Close panel", exact: true }).click();
    await expect(harbor.getByRole("heading", { name: "All three asks kept.", exact: true })).toBeVisible();
    await expect(harbor.locator(".tide-stamp-seal")).toHaveAttribute("alt", "");
    await checkHarborStamp(page);
    await page.screenshot({ path: join(shots, `harbor-result-${tag}.png`) });
    await expect(harbor.locator("p").first()).toHaveText(`${route.length} decisions: the Tidekeeper’s way. Tomorrow: ${nextCard.name}.`);
    await expect(harbor.locator(".exp-primary")).toHaveText("Open the tide log");
    await capturePair(page, "harbor-all-three", () => checkHarborStamp(page));
    await harbor.getByRole("button", { name: "Take it to Bram", exact: true }).click();
    await expect(panel.getByRole("heading", { name: "“You’re back.”", exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Close panel", exact: true }).click();
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
    await expect(panel.locator(".tide-earlier > ul > li")).toHaveCount(1);
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
    await expect(panel.locator(".tide-list")).not.toHaveAttribute("data-arrival", "true");
    await panel.getByRole("button", { name: "Close panel", exact: true }).click();
    await harbor.locator('[data-action="tide"]').click();
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
      await page.locator(`button[data-command="${command}"]`).click();
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
    await page.locator('button[data-command="wait"]').click();
    await expect(game).toHaveAttribute("data-busy", "false", { timeout: 15000 });
    await expect(restart).toBeEnabled();
    assert.equal(await page.evaluate(() => window.restartBusySeen), true, "restart was disabled during the observed busy window");
    await expect(asks.locator('[data-holding="true"]')).not.toHaveCount(0);
    await expect(asks.locator('[data-status="slipped"] .tide-sr').first()).toHaveText(" (slipped)");
    await capturePair(page, "holding-slipped", () => checkRestartLayout(page, "holding/slipped strip"));
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
    await expect(asks.locator("[data-motion]")).toHaveCount(0);
    assert.equal(await page.evaluate(() => window.tidePops.length), popsBeforeRestart, "restart does not pop the reset strip");

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

    const seedHarbor = async (tideDay: number, log: TideEntry[]) => {
      await page.evaluate(({ saveKey, logKey, pendingKey, log }) => {
        const save = JSON.parse(localStorage.getItem(saveKey)!);
        localStorage.setItem(saveKey, JSON.stringify({ ...save, active: null, last: null }));
        localStorage.setItem(logKey, JSON.stringify(log));
        localStorage.removeItem(pendingKey);
      }, { saveKey, logKey, pendingKey, log });
      await page.goto(new URL(`/outing/?play&tide-day=${tideDay}`, origin).href);
      await expect(world).toHaveAttribute("data-ready", "true", { timeout: 30000 });
      await expect(game).toHaveAttribute("data-mode", "harbor");
    };
    const partialRoute = solve(card.tool, [card.asks[0]])!;
    const partial = entryFor(day, partialRoute), rescued = entryFor(day, Array(9).fill("wait"));
    assert.deepEqual(partial.kept, [true, false, true]);
    assert.equal(rescued.outcome, "rescued");
    for (const [label, entry, title, body] of [
      ["slipped", partial, "One ask slipped.", `Slipped: ${askLine(card.asks[1], card.tool)} Tomorrow: ${nextCard.name}.`],
      ["rescued", rescued, "Bram brought Mochi home.", `The asks can wait for another try. Tomorrow: ${nextCard.name}.`],
    ] as const) {
      await seedHarbor(day, [entry]);
      await expect(harbor.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(harbor.locator("p").first()).toHaveText(body);
      await expect(harbor.locator(".exp-primary")).toHaveText("Sail today’s tide again");
      await expect(harbor.getByRole("button", { name: "Open the tide log", exact: true })).toBeVisible();
      await expect(harbor.getByRole("button", { name: "Take it to Bram", exact: true })).toHaveCount(label === "slipped" ? 1 : 0);
      await capturePair(page, `harbor-${label}`, () => checkHarborStamp(page));
      await harbor.locator(".exp-primary").click();
      await expect(game).toHaveAttribute("data-mode", "court");
      assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), pendingKey), { day, late: false }, `${label}: primary sails today's card directly`);
    }

    const oldDay = day - 2, oldCard = cardForDay(oldDay);
    await seedHarbor(nextDay, [entryFor(oldDay, solve(oldCard.tool, oldCard.asks)!), partial]);
    await harbor.locator(".exp-primary").click();
    await panel.getByText("Earlier tides", { exact: true }).click();
    const rows = panel.locator(".tide-earlier > ul > li");
    await expect(rows).toHaveCount(3);
    const missed = rows.filter({ hasText: "Not sailed" });
    await expect(missed).toHaveCount(1);
    const sailLate = missed.getByRole("button", { name: "Sail late", exact: true });
    await expect(sailLate).toHaveClass("exp-text-button");
    assert.ok(await sailLate.evaluate(button => button.getBoundingClientRect().width < button.closest("li")!.getBoundingClientRect().width / 2), "missed tide's sail action is a small row button");
    await checkPanel(page, "earlier tides with a gap");
    await sailLate.click();
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), pendingKey), { day: day - 1, late: true }, "missed day sails with its own late marker");

    await seedHarbor(nextDay, [partial]);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await harbor.locator(".exp-primary").click();
    await observePops(page);
    await panel.getByRole("button", { name: "Sail today’s tide", exact: true }).click();
    await expect(game).toHaveAttribute("data-mode", "court");
    await expect(asks.locator("[data-motion]")).toHaveCount(0);
    assert.deepEqual(await page.evaluate(() => window.tidePops), [], "holding on first render has no pop");
    const bridgeRoute: Command[] = ["step:west", "wait", "step:east", "wait", "wait", "wait", "step:west", "wait", "step:east"];
    const bridgeChip = asks.locator("li").nth(1);
    for (const [index, command] of bridgeRoute.entries()) {
      await page.locator(`button[data-command="${command}"]`).click();
      await expect(game).toHaveAttribute("data-busy", "false", { timeout: 15000 });
      const holding = askHolds(nextCard.asks[1], replayRun(nextCard.tool, bridgeRoute.slice(0, index + 1))!);
      await expect(bridgeChip).toHaveAttribute("data-holding", String(holding));
      await expect(bridgeChip.locator(".tide-sr")).toHaveText(holding ? " (holding)" : " (not yet)");
      await expect(bridgeChip.locator("svg path")).toHaveCount(holding ? 1 : 0);
      await expect.poll(() => page.evaluate(() => window.tidePops)).toEqual(index < 2 ? [] : index < 8 ? [1] : [1, 1]);
    }
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Another bridge cycle changes the status, with no animation under reduced motion.
    for (const command of ["wait", "wait", "wait"] as Command[]) {
      await page.locator(`button[data-command="${command}"]`).click();
      await expect(game).toHaveAttribute("data-busy", "false", { timeout: 15000 });
    }
    await expect(bridgeChip).toHaveAttribute("data-holding", "false");
    assert.deepEqual(await asks.locator("li").evaluateAll(chips => chips.map(chip => getComputedStyle(chip).animationName)), ["none", "none", "none"], "reduced motion removes chip animations");
    for (const command of ["step:west", "wait", "step:east"] as Command[]) {
      await page.locator(`button[data-command="${command}"]`).click();
      await expect(game).toHaveAttribute("data-busy", "false", { timeout: 15000 });
    }
    await expect(bridgeChip).toHaveAttribute("data-holding", "true");
    await expect(asks.locator("[data-motion]")).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(asks.locator("[data-motion]")).toHaveCount(0);
    await page.evaluate(() => new Promise<void>(done => requestAnimationFrame(() => requestAnimationFrame(() => done()))));
    assert.deepEqual(await page.evaluate(() => window.tidePops), [1, 1], "turning motion back on does not replay a holding transition made under reduced motion");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator('button[data-command="return"]').click();
    await expect(panel.getByRole("heading", { name: "Bram’s tide log", exact: true })).toBeVisible();
    await expect(panel.locator(".tide-list")).toHaveAttribute("data-arrival", "true");
    await expect(panel.locator(".tide-page-stamp .tide-stamp")).toHaveAttribute("data-press", "true");
    assert.deepEqual(await panel.locator(".tide-list .tide-ask-mark, .tide-page-stamp .tide-stamp").evaluateAll(markers => markers.map(marker => getComputedStyle(marker).animationName)), ["none", "none", "none", "none"], "reduced-motion return is present without stamping animations");
    await panel.getByRole("button", { name: "Earlier page", exact: true }).click();
    await expect(panel.getByRole("heading", { name: card.name, exact: true })).toBeVisible();
    await expect(panel.locator(".tide-list")).not.toHaveAttribute("data-arrival", "true");
    await panel.getByRole("button", { name: "Later page", exact: true }).click();
    await expect(panel.getByRole("heading", { name: nextCard.name, exact: true })).toBeVisible();
    await expect(panel.locator(".tide-list")).not.toHaveAttribute("data-arrival", "true");
    await expect(panel.locator(".tide-page-stamp .tide-stamp")).not.toHaveAttribute("data-press", "true");
    await panel.getByRole("button", { name: "Close panel", exact: true }).click();
    await harbor.getByRole("button", { name: "Open the tide log", exact: true }).click();
    await expect(panel.locator(".tide-list")).not.toHaveAttribute("data-arrival", "true");
    await expect(panel.locator(".tide-page-stamp .tide-stamp")).not.toHaveAttribute("data-press", "true");
  } finally {
    await browser.close();
    assert.deepEqual(errors, [], "uncaught browser errors");
  }
  console.info(`${tag} / 1280x800: holding transitions, four harbor states, earlier-day range, arrival stamps, solved outing, unchanged home, title entry and both restart paths passed`);
} finally {
  await server.close();
  console.info(`Screenshots: ${shots}`);
}
