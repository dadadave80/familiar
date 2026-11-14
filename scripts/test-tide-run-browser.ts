/** A fresh device harbor sails the three story tides and today's tide run, leaving and reloading one of them half way. */
import assert from "node:assert/strict";
import { guide, worldAction, buttonControls, sailStory } from "./browser-controls";
import { BROWSER_DAY, prepareBrowser } from "./browser-fixtures";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, expect, type Locator, type Page } from "@playwright/test";
import { createServer } from "vite";
import { VALUE, applyMove, replayTide, startTide, type Move, type TideStart } from "../web/src/run/engine";
import { cautiousMove } from "../web/src/run/bot";
import { storyStart } from "../web/src/run/story";
import { dayLabel } from "../web/src/tide/cards";

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
const zeroLens:Move[]=["north","north","north","south","north","west","north","south","south","south","east"];
const zeroLensState=replayTide(storyStart("lens"),zeroLens)!;
assert.equal(zeroLensState.outcome,"active");assert.equal(zeroLensState.score,0);assert(zeroLensState.banked.includes("lens"));

/** Visibility alone permits clipped text and controls covered by their siblings. */
async function readable(locator:Locator) {
  await expect(locator).toBeVisible();
  await expect.poll(()=>locator.evaluate(node=>{
    const rect=node.getBoundingClientRect(),issues:string[]=[];
    if(rect.left<0||rect.top<0||rect.right>innerWidth+1||rect.bottom>innerHeight+1)issues.push("outside viewport");
    for(let parent=node.parentElement;parent;parent=parent.parentElement){
      const style=getComputedStyle(parent),clip=parent.getBoundingClientRect();
      if(/auto|scroll|hidden|clip/.test(style.overflowY)&&(rect.top<clip.top+parent.clientTop-1||rect.bottom>clip.top+parent.clientTop+parent.clientHeight+1))issues.push(`clipped vertically by ${parent.className}`);
      if(/auto|scroll|hidden|clip/.test(style.overflowX)&&(rect.left<clip.left+parent.clientLeft-1||rect.right>clip.left+parent.clientLeft+parent.clientWidth+1))issues.push(`clipped horizontally by ${parent.className}`);
    }
    for(const y of [rect.top+2,rect.top+rect.height/2,rect.bottom-2]){
      const hit=document.elementFromPoint(rect.left+rect.width/2,y);
      if(!hit||!node.contains(hit))issues.push(`covered at y=${y}`);
    }
    return issues;
  })).toEqual([]);
}

