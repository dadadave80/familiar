import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, type CDPSession, type Page } from "@playwright/test";
import { createServer } from "vite";
import type { Action } from "../web/src/outing/engine";

const captures = await mkdtemp(join(tmpdir(), "familiar-outing-browser-"));
const web = resolve(import.meta.dir, "../web");
const target = process.argv[2] ? new URL(process.argv[2]) : null;
if (target) {
  assert(!target.username && !target.password && target.pathname === "/" && !target.search && !target.hash, "Pass a plain site origin");
  assert(target.origin === "https://familiar-two.vercel.app" || (target.protocol === "http:" && ["127.0.0.1","localhost"].includes(target.hostname)), "Use Familiar production or a local preview");
}
const server = target ? null : await createServer({ cacheDir:join(captures,"vite-cache"), root: web, envDir: false, envPrefix: [], logLevel: "error", server: { host: "127.0.0.1", port: 0 } });

const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });
const action = (page: Page, value: string) => page.locator(`[data-action="${value}"]`);
const scene = (page: Page) => page.getByTestId("outing-scene");

async function openGame(page: Page, origin: string, path: string) {
  const response = await page.goto(origin + path);
  assert.equal(response?.status(), 200, "Familiar opens publicly");
  if (path === "/") {
    await page.getByRole("link", {name:"Play Familiar", exact:true}).first().click();
    await expect(page).toHaveURL(new RegExp("/outing/?$"));
  }
  assert.match(new URL(page.url()).pathname, /^\/outing\/?$/, "Game opens at its dedicated route");
}

async function play(page: Page, moves: readonly Action[]) {
  for (const move of moves) await action(page, move).click();
}

async function onTurn(page: Page, turn: number, lane: string) {
  await expect(scene(page)).toHaveAttribute("data-turn",String(turn));
  await expect(button(page, `Inspect ${lane}`)).toHaveAttribute("data-here","true");
  if(await action(page,"wait").count())await expect(action(page, "wait")).toBeEnabled();
}

