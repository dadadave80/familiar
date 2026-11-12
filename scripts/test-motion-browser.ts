import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { MOCHI_POSES, type MochiPoseName } from "../web/src/motion/mochi";

const origin = "http://127.0.0.1:5186";
const captures = join(tmpdir(), "familiar-motion-browser");
const browser = await chromium.launch();
const server = Bun.spawn(
  ["bun", "--no-env-file", "run", "dev", "--port", "5186", "--strictPort"],
  {
    stdout: "ignore",
    stderr: "inherit",
    env: {
      ...process.env,
      VITE_NEAR_RPC_URL: "https://motion-forbidden.invalid",
      VITE_NEAR_ROOT: "motion-fixture.testnet",
      VITE_RELAYER_URL: "/api",
      VITE_NPC_URL: "/npc-api",
      VITE_NEAR_AUTH_CLIENT_ID: "",
    },
  },
);

const status = (page: Page) => page.getByTestId("motion-status");
const time = async (page: Page) => Number(await status(page).getAttribute("data-time"));
const settle = (page: Page) => page.evaluate(() => new Promise<void>((resolve) =>
  requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
));

async function seek(page: Page, milliseconds: number) {
  await page.getByRole("slider", { name: "Scrub animation", exact: true }).evaluate((input, value) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setValue.call(input, String(value));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, milliseconds);
  await expect.poll(() => time(page)).toBe(milliseconds);
  await settle(page);
}

async function actorSnapshot(page: Page) {
  return page.getByTestId("mochi-actor").evaluate((actor) => ({
    pose: actor.getAttribute("data-pose"),
    frame: actor.getAttribute("data-frame"),
    position: getComputedStyle(actor).transform,
    body: getComputedStyle(actor.querySelector(".mochi-body")!).transform,
    crop: getComputedStyle(actor.querySelector(".mochi-atlas")!).transform,
  }));
}

async function expectPose(page: Page, milliseconds: number, pose: MochiPoseName) {
  await seek(page, milliseconds);
  const actor = page.getByTestId("mochi-actor");
  await expect(actor).toHaveAttribute("data-pose", pose);
  await expect(actor).toHaveAttribute("data-frame", String(MOCHI_POSES[pose].frame));
  const crop = await actor.evaluate((element) => {
    const image = element.querySelector<HTMLImageElement>(".mochi-atlas")!;
    const cell = element.querySelector<HTMLElement>(".mochi-cell")!;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(image).transform);
    const frame = Number(element.getAttribute("data-frame"));
    return {
      overflow: getComputedStyle(cell).overflow,
      horizontalError: Math.abs(matrix.e + (frame % 4) * cell.clientWidth),
      verticalError: Math.abs(matrix.f + Math.floor(frame / 4) * cell.clientHeight),
      columns: image.clientWidth / cell.clientWidth,
      rows: image.clientHeight / cell.clientHeight,
    };
  });
  assert.equal(crop.overflow, "hidden", "Atlas cells do not spill into neighboring poses");
  assert(crop.horizontalError < 2 && crop.verticalError < 2, "Atlas crop shows the selected registered cell");
  assert(Math.abs(crop.columns - 4) < .1 && Math.abs(crop.rows - 4) < .1, "Atlas renders as a four-by-four pose sheet");
}

async function expectPawAttached(page: Page, pose: MochiPoseName) {
  const distance = await page.evaluate(({ x, y }) => {
    const body = document.querySelector<HTMLElement>(".mochi-body")!;
    const cell = body.querySelector<HTMLElement>(".mochi-cell")!;
    const path = document.querySelector<SVGPathElement>(".motion-rope path")!;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(body).transform);
    const [originX, originY] = getComputedStyle(body).transformOrigin.split(" ").map(Number.parseFloat);
    const point = new DOMPoint(x * cell.offsetWidth - originX!, y * cell.offsetHeight - originY!)
      .matrixTransform(matrix);
    // offsetLeft/Top are untransformed; restore the body's transform origin in its actor.
    const actor = body.parentElement!.getBoundingClientRect();
    const pawX = actor.left + point.x + originX!;
    const pawY = actor.top + point.y + originY!;
    const start = path.getPointAtLength(0).matrixTransform(path.getScreenCTM()!);
    return Math.hypot(start.x - pawX, start.y - pawY);
  }, MOCHI_POSES[pose].paw);
  assert(distance < 2, `Reel line starts at the displayed ${pose} paw (${distance.toFixed(2)}px)`);
}