async function scrolledRules(panel:Locator) {
  const header=panel.locator(".exp-panel-header"),body=panel.locator(".exp-panel-body");
  await expect.poll(()=>body.evaluate(node=>node.scrollHeight>node.clientHeight)).toBe(true);
  await body.focus();await body.press("End");
  await expect(body).toHaveCSS("outline-offset","-3px");
  await expect.poll(()=>body.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
  for(const position of [0.5,1]){
    await body.evaluate((node,position)=>{node.scrollTop=(node.scrollHeight-node.clientHeight)*position;},position);
    await readable(header.getByRole("heading"));
    await readable(header.getByRole("button",{name:"Close panel",exact:true}));
    const geometry=await header.evaluate(node=>{
      const rect=node.getBoundingClientRect(),panel=node.parentElement!,bounds=panel.getBoundingClientRect();
      return {fullWidth:rect.left<=bounds.left+panel.clientLeft+1&&rect.right>=bounds.left+panel.clientLeft+panel.clientWidth-1,
        atTop:Math.abs(rect.top-bounds.top-panel.clientTop)<2,background:getComputedStyle(node).backgroundColor,
        uncovered:[rect.left+2,rect.right-2].filter(x=>!node.contains(document.elementFromPoint(x,rect.top+rect.height/2)))};
    });
    assert(geometry.fullWidth&&geometry.atTop,`rules header covers the full scrolled panel: ${JSON.stringify(geometry)}`);
    assert.match(geometry.background,/^rgb\(/,"rules header is opaque");
    assert.deepEqual(geometry.uncovered,[],"scrolled rules cannot show through beside the heading and close control");
    assert.equal(await panel.evaluate(node=>node.scrollTop),0,"only rules scroll; the full-width heading stays outside their scrollbar");
  }
  await body.evaluate(node=>{node.scrollTop=0;});
}

async function trayExplanations(page:Page) {
  await page.locator(".tide-controls .exp-input-reading").evaluate(node=>{node.scrollTop=0;});
  for(const selector of [".tide-dock-instruction",".tide-pause-explanation"]){
    const explanation=page.locator(selector);
    await readable(explanation);
  }
}

async function guidanceOverflow(page:Page) {
  const reading=page.getByRole("region",{name:"Outing guidance",exact:true}),more=page.getByRole("button",{name:"Read more outing guidance",exact:true});
  const scrollState=()=>reading.evaluate(node=>({top:node.scrollTop,remaining:Math.max(0,node.scrollHeight-node.clientHeight-node.scrollTop),more:!!node.parentElement?.querySelector(".exp-input-more")}));
  const settled=async()=>{
    let previous:Awaited<ReturnType<typeof scrollState>>|undefined;
    await expect.poll(async()=>{
      const state=await scrollState(),stable=previous!==undefined&&state.top===previous.top&&state.remaining===previous.remaining;
      previous=state;
      return stable&&state.more===(state.remaining>1);
    },{intervals:[100]}).toBe(true);
    return previous!;
  };
  await reading.evaluate(node=>{node.scrollTop=0;});
  const overflows=(await settled()).remaining>1;
  await expect(more).toHaveCount(overflows?1:0);
  if(!overflows)return;
  await readable(more);
  await readable(page.locator(".exp-button-controls summary"));
  await readable(page.getByTestId("tide-guide"));
  const saved=await page.evaluate(key=>localStorage.getItem(key),bookKey);
  await reading.focus();await page.keyboard.press("ArrowDown");
  await expect.poll(()=>reading.evaluate(node=>node.scrollTop>0||node.scrollHeight<=node.clientHeight+1)).toBe(true);
  let position=await settled();
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),saved,"scrolling guidance with arrow keys never moves Mochi");
  while(position.remaining>1){
    const before=position.top;
    await readable(more);
    await more.click();
    await expect.poll(()=>reading.evaluate(node=>node.scrollTop)).toBeGreaterThan(before);
    position=await settled();
  }
  await expect(more).toHaveCount(0);
  await expect(reading).toBeFocused();
  await page.locator(".tide-pause-explanation").scrollIntoViewIfNeeded();
  await readable(page.locator(".tide-pause-explanation"));
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),saved,"revealing all guidance preserves the exact outing trace");
  await reading.evaluate(node=>{node.scrollTop=0;});
}
try {
  await server.listen();
  const origin = new URL(server.resolvedUrls!.local[0]!);
  for(const engine of [chromium,webkit]) {
  const browser = await engine.launch();
  try {
    const probe=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,reducedMotion:"reduce"});
    const probeNetwork=await prepareBrowser(probe,origin,BROWSER_DAY);
    await probe.goto(new URL("/outing/?play",origin).href);await expect(probe.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");
    await sailStory(probe);await expect(probe.getByTestId("tide-world")).toHaveAttribute("data-ready","true");
    const probeRun=probe.getByTestId("tide-run"),tiles=JSON.parse((await probe.getByTestId("tide-world").getAttribute("data-tiles"))!) as {position:{x:number;y:number};x:number;y:number}[];
    const start=tiles.find(tile=>tile.position.x===1&&tile.position.y===2)!;
    await probe.mouse.move(start.x,start.y);await probe.mouse.down();await probe.keyboard.press("i");await expect(probe.getByRole("dialog")).toBeVisible();
    await probe.mouse.up();await probe.keyboard.press("Escape");await expect(probeRun).toBeFocused();await worldAction(probe,"wait",true);
    await expect(probeRun).toHaveAttribute("data-beat","1");
    assert.deepEqual(await probe.evaluate(key=>JSON.parse(localStorage.getItem(key)!).active.moves,bookKey),["wait"],"a release while the guide is open cannot block the next native touch");
    for(const failFiling of [false,true]){
      await probe.evaluate(()=>localStorage.clear());await probe.reload();await expect(probe.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");await sailStory(probe);
      await expect(probe.getByTestId("tide-world")).toHaveAttribute("data-ready","true");
      for(const [index,move] of zeroLens.entries()){
        await expect(probeRun).toHaveAttribute("data-busy","false");
        await guide(probe,move);
        await expect(probeRun).toHaveAttribute("data-beat",String(index+1));
        assert.deepEqual(await probe.evaluate(key=>JSON.parse(localStorage.getItem(key)!).active.moves,bookKey),zeroLens.slice(0,index+1),"each ready command saves the canonical zero-score route exactly once");
      }
      await expect(probeRun).toHaveAttribute("data-busy","false");
      await expect(probe.getByTestId("tide-score")).toHaveText("0");await expect(probe.getByText("Lens safe",{exact:true})).toBeVisible();
      await readable(probe.getByTestId("tide-prize-status"));
      await readable(probe.getByTestId("tide-finish-return"));
      await trayExplanations(probe);
      if(!failFiling)for(const size of [{width:320,height:480},{width:390,height:844},{width:844,height:390}]){
        await probe.setViewportSize(size);
        await readable(probe.getByTestId("tide-prize-status"));
        await readable(probe.getByTestId("tide-finish-return"));
        await guidanceOverflow(probe);
        await buttonControls(probe);await readable(probe.locator(".exp-button-controls-body"));await buttonControls(probe,false);
        await probe.screenshot({path:join(cacheDir,`${engine.name()}-lens-safe-zero-score-${size.width}x${size.height}.png`)});
      }
      await probe.setViewportSize({width:390,height:844});
      await probe.evaluate(({bookKey,failFiling})=>{
        const write=Storage.prototype.setItem,events:(Record<string,unknown>)[]=[];(window as any).__filingEvents=events;let refused=false;
        Storage.prototype.setItem=function(key,value){
          if(key===bookKey||key==="familiar.expedition.local.v2"){
            const parsed=JSON.parse(value);events.push({key,lastMove:parsed.active?.moves?.at(-1)??null,closed:key===bookKey&&parsed.active===null,busy:document.querySelector('[data-testid="tide-run"]')?.getAttribute("data-busy")??null});
            if(failFiling&&key==="familiar.expedition.local.v2"&&!refused){refused=true;throw new DOMException("Saving is blocked","QuotaExceededError");}
          }
          return write.call(this,key,value);
        };
      },{bookKey,failFiling});
      await probe.getByTestId("tide-finish-return").click();
      if(failFiling){
        await expect(probeRun.getByRole("alert")).toHaveText("This return could not be saved. Keep this finished outing open and try again when this browser can save.");
        await probe.waitForTimeout(150);
        const failed=await probe.evaluate(key=>({events:(window as any).__filingEvents,trace:JSON.parse(localStorage.getItem(key)!).active}),bookKey);
        assert.equal(failed.events.filter((event:{key:string})=>event.key==="familiar.expedition.local.v2").length,1,"failed explicit filing is not automatically retried");
        assert.equal(replayTide(failed.trace,failed.trace.moves)?.outcome,"home");assert.deepEqual(failed.trace.moves,[...zeroLens,"home"]);
        await expect(probe.locator('[data-action="home-next"]')).toHaveCount(0);
        await probe.getByTestId("tide-finish").click();
      }
      await expect(probe.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");
      await expect(probe.getByRole("button",{name:"Fit the Beacon Lens",exact:true})).toBeVisible();
      const filed=await probe.evaluate(key=>({events:(window as any).__filingEvents,book:JSON.parse(localStorage.getItem(key)!)}),bookKey);
      assert.equal(filed.events[0].key,bookKey);assert.equal(filed.events[0].lastMove,"home","finish transition is saved before filing");
      assert(filed.events.filter((event:{key:string})=>event.key==="familiar.expedition.local.v2").every((event:{busy:string})=>event.busy==="false"),"harbor filing follows settled presentation");
      assert.equal(filed.events.filter((event:{closed:boolean})=>event.closed).length,1,"the accepted return closes once");assert.equal(filed.book.active,null);
    }
    const finishedTrace={...storyStart("lens"),moves:[...zeroLens,"home"] as Move[]};
    assert.equal(replayTide(finishedTrace,finishedTrace.moves)?.outcome,"home");
    await probe.evaluate(({bookKey,trace})=>{
      localStorage.clear();localStorage.setItem(bookKey,JSON.stringify({version:1,active:trace,days:[]}));
    },{bookKey,trace:finishedTrace});
    await probe.reload();
    await expect(probeRun).toHaveAttribute("data-outcome","home");
    await expect(probe.getByTestId("tide-world")).toHaveAttribute("data-ready","true");
    const restored=await probe.evaluate(key=>localStorage.getItem(key),bookKey);
    await probe.locator('[data-testid="tide-world"] canvas').evaluate(canvas=>canvas.dispatchEvent(new Event("webglcontextlost",{cancelable:true})));
    await expect(probeRun.locator(".exp-fault")).toContainText("The drawing surface stopped.");
    assert.equal(await probe.evaluate(key=>localStorage.getItem(key),bookKey),restored,"renderer failure preserves the restored finished trace");
    await expect(probe.getByTestId("tide-leave")).toBeEnabled();
    await expect(probe.getByTestId("tide-finish")).toBeEnabled();
    await readable(probe.getByTestId("tide-leave"));
    await probe.evaluate(bookKey=>{
      const write=Storage.prototype.setItem,events:{key:string;closed:boolean;refused:boolean}[]=[];(window as any).__faultFilingEvents=events;let refused=false;
      Storage.prototype.setItem=function(key,value){
        if(key===bookKey||key==="familiar.expedition.local.v2"){
          const closed=key===bookKey&&JSON.parse(value).active===null,fail=closed&&!refused;
          events.push({key,closed,refused:fail});
          if(fail){refused=true;throw new DOMException("Saving is blocked","QuotaExceededError");}
        }
        return write.call(this,key,value);
      };
    },bookKey);
    await probe.getByTestId("tide-leave").click();
    await expect(probeRun.locator(".tide-finish [role=alert]")).toHaveText("This return could not be saved. Keep this finished outing open and try again when this browser can save.");
    await probe.waitForTimeout(150);
    const failedFaultReturn=await probe.evaluate(key=>({events:(window as any).__faultFilingEvents,raw:localStorage.getItem(key),home:JSON.parse(localStorage.getItem("familiar.expedition.local.v2")!).home}),bookKey);
    assert.deepEqual(failedFaultReturn.events,[{key:"familiar.expedition.local.v2",closed:false,refused:false},{key:bookKey,closed:true,refused:true}],"a faulted renderer permits one explicit filing attempt without automatic retry");
    assert.equal(failedFaultReturn.raw,restored,"a failed close preserves the exact finished trace for retry");
    assert.deepEqual(failedFaultReturn.home.banked,["lens"],"the harbor prize survives a failed TideBook close");
    await expect(probeRun.locator(".exp-fault")).toBeVisible();
    await expect(probe.locator('[data-action="home-next"]')).toHaveCount(0);
    await probe.getByTestId("tide-leave").click();
    await expect(probe.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");
    await expect(probe.getByRole("button",{name:"Fit the Beacon Lens",exact:true})).toBeVisible();
    const filedFaultReturn=await probe.evaluate(key=>({events:(window as any).__faultFilingEvents,book:JSON.parse(localStorage.getItem(key)!),home:JSON.parse(localStorage.getItem("familiar.expedition.local.v2")!).home}),bookKey);
    assert.equal(filedFaultReturn.events.length,4,"retry makes exactly one further filing attempt");
    assert.equal(filedFaultReturn.events.filter((event:{closed:boolean;refused:boolean})=>event.closed&&!event.refused).length,1,"the faulted story return closes exactly once");
    assert.deepEqual(filedFaultReturn.home.banked,["lens"],"retry does not duplicate the recovered prize");
    assert.equal(filedFaultReturn.book.active,null);assert.deepEqual(filedFaultReturn.book.days,[]);
    probeNetwork.assertClean();await probe.close();
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: "reduce" });
    const errors: string[] = [];
    const cdp=engine===chromium?await page.context().newCDPSession(page):null;
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    const network=await prepareBrowser(page,origin,BROWSER_DAY);

    const run = page.getByTestId("tide-run"), title = page.locator(".exp-departure h1");
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
          await expect(run.getByRole("alert")).toHaveText("This return could not be saved. Keep this finished outing open and try again when this browser can save.");
          await expect(page.getByTestId("tide-finish")).toBeEnabled();
          assert.deepEqual((await home()).banked, key === bookKey ? ["lens"] : []);
          await expect(page.locator('[data-action="home-next"]')).toHaveCount(0);
        }
      } else if (!start.story) {
        await expect(run.getByRole("alert")).toHaveText("This return could not be saved. Keep this finished outing open and try again when this browser can save.");
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
    const storyPreparation=page.locator('.exp-panel[data-surface="story"]');
    await expect(storyPreparation).toContainText("Chapter 1: First light");
    await expect(storyPreparation).toContainText("Eight waves. Only moving or waiting advances the water.");
    await storyPreparation.locator("summary").click();
    await scrolledRules(storyPreparation);
    await page.screenshot({path:join(cacheDir,`${engine.name()}-chapter-1-preparation-390x844.png`)});
    await storyPreparation.getByRole("button",{name:"Sail with Mochi",exact:true}).click();
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
      await guidanceOverflow(page);
      await buttonControls(page);await readable(page.locator(".exp-button-controls-body"));await buttonControls(page,false);
      await page.screenshot({path:join(cacheDir,`${engine.name()}-hints-${size.width}x${size.height}.png`)});
    }
    await page.setViewportSize({width:390,height:844});
    await buttonControls(page);await expect(page.locator('[data-move="wait"]')).toBeVisible();await buttonControls(page,false);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),untouched,"optional controls only reveal alternatives");
    const summary=page.locator(".exp-button-controls summary");await summary.focus();await page.keyboard.press("Space");await page.keyboard.press("Space");
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),untouched,"summary Space never waits");
    await page.evaluate(()=>{document.body.tabIndex=-1;document.body.focus();});await page.keyboard.press("ArrowUp");
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),untouched,"letter and direction shortcuts need game focus");
    await trayExplanations(page);
    const guideButton=page.getByTestId("tide-guide");await guideButton.tap();await expect(page.getByRole("dialog")).toBeVisible();
    await scrolledRules(page.getByRole("dialog"));
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
    await page.getByRole("button", { name: "Fit the Beacon Lens" }).click();

    await expect(page.locator(".exp-departure-heading p")).toHaveText("The beacon is lit. Bram needs the Signal Vane to read the wind. Bring it home from the right shell.");
    await expect(page.getByRole("button",{name:"Today’s tide · optional",exact:true})).toBeVisible();
    const beforeOptional=await page.evaluate(key=>localStorage.getItem(key),bookKey);
    await page.getByRole("button",{name:"Today’s tide · optional",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Today’s Tide Run",exact:true})).toBeVisible();
    await expect(page.getByRole("dialog")).toContainText("Your first finished daily outing sets that day’s score and stamps, even if the tide turns or Bram brings Mochi home. Later sails are practice. Pausing does not finish an outing.");
    await page.screenshot({path:join(cacheDir,`${engine.name()}-optional-daily-390x844.png`)});
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),beforeOptional,"opening optional daily preparation does not start or score an outing");
    await sailStory(page);
    await expect(page.getByTestId("tide-feedback")).toHaveText("The beacon is lit. Bram needs the Signal Vane to read the wind. Bring it home from the right shell.");
    await press(route(storyStart("vane")).keys.slice(0, 3));
    await trayExplanations(page);
    await page.screenshot({path:join(cacheDir,`${engine.name()}-vane-beat-3-readable-390x844.png`)});
    await page.reload();
    await passTitle(true);
    await expect(run).toHaveAttribute("data-beat", "3");
    await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready", "true");
    await trayExplanations(page);
    await page.getByTestId("tide-leave").click();
    const pausedVane=await page.evaluate(key=>localStorage.getItem(key),bookKey);
    await expect(page.locator('[data-action="resume"]')).toBeVisible();
    await page.locator('[data-action="resume"]').click();
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),pausedVane,"resume bypasses preparation without rewriting the original trace");
    await expect(run).toHaveAttribute("data-story", "vane");
    await expect(run).toHaveAttribute("data-beat", "3");
    await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("tide-leave").click();
    await harbor();
    await expect(title).toHaveText("The outing is waiting.");
    await page.locator('[data-action="resume"]').click();
    await expect(run).toHaveAttribute("data-story", "vane");
    await expect(run).toHaveAttribute("data-beat", "3");
    await sail(storyStart("vane"), 3);
    await page.getByRole("button",{name:"Fit the Signal Vane",exact:true}).click();
    await page.getByRole("button", { name: "Fit the Signal Vane" }).click();

    await sailStory(page);
    await sail(storyStart("moth"));
    assert.deepEqual((await home()).banked, ["lens", "vane", "moth"]);

    await page.locator('[data-action="tide"]').click();
    const ask = page.locator('.exp-panel[data-surface="tide"]');
    await expect(ask).toBeVisible();
    await expect(ask.locator(".tide-day")).toHaveText(dayLabel(BROWSER_DAY));
    await network.setTime((BROWSER_DAY+1)*86_400_000+43_200_000);
    await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
    await expect(ask.locator(".tide-day")).toHaveText(dayLabel(BROWSER_DAY+1));
    await ask.locator(".exp-primary").click();
    await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready", "true");
    await trayExplanations(page);
    await page.screenshot({path:join(cacheDir,`${engine.name()}-daily-guidance-390x844.png`)});
    const day = Number(await run.getAttribute("data-seed"));
    assert.equal(day, await page.evaluate(() => Math.floor(Date.now() / 86_400_000)));
    const daily = await sail({ seed: day });
    const sheet = page.locator('.exp-panel[data-surface="home"]');
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".tide-home-note")).toHaveCount(0);
    await page.screenshot({path:join(cacheDir,`${engine.name()}-daily-home-390x844.png`)});
    const book = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), bookKey);
    assert.equal(book.active, null);
    assert.deepEqual(book.days.map((entry: { seed: number; moves: string[] }) => [entry.seed, entry.moves.length]), [[day, daily.moves.length]]);
    await sheet.locator(".exp-secondary").click();
    await expect(page.locator('.exp-panel[data-surface="log"] .tide-log-run')).toBeVisible();
    await page.screenshot({path:join(cacheDir,`${engine.name()}-daily-log-390x844.png`)});
    await page.keyboard.press("Escape");
    await page.locator(".exp-departure-buttons > .exp-secondary").click();
    await expect(ask).toBeVisible();await ask.locator(".exp-primary").click();
    await expect(run).toHaveAttribute("data-seed", String(day));
    await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready", "true");
    await buttonControls(page);await page.locator('[data-move="wait"]').tap();await buttonControls(page,false);
    await expect(run).toHaveAttribute("data-busy", "false");
    await page.reload();
    await passTitle(true);
    await expect(run).toHaveAttribute("data-beat", "1");
    await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready", "true");
    await page.getByTestId("tide-leave").click();
    const pausedDaily=await page.evaluate(key=>localStorage.getItem(key),bookKey);
    await network.setTime((day+1)*86_400_000+43_200_000);
    await page.evaluate(()=>document.dispatchEvent(new Event("visibilitychange")));
    await page.locator('[data-action="resume"]').click();
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),pausedDaily,"resuming after UTC rollover preserves the original day and moves");
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
    network.assertClean();
    console.info(`${engine.name()} tide run: ${cdp?"native swipe/tap":"native tap/keyboard"} lens and daily routes, ${cdp?"native gesture cancellation":"keyboard/dialog isolation"}, optional controls, keyboard focus isolation, three story tides, finished reload, failed-save retries, leave and resume, daily Home and log, and practice preserving the first tide passed on a device harbor`);
  } finally { await browser.close(); }
  }
  console.info("Tide run captures:",cacheDir);
} finally { await server.close(); }