async function chooseOuting(page:Page,name:string) {
  await button(page,"Prepare outing").click();await button(page,"Change outing").click();await button(page,name).click();
}
async function chooseTool(page:Page,name:"Rope"|"Lantern") {
  await button(page,"Prepare outing").click();await button(page,"Change tool").click();await page.getByRole("radio",{name:new RegExp(name,"i")}).check();await button(page,`Use ${name}`).click();
}
async function memory(page:Page,match:RegExp) {
  await button(page,"Menu").click();await button(page,"Mochi’s memory").click();await expect(page.locator(".of-memory")).toContainText(match);await button(page,"Back to harbor").click();
}
async function event(page:Page,match:RegExp) {
  await expect(page.getByTestId("turn-consequence")).toBeVisible();
  await button(page,"Menu").click();await button(page,"Outing notes").click();await button(page,"Last turn").click();
  await expect(page.locator(".of-panel-page:visible .of-intent")).toContainText(match);
  await button(page,"Back to outing").click();
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
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), name + " fits without page scrolling");
  const overflow=await page.locator(".of-panel-page:visible").evaluateAll(nodes=>nodes.filter(n=>n.scrollHeight>n.clientHeight+1||n.scrollWidth>n.clientWidth+1).map(n=>n.id));
  assert.deepEqual(overflow,[],name+" has no scrolling panel");
  const outside=await page.locator("button:visible,a:visible,input:visible").evaluateAll(nodes=>nodes.filter(n=>{const r=n.getBoundingClientRect();return r.left<-.5||r.top<-.5||r.right>innerWidth+.5||r.bottom>innerHeight+.5}).map(n=>n.textContent));
  assert.deepEqual(outside,[],name+" keeps every action in the viewport");
  const small = await page.locator("button:visible, summary:visible, .of-kits label:visible").evaluateAll(nodes =>
    nodes.filter(node => {
      const {width, height} = node.getBoundingClientRect();
      return width < 44 || height < 44;
    }).map(node => node.textContent?.trim()));
  assert.deepEqual(small, [], name + " controls have 44px touch targets");
  if (await scene(page).getAttribute("data-orientation") !== null) {
    const overlaps = await scene(page).evaluate(stage => {
      const nodes = [...stage.querySelectorAll(".of-source, .of-strike span, .of-vane-find, .of-socket, .of-lanes button")];
      const collisions:string[] = [];
      for (const [index,node] of nodes.entries()) {
        const a = node.getBoundingClientRect();
        for (const other of nodes.slice(index + 1)) {
          const b = other.getBoundingClientRect();
          if (Math.min(a.right,b.right) > Math.max(a.left,b.left) &&
              Math.min(a.bottom,b.bottom) > Math.max(a.top,b.top)) {
            collisions.push(`${node.textContent?.trim()} overlaps ${other.textContent?.trim()}`);
          }
        }
      }
      return collisions;
    });
    assert.deepEqual(overlaps, [], name + " scene labels remain readable beside the lane controls");
  }
  // Keep mobile captures in the real touch viewport, including its input media queries.
  const touch = await page.evaluate(() => navigator.maxTouchPoints > 0);
  if (touch) await page.evaluate(() => window.scrollTo({top:0,behavior:"instant"}));
  await page.screenshot({ path: join(captures, name + ".png"), fullPage: false });
  if (touch && await scene(page).getAttribute("data-orientation") !== null) {
    await page.locator(".of-controls").screenshot({path:join(captures, name + "-controls.png")});
  }
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
  await expect(page.getByText(/wave strikes Left/i)).toBeVisible();
  await expect(action(page, "move:right")).toBeDisabled();
  await page.reload();
  await expect(page.getByText("Turn 3 of 15")).toBeVisible();
  await expect(page.getByText(/wave strikes Left/i)).toBeVisible();
  await expect(page.getByTestId("mochi-actor")).toHaveAttribute("data-pose", "brace");
  await capture(page, "desktop-locked");
  // Second key-down is an OS repeat. Center still has a legal Right move after settling.
  await page.keyboard.down("ArrowRight");
  await onTurn(page, 4, "Center");
  await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  await onTurn(page, 4, "Center");
  await event(page,/left shell split open.*stayed dry/i);
  await expect(page.getByTestId("mochi-actor")).toHaveAttribute("data-pose", "relieved");
  await play(page, ["reel:lens"]);
  await expect(page.getByTestId("mochi-actor")).toHaveAttribute("data-pose", "pull-in");
  await play(page, ["return"]);
  await expect(page.getByRole("heading", { name: "The lens is home." })).toBeVisible();
  await expect(scene(page)).toHaveAttribute("data-lit", "false");
  // Returning with the lens must not unlock the second outing before installation.
  assert.equal(await button(page, "Wind Gate").isEnabled().catch(() => false), false);
  await action(page, "install").click();
  await expect(scene(page)).toHaveAttribute("data-lit", "true");
  await button(page,"Menu").click();await button(page, "Try the two-shell challenge").click();
  await expect(page.getByText(/Open both shells with the Rope/i)).toBeVisible();
  await button(page, "Start challenge").click();
  await page.reload();
  await expect(page.getByText("Open both shells. Bring Mochi home dry.",{exact:true})).toBeVisible();
  await play(page, ["wait", "move:left", "move:center", "move:right", "wait", "move:center", "move:right", "take:moth", "move:center", "return"]);
  await expect(page.getByText(/two-shell challenge complete/i)).toBeVisible();
  await expect(page.getByText("Wind-moth in the garden")).toBeVisible();
  await button(page,"Menu").click();await button(page, "Make a challenge").click();
  const invite = page.getByLabel("Challenge invitation");
  const text = await invite.innerText();
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
  await button(page,"Back to harbor").click();
  await button(page, "Rest at the harbor").click();
  await expect(scene(page)).toHaveAttribute("data-lit", "true");
  await expect(page.getByTestId("mochi-actor")).toHaveAttribute("data-pose", "neutral");
  await expect(action(page, "wait")).toHaveCount(0);
  await page.reload();
  await expect(page.getByText("Wind-moth in the garden")).toBeVisible();
  await memory(page,/little wings all the way home/i);
  await capture(page, "desktop-restored-garden");
}

