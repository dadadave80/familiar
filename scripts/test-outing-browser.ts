import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { createServer } from "vite";
import type { Action } from "../web/src/outing/engine";

const captures = await mkdtemp(join(tmpdir(), "familiar-beacon-browser-"));
const web = resolve(import.meta.dir, "../web");
const server = await createServer({ root: web, envDir: false, envPrefix: [], logLevel: "error", server: { host: "127.0.0.1", port: 0 } });

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const action = (page: Page, value: string) => page.locator(`[data-action="${value}"]`);
const scene = (page: Page) => page.getByTestId("outing-scene");

async function play(page: Page, moves: readonly Action[]) {
  for (const move of moves) await action(page, move).click();
}

async function capture(page: Page, name: string) {
  // Screenshots describe the next choice after the brief input guard has released.
  if (await action(page, "wait").count()) await expect(action(page, "wait")).toBeEnabled();
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map(image => image.decode()));
  });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name + " fits the viewport");
  const small = await page.locator("button:visible, summary:visible, .of-kits label:visible").evaluateAll(nodes =>
    nodes.filter(node => {
      const {width, height} = node.getBoundingClientRect();
      return width < 44 || height < 44;
    }).map(node => node.textContent?.trim()));
  assert.deepEqual(small, [], name + " controls have 44px touch targets");
  await page.screenshot({ path: join(captures, name + ".png"), fullPage: true });
}

async function dryOuting(page: Page) {
  await capture(page, "desktop-harbor");
  await action(page, "depart").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Low tide" })).toBeFocused();
  await button(page, "Inspect Left").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/A crack runs through this shell/)).toBeVisible();
  await expect(page.getByText("Turn 1 of 15")).toBeVisible();
  await button(page, "Close inspection").click();
  await action(page, "wait").evaluate(node => {
    const control = node as HTMLButtonElement;
    control.click();
    control.click();
  });
  await expect(page.getByText("Turn 2 of 15")).toBeVisible();
  await play(page, ["move:left"]);
  await expect(page.getByText(/wave will strike Left/i)).toBeVisible();
  await expect(action(page, "move:right")).toBeDisabled();
  await page.reload();
  await expect(page.getByText("Turn 3 of 15")).toBeVisible();
  await expect(page.getByText(/wave will strike Left/i)).toBeVisible();
  await expect(page.getByTestId("mochi-actor")).toHaveAttribute("data-pose", "brace");
  await capture(page, "desktop-locked");
  await play(page, ["move:center"]);
  await expect(page.getByText(/left shell split open.*stayed dry/i)).toBeVisible();
  await expect(page.getByTestId("mochi-actor")).toHaveAttribute("data-pose", "relieved");
  await play(page, ["reel:lens"]);
  await expect(page.getByTestId("mochi-actor")).toHaveAttribute("data-pose", "pull-in");
  await play(page, ["return"]);
  await expect(page.getByRole("heading", { name: "The lens is home." })).toBeVisible();
  await expect(scene(page)).toHaveAttribute("data-lit", "false");
  await action(page, "install").click();
  await expect(scene(page)).toHaveAttribute("data-lit", "true");
  await button(page, "Try the two-shell challenge").click();
  await expect(page.getByText(/Open both shells with the Rope/i)).toBeVisible();
  await button(page, "Start challenge").click();
  await page.reload();
  await expect(page.getByText(/two-shell challenge: open both shells/i)).toBeVisible();
  await play(page, ["wait", "move:left", "move:center", "move:right", "wait", "move:center", "move:right", "take:moth", "move:center", "return"]);
  await expect(page.getByText(/two-shell challenge complete/i)).toBeVisible();
  await expect(page.getByText("Wind-moth in the garden")).toBeVisible();
  await button(page, "Make a challenge").click();
  const invite = page.getByLabel("Challenge invitation");
  const text = await invite.inputValue();
  assert.match(text, /10 turns/);
  assert.match(text, /both shells/i);
  assert.doesNotMatch(text, /https?:\/\/|move:|reel:|0x[0-9a-f]{20,}/i);
  // Capture the browser Clipboard API payload without overwriting a developer's clipboard.
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (value: string) => { document.documentElement.dataset.copiedInvite = value; } },
  }));
  await button(page, "Copy invitation").click();
  await expect(page.locator("html")).toHaveAttribute("data-copied-invite", text);
  await button(page, "Rest at the harbor").click();
  await expect(scene(page)).toHaveAttribute("data-lit", "true");
  await expect(page.getByTestId("mochi-actor")).toHaveAttribute("data-pose", "neutral");
  await expect(action(page, "wait")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Wind-moth in the garden")).toBeVisible();
  await expect(page.getByText(/little wings all the way home/i)).toBeVisible();
  await capture(page, "desktop-restored-garden");
}

