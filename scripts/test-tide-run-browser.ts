/** A fresh device harbor sails the three story tides and today's tide run, leaving and reloading one of them half way. */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { createServer } from "vite";
import { VALUE, applyMove, startTide, type Move, type TideStart } from "../web/src/run/engine";
import { bramsGuess, cautiousMove } from "../web/src/run/bot";
import { storyStart } from "../web/src/run/story";

const KEY: Record<Move, string> = { north: "ArrowUp", south: "ArrowDown", west: "ArrowLeft", east: "ArrowRight", wait: "Space", home: "r" };
/** The cautious bot's route. In a story tide it wants the chapter's prize above everything. */
function route(start: TideStart) {
  let state = startTide(start);
  const keys: string[] = [];
  while (state.outcome === "active") {
    const move = cautiousMove(state, start.story ? { ...VALUE, [start.story]: 60 } : VALUE);
    keys.push(KEY[move]); state = applyMove(state, move)!.after;
  }
  return { keys, state };
}

const cacheDir = await mkdtemp(join(tmpdir(), "familiar-tide-run-"));
const server = await createServer({
  root: resolve(import.meta.dir, "../web"), envDir: false, envPrefix: [], cacheDir, logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
const bookKey = "familiar.expedition.local.v2:tide-run.v1";
try {
  await server.listen();
  const origin = new URL(server.resolvedUrls!.local[0]!);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/*", request => new URL(request.request().url()).origin === origin.origin && !/^\/(?:api|npc-api)\//.test(new URL(request.request().url()).pathname) ? request.continue() : request.abort());

    const run = page.getByTestId("tide-run"), link = page.locator('[data-action="tide-run"]'), title = page.locator(".exp-departure h1");
    const harbor = () => expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready", "true");
    const passTitle = async () => {
      await expect(page.getByTestId("opening")).toHaveAttribute("data-mode", "title");
      await page.keyboard.press("Enter");
      await page.locator('[data-plank="continue"],[data-plank="new"]').click();
      await expect(page.getByTestId("opening")).toHaveCount(0);
    };
    const press = async (keys: readonly string[]) => {
      await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready", "true");
      for (const key of keys) { await expect(run).toHaveAttribute("data-busy", "false"); await page.keyboard.press(key); }
      await expect(run).toHaveAttribute("data-busy", "false");
    };
    const home = () => page.evaluate(() => JSON.parse(localStorage.getItem("familiar.expedition.local.v2")!).home as { banked: string[] });
    async function sail(start: TideStart, from = 0) {
      const { keys, state } = route(start);
      await press(keys.slice(from));
      await expect(run).toHaveAttribute("data-outcome", state.outcome);
      await expect(run).toHaveAttribute("data-score", String(state.score));
      await page.getByTestId("tide-finish").click();
      await harbor();
      return state;
    }

    await page.goto(new URL("/outing/", origin).href);
    await passTitle(); await harbor();
    await expect(title).toHaveText("First light.");
    await expect(page.locator('[data-action="depart"]')).toBeVisible();
    await page.locator('[data-action="story"]').click();
    await expect(run).toHaveAttribute("data-story", "lens");
    await sail(storyStart("lens"));
    await expect(title).toHaveText("The lens is home.");
    assert.deepEqual((await home()).banked, ["lens"]);
    await page.locator('[data-action="home-next"]').click();
    await page.getByRole("button", { name: "Restore the beacon" }).click();

    // The lit harbor keeps the Tidekeeper's ask; the next chapter sits beside it.
    await expect(title).toHaveText("The Tidekeeper has an ask.");
    await expect(link).toHaveAttribute("title", "Chapter 2: What the tide brings");
    await link.click();
    await press(route(storyStart("vane")).keys.slice(0, 3));
    await page.reload();
    await passTitle();
    await expect(run).toHaveAttribute("data-beat", "3");
    await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("tide-leave").click();
    await harbor();
    await expect(link).toHaveAttribute("title", "Return to the tide Mochi left");
    await link.click();
    await expect(run).toHaveAttribute("data-beat", "3");
    await sail(storyStart("vane"), 3);
    await expect(link).toHaveAttribute("title", "Fit the Signal Vane");
    await link.click();
    await page.getByRole("button", { name: "Repair the signal post" }).click();

    await expect(link).toHaveAttribute("title", "Chapter 3: The last thing");
    await link.click();
    await sail(storyStart("moth"));
    assert.deepEqual((await home()).banked, ["lens", "vane", "moth"]);

    await link.click();
    const day = Number(await run.getAttribute("data-seed"));
    assert.equal(day, await page.evaluate(() => Math.floor(Date.now() / 86_400_000)));
    const daily = await sail({ seed: day });
    await expect(page.getByTestId("expedition-feedback").first()).toHaveText(`Banked ${daily.score}. Bram guessed ${bramsGuess(day)}.`);
    await expect(link).toHaveText(`Tide run: ${daily.score}`);
    const book = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), bookKey);
    assert.equal(book.active, null);
    assert.deepEqual(book.days.map((entry: { seed: number; moves: string[] }) => [entry.seed, entry.moves.length]), [[day, daily.moves.length]]);
    await expect(title).toHaveText("The Tidekeeper has an ask.");
    assert.deepEqual(errors, []);
    console.info("tide run: three story tides, leave, reload and resume, and today's tide passed on a device harbor");
  } finally { await browser.close(); }
} finally { await server.close(); }