async function lanternOuting(page: Page) {
  const client = await page.context().newCDPSession(page);
  await chooseTool(page,"Lantern");
  await action(page, "depart").click();
  await expect(page.locator(".of-touch-hint")).toBeVisible();
  // Vertical pans stay within the fixed game viewport and must not spend a turn.
  await page.evaluate(()=>window.scrollTo(0,0));
  let start = await touchStart(page);
  const top = await page.evaluate(()=>scrollY);
  await drag(client,[start],0,-80);
  assert.equal(await page.evaluate(()=>scrollY),top,"vertical gesture does not scroll the game");
  await onTurn(page, 1, "Center");
  await page.evaluate(()=>window.scrollTo(0,0));
  start = await touchStart(page);
  await client.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[start]});
  // A vertical-first gesture with a sideways tail must never spend a turn.
  for (const [dx,dy] of [[0,-24],[0,-56],[-70,-60],[-115,-60]]) {
    await client.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{...start,x:start.x+dx,y:start.y+dy}]});
  }
  await client.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await onTurn(page, 1, "Center");

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
  await expect(page.getByText(/wave strikes Center/i)).toBeVisible();
  await button(page, "Lure wave").click();
  await action(page, "lure:right").focus();
  await page.keyboard.press("ArrowLeft");
  await onTurn(page, 3, "Center");
  await page.keyboard.press("Escape");
  await expect(button(page, "Lure wave")).toBeFocused();
  await expect(page.getByText("Turn 3 of 15")).toBeVisible();
  await button(page, "Lure wave").click();
  await play(page, ["lure:right"]);
  await event(page,/right shell split open.*stayed dry/i);
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
  await event(page,/left shell split open.*2 Resolve left/i);
  await expect(page.getByTestId("mochi-actor")).toHaveAttribute("data-pose", "startled");
  await expect(action(page,"take:lens")).toBeEnabled();
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
  await memory(page,/wrung out my scarf/i);
  await page.reload();
  await expect(scene(page)).toHaveAttribute("data-lit", "true");
  await chooseOuting(page, "Beacon Court");
  await action(page, "depart").click();
  const circuit: Action[] = ["wait", "move:left", "move:center", "wait", "move:right", "move:center"];
  await play(page, [...circuit, ...circuit]);
  await onTurn(page,13,"Center");
  await play(page, ["wait", "move:left", "move:center"]);
  await expect(page.getByRole("heading", {name:"The tide closed in."})).toBeVisible();
  await expect(scene(page)).toHaveAttribute("data-lit","true");
  await expect(page.getByText(/tide closed the route.*satchel is empty/i)).toBeVisible();
  await button(page,"Last turn").click();await expect(page.getByTestId("final-turn-result")).toContainText("fifteenth action closed the route");await capture(page,"mobile-flood-final-turn");await button(page,"Back to harbor").click();
  await capture(page, "mobile-flood-refuge");
}

async function temporaryOuting(page: Page) {
  await expect(page.getByText(/storage unavailable/i)).toBeVisible();
  await button(page, "Accept two-shell challenge").click();
  await button(page, "Start challenge").click();
  for (let i = 0; i < 9; i++) await play(page, ["wait"]);
  await expect(page.getByRole("heading", {name:"Carried home."})).toBeVisible();
  await button(page,"Last turn").click();await expect(page.getByTestId("final-turn-result")).toContainText(/wave struck center.*0 Resolve left.*ran out of Resolve/i);await capture(page,"small-mobile-zero-resolve-final-turn");await button(page,"Back to harbor").click();
  await button(page,"Try again").click();
  await action(page,"depart").click();
  await expect(page.getByText("Turn 1 of 15")).toBeVisible();
  await play(page, ["return"]);
  await button(page,"Rest at the harbor").click();
  await capture(page, "small-mobile-safe-stop");
  await page.reload();
  await expect(page.getByRole("heading",{name:"The broken beacon."})).toBeVisible();
}

const windDry: readonly Action[] = [
  "move:left", "wait", "wait", "move:center", "move:right", "move:center", "take:vane", "return",
];

async function denyStorageWrites(page: Page) {
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Object.defineProperty(window, "restoreWindStorage", {
      configurable:true, value:() => { Storage.prototype.setItem = original; },
    });
    Storage.prototype.setItem = () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); };
  });
}

