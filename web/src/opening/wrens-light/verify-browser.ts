/** Bun browser checks. The contract fixture is explicitly not the real Slice B integration. */
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, webkit, type Page, type Route } from "@playwright/test";
import { createServer } from "vite";
import { WRENS_LIGHT_SCENES } from "./wrens-light-scenes";

const artifacts = await mkdtemp(join(tmpdir(), "familiar-opening-browser-"));
const failures: string[] = [], requests: string[] = [], errors: string[] = [];
const integrationUrl = process.env.OPENING_INTEGRATION_URL;
const harness = `
import React, {useLayoutEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import Opening,{WRENS_LIGHT_DISSOLVE_MS} from '/src/opening/wrens-light/WrensLightSequence.tsx';
import {preloadWrensLight} from '/src/opening/wrens-light/opening-preload.ts';
preloadWrensLight();
window.__openingCheck = {complete:0,skip:0,focus:[],dissolveMs:WRENS_LIGHT_DISSOLVE_MS,release:()=>{}};
function Harness(){
  const [requested,setRequested]=useState(false),[ready,setReady]=useState(false),[ended,setEnded]=useState(false);
  const heading=useRef(null);
  window.__openingCheck.release=()=>setReady(true);
  useLayoutEffect(()=>{if(requested && !location.search.includes('hold')) setReady(true);},[requested]);
  useLayoutEffect(()=>{if(ended) heading.current?.focus({preventScroll:true});},[ended]);
  const request=reason=>{window.__openingCheck[reason]++;setRequested(true);};
  return React.createElement(React.Fragment,null,
    React.createElement('section',{inert:!ended,'aria-hidden':!ended},
      React.createElement('h1',{ref:heading,tabIndex:-1,'data-testid':'contract-destination'},'Contract destination')),
    !ended && React.createElement(Opening,{onComplete:()=>request('complete'),onSkip:()=>request('skip'),
      destinationReady:ready,onExited:()=>setEnded(true)}));
}
document.addEventListener('focusin',event=>{
  if(event.target.matches('.wl-reading h1')) window.__openingCheck.focus.push(event.target.textContent);
});
createRoot(document.getElementById('root')).render(React.createElement(React.StrictMode,null,React.createElement(Harness)));
`;
const server = await createServer({
  configFile: false, root: resolve(import.meta.dir, "../../.."), envDir: false, envPrefix: [],
  cacheDir: join(artifacts, "vite-cache"), logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
  plugins: [{
    name: "opening-contract-check",
    resolveId(id) { if (id === "virtual:opening-check") return "\0virtual:opening-check"; },
    load(id) { if (id === "\0virtual:opening-check") return harness; },
    configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        if (request.url?.split("?")[0] !== "/__opening-check") return next();
        response.setHeader("Content-Type", "text/html");
        response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0"><div id="root"></div><script type="module" src="/@id/__x00__virtual:opening-check"></script></body></html>');
      });
    },
  }],
});

type CheckState = { complete: number; skip: number; focus: string[]; dissolveMs: number; release(): void };
const state = (page: Page) => page.evaluate(() => (window as unknown as { __openingCheck: CheckState }).__openingCheck);
const caption = (page: Page) => page.locator(".wl-reading h1");
const next = (page: Page) => page.locator(".wl-next");
const frame = (page: Page) => page.locator(".wl-opening").getAttribute("data-scene");
const art = (page: Page) => page.locator(".wl-current");

