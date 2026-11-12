import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, type CDPSession, type Page } from "@playwright/test";
import { createServer } from "vite";
import type { Action } from "../web/src/outing/engine";

const captures = await mkdtemp(join(tmpdir(), "familiar-beacon-browser-"));
const web = resolve(import.meta.dir, "../web");
const target = process.argv[2] ? new URL(process.argv[2]) : null;
if (target) {
  assert(!target.username && !target.password && target.pathname === "/" && !target.search && !target.hash, "Pass a plain site origin");
  assert(target.origin === "https://familiar-two.vercel.app" || (target.protocol === "http:" && ["127.0.0.1","localhost"].includes(target.hostname)), "Use Familiar production or a local preview");
}
const server = target ? null : await createServer({ root: web, envDir: false, envPrefix: [], logLevel: "error", server: { host: "127.0.0.1", port: 0 } });

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const action = (page: Page, value: string) => page.locator(`[data-action="${value}"]`);
const scene = (page: Page) => page.getByTestId("outing-scene");

async function play(page: Page, moves: readonly Action[]) {
  for (const move of moves) await action(page, move).click();
}

async function onTurn(page: Page, turn: number, lane: string) {
  await expect(page.getByText(`Turn ${turn} of 15`, {exact:true})).toBeVisible();
  await expect(button(page, `Inspect ${lane}`)).toHaveAttribute("data-here","true");
  await expect(action(page, "wait")).toBeEnabled();
}

type Point = {x:number; y:number; id:number};
async function drag(client: CDPSession, starts: Point[], dx: number, dy: number, cancel = false) {
  await client.send("Input.dispatchTouchEvent", {type:"touchStart", touchPoints:starts});
  for (const fraction of [.25,.5,.75,1]) {
    await client.send("Input.dispatchTouchEvent", {type:"touchMove", touchPoints:starts.map(p => ({
      ...p, x:p.x+dx*fraction, y:p.y+dy*fraction,
    }))});
  }
  await client.send("Input.dispatchTouchEvent", {type:cancel ? "touchCancel" : "touchEnd", touchPoints:[]});
}

async function touchStart(page: Page, lane?: string): Promise<Point> {
  const element = lane ? button(page, `Inspect ${lane}`) : scene(page);
  await element.scrollIntoViewIfNeeded();
  const box = await element.boundingBox();
  assert(box);
  return {x:box.x+box.width/2, y:box.y+box.height/2, id:1};
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
  // Keep mobile captures in the real touch viewport, including its input media queries.
  const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  if (touch) await page.evaluate(() => window.scrollTo({top:0,behavior:"instant"}));
  await page.screenshot({ path: join(captures, name + ".png"), fullPage: !touch });
}