async function allowStorageWrites(page: Page) {
  await page.evaluate(() => {
    Reflect.get(window, "restoreWindStorage")();
    Reflect.deleteProperty(window, "restoreWindStorage");
  });
}

async function windOuting(page: Page, kit: "rope" | "lantern", width: number) {
  await expect(scene(page)).toHaveAttribute("data-lit", "true");
  await expect(scene(page)).toHaveAttribute("data-signaled", "false");
  await chooseOuting(page, "Wind Gate");
  if (kit === "lantern") {
    await button(page,"Prepare outing").click();await button(page,"Change outing").click();
    await button(page,"Moonpool Chart · Wind Gate").click();
    await expect(page.getByText(/On arrival, Left exits Center, Center exits Right, and Right exits Left/)).toBeVisible();
    await button(page,"Back to outings").click();await button(page,"Back to harbor").click();
  }
  await chooseTool(page,kit === "rope"?"Rope":"Lantern");
  await action(page, "depart").click();
  await expect(page.getByRole("region", {name:"Wind Gate playfield"})).toBeVisible();
  const routing = scene(page);
  await expect(routing).toHaveAttribute("data-orientation", "1");
  await expect(page.getByTestId("wind-socket-left")).toHaveAttribute("data-charged", "false");
  await expect(page.getByTestId("wind-socket-center")).toHaveAttribute("data-charged", "false");
  await expect(action(page, "take:chart")).toHaveCount(0);
  await expect(action(page, "take:lens")).toHaveCount(0);
  await button(page, "Inspect Center").click();
  await expect(button(page, "Close inspection")).toBeVisible();
  await onTurn(page, 1, "Center");
  await button(page, "Close inspection").click();
  await expect(routing).toHaveAttribute("data-orientation", "1");
  // Use the actual input pipeline for the first move into the routed arena.
  if (width === 1440) {
    await page.getByRole("heading", {name:"Low tide"}).focus();
    await page.keyboard.press("ArrowLeft");
  } else {
    const client = await page.context().newCDPSession(page);
    await drag(client, [await touchStart(page)], -80, 0);
    await client.detach();
  }
  await onTurn(page, 2, "Left");
  await expect(action(page, "turn:vane")).toBeDisabled();
  await play(page, ["wait"]);
  await expect(routing).toHaveAttribute("data-source", "left");
  await expect(routing).toHaveAttribute("data-exit", "center");
  await capture(page, `wind-${width}-${kit}-locked`);
  await page.reload();
  await expect(routing).toHaveAttribute("data-source", "left");
  await expect(routing).toHaveAttribute("data-exit", "center");
  await onTurn(page, 3, "Left");
  await play(page, ["wait"]);
  await expect(page.getByTestId("wind-socket-center")).toHaveAttribute("data-charged", "true");
  await expect(page.getByTestId("wind-socket-left")).toHaveAttribute("data-charged", "false");
  await event(page,/Mochi stayed dry/);
  await play(page, windDry.slice(3, 6));
  await expect(page.getByTestId("wind-socket-left")).toHaveAttribute("data-charged", "true");
  await expect(page.getByTestId("wind-socket-center")).toHaveAttribute("data-charged", "true");
  await expect(action(page, "take:vane")).toBeEnabled();
  await capture(page, `wind-${width}-${kit}-charged`);
  await play(page, ["take:vane"]);
  if (width === 390) await denyStorageWrites(page);
  await play(page, ["return"]);
  await expect(page.getByText(/8 actions · 3 \/ 3 Resolve/)).toBeVisible();
  await expect(action(page, "install-vane")).toBeEnabled();
  await expect(scene(page)).toHaveAttribute("data-signaled", "false");
  if (width === 390) {
    await expect(page.getByText(/Progress only in this tab/)).toBeVisible();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("familiar.first-light.beacon.v1")!));
    assert.equal(saved.bank.includes("vane"), false, "Failed return write keeps the earlier device save");
    await allowStorageWrites(page);
  } else {
    await page.reload();
    await expect(action(page, "install-vane")).toBeEnabled();
    await expect(scene(page)).toHaveAttribute("data-signaled", "false");
  }
  if (width === 320) {
    await denyStorageWrites(page);
    await button(page, "Repair signal post").click();
    await expect(page.getByRole("alert")).toContainText("The repair could not be saved");
    await expect(scene(page)).toHaveAttribute("data-signaled", "false");
    await expect(action(page, "install-vane")).toBeEnabled();
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("familiar.first-light.beacon.v1")!));
    assert.equal(saved.signaled, false);
    assert(saved.bank.includes("vane"), "Failed repair preserves the earned vane");
    await allowStorageWrites(page);
  }
  await button(page, "Repair signal post").click();
  await expect(scene(page)).toHaveAttribute("data-signaled", "true");
  await expect(action(page, "install-vane")).toHaveCount(0);
  if (width === 390) {
    // Keep this same mounted app. Reloading here would reset its persistence
    // status and hide a failure to resume durable writes after the repair.
    await expect(page.getByText("Saved on this device", {exact:true})).toBeVisible();
    await capture(page, `wind-${width}-${kit}-restored`);
    await button(page, "Prepare another outing").click();
    await chooseOuting(page, "Wind Gate");
    await action(page, "depart").click();
    await play(page, ["move:left", "wait"]);
    await page.reload();
    await onTurn(page, 3, "Left");
    await expect(routing).toHaveAttribute("data-exit", "center");
    await expect(scene(page)).toHaveAttribute("data-signaled", "true");
  } else {
    await page.reload();
    await expect(scene(page)).toHaveAttribute("data-signaled", "true");
    await expect(action(page, "install-vane")).toHaveCount(0);
    await capture(page, `wind-${width}-${kit}-restored`);
  }
}