async function check(label: string, action: () => Promise<void>) {
  try { await action(); console.log(`PASS ${label}`); }
  catch (error) { failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`); }
}

async function ready(page: Page, origin: string, hold = false) {
  await page.goto(`${origin}/__opening-check${hold ? "?hold" : ""}`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => document.fonts.ready);
  await expect(caption(page)).toBeFocused();
  await expect.poll(() => art(page).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
}

async function settle(page: Page) {
  // Wait for every active film animation, including any future camera animation.
  await page.locator(".wl-opening").evaluate(async root => {
    await Promise.all(root.getAnimations({ subtree: true }).filter(animation => animation.playState !== "paused").map(animation => animation.finished.catch(() => {})));
  });
}

async function geometry(page: Page) {
  const issues = await page.locator(".wl-opening").evaluate(root => {
    const found: string[] = [];
    for (const button of root.querySelectorAll<HTMLButtonElement>("button")) {
      const box = button.getBoundingClientRect();
      if (!box.width || !box.height) continue;
      const label = button.getAttribute("aria-label") ?? button.textContent?.trim();
      if (box.width < 43.9 || box.height < 43.9) found.push(`${label}: target ${box.width}×${box.height}`);
      if (box.left < -.5 || box.top < -.5 || box.right > innerWidth + .5 || box.bottom > innerHeight + .5) found.push(`${label}: outside viewport`);
    }
    const reading = root.querySelector<HTMLElement>(".wl-reading")!;
    if (reading.tabIndex !== -1) found.push("Reading region must not add a Tab stop");
    if (reading.scrollWidth > reading.clientWidth + 1) found.push("Reading overflows horizontally");
    const heading = root.querySelector<HTMLElement>(".wl-caption")!, dots = root.querySelector<HTMLElement>(".wl-pages")!;
    if (Math.abs(heading.getBoundingClientRect().left - dots.getBoundingClientRect().left) > 1) found.push("Caption and progress do not share a left edge");
    if (innerWidth === 844 && innerHeight === 390 && root.getAttribute("data-scene") === "rowing-out"
      && root.querySelector(".wl-next")!.getBoundingClientRect().right > 340) found.push("Continue enters the rowing subject safe area");
    reading.scrollTop = reading.scrollHeight;
    const last = [...reading.querySelectorAll<HTMLElement>("h1,p")].filter(node => !node.className.includes("sr") && node.textContent?.trim()).at(-1);
    if (last && last.getBoundingClientRect().bottom > reading.getBoundingClientRect().bottom + 1) found.push("Final caption line is unreachable");
    reading.scrollTop = 0;
    return found;
  });
  assert.deepEqual(issues, []);
}

async function tabCircuit(page: Page) {
  await caption(page).focus();
  const buttons = page.locator(".wl-opening button:not([disabled])");
  const count = await buttons.count();
  assert(count > 0);
  for (let index = 0; index < count; index++) { await page.keyboard.press("Tab"); await expect(buttons.nth(index)).toBeFocused(); }
  await page.keyboard.press("Tab"); await expect(buttons.first()).toBeFocused();
  for (let index = count - 1; index >= 0; index--) { await page.keyboard.press("Shift+Tab"); await expect(buttons.nth(index)).toBeFocused(); }
}

async function captionFocus(page: Page) {
  await caption(page).focus();
  await page.keyboard.press("Home");
  await expect(caption(page)).toBeFocused();
  const issues = await caption(page).evaluate(heading => {
    const found: string[] = [], style = getComputedStyle(heading);
    const width = parseFloat(style.outlineWidth), offset = parseFloat(style.outlineOffset);
    if (style.outlineStyle === "none" || width < 3) found.push("Caption needs a complete, substantial keyboard focus perimeter");
    if (offset < 10) found.push("Caption focus needs at least 10px of clearance");
    const box = heading.getBoundingClientRect(), reading = heading.closest(".wl-reading")!.getBoundingClientRect();
    const extent = Math.max(0, width + offset);
    if (box.left - extent < Math.max(0, reading.left) - .5 || box.right + extent > Math.min(innerWidth, reading.right) + .5
      || box.top - extent < Math.max(0, reading.top) - .5 || box.bottom + extent > Math.min(innerHeight, reading.bottom) + .5) {
      found.push("Caption focus perimeter is clipped by its reading region or viewport");
    }
    return found;
  });
  assert.deepEqual(issues, []);
}

async function completeFilm(page: Page, requestExit = true) {
  for (let index = 0; index < WRENS_LIGHT_SCENES.length - 1; index++) {
    await next(page).click();
    await expect.poll(() => frame(page)).toBe(WRENS_LIGHT_SCENES[index + 1].id);
  }
  if (requestExit) await next(page).click();
}

await server.listen();
const origin = server.resolvedUrls!.local[0]!.replace(/\/$/, "");
console.log(`Opening browser evidence: ${artifacts}`);
try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const newPage = async (width = 390, height = 844, reducedMotion: "reduce" | "no-preference" = "no-preference", deviceScaleFactor = 1) => {
        const page = await browser.newPage({ viewport: { width, height }, reducedMotion, hasTouch: width < 900, deviceScaleFactor });
        page.on("pageerror", error => errors.push(`${engine.name()}: ${error.message}`));
        await page.route("**/*", route => {
          const url = new URL(route.request().url());
          if (url.origin !== origin || /^\/(api|npc-api|rpc)(\/|$)/.test(url.pathname)) { requests.push(url.href); return route.abort(); }
          return route.continue();
        });
        return page;
      };
      for (const [width, height] of [[390, 844], [844, 390], [390, 480], [1440, 900]]) {
        for (const reduced of [false, true]) {
          const label = `${engine.name()} ${width}×${height} ${reduced ? "reduced" : "motion"}`;
          const page = await newPage(width, height, reduced ? "reduce" : "no-preference");
          await check(label, async () => {
            if (!reduced) await page.clock.install();
            await ready(page, origin);
            for (const [index, scene] of WRENS_LIGHT_SCENES.entries()) {
              if (index > 0 && !reduced) {
                // Freeze both clocks before starting the edit: the fallback timer must not remove the layer during capture.
                await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
                const pauseStyle = await page.addStyleTag({ content: ".wl-reveal, .wl-previous, .wl-light { animation-play-state: paused !important; }" });
                await next(page).click();
                await expect.poll(() => frame(page)).toBe(scene.id);
                for (const fraction of scene.edit === "light" ? [.25, .44, .49, .5, .51, .56, .75] : [.25, .5, .75]) {
                  await page.locator(".wl-opening").evaluate((root, fraction) => {
                    for (const animation of root.getAnimations({ subtree: true })) {
                      const duration = Number(animation.effect?.getTiming().duration);
                      if (duration > 0) { animation.pause(); animation.currentTime = duration * fraction; }
                    }
                    const outgoing = root.querySelector(".wl-previous")!, incoming = root.querySelector(".wl-reveal")!;
                    if (root.getAttribute("data-edit") === "dip") {
                      if (+getComputedStyle(outgoing).opacity > 0 && +getComputedStyle(incoming).opacity > 0) throw new Error("Unregistered plates share an exposure");
                    }
                    if (root.getAttribute("data-edit") === "light") {
                      const incomingStyle = getComputedStyle(incoming), light = root.querySelector(".wl-light");
                      const incomingOpacity = +incomingStyle.opacity, outgoingOpacity = +getComputedStyle(outgoing).opacity;
                      if (![0, 1].includes(incomingOpacity) || incomingOpacity + outgoingOpacity !== 1) throw new Error("Warm plates must cut without sharing an exposure");
                      if (!light) throw new Error("Warm reveal needs its light bloom");
                      const lightStyle = getComputedStyle(light);
                      if (!lightStyle.backgroundImage.includes("radial-gradient(")) throw new Error("Warm reveal needs spatial light texture");
                      if (fraction >= .44 && fraction <= .56) {
                        if (+lightStyle.opacity !== 1 || lightStyle.mixBlendMode !== "normal" || lightStyle.maskImage !== "none") throw new Error("The complete plate switch must be covered by opaque light");
                        if (!/^rgb\(/.test(lightStyle.backgroundColor)) throw new Error("The light veil needs an opaque backing");
                      }
                    }
                  }, fraction);
                  await page.screenshot({ path: join(artifacts, `${engine.name()}-${width}-${height}-${scene.id}-t${fraction * 100}.png`) });
                }
                await pauseStyle.evaluate(node => node.parentNode?.removeChild(node));
                await page.locator(".wl-opening").evaluate(root => { for (const animation of root.getAnimations({ subtree: true })) animation.play(); });
                await page.clock.resume();
              } else if (index > 0) await next(page).click();
              await expect.poll(() => frame(page)).toBe(scene.id);
              await settle(page);
              await page.screenshot({ path: join(artifacts, `${engine.name()}-${width}-${height}-${scene.id}-${reduced ? "still" : "settled"}.png`) });
              await geometry(page); await tabCircuit(page);
              await captionFocus(page);
              await page.screenshot({ path: join(artifacts, `${engine.name()}-${width}-${height}-${scene.id}-focus-${reduced ? "still" : "motion"}.png`) });
              await caption(page).click();
              assert.equal(await caption(page).evaluate(node => getComputedStyle(node).outlineStyle), "none", "Pointer input clears the caption's keyboard-only ring");
              assert.equal(await frame(page), scene.id, "Reading the caption does not advance the film");
              await expect(page.locator(".wl-pages span")).toHaveCount(7);
            }
            await next(page).click();
            await expect(page.getByTestId("contract-destination")).toBeFocused();
            const result = await state(page); assert.equal(result.complete + result.skip, 1);
          });
          await page.close();
        }
      }
      for (const exit of ["complete", "skip", "escape"] as const) for (const reduced of [false, true]) {
        const page = await newPage(390, 844, reduced ? "reduce" : "no-preference");
        await check(`${engine.name()} controlled delayed ${exit}, reduced=${reduced}`, async () => {
          await page.clock.install();
          await ready(page, origin, true);
          if (exit === "complete") { await completeFilm(page, false); await settle(page); }
          await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
          if (exit === "complete") await next(page).click();
          else if (exit === "skip") await page.locator(".wl-skip").click();
          else await page.keyboard.press("Escape");
          await expect.poll(() => frame(page)).toBe(exit === "complete" ? "mochi-quay" : "storm");
          await expect(art(page)).toHaveAttribute("data-plate", exit === "complete" ? "mochi-quay" : "storm");
          await expect(page.getByTestId("contract-destination")).not.toBeFocused();
          await expect(page.locator("section")).toHaveAttribute("inert", "");
          await expect(next(page)).toHaveText("Opening…");
          await expect(next(page)).toHaveAttribute("aria-busy", "true");
          await expect(page.locator(".wl-reading")).not.toContainText("Preparing");
          await expect(page.locator(".wl-wait")).toBeVisible();
          await expect(page.locator(".wl-exit-status[role='status']")).toContainText("Opening the harbor");
          const headingBefore = await caption(page).boundingBox();
          const { dissolveMs } = await state(page);
          await page.clock.runFor(1500);
          assert.deepEqual(await caption(page).boundingBox(), headingBefore, "Busy feedback must not move the caption");
          await tabCircuit(page);
          await page.evaluate(() => (window as unknown as { __openingCheck: CheckState }).__openingCheck.release());
          if (!reduced && exit === "complete") {
            await expect(page.locator(".wl-opening")).toHaveAttribute("data-revealing", "true");
            const midpoint = await page.locator(".wl-opening").evaluate((root, midpointMs) => {
              for (const animation of root.getAnimations({ subtree: true })) {
                const duration = Number(animation.effect?.getTiming().duration);
                if (duration > 0) { animation.pause(); animation.currentTime = Math.min(midpointMs, duration); }
              }
              return { film: +getComputedStyle(root).opacity,
                top: +getComputedStyle(root.querySelector(".wl-top")!).opacity,
                bottom: +getComputedStyle(root.querySelector(".wl-bottom")!).opacity };
            }, dissolveMs / 2);
            assert(midpoint.film > 0 && midpoint.film < 1, "Film remains in its 600ms dissolve at midpoint");
            assert(midpoint.top <= .01 && midpoint.bottom <= .01, "Controls and captions leave before the film midpoint");
            await expect(page.locator(".wl-wait")).toHaveCount(0);
            await page.screenshot({ path: join(artifacts, `${engine.name()}-${exit}-exit-mid.png`) });
            await page.locator(".wl-opening").evaluate(root => { for (const animation of root.getAnimations({ subtree: true })) animation.play(); });
            await page.clock.runFor(dissolveMs);
          }
          await expect(page.getByTestId("contract-destination")).toBeFocused();
          const result = await state(page); assert.equal(result.complete + result.skip, 1);
        });
        await page.close();
      }
      for (const [width, height, dpr, expected] of [
        [1440, 900, 1, "storm-landscape.webp"],
        [1440, 900, 2, "storm-landscape-2880.webp"],
        [390, 844, 3, "storm.webp"],
        [844, 390, 3, "storm-landscape.webp"],
      ] as const) {
        const page = await newPage(width, height, "reduce", dpr), held: Route[] = [], seen: string[] = [];
        await check(`${engine.name()} ${width}×${height} DPR ${dpr} chooses only its first plate`, async () => {
          page.on("request", request => {
            const path = new URL(request.url()).pathname;
            if (path.startsWith("/assets/opening/")) seen.push(path);
          });
          await page.route(`**/assets/opening/${expected}`, route => { held.push(route); });
          await page.goto(`${origin}/__opening-check`, { waitUntil: "domcontentloaded" });
          await expect(page.locator(".wl-loading")).toBeVisible();
          await expect.poll(() => held.length).toBeGreaterThan(0);
          assert.deepEqual(seen, [`/assets/opening/${expected}`], "First image has no competing orientation, resolution or next-scene request");
          await page.unroute(`**/assets/opening/${expected}`);
          for (const route of held) await route.continue();
          await expect.poll(() => art(page).evaluate((image: HTMLImageElement) => image.complete && image.currentSrc)).toBe(`${origin}/assets/opening/${expected}`);
          const expectedNext = width >= 650 ? "beacon-dark-landscape" : "beacon-dark";
          await expect.poll(() => seen.some(path => path.includes(expectedNext))).toBe(true);
          assert.deepEqual(seen.filter(path => /\/storm[^/]*\.webp$/.test(path)), [`/assets/opening/${expected}`], "Decoded rendering reuses the first fetch");
          if (width < 1024) assert(seen.every(path => !path.includes("-2880.webp")), "Phone loading never gains the desktop derivative");
        });
        for (const route of held) await route.abort().catch(() => {});
        await page.close();
      }
      const keyboard = await newPage();
      await check(`${engine.name()} canceled artwork gestures retain scoped keyboard focus`, async () => {
        await ready(keyboard, origin);
        for (const key of ["Enter", "Space", "ArrowRight"]) {
          const current = await frame(keyboard);
          await keyboard.mouse.move(180, 180);
          await keyboard.mouse.down();
          await keyboard.locator(".wl-world").dispatchEvent("pointercancel", { pointerId: 1, isPrimary: true });
          await keyboard.mouse.up();
          await expect(caption(keyboard)).toBeFocused();
          assert.equal(await frame(keyboard), current);
          await keyboard.keyboard.press(key);
          await expect.poll(() => frame(keyboard)).not.toBe(current);
          await expect(caption(keyboard)).toBeFocused();
        }
        await tabCircuit(keyboard);
      });
      await keyboard.close();
      for (const reduced of [false, true]) {
        const page = await newPage(390, 844, reduced ? "reduce" : "no-preference");
        await check(`${engine.name()} indefinite reading, reduced=${reduced}`, async () => {
          await page.clock.install(); await ready(page, origin);
          await page.clock.runFor(120_000);
          assert.equal(await frame(page), "storm", "Two minutes never advances a caption");
        });
        await page.close();
      }
      const pending = await newPage(), held: Route[] = [];
      const cold = await newPage(), first: Route[] = [];
      await check(`${engine.name()} cold first plate has a poster, cue and no competing next request`, async () => {
        const seen: string[] = [];
        cold.on("request", request => { seen.push(new URL(request.url()).pathname); });
        await cold.route("**/assets/opening/storm.webp", route => { first.push(route); });
        await cold.goto(`${origin}/__opening-check`, { waitUntil: "domcontentloaded" });
        await expect(cold.locator(".wl-loading")).toHaveText("Bringing the harbor into view…");
        await expect(cold.locator(".wl-placeholder img")).toHaveAttribute("src", /^data:image\/webp;base64,/);
        await expect(caption(cold)).toBeFocused();
        assert.equal(await caption(cold).evaluate(node => getComputedStyle(node).outlineStyle), "none");
        await next(cold).click({ force: true });
        assert.equal(await frame(cold), "storm");
        assert(!seen.includes("/assets/opening/beacon-dark.webp"));
        await cold.screenshot({ path: join(artifacts, `${engine.name()}-cold-first-poster.png`) });
        for (const route of first) await route.continue();
        await expect(cold.locator(".wl-loading")).toHaveCount(0);
        await expect(next(cold)).toHaveText("Continue");
        assert.equal(await frame(cold), "storm");
        await expect.poll(() => seen.includes("/assets/opening/beacon-dark.webp")).toBe(true);
      });
      for (const route of first) await route.abort().catch(() => {});
      await cold.close();
      await check(`${engine.name()} pending image retains focus and visible feedback`, async () => {
        await pending.route("**/assets/opening/beacon-dark.webp", route => { held.push(route); });
        await ready(pending, origin);
        await pending.locator(".wl-world").click({ position: { x: 180, y: 180 } });
        await expect(caption(pending)).toBeFocused();
        await expect(next(pending)).toContainText("Preparing…");
        for (const key of ["Enter", "Space", "ArrowRight"]) { await pending.keyboard.press(key); assert.equal(await frame(pending), "storm"); }
        await pending.keyboard.press("Escape");
        await expect(pending.getByTestId("contract-destination")).toBeFocused();
      });
      for (const route of held) await route.abort().catch(() => {});
      await pending.close();
      const enlarged = await newPage(390, 480, "reduce");
      await check(`${engine.name()} enlarged reading remains reachable`, async () => {
        await ready(enlarged, origin);
        await enlarged.locator(".wl-reading h1,.wl-reading p,.wl-opening button").evaluateAll(elements => {
          for (const element of elements) (element as HTMLElement).style.setProperty("font-size", `${parseFloat(getComputedStyle(element).fontSize) * 2}px`, "important");
        });
        await geometry(enlarged); await tabCircuit(enlarged);
        await caption(enlarged).focus(); await enlarged.keyboard.press("End");
        await enlarged.screenshot({ path: join(artifacts, `${engine.name()}-200-percent.png`) });
      });
      await enlarged.close();

      // This path visits the integrator's actual app; it never substitutes a destination.
      if (integrationUrl) for (const exit of ["complete", "skip", "escape"] as const) for (const cache of ["cold", "warm"] as const) for (const reduced of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: reduced ? "reduce" : "no-preference" });
        await check(`${engine.name()} REAL prologue ${exit} ${cache}, reduced=${reduced}`, async () => {
          const heldAssets: Route[] = [];
          if (cache === "cold") await page.route("**/assets/**", route => {
            const path = new URL(route.request().url()).pathname;
            if (!path.includes("/opening/") && /\.(png|jpe?g|webp|avif|gif|mp3|ogg|wav|m4a)$/i.test(path)) {
              heldAssets.push(route); return;
            }
            return route.continue();
          });
          await page.goto(integrationUrl, { waitUntil: "domcontentloaded" });
          if (cache === "warm") {
            await page.locator(".wl-skip").click();
            await expect(page.locator(".wl-opening")).toHaveCount(0);
            await expect(page.getByRole("heading", { name: "Keep Wren’s Light", exact: true })).toBeFocused();
            await page.reload({ waitUntil: "domcontentloaded" });
          }
          await expect(caption(page)).toBeFocused(); await tabCircuit(page);
          const before = await frame(page);
          await page.mouse.move(180, 180); await page.mouse.down();
          await page.locator(".wl-world").dispatchEvent("pointercancel", { pointerId: 1, isPrimary: true });
          await page.mouse.up();
          await expect(caption(page)).toBeFocused();
          assert.equal(await frame(page), before, "Canceled real-route artwork gesture must not advance");
          if (exit === "complete") await completeFilm(page);
          else if (exit === "skip") await page.locator(".wl-skip").click();
          else await page.keyboard.press("Escape");
          if (cache === "cold") {
            await expect.poll(() => heldAssets.some(route => new URL(route.request().url()).pathname.startsWith("/assets/expedition/runtime/"))).toBe(true);
            await expect(page.locator(".wl-opening")).toBeVisible();
            await page.unroute("**/assets/**");
            for (const route of heldAssets) await route.continue();
          }
          await expect(page.locator(".wl-opening")).toHaveCount(0);
          const prologue = page.getByRole("heading", { name: "Keep Wren’s Light", exact: true });
          await expect(prologue).toBeFocused();
          await expect(page.getByRole("button", { name: "Help Mochi", exact: true })).toBeVisible();
          await expect(page.getByRole("button", { name: "Skip introduction", exact: true })).toBeVisible();
          await expect(page.getByText("Use buttons", { exact: true })).toBeVisible();
          await page.screenshot({ path: join(artifacts, `${engine.name()}-real-${exit}-${cache}-${reduced ? "still" : "motion"}.png`) });
        });
        await page.close();
      }
    } finally { await browser.close(); }
  }
} finally { await server.close(); }
if (!integrationUrl) console.log("NOT RUN: real Slice B integration. Set OPENING_INTEGRATION_URL to its actual first-device journey after integration.");
assert.deepEqual(requests, [], "Contract fixture makes no external or service requests");
assert.deepEqual(errors, [], "No browser exceptions");
if (failures.length) console.error(failures.join("\n\n"));
assert.equal(failures.length, 0, `${failures.length} opening browser checks failed; artifacts: ${artifacts}`);
console.log(`Contract checks passed. Focus events are not screen-reader evidence. Artifacts: ${artifacts}`);