async function expectPaused(page: Page, message: string) {
  await expect(status(page), message).toHaveAttribute("data-playing", "false");
  await settle(page);
  const before = await time(page);
  const beforeActor = await actorSnapshot(page);
  await page.waitForTimeout(180);
  assert.equal(await time(page), before, message);
  assert.deepEqual(await actorSnapshot(page), beforeActor, `${message}: Mochi pose and atlas crop also freeze`);
  const runningAnimations = await page.getByTestId("motion-stage").evaluate((stage) =>
    stage.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length,
  );
  assert.equal(runningAnimations, 0, `${message}: ambient animation also pauses`);
}

async function expectFinished(page: Page) {
  const duration = Number(await status(page).getAttribute("data-duration"));
  assert(Number.isFinite(duration) && duration > 0, "Selected clip has a finite positive duration");
  await expect(status(page)).toHaveAttribute("data-playing", "false");
  await expect.poll(() => time(page)).toBe(duration);
}

try {
  await mkdir(captures, { recursive: true });
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(server.exitCode, null, "Motion browser server exited before readiness.");
    try {
      if ((await fetch(origin)).ok) break;
    } catch {}
    if (attempt === 99) throw new Error("Motion browser server did not start.");
    await Bun.sleep(100);
  }

  for (const [width, height, label] of [
    [320, 844, "small-mobile"],
    [390, 844, "mobile"],
    [1440, 1000, "desktop"],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    const failedAssets: string[] = [];
    const forbiddenRequests: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) failedAssets.push(`${response.status()} ${response.url()}`);
    });
    await context.addInitScript(() => {
      localStorage.setItem("familiar.guest.v1", "motion-fixture-identity-preserved");
    });
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || /^\/(?:api|npc-api)(?:\/|$)/.test(url.pathname)) {
        forbiddenRequests.push(url.href);
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });

    await page.goto(`${origin}/motion`);
    await page.getByRole("heading", { name: "First Light, in motion.", exact: true }).waitFor();
    await page.getByTestId("motion-stage").waitFor();
    const play = page.getByRole("button", { name: "Play", exact: true });
    await expect(play).toBeEnabled();
    await expectPaused(page, `${label}: no autoplay before a gesture`);
    await page.evaluate(() => document.fonts.ready);
    const brokenImages = await page.evaluate(async () => {
      const images = Array.from(document.images);
      await Promise.all(images.map((image) => image.decode().catch(() => {})));
      return images.filter((image) => !image.naturalWidth).map((image) => image.src);
    });
    assert.deepEqual(brokenImages, [], `${label}: scene and character images decode`);
    await expect(page.locator(".mochi-atlas")).toHaveJSProperty("naturalWidth", 1024);
    await expect(page.locator(".mochi-atlas")).toHaveJSProperty("naturalHeight", 1024);
    await expect(page.locator(".mochi-atlas")).toHaveAttribute("src", /\/mochi-poses-v1\.webp$/);
    await settle(page);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      `${label}: no document-level horizontal overflow`);
    const smallTargets = await page.locator("button:visible, input[type=range]:visible, select:visible")
      .evaluateAll((elements) => elements.filter((element) => {
        const bounds = element.getBoundingClientRect();
        return bounds.height < 44 || bounds.width < 44;
      }).map((element) => element.getAttribute("aria-label") || element.textContent?.trim()));
    assert.deepEqual(smallTargets, [], `${label}: controls have 44px touch targets`);
    await page.screenshot({ path: join(captures, `${label}-idle.png`), fullPage: true });

    await play.focus();
    await page.keyboard.press("Enter");
    await expect(status(page)).toHaveAttribute("data-playing", "true");
    await expect.poll(() => time(page)).toBeGreaterThan(100);
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await expectPaused(page, `${label}: Pause freezes the sequence`);

    const slider = page.getByRole("slider", { name: "Scrub animation", exact: true });
    await slider.focus();
    await page.keyboard.press("End");
    await expectFinished(page);
    await page.keyboard.press("Home");
    await expect.poll(() => time(page)).toBe(0);
    await expectPaused(page, `${label}: seeking does not silently start playback`);

    const replay = page.getByRole("button", { name: "Replay", exact: true });
    await replay.click();
    await replay.click();
    await replay.click();
    await expect(status(page)).toHaveAttribute("data-playing", "true");
    await page.getByRole("button", { name: "Finish", exact: true }).click();
    await expectFinished(page);
    await expectPaused(page, `${label}: Finish cancels all earlier replays`);
    await page.screenshot({ path: join(captures, `${label}-finished.png`), fullPage: true });

    const clips = ["dodge", "lure", "reel", "echo", "vane", "hit", "beacon", "idle", "moth"];
    await expect(page.locator("button[data-motion-clip]")).toHaveCount(clips.length);
    const initialClip = await status(page).getAttribute("data-clip");
    assert(initialClip && clips.includes(initialClip), `${label}: initial clip is in the chooser`);
    const clipOrder = [...clips.filter((clip) => clip !== initialClip), initialClip];
    await replay.click();
    for (const clip of clipOrder) {
      const choice = page.locator(`button[data-motion-clip="${clip}"]`);
      await choice.focus();
      await page.keyboard.press("Enter");
      await expect(choice).toHaveAttribute("aria-pressed", "true");
      await expect(status(page)).toHaveAttribute("data-clip", clip);
      await expect.poll(() => time(page)).toBe(0);
      await expectPaused(page, `${label}: selecting ${clip} cancels the previous sequence`);
      const openingShell = page.locator(".shell-barrier[data-open]");
      const intactShell = page.locator(".shell-barrier:not([data-open])");
      if (["dodge", "lure", "reel"].includes(clip)) {
        await expect(openingShell).toHaveAttribute("data-open", clip === "reel" ? "1" : "0");
        await expect(openingShell.locator("img")).toHaveCount(2);
        await expect(intactShell.locator("img")).toHaveCount(1);
        await expect(intactShell.locator("img")).toHaveCSS("transform", "none");
      }
      if (clip === "dodge") {
        await expectPose(page, 900, "look-right");
        const headLead = await actorSnapshot(page);
        await expectPose(page, 1200, "turn-right");
        await page.getByTestId("motion-stage").screenshot({ path: join(captures, `${label}-mochi-turn.png`) });
        await expectPose(page, 1400, "turn-right");
        for (const [at, pose] of [
          [1500, "walk-contact-a"], [1675, "walk-pass-a"],
          [1800, "walk-contact-b"], [1850, "walk-pass-b"],
        ] as const) {
          await expectPose(page, at, pose);
          await expectPaused(page, `${label}: ${pose} is frozen at the chosen walk contact`);
          await page.getByTestId("motion-stage").screenshot({ path: join(captures, `${label}-mochi-${pose}.png`) });
        }
        await expectPose(page, 2250, "turn-right");
        await expectPose(page, 900, "look-right");
        assert.deepEqual(await actorSnapshot(page), headLead, `${label}: reverse scrubbing restores the exact earlier turn pose`);
      }
      if (clip === "reel") {
        await expectPose(page, 250, "turn-left");
        await expectPose(page, 600, "reach-ready");
        await expectPawAttached(page, "reach-ready");
        await expectPose(page, 1000, "reach-left");
        await expectPawAttached(page, "reach-left");
        await page.getByTestId("motion-stage").screenshot({ path: join(captures, `${label}-mochi-reach.png`) });
        await expectPose(page, 1500, "pull-in");
        await expectPawAttached(page, "pull-in");
        await page.getByTestId("motion-stage").screenshot({ path: join(captures, `${label}-mochi-pull.png`) });
        await expectPose(page, 3800, "relieved");
        await expectPose(page, 1000, "reach-left");
        await expectPaused(page, `${label}: reversing from stow restores the reaching pose and line`);
      }
      if (clip === "hit") {
        await expectPose(page, 2250, "startled");
        await expect(page.locator(".motion-scene-art")).toHaveAttribute("aria-label", /Resolve: 2 of 3\./);
        await page.getByTestId("motion-stage").screenshot({ path: join(captures, `${label}-mochi-startle.png`) });
        await expectPose(page, 2800, "brace");
        await page.getByTestId("motion-stage").screenshot({ path: join(captures, `${label}-mochi-recovery.png`) });
        await expectPose(page, 3500, "relieved");
        await page.getByRole("checkbox", { name: "Reduced motion", exact: true }).check();
        await expectPose(page, 2250, "brace");
        await expect(page.locator(".mochi-body")).toHaveCSS("transform", "matrix(1, 0, 0, 1, 0, 0)");
        await expect(page.locator(".motion-scene-art")).toHaveAttribute("aria-label", /Resolve: 2 of 3\./);
        await expectPaused(page, `${label}: reduced impact presents a planted pose without recoil`);
        await page.getByRole("checkbox", { name: "Reduced motion", exact: true }).uncheck();
      }
      if (clip === "moth") {
        await expectPose(page, 1400, "look-right");
        await expectPose(page, 2300, "curious");
        await page.getByTestId("motion-stage").screenshot({ path: join(captures, `${label}-mochi-curious.png`) });
      }
      if (label === "desktop" && clip === "dodge") {
        // Send the same native input event as scrubbing, at a deterministic impact instant.
        await seek(page, 3500);
        const openness = Number(await openingShell.getAttribute("data-open"));
        assert(openness > 0 && openness < 1, "Impact scrubbing presents a partly opened shell");
        const transforms = await openingShell.locator("img").evaluateAll((halves) =>
          halves.map((half) => getComputedStyle(half).transform),
        );
        assert.notEqual(transforms[0], transforms[1], "The shell halves separate in different directions");
        await expectPaused(page, "Scrubbing the shell opening preserves the chosen instant");
      }
      await replay.click();
      await expect(status(page)).toHaveAttribute("data-playing", "true");
      if (clip === "dodge" || clip === "lure") {
        await expect(openingShell).toHaveAttribute("data-open", "0");
      }
      if (label === "desktop" && clip === "reel") {
        const duration = Number(await status(page).getAttribute("data-duration"));
        await expect(status(page), "The Reel sequence completes naturally").toHaveAttribute(
          "data-playing", "false", { timeout: duration + 2000 },
        );
      } else {
        await page.getByRole("button", { name: "Finish", exact: true }).click();
      }
      await expectFinished(page);
      if (clip === "hit") await expect(status(page)).toContainText("2 of 3 Resolve");
      if (clip === "reel") await expect(status(page)).toContainText("safely stowed");
      if (["dodge", "lure", "reel"].includes(clip)) {
        await expect(openingShell).toHaveAttribute("data-open", "1");
        await expect(intactShell.locator("img")).toHaveCSS("transform", "none");
      }
      if (clip === "vane") {
        await expect(status(page)).toContainText("Signal Vane");
        await expect(page.locator(".motion-lens")).toHaveCSS("opacity", "0");
      }
      if (label === "desktop" && clip === "lure") {
        await page.getByRole("checkbox", { name: "Reduced motion", exact: true }).check();
        await replay.click();
        await expectFinished(page);
        await expect(openingShell).toHaveAttribute("data-open", "1");
        await page.getByRole("checkbox", { name: "Reduced motion", exact: true }).uncheck();
      }
      if (label === "desktop") {
        await page.getByTestId("motion-stage").screenshot({ path: join(captures, `${clip}-finished.png`) });
      }
    }

    await page.getByRole("checkbox", { name: "Reduced motion", exact: true }).check();
    await expect(page.getByTestId("motion-stage")).toHaveAttribute("data-reduced", "true");
    await replay.click();
    await expectFinished(page);
    await expect(page.locator(".shell-barrier[data-open]")).toHaveAttribute("data-open", "1");
    const runningStageAnimations = await page.getByTestId("motion-stage").evaluate((stage) =>
      stage.getAnimations({ subtree: true }).filter((animation) => animation.playState === "running").length,
    );
    assert.equal(runningStageAnimations, 0, `${label}: reduced motion leaves no running ambient animation`);
    await page.getByRole("checkbox", { name: "Reduced motion", exact: true }).uncheck();

    await replay.click();
    await expect(status(page)).toHaveAttribute("data-playing", "true");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, value: true });
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expectPaused(page, `${label}: simulated hidden document pauses playback`);
    await page.evaluate(() => {
      delete (document as unknown as Record<string, unknown>).hidden;
      delete (document as unknown as Record<string, unknown>).visibilityState;
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await expectPaused(page, `${label}: visibility restoration does not autoplay`);

    await replay.click();
    await expect(status(page)).toHaveAttribute("data-playing", "true");
    await expect(page.getByTestId("motion-stage"), `${label}: replay keeps its scene visible`).toBeInViewport();
    await page.evaluate(() => {
      const spacer = document.createElement("div");
      spacer.id = "motion-test-scroll-space";
      spacer.style.height = "200vh";
      document.body.append(spacer);
      window.scrollTo(0, document.documentElement.scrollHeight);
    });
    await expectPaused(page, `${label}: offscreen scene pauses playback`);
    await page.evaluate(() => document.querySelector("#motion-test-scroll-space")?.remove());
    await page.getByTestId("motion-stage").scrollIntoViewIfNeeded();
    await expectPaused(page, `${label}: scrolling back does not autoplay`);

    const storage = await page.evaluate(() => ({
      original: localStorage.getItem("familiar.guest.v1"),
      identityKeys: Object.keys(localStorage).filter((key) =>
        /guest|identity|wallet|auth|account|private|secret|credential/i.test(key),
      ),
    }));
    assert.equal(storage.original, "motion-fixture-identity-preserved", `${label}: legacy identity untouched`);
    assert.deepEqual(storage.identityKeys, ["familiar.guest.v1"], `${label}: preview creates no identity or signing storage`);
    assert.deepEqual(forbiddenRequests, [], `${label}: preview needs no external or backend service`);
    assert.deepEqual(failedAssets, [], `${label}: all local assets load successfully`);
    assert.deepEqual(errors, [], `${label}: no browser exceptions`);
    await context.close();
    console.info(`PASS ${label} ${width}×${height}: responsive controls, keyboard, interruption, reduced motion, hidden/offscreen pause and isolated identity`);
  }

  const reducedContext = await browser.newContext({ reducedMotion: "reduce" });
  const reducedPage = await reducedContext.newPage();
  const freshRequests: string[] = [];
  await reducedPage.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin || /^\/(?:api|npc-api)(?:\/|$)/.test(url.pathname)) {
      freshRequests.push(url.href);
      return route.abort("blockedbyclient");
    }
    return route.continue();
  });
  await reducedPage.goto(`${origin}/motion`);
  await expect(reducedPage.getByTestId("motion-stage")).toHaveAttribute("data-reduced", "true");
  await expect(reducedPage.getByRole("checkbox", { name: "Reduced motion", exact: true })).toBeChecked();
  await reducedPage.getByRole("button", { name: "Replay", exact: true }).click();
  await expectFinished(reducedPage);
  assert.deepEqual(await reducedPage.evaluate(() => Object.keys(localStorage).filter((key) =>
    /guest|identity|wallet|auth|account|private|secret|credential/i.test(key),
  )), [], "Fresh preview creates no identity");
  assert.deepEqual(freshRequests, [], "Fresh preview needs no external or backend service");
  await reducedContext.close();
  console.info("PASS system reduced-motion preference");

  for (const [filename, selector, label] of [
    ["arena.webp", ".motion-backdrop", "scene"],
    ["mochi-poses-v1.webp", ".mochi-atlas", "mochi-atlas"],
  ] as const) {
    const recoveryContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const recoveryPage = await recoveryContext.newPage();
    let imageAvailable = false;
    const recoveryRequests: string[] = [];
    await recoveryPage.route("**/*", (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || /^\/(?:api|npc-api)(?:\/|$)/.test(url.pathname)) {
        recoveryRequests.push(url.href);
        return route.abort("blockedbyclient");
      }
      if (url.pathname.endsWith(`/first-light-motion/${filename}`) && !imageAvailable) {
        return route.fulfill({ status: 503, body: `Simulated ${label} outage`, contentType: "text/plain" });
      }
      return route.continue();
    });
    await recoveryPage.goto(`${origin}/motion`);
    await expect(recoveryPage.getByText("The scene art couldn’t load.", { exact: true })).toBeVisible();
    await expect(recoveryPage.getByRole("button", { name: "Play", exact: true })).toBeDisabled();
    await recoveryPage.screenshot({ path: join(captures, `mobile-${label}-error.png`), fullPage: true });
    imageAvailable = true;
    await recoveryPage.getByRole("button", { name: "Try again", exact: true }).focus();
    await recoveryPage.keyboard.press("Enter");
    await expect(recoveryPage.getByRole("button", { name: "Play", exact: true })).toBeEnabled();
    await expect.poll(() => recoveryPage.locator(selector).evaluate((image) =>
      (image as HTMLImageElement).naturalWidth,
    ), { message: `Retry restores the visible ${label} image, not only preloader state` }).toBeGreaterThan(0);
    await recoveryPage.getByRole("button", { name: "Replay", exact: true }).click();
    await expect.poll(() => time(recoveryPage)).toBeGreaterThan(100);
    await recoveryPage.getByRole("button", { name: "Pause", exact: true }).click();
    await expectPaused(recoveryPage, `Recovered ${label} supports normal playback`);
    await recoveryPage.screenshot({ path: join(captures, `mobile-${label}-recovered.png`), fullPage: true });
    assert.deepEqual(recoveryRequests, [], `${label} retry needs no backend or external service`);
    await recoveryContext.close();
    console.info(`PASS injected ${label} outage, accessible retry and recovered playback`);
  }
  console.info(`Captures: ${captures}`);
} finally {
  await browser.close();
  server.kill();
  await server.exited;
}