async function windRotationAndLure(page: Page) {
  await chooseOuting(page, "Wind Gate");
  await chooseTool(page,"Lantern");
  await action(page, "depart").click();
  const routing = scene(page);
  await play(page, ["wait", "wait"]);
  await expect(routing).toHaveAttribute("data-source", "center");
  await expect(routing).toHaveAttribute("data-exit", "right");
  // The committed source is fixed, but a Surge turn applies the new orientation.
  await expect(action(page, "turn:vane")).toContainText(/left/i);
  await play(page, ["turn:vane"]);
  await expect(routing).toHaveAttribute("data-orientation", "2");
  await expect(page.getByTestId("wind-socket-left")).toHaveAttribute("data-charged", "true");
  await event(page,/wave entered center and struck left/i);
  await play(page, ["move:left", "wait"]);
  await expect(routing).toHaveAttribute("data-source", "left");
  await expect(routing).toHaveAttribute("data-exit", "right");
  await button(page, "Lure wave").click();
  await expect(action(page, "lure:right")).toContainText(/center/i);
  await play(page, ["lure:right"]);
  await expect(page.getByTestId("wind-socket-center")).toHaveAttribute("data-charged", "true");
  await event(page,/wave entered right and struck center/i);
  await play(page, ["move:center", "take:vane", "return"]);
  await expect(page.getByText(/9 actions · 3 \/ 3 Resolve/)).toBeVisible();
  await expect(action(page, "install-vane")).toBeVisible();
}