async function dryOuting(page: Page) {
  await capture(page, "desktop-harbor");
  await action(page, "depart").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".of-key-hint")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Low tide" })).toBeFocused();
  await button(page, "Inspect Left").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/A crack runs through this shell/)).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await onTurn(page, 1, "Center");
  await button(page, "Close inspection").click();
  await action(page, "wait").evaluate(node => {
    const control = node as HTMLButtonElement;
    control.click();
    control.click();
  });
  await onTurn(page, 2, "Center");
  // Shortcuts must not steal arrows from editing, even if a future overlay adds an input.
  await page.evaluate(() => {
    const field = document.createElement("input");
    field.id = "keyboard-native-input"; field.value = "abc";
    document.body.append(field); field.focus(); field.setSelectionRange(2,2);
  });
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.locator("#keyboard-native-input").evaluate(el => (el as HTMLInputElement).selectionStart), 1);
  await onTurn(page, 2, "Center");
  await page.locator("#keyboard-native-input").evaluate(el=>el.remove());
  await page.getByRole("heading",{name:"Rising tide"}).focus();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await onTurn(page, 2, "Center");
  await page.keyboard.press("ArrowLeft");
  await onTurn(page, 3, "Left");
  await page.keyboard.press("ArrowLeft");
  await onTurn(page, 3, "Left");
  await expect(page.getByText(/wave will strike Left/i)).toBeVisible();
  await expect(action(page, "move:right")).toBeDisabled();
  await page.reload();
  await expect(page.getByText("Turn 3 of 15")).toBeVisible();
  await expect(page.getByText(/wave will strike Left/i)).toBeVisible();
  await expect(page.getByTestId("mochi-actor")).toHaveAttribute("data-pose", "brace");
  await capture(page, "desktop-locked");
  // Second key-down is an OS repeat. Center still has a legal Right move after settling.
  await page.keyboard.down("ArrowRight");
  await onTurn(page, 4, "Center");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  await onTurn(page, 4, "Center");
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
  assert.doesNotMatch(text, /move:|reel:|0x[0-9a-f]{20,}/i);
  if (new URL(page.url()).protocol === "https:") {
    const link = new URL(text.split("\n").at(-1)!);
    assert.equal(link.origin, "https://familiar-two.vercel.app");
    assert.match(link.pathname, /^\/outing\/?$/);
    assert.equal(link.search, "?challenge=two-shells-v1");
  } else assert.doesNotMatch(text, /https?:\/\//i);
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
  const client = await page.context().newCDPSession(page);
  await page.getByRole("radio", {name:/Lantern/}).check();
  await action(page, "depart").click();
  await expect(page.locator(".of-touch-hint")).toBeVisible();
  // Give the browser scroll room to discriminate a real vertical pan from a game swipe.
  const scrollRoom = await page.addStyleTag({content:"body {min-height: 200vh}"});
  await page.evaluate(()=>window.scrollTo(0,0));
  let start = await touchStart(page);
  const top = await page.evaluate(()=>scrollY);
  await drag(client,[start],0,-80);
  await expect.poll(()=>page.evaluate(()=>scrollY)).toBeGreaterThan(top);
  await onTurn(page, 1, "Center");
  await page.evaluate(()=>window.scrollTo(0,0));
  start = await touchStart(page);
  await client.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[start]});
  // Once a pan has scrolled the document, a sideways tail must never spend a turn.
  for (const [dx,dy] of [[0,-24],[0,-56],[-70,-60],[-115,-60]]) {
    await client.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{...start,x:start.x+dx,y:start.y+dy}]});
  }
  await client.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await onTurn(page, 1, "Center");
  await scrollRoom.evaluate(el=>el.parentNode?.removeChild(el));
  start = await touchStart(page);
  await drag(client,[start],-45,50);
  await onTurn(page, 1, "Center");
  start = await touchStart(page);
  await drag(client,[start],-70,1,true);
  await onTurn(page, 1, "Center");
  start = await touchStart(page);
  await drag(client,[start,{...start,id:2,y:start.y+24}],-70,0);
  await onTurn(page, 1, "Center");
  await button(page, "Inspect Right").tap();
  await expect(button(page, "Close inspection")).toBeVisible();
  await onTurn(page, 1, "Center");
  await button(page, "Close inspection").tap();
  await expect(button(page, "Lure wave")).toBeDisabled();
  await play(page, ["wait", "wait"]);
  await expect(page.getByText(/wave will strike Center/i)).toBeVisible();
  await button(page, "Lure wave").click();
  await action(page, "lure:right").focus();
  await page.keyboard.press("ArrowLeft");
  await onTurn(page, 3, "Center");
  await page.keyboard.press("Escape");
  await expect(button(page, "Lure wave")).toBeFocused();
  await expect(page.getByText("Turn 3 of 15")).toBeVisible();
  await button(page, "Lure wave").click();
  await play(page, ["lure:right"]);
  await expect(page.getByText(/right shell split open.*stayed dry/i)).toBeVisible();
  await onTurn(page, 4, "Center");
  start = await touchStart(page,"Center");
  await drag(client,[start],-79,3);
  await onTurn(page, 5, "Left");
  await expect(button(page, "Close inspection")).toHaveCount(0);
  await button(page,"Inspect Center").tap();
  await expect(button(page,"Close inspection")).toBeVisible();
  await button(page,"Close inspection").tap();
  await onTurn(page, 5, "Left");
  start = await touchStart(page);
  await drag(client,[start],-75,0);
  await onTurn(page, 5, "Left");
  await play(page, ["wait", "wait"]);
  await expect(page.getByText(/left shell split open.*2 Resolve left/i)).toBeVisible();
  await expect(page.getByTestId("mochi-actor")).toHaveAttribute("data-pose", "startled");
  await expect(page.getByText(/Beacon Lens is exposed/i)).toBeVisible();
  await expect(page.locator(".of-touch-hint")).toBeVisible();
  // The browser may still register a reduced 0.001ms animation before its first frame.
  const durations = await scene(page).evaluate(stage =>
    stage.getAnimations({subtree:true}).map(animation => Number(animation.effect?.getComputedTiming().endTime)));
  assert(durations.every(duration => duration <= 16), "No sustained movement under reduced motion");
  await capture(page, "mobile-mixed-wave");
  await play(page, ["take:lens"]);
  await onTurn(page, 8, "Left");
  await drag(client,[await touchStart(page)],80,0);
  await onTurn(page, 9, "Center");
  await play(page, ["return"]);
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
  let origin = target?.origin;
  if (server) {
    await server.listen();
    const address = server.httpServer?.address();
    assert(address && typeof address === "object");
    origin = "http://127.0.0.1:" + address.port;
  }
  assert(origin);
  const browser = await chromium.launch();
  try {
    for (const [width, height, scenario] of [[1440, 900, dryOuting], [390, 844, lanternOuting], [320, 750, temporaryOuting]] as const) {
      const context = await browser.newContext({
        viewport: {width, height}, reducedMotion: width === 1440 ? "no-preference" : "reduce",
        hasTouch: width !== 1440, isMobile: width !== 1440,
      });
      assert.deepEqual((await context.storageState()).cookies, [], "Fresh signed-out session");
      const page = await context.newPage();
      const errors: string[] = [], forbidden: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || route.request().method() !== "GET" || /^\/(api|npc-api)(\/|$)/.test(url.pathname)) {
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
      const path = width === 320 ? "/outing/?challenge=two-shells-v1" : "/outing";
      const response = await page.goto(origin + path);
      assert.equal(response?.status(), 200, "Outing opens publicly");
      assert.match(new URL(page.url()).pathname, /^\/outing\/?$/, "No redirect to a login or fallback");
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
  await server?.close();
}
