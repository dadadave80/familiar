/** A fresh device harbor sails the three story tides and today's tide run, leaving and reloading one of them half way. */
import assert from "node:assert/strict";
import { guide, worldAction, buttonControls } from "./browser-controls";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, expect } from "@playwright/test";
import { createServer } from "vite";
import { VALUE, applyMove, startTide, type Move, type TideStart } from "../web/src/run/engine";
import { cautiousMove } from "../web/src/run/bot";
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
  for(const engine of [chromium,webkit]) {
  const browser = await engine.launch();
  try {
    const probe=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,reducedMotion:"reduce"});
    await probe.route("**/*",request=>new URL(request.request().url()).origin===origin.origin&&!/^\/(?:api|npc-api)\//.test(new URL(request.request().url()).pathname)?request.continue():request.abort());
    await probe.goto(new URL("/outing/?play",origin).href);await expect(probe.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");
    await probe.locator('[data-action="story"]').click();await expect(probe.getByTestId("tide-world")).toHaveAttribute("data-ready","true");
    const probeRun=probe.getByTestId("tide-run"),tiles=JSON.parse((await probe.getByTestId("tide-world").getAttribute("data-tiles"))!) as {position:{x:number;y:number};x:number;y:number}[];
    const start=tiles.find(tile=>tile.position.x===1&&tile.position.y===2)!;
    await probe.mouse.move(start.x,start.y);await probe.mouse.down();await probe.keyboard.press("i");await expect(probe.getByRole("dialog")).toBeVisible();
    await probe.mouse.up();await probe.keyboard.press("Escape");await expect(probeRun).toBeFocused();await worldAction(probe,"wait",true);
    await expect(probeRun).toHaveAttribute("data-beat","1");
    assert.deepEqual(await probe.evaluate(key=>JSON.parse(localStorage.getItem(key)!).active.moves,bookKey),["wait"],"a release while the guide is open cannot block the next native touch");
    await probe.close();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce" });
    const errors: string[] = [];
    const cdp=engine===chromium?await page.context().newCDPSession(page):null;
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/*", request => new URL(request.request().url()).origin === origin.origin && !/^\/(?:api|npc-api)\//.test(new URL(request.request().url()).pathname) ? request.continue() : request.abort());

    const run = page.getByTestId("tide-run"), link = page.locator('[data-action="tide-run"]'), title = page.locator(".exp-departure h1");
    const harbor = () => expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready", "true");
    const passTitle = async (tide = false) => {
      await expect(page.getByTestId("opening")).toHaveAttribute("data-mode", "title");
      await page.keyboard.press("Enter");
      await page.locator(tide ? '[data-plank="tide"]' : '[data-plank="continue"],[data-plank="new"]').click();
      if (tide) await page.locator('[data-el="scroll"] .fo-primary').click();
      await expect(page.getByTestId("opening")).toHaveCount(0);
    };
    const press = async (keys: readonly string[], touch=false) => {
      await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready", "true");
      for (const key of keys) {
        await expect(run).toHaveAttribute("data-busy", "false");
        const before=Number(await run.getAttribute("data-beat"));
        if(touch){
          const move=Object.entries(KEY).find(([,mapped])=>mapped===key)![0] as Move;
          if(move==="wait"||move==="home")await worldAction(page,move,true);
          else if(cdp) {
            const tiles=JSON.parse((await page.getByTestId("tide-world").getAttribute("data-tiles"))!) as {position:{x:number;y:number};x:number;y:number}[];
            const from=tiles.find(tile=>tile.position.x===1&&tile.position.y===2)!;
            const dx=move==="west"?-60:move==="east"?60:0,dy=move==="north"?-60:move==="south"?60:0;
            await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{id:1,x:from.x,y:from.y}]});
            await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{id:1,x:from.x+dx,y:from.y+dy}]});
            await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
          }
          else{await run.focus();await page.keyboard.press(key);}
        }else{await run.focus();await page.keyboard.press(key);}
        await expect(run).toHaveAttribute("data-beat",String(before+1));
      }
      await expect(run).toHaveAttribute("data-busy", "false");
    };
    const home = () => page.evaluate(() => (JSON.parse(localStorage.getItem("familiar.expedition.local.v2") ?? "null")?.home ?? { banked: [] }) as { banked: string[] });
    const failNextWrite = (key: string, filing = false) => page.evaluate(({ key, filing }) => {
      const setItem = Storage.prototype.setItem;
      Storage.prototype.setItem = function (name, value) {
        if (name === key && (!filing || JSON.parse(value).active === null)) { Storage.prototype.setItem = setItem; throw new DOMException("Saving is blocked", "QuotaExceededError"); }
        setItem.call(this, name, value);
      };
    }, { key, filing });
    async function sail(start: TideStart, from = 0) {
      const { keys, state } = route(start);
      if (start.story) await press(keys.slice(from),start.story==="lens");
      else {
        await press(keys.slice(from, -1),true);
        await failNextWrite(bookKey, true);
        await guide(page,Object.entries(KEY).find(([,key])=>key===keys.at(-1))![0]);
      }
      await expect(run).toHaveAttribute("data-outcome", state.outcome);
      await expect(run).toHaveAttribute("data-score", String(state.score));
      const trace=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).active,bookKey);
      assert.deepEqual(trace.moves,state.moves,"the default input route saves exactly the canonical move history");
      if (start.story === "lens") {
        await page.reload(); await passTitle();
        await expect(run).toHaveAttribute("data-outcome", state.outcome);
        await expect(page.getByTestId("tide-finish")).toBeVisible();
        await expect(page.locator("[data-move]")).toHaveCount(0);
        await expect(page.getByTestId("tide-feedback")).toBeEmpty();
        for (const key of ["familiar.expedition.local.v2", bookKey]) {
          await failNextWrite(key);
          await page.getByTestId("tide-finish").click();
          await expect(run.getByRole("alert")).toHaveText("This tide could not be saved. Try it again when this browser can save.");
          await expect(page.getByTestId("tide-finish")).toBeEnabled();
          assert.deepEqual((await home()).banked, key === bookKey ? ["lens"] : []);
        }
      } else if (!start.story) {
        await expect(run.getByRole("alert")).toHaveText("This tide could not be saved. Try it again when this browser can save.");
        await expect(page.getByTestId("tide-finish")).toBeEnabled();
      }
      await page.getByTestId("tide-finish").click();
      await harbor();
      return state;
    }

    await page.goto(new URL("/outing/", origin).href);
    await passTitle(); await harbor();
    await expect(title).toHaveText("First light.");
    await page.locator('[data-action="story"]').click();
    await expect(run).toHaveAttribute("data-story", "lens");
    await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready","true");
    await expect(page.locator("[data-move]:visible")).toHaveCount(0);
    const untouched=await page.evaluate(key=>localStorage.getItem(key),bookKey);
    for(const size of [{width:320,height:480},{width:390,height:844},{width:412,height:860},{width:844,height:390},{width:1280,height:800},{width:1440,height:900}]){
      await page.setViewportSize(size);
      await expect.poll(()=>page.locator('[data-testid="tide-world"] canvas').evaluate(node=>{const r=node.getBoundingClientRect();return Math.abs(r.width-innerWidth)<1&&Math.abs(r.height-innerHeight)<1;})).toBe(true);
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      const geometry=await page.getByTestId("tide-world").evaluate(node=>{
        const targets=[...JSON.parse(node.getAttribute("data-tiles")!),...JSON.parse(node.getAttribute("data-actions")!)];
        return{count:JSON.parse(node.getAttribute("data-tiles")!).length,hidden:targets.filter(target=>target.x<0||target.y<0||target.x>innerWidth||target.y>innerHeight||document.elementFromPoint(target.x,target.y)?.tagName!=="CANVAS"),scroll:[scrollX,scrollY,document.documentElement.scrollWidth-innerWidth,document.documentElement.scrollHeight-innerHeight]};
      });
      assert.equal(geometry.count,15);assert.deepEqual(geometry.hidden,[],`${engine.name()} ${size.width}x${size.height}: all world targets remain exposed`);
      assert.deepEqual(geometry.scroll,[0,0,0,0],"the gesture playfield never scrolls the page");
      await page.screenshot({path:join(cacheDir,`${engine.name()}-hints-${size.width}x${size.height}.png`)});
    }
    await page.setViewportSize({width:390,height:844});
    await buttonControls(page);await expect(page.locator('[data-move="wait"]')).toBeVisible();await buttonControls(page,false);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),untouched,"optional controls only reveal alternatives");
    const summary=page.locator(".exp-button-controls summary");await summary.focus();await page.keyboard.press("Space");await page.keyboard.press("Space");
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),untouched,"summary Space never waits");
    await page.evaluate(()=>{document.body.tabIndex=-1;document.body.focus();});await page.keyboard.press("ArrowUp");
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),untouched,"letter and direction shortcuts need game focus");
    const guideButton=page.getByTestId("tide-guide");await guideButton.tap();await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button",{name:"Close panel",exact:true}).tap();await expect(guideButton).toBeFocused();
    await run.focus();await page.keyboard.press("i");await expect(page.getByRole("dialog")).toBeVisible();await page.keyboard.press("Escape");await expect(run).toBeFocused();
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),untouched,"free inspection preserves the story trace");
    if(cdp)for(const cancel of ["cancel","diagonal","short","two-fingers","rotate"] as const){
      const tiles=JSON.parse((await page.getByTestId("tide-world").getAttribute("data-tiles"))!) as {position:{x:number;y:number};x:number;y:number}[];
      const from=tiles.find(tile=>tile.position.x===1&&tile.position.y===2)!;
      await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{id:1,x:from.x,y:from.y}]});
      if(cancel==="diagonal"||cancel==="short")await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{id:1,x:from.x+(cancel==="short"?20:45),y:from.y+(cancel==="short"?0:45)}]});
      if(cancel==="two-fingers")await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{id:1,x:from.x,y:from.y},{id:2,x:from.x+50,y:from.y}]});
      if(cancel==="rotate")await page.setViewportSize({width:844,height:390});
      await cdp.send("Input.dispatchTouchEvent",{type:cancel==="cancel"?"touchCancel":"touchEnd",touchPoints:[]});
      await expect(run).toHaveAttribute("data-busy","false");
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),untouched,`${cancel} gesture preserves the exact story save`);
      if(cancel==="rotate")await page.setViewportSize({width:390,height:844});
    }
    await page.screenshot({path:join(cacheDir,"direct-story-hints.png")});
    await sail(storyStart("lens"));
    await expect(title).toHaveText("The lens is home.");
    assert.deepEqual((await home()).banked, ["lens"]);
    await page.locator('[data-action="home-next"]').click();
    await page.getByRole("button", { name: "Restore the beacon" }).click();

    await expect(page.locator('[data-action="tide"]')).toBeVisible();
    await expect(link).toHaveAttribute("title", "Chapter 2: What the tide brings");
    await link.click();
    await press(route(storyStart("vane")).keys.slice(0, 3));
    await page.reload();
    await passTitle(true);
    await expect(run).toHaveAttribute("data-beat", "3");
    await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("tide-leave").click();
    const waitingAsk = page.locator('.exp-panel[data-surface="tide"]');
    await expect(waitingAsk).toBeVisible();
    await waitingAsk.locator(".exp-primary").click();
    await expect(run).toHaveAttribute("data-story", "vane");
    await expect(run).toHaveAttribute("data-beat", "3");
    await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("tide-leave").click();
    await harbor();
    await expect(link).toHaveAttribute("title", "Return to the tide Mochi left");
    await expect(title).toHaveText("The tide is waiting.");
    await page.locator('[data-action="resume"]').click();
    await expect(run).toHaveAttribute("data-story", "vane");
    await expect(run).toHaveAttribute("data-beat", "3");
    await sail(storyStart("vane"), 3);
    await expect(link).toHaveAttribute("title", "Fit the Signal Vane");
    await link.click();
    await page.getByRole("button", { name: "Repair the signal post" }).click();

    await expect(link).toHaveAttribute("title", "Chapter 3: The last thing");
    await link.click();
    await sail(storyStart("moth"));
    assert.deepEqual((await home()).banked, ["lens", "vane", "moth"]);

    await page.locator('[data-action="tide"]').click();
    const ask = page.locator('.exp-panel[data-surface="tide"]');
    await expect(ask).toBeVisible();
    await ask.locator(".exp-primary").click();
    const day = Number(await run.getAttribute("data-seed"));
    assert.equal(day, await page.evaluate(() => Math.floor(Date.now() / 86_400_000)));
    const daily = await sail({ seed: day });
    const sheet = page.locator('.exp-panel[data-surface="home"]');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".tide-home-note")).toHaveCount(0);
    const book = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), bookKey);
    assert.equal(book.active, null);
    assert.deepEqual(book.days.map((entry: { seed: number; moves: string[] }) => [entry.seed, entry.moves.length]), [[day, daily.moves.length]]);
    await sheet.locator(".exp-secondary").click();
    await expect(page.locator('.exp-panel[data-surface="log"] .tide-log-run')).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator(".exp-departure-buttons > .exp-secondary").click();
    await expect(run).toHaveAttribute("data-seed", String(day));
    await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready", "true");
    await buttonControls(page);await page.locator('[data-move="wait"]').tap();await buttonControls(page,false);
    await expect(run).toHaveAttribute("data-busy", "false");
    await page.reload();
    await passTitle(true);
    await expect(run).toHaveAttribute("data-beat", "1");
    await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("tide-leave").click();
    await waitingAsk.locator(".exp-primary").click();
    await expect(run).toHaveAttribute("data-seed", String(day));
    await expect(run).toHaveAttribute("data-beat", "1");
    await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready", "true");
    await worldAction(page,"home",true);
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".tide-home-note")).toHaveText("A practice tide: banked 0. Today’s first tide is the one that counts.");
    const practiced = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), bookKey);
    assert.equal(practiced.active, null);
    assert.deepEqual(practiced.days, book.days);
    assert.notEqual(daily.moves.length, 2);
    assert.deepEqual(errors, []);
    console.info(`${engine.name()} tide run: ${cdp?"native swipe/tap":"native tap/keyboard"} lens and daily routes, ${cdp?"native gesture cancellation":"keyboard/dialog isolation"}, optional controls, keyboard focus isolation, three story tides, finished reload, failed-save retries, leave and resume, daily Home and log, and practice preserving the first tide passed on a device harbor`);
  } finally { await browser.close(); }
  }
  console.info("Tide run captures:",cacheDir);
} finally { await server.close(); }