async function windSocketSplash(page: Page) {
  await chooseOuting(page, "Wind Gate");
  await action(page, "depart").click();
  await play(page, ["move:left", "wait", "move:center"]);
  await expect(page.getByTestId("wind-socket-center")).toHaveAttribute("data-charged", "true");
  await event(page,/2 Resolve left/);
  await expect(page.getByTestId("mochi-actor")).toHaveAttribute("data-pose", "startled");
  await capture(page, "wind-socket-and-splash");
  await page.reload();
  await expect(page.getByTestId("wind-socket-center")).toHaveAttribute("data-charged", "true");
  await event(page,/2 Resolve left/);
  await play(page, ["return"]);
  await expect(action(page, "install-vane")).toHaveCount(0);
  await expect(scene(page)).toHaveAttribute("data-signaled", "false");
  await button(page, "Prepare another outing").click();
  await chooseOuting(page, "Wind Gate");
  await chooseTool(page,"Rope");
  await action(page, "depart").click();
  await play(page, windDry.slice(0,6));
  await play(page, ["move:left", "reel:vane"]);
  await expect(page.getByTestId("mochi-actor")).toHaveAttribute("data-pose", "pull-in");
  await expect(action(page, "reel:vane")).toHaveCount(0);
  await play(page, ["wait", "move:center", "return"]);
  await expect(page.getByText(/11 actions · 3 \/ 3 Resolve/)).toBeVisible();
  await expect(action(page, "install-vane")).toBeEnabled();
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
      const path = width === 1440 ? "/" : width === 320 ? "/outing/?challenge=two-shells-v1" : "/outing";
      await openGame(page, origin, path);
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
    const windScenarios = [
      {width:1440, height:900, name:"windRope", run:(page:Page) => windOuting(page, "rope", 1440)},
      {width:390, height:844, name:"windLantern", run:(page:Page) => windOuting(page, "lantern", 390)},
      {width:320, height:750, name:"windSmallPhone", run:(page:Page) => windOuting(page, "rope", 320)},
      {width:1440, height:900, name:"windRotationAndLure", run:windRotationAndLure},
      {width:390, height:844, name:"windSocketSplash", run:windSocketSplash},
      {width:320, height:750, name:"legacyActiveBeacon", run:async (page:Page) => {
        await expect(page.getByRole("region", {name:"Beacon Court playfield"})).toBeVisible();
        await onTurn(page, 3, "Left");
        await expect(page.getByText(/wave strikes Left/i)).toBeVisible();
        await play(page, ["move:center", "reel:lens", "return"]);
        await expect(action(page, "install")).toBeEnabled();
        await expect(scene(page)).toHaveAttribute("data-lit", "false");
        assert.equal(await button(page, "Wind Gate").isEnabled().catch(() => false), false);
        await action(page, "install").click();
        await button(page, "Prepare another outing").click();
        await button(page,"Prepare outing").click();await button(page,"Change outing").click();
        await expect(button(page, "Wind Gate")).toBeEnabled();
        await button(page,"Back to harbor").click();
        await openGame(page, origin!, "/");
        await expect(scene(page)).toHaveAttribute("data-lit", "true");
        await button(page,"Prepare outing").click();await button(page,"Change outing").click();
        await expect(button(page, "Wind Gate")).toBeEnabled();
        await button(page,"Back to harbor").click();
      }},
    ];
    for (const {width,height,name,run} of windScenarios) {
      const context = await browser.newContext({
        viewport:{width,height}, reducedMotion:width === 1440 ? "no-preference" : "reduce",
        hasTouch:width !== 1440, isMobile:width !== 1440,
      });
      const page = await context.newPage();
      const errors:string[] = [], forbidden:string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await context.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || route.request().method() !== "GET" || /^\/(api|npc-api)(\/|$)/.test(url.pathname)) {
          forbidden.push(url.href);
          return route.abort();
        }
        return route.continue();
      });
      // These are fixtures in the previously shipped v1 format. Once the app writes
      // the migrated save, reloads must keep the new progress rather than reseed it.
      const legacyActive = name === "legacyActiveBeacon";
      await context.addInitScript(({legacyActive, chart}) => {
        const key = "familiar.first-light.beacon.v1";
        if (localStorage.getItem(key) !== null) return;
        localStorage.setItem(key, JSON.stringify({
          version:1, bank:legacyActive ? [] : chart ? ["lens","chart"] : ["lens"],
          lit:!legacyActive, memory:"A line from the previous Beacon build.",
          active:legacyActive ? {tool:"rope",actions:["wait","move:left"]} : null,
        }));
      }, {legacyActive,chart:name === "windLantern"});
      await openGame(page, origin, width === 1440 ? "/" : "/outing/");
      await run(page);
      assert.deepEqual(errors, [], name + " has no browser exceptions");
      assert.deepEqual(forbidden, [], name + " has no external or backend requests");
      const keys = await page.evaluate(() => Object.keys(localStorage));
      assert.deepEqual(keys, ["familiar.first-light.beacon.v1"], "Existing on-device save namespace is preserved");
      await context.close();
      console.log(`PASS ${width}×${height} ${name}`);
    }
  } finally {
    await browser.close();
  }
  console.log("Outing screenshots:", captures);
} finally {
  await server?.close();
}