async function lanternOuting(page: Page) {
  await page.getByRole("radio", {name:/Lantern/}).check();
  await action(page, "depart").click();
  await expect(button(page, "Lure wave")).toBeDisabled();
  await play(page, ["wait", "wait"]);
  await expect(page.getByText(/wave will strike Center/i)).toBeVisible();
  await button(page, "Lure wave").click();
  await action(page, "lure:right").focus();
  await page.keyboard.press("Escape");
  await expect(button(page, "Lure wave")).toBeFocused();
  await expect(page.getByText("Turn 3 of 15")).toBeVisible();
  await button(page, "Lure wave").click();
  await play(page, ["lure:right"]);
  await expect(page.getByText(/right shell split open.*stayed dry/i)).toBeVisible();
  await play(page, ["move:left", "wait", "wait"]);
  await expect(page.getByText(/left shell split open.*2 Resolve left/i)).toBeVisible();
  await expect(page.getByTestId("mochi-actor")).toHaveAttribute("data-pose", "startled");
  await expect(page.getByText(/Beacon Lens is exposed/i)).toBeVisible();
  // The browser may still register a reduced 0.001ms animation before its first frame.
  const durations = await scene(page).evaluate(stage =>
    stage.getAnimations({subtree:true}).map(animation => Number(animation.effect?.getComputedTiming().endTime)));
  assert(durations.every(duration => duration <= 16), "No sustained movement under reduced motion");
  await capture(page, "mobile-mixed-wave");
  await play(page, ["take:lens", "move:center", "return"]);
  await page.reload();
  await expect(scene(page)).toHaveAttribute("data-lit", "false");
  await expect(action(page, "install")).toBeVisible();
  await action(page, "install").click();
  await expect(scene(page)).toHaveAttribute("data-lit", "true");
  await expect(page.getByText(/wrung out my scarf/i)).toBeVisible();
  await page.reload();
  await expect(scene(page)).toHaveAttribute("data-lit", "true");
  await action(page, "depart").click();
  const circuit: Action[] = ["wait", "move:left", "move:center", "wait", "move:right", "move:center"];
  await play(page, [...circuit, ...circuit]);
  await expect(page.getByText(/3 actions left, including the return/i)).toBeVisible();
  await play(page, ["wait", "move:left", "move:center"]);
  await expect(page.getByRole("heading", {name:"The tide closed in."})).toBeVisible();
  await expect(scene(page)).toHaveAttribute("data-lit","true");
  await expect(page.getByText(/tide closed the route.*satchel is empty/i)).toBeVisible();
  await capture(page, "mobile-flood-refuge");
}

async function temporaryOuting(page: Page) {
  await expect(page.getByText(/storage unavailable/i)).toBeVisible();
  await button(page, "Accept two-shell challenge").click();
  await button(page, "Start challenge").click();
  for (let i = 0; i < 9; i++) await play(page, ["wait"]);
  await expect(page.getByRole("heading", {name:"Carried home."})).toBeVisible();
  await button(page,"Try again").click();
  await action(page,"depart").click();
  await expect(page.getByText("Turn 1 of 15")).toBeVisible();
  await play(page, ["return"]);
  await button(page,"Rest at the harbor").click();
  await capture(page, "small-mobile-safe-stop");
  await page.reload();
  await expect(page.getByRole("heading",{name:"The broken beacon."})).toBeVisible();
}

try {
  await server.listen();
  const address = server.httpServer?.address();
  assert(address && typeof address === "object");
  const origin = "http://127.0.0.1:" + address.port;
  const browser = await chromium.launch();
  try {
    for (const [width, height, scenario] of [[1440, 900, dryOuting], [390, 844, lanternOuting], [320, 750, temporaryOuting]] as const) {
      const context = await browser.newContext({
        viewport: {width, height}, reducedMotion: width === 1440 ? "no-preference" : "reduce",
      });
      const page = await context.newPage();
      const errors: string[] = [], forbidden: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || /^\/(api|npc-api)(\/|$)/.test(url.pathname)) {
          forbidden.push(url.href);
          return route.abort();
        }
        return route.continue();
      });
      if (width === 320) {
        await context.addInitScript(() => Object.defineProperty(window,"localStorage", {
          get() { throw new DOMException("Unavailable", "SecurityError"); },
        }));
      }
      await page.goto(origin + "/outing" + (width === 320 ? "?challenge=two-shells-v1" : ""));
      await expect(page.getByRole("heading",{name:"The broken beacon."})).toBeVisible();
      await scenario(page);
      if (width !== 320) {
        const keys = await page.evaluate(() => Object.keys(localStorage));
        assert.deepEqual(keys, ["familiar.first-light.beacon.v1"], "Only the outing's save was written");
      }
      assert.deepEqual(errors, [], "No browser exceptions");
      assert.deepEqual(forbidden, [], "No external, RPC, or legacy backend requests");
      await context.close();
      console.log(`PASS ${width}×${height} ${scenario.name}`);
    }
  } finally {
    await browser.close();
  }
  console.log("Outing screenshots:", captures);
} finally {
  await server.close();
}
