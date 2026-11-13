import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { createServer } from "vite";
import type { Action } from "../web/src/outing/engine";

const captures = await mkdtemp(join(tmpdir(), "familiar-tidebound-browser-"));
const server = await createServer({ cacheDir:join(captures,"vite-cache"), root:resolve(import.meta.dir,"../web"), envDir:false, envPrefix:[], logLevel:"error", server:{host:"127.0.0.1",port:0} });
await server.listen();
const origin = server.resolvedUrls!.local[0]!.replace(/\/$/, "");
const browser = await chromium.launch({headless:true});
const dry:Action[] = ["move:left","wait","move:center","reel:lens","return"];
const rescue:Action[] = ["wait","move:left","move:center","move:right","reel:lens","move:center","move:right","take:moth","move:center","return"];
const key = "familiar.first-light.beacon.v1";
const results:unknown[] = [];
async function play(page:Page, commands:Action[]) {
  for (const command of commands) await page.locator(`[data-action="${command}"]`).click();
}
async function record(page:Page, label:string) {
  await page.evaluate(async () => {await document.fonts.ready;await Promise.all([...document.images].map(i=>i.decode()));});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight), `${label} fits without page scrolling`);
  const primary=await page.locator(".outing-root").getAttribute("data-primary")==="true";
  const world=await page.getByTestId("outing-scene").boundingBox();
  const viewport=page.viewportSize()!;assert(world && world.x===0 && world.y===0 && world.width===viewport.width && world.height===viewport.height,`${label} uses an edge-to-edge game world`);
  if(primary && await page.locator('.of-lanes').count()) {
    const obscured=await page.locator('.of-lanes button').evaluateAll(nodes=>nodes.filter(n=>{const r=n.getBoundingClientRect(),top=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !top || top.closest('button')!==n}).map(n=>n.getAttribute('aria-label')));
    assert.deepEqual(obscured,[],`${label} keeps all three inspection lanes uncovered`);
  }
  const pane=page.locator(".of-panel-page:visible");
  if(primary && await page.getByTestId("placed-lantern").count()) {
    const item=await page.getByTestId("placed-lantern").boundingBox(),hud=await pane.boundingBox();
    assert(item && hud && (item.x+item.width<=hud.x || item.x>=hud.x+hud.width || item.y+item.height<=hud.y || item.y>=hud.y+hud.height),`${label} keeps the placed lantern visible beside the quest`);
  }
  if(primary)assert(await pane.evaluate(n=>n.scrollHeight<=n.clientHeight+1 && n.scrollWidth<=n.clientWidth+1),`${label} fits its primary decision without scrolling`);
  for(const control of await page.locator("button:visible,a:visible,input:visible,textarea:visible,select:visible").all()) {
    if(await control.evaluate(n=>!!n.closest(".of-panel-page")))await control.scrollIntoViewIfNeeded();
    assert(await control.evaluate(n=>{const r=n.getBoundingClientRect();return r.left>=-.5 && r.top>=-.5 && r.right<=innerWidth+.5 && r.bottom<=innerHeight+.5 && scrollX===0 && scrollY===0}),`${label} keeps every action reachable inside the viewport`);
  }
  await pane.evaluate(n=>n.scrollTop=0);
  const small = await page.locator("button:visible, summary:visible, .tb-motifs label:visible, .tb-sockets label:visible").evaluateAll(nodes => nodes.filter(node=>{const r=node.getBoundingClientRect();return r.height<44 || r.width<44;}).map(node=>node.textContent?.trim()));
  assert.deepEqual(small,[], `${label} has 44px control targets`);
  if (await page.locator(".tb-origin-scene:visible").count()) {
    const crop = await page.locator(".tb-origin-scene .mochi-cell").evaluate(cell => {
      const atlas = cell.querySelector("img")!;
      return { clipped:getComputedStyle(cell).overflow === "hidden", ratio:atlas.getBoundingClientRect().width/cell.getBoundingClientRect().width };
    });
    assert(crop.clipped && Math.abs(crop.ratio-4) < .01, "origin shows one registered Mochi pose, not the whole atlas");
  }
  await page.evaluate(()=>window.scrollTo({top:0,behavior:"instant"}));
  await page.screenshot({path:join(captures,`${label}.png`),fullPage:false});
}
try {
  for (const [width,height] of [[320,568],[320,750],[390,844],[768,1024],[1280,800],[1440,900],[1920,1080],[2560,1080],[844,390]]) {
    const size = `${width}x${height}`;
    const context = await browser.newContext({viewport:{width,height},reducedMotion:"reduce"});
    const page = await context.newPage();
    const errors:string[] = [];
    const network:string[] = [];
    page.on("pageerror",e=>errors.push(e.message));
    page.on("request",r=>{if(/rpc|\/api\/|fast-auth/.test(r.url()))network.push(r.url());});
    const start = Date.now();
    await page.goto(origin+"/outing/?classic=1"+(width===390 ? "&VITE_TIDEBOUND_ENABLED=true&network=mainnet" : ""));
    await page.locator('[data-action="depart"]').waitFor();
    const startupMs = Date.now()-start;
    await page.getByRole("tab",{name:"Account",exact:true}).click();
    await expect(page.getByText("Recoverable sign-in and NEAR ownership are not connected here yet. Your lantern remains a local preview.",{exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"Continue with Google",exact:true})).toHaveCount(0);
    await expect(page.locator(".tb-account-harbor")).toHaveCount(0);
    await expect(page.getByText("Owned item confirmed on NEAR testnet.",{exact:false})).toHaveCount(0);
    await record(page,`${size}-account-unavailable`);
    await page.getByRole("tab",{name:"Outing",exact:true}).click();
    await page.locator('[data-action="depart"]').waitFor();
    await record(page,`${size}-harbor`);
    for (const [control,back] of [["Change tool","Use Rope"],["Change outing","Back to harbor"],["Mochi’s memory","Back to harbor"],["Discoveries","Back to harbor"]]) {
      if(["Change tool","Change outing"].includes(control)){await page.getByRole("button",{name:"Prepare outing",exact:true}).click();}
      else if(!await page.getByRole("button",{name:control,exact:true}).isVisible())await page.getByRole("button",{name:"Menu",exact:true}).click();
      await page.getByRole("button",{name:control,exact:true}).click();
      await record(page,`${size}-${control.replaceAll(" ","-")}`);
      await page.getByRole("button",{name:back,exact:true}).click();
    }
    await page.locator('[data-action="depart"]').click();
    const inputAcknowledgmentMs=await page.evaluate(()=>new Promise<number>(resolve=>{
      const scene=document.querySelector('[data-testid="outing-scene"]')!;
      const start=performance.now();
      const observer=new MutationObserver(()=>{if(scene.getAttribute("data-turn")!=="2")return;observer.disconnect();requestAnimationFrame(()=>resolve(performance.now()-start));});
      observer.observe(scene,{attributes:true,attributeFilter:["data-turn"]});
      (document.querySelector('[data-action="move:left"]') as HTMLButtonElement).click();
    }));
    await play(page,["wait"]);
    await record(page,`${size}-active-wave`);
    const beforeResize = await page.evaluate(k=>localStorage.getItem(k),key);
    await page.setViewportSize({width:height,height:width});
    await record(page,`${size}-active-resized`);
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),beforeResize,"resize preserves the exact active transcript");
    await page.setViewportSize({width,height});
    await page.getByRole("button",{name:"Menu",exact:true}).click();
    await record(page,`${size}-menu`);
    await page.getByRole("button",{name:"Outing notes",exact:true}).click();
    await record(page,`${size}-notes`);
    for(const detail of ["Tide guide","Pack & finds","Last turn"]){
      await page.getByRole("button",{name:detail,exact:true}).click();
      await record(page,`${size}-${detail.replaceAll(" ","-")}`);
      await page.getByRole("button",{name:"Back to outing",exact:true}).click();
      await page.getByRole("button",{name:"Menu",exact:true}).click();
      await page.getByRole("button",{name:"Outing notes",exact:true}).click();
    }
    await page.getByRole("button",{name:"Back to outing",exact:true}).click();
    await page.locator('[data-action="move:center"]').click();
    await expect(page.getByTestId("turn-consequence")).toHaveText("Left shell opened. Mochi stayed dry.");
    await record(page,`${size}-visible-shell-consequence`);
    await play(page,dry.slice(3));
    await record(page,`${size}-returned`);
    await page.getByRole("button",{name:"Last turn",exact:true}).click();
    await expect(page.getByTestId("final-turn-result")).toContainText("Mochi returned from Center before the incoming wave");
    await record(page,`${size}-final-turn`);
    await page.getByRole("button",{name:"Back to harbor",exact:true}).click();
    await page.locator('[data-action="install"]').click();
    await page.getByRole("tab",{name:"Workshop",exact:true}).click();
    await record(page,`${size}-craft`);
    await page.getByRole("button",{name:"Choose motif",exact:true}).click();
    await record(page,`${size}-craft-choices`);
    await expect(page.getByText("Bring the wind-moth home to unlock this motif",{exact:true})).toBeVisible();
    await expect(page.getByRole("radio",{name:/Moth/})).toBeDisabled();
    await page.getByRole("button",{name:"Use Crest motif",exact:true}).click();
    await page.getByRole("button",{name:"Preview lantern",exact:true}).click();
    await record(page,`${size}-lantern`);
    await page.getByRole("button",{name:"Choose placement",exact:true}).click();
    await record(page,`${size}-placement`);
    await expect(page.getByTestId("placed-lantern")).toHaveAttribute("data-socket","porch");
    await page.getByRole("radio",{name:/Dock A light/}).check();
    await expect(page.getByTestId("placed-lantern")).toHaveAttribute("data-socket","porch");
    if (width === 1280) {
      await page.getByRole("button",{name:"Place here",exact:true}).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByTestId("placed-lantern")).toBeInViewport();
    } else await page.getByRole("button",{name:"Place here",exact:true}).click();
    await expect(page.getByTestId("placed-lantern")).toHaveAttribute("data-socket","dock");
    await page.reload();
    await expect(page.getByTestId("placed-lantern")).toHaveCount(1);
    await expect(page.getByTestId("placed-lantern")).toHaveAttribute("data-socket","dock");
    await record(page,`${size}-placed-dock-world`);
    await page.getByRole("tab",{name:"Workshop",exact:true}).click();
    await page.getByRole("button",{name:"View origin",exact:true}).click();
    await expect(page.getByText(/Mochi brought the Beacon Lens home. 5 actions with the Rope; a dry crossing/)).toBeVisible();
    await expect(page.getByTestId("outing-scene")).toHaveAttribute("data-lit","true");
    await record(page,`${size}-crest-dock-origin`);
    const saved = await page.evaluate(k=>JSON.parse(localStorage.getItem(k)!),key);
    assert.equal(saved.version,3);
    assert.equal(saved.storycraft.lantern.motif,"crest");
    assert.equal(saved.storycraft.origins.moth,null);
    assert.equal(await page.evaluate(()=>localStorage.getItem("familiar.guest.v1")),null);
    assert.deepEqual(await page.evaluate(()=>Object.keys(localStorage).filter(k=>/^familiar\.(auth|tidebound)/.test(k))),[],"default-disabled account controls create no account or pending-operation records");
    assert.deepEqual(network,[],"local preview makes no RPC or auth calls");
    assert.deepEqual(errors,[]);
    if(width===320 && height===568) {
      const pane=page.locator(".of-panel-page:visible");
      await pane.evaluate(node=>{
        const elements=[node,...node.querySelectorAll("*")];
        const sizes=elements.map(el=>[el,parseFloat(getComputedStyle(el).fontSize)] as const);
        for(const [el,size] of sizes)(el as HTMLElement).style.fontSize=`${size*2}px`;
      });
      assert(await pane.evaluate(node=>node.scrollHeight>node.clientHeight),"200% text uses a contained reading surface");
      for(const control of await pane.locator("button:visible,a:visible").all()) {
        await control.scrollIntoViewIfNeeded();
        assert(await control.evaluate(node=>{const r=node.getBoundingClientRect(),p=node.closest(".of-panel-page")!.getBoundingClientRect();return r.top>=p.top-.5 && r.bottom<=p.bottom+.5 && r.left>=0 && r.right<=innerWidth && scrollX===0 && scrollY===0}),"enlarged-text actions remain reachable without page scrolling");
      }
      assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight && scrollY===0),"enlarged text keeps the page fixed");
      await page.screenshot({path:join(captures,"320x568-enlarged-text-contained-scroll.png"),fullPage:false});
    }
    results.push({width,height,startupMs,inputAcknowledgmentMs,localPreview:"passed"});
    await context.close();
  }
  const context = await browser.newContext({viewport:{width:390,height:844}});
  const page = await context.newPage();
  await page.goto(origin+"/outing/?classic=1");
  await page.locator('[data-action="depart"]').click();
  await play(page,rescue);
  await page.locator('[data-action="install"]').click();
  await page.getByRole("tab",{name:"Workshop",exact:true}).click();
  await page.getByRole("button",{name:"Choose motif",exact:true}).click();
  await page.getByRole("radio",{name:/Moth Wing-shaped/}).check();
  await page.getByRole("button",{name:"Use Moth motif",exact:true}).click();
  await page.getByRole("button",{name:"Preview lantern",exact:true}).click();
  await expect(page.getByTestId("placed-lantern").locator('[data-motif="moth"]')).toHaveCount(1);
  await page.getByText("View origin",{exact:true}).click();
  await expect(page.getByText(/Mochi carried the wind-moth home. 10 actions/)).toBeVisible();
  await record(page,"390-moth-porch-origin");
  await context.close();

  const legacy = await browser.newContext({viewport:{width:390,height:844}});
  const old = await legacy.newPage();
  await old.goto(origin+"/outing/?classic=1");
  await old.evaluate(k=>localStorage.setItem(k,JSON.stringify({version:2,bank:["lens","moth","salvage"],lit:true,signaled:false,active:null})),key);
  await old.reload();
  await expect(old.getByTestId("placed-lantern")).toHaveCount(0);
  await old.getByRole("tab",{name:"Workshop",exact:true}).click();
  await old.getByRole("button",{name:"Record a Beacon memory",exact:true}).click();
  await play(old,dry.slice(0,2));
  await old.reload();
  await play(old,dry.slice(2));
  await old.getByRole("tab",{name:"Workshop",exact:true}).click();
  await expect(old.getByRole("button",{name:"Preview lantern",exact:true})).toBeVisible();
  await old.evaluate(()=>{
    const setItem = Storage.prototype.setItem;
    Object.defineProperty(window,"blockStorycraftSave",{value:true,writable:true,configurable:true});
    Storage.prototype.setItem = function(k,v) {if(k === "familiar.first-light.beacon.v1" && (window as unknown as {blockStorycraftSave:boolean}).blockStorycraftSave)throw new DOMException("Full","QuotaExceededError");return setItem.call(this,k,v);};
  });
  await old.getByRole("button",{name:"Preview lantern",exact:true}).click();
  await expect(old.getByRole("alert")).toContainText("could not be saved");
  await expect(old.getByTestId("placed-lantern")).toHaveCount(0);
  await old.evaluate(()=>{(window as unknown as {blockStorycraftSave:boolean}).blockStorycraftSave=false;});
  await old.getByRole("button",{name:"Try again",exact:true}).click();
  await expect(old.getByTestId("placed-lantern")).toHaveCount(1);
  const migrated = await old.evaluate(k=>JSON.parse(localStorage.getItem(k)!),key);
  assert.deepEqual(migrated.bank,["lens","moth","salvage"]);
  assert.equal(migrated.lit,true);
  assert.equal(migrated.storycraft.origins.moth,null);
  await record(old,"390-migrated-crest");
  await legacy.close();
  console.log(JSON.stringify({results,scenarios:11,captures,limits:"Chromium emulation only; no real-device, account recovery, chain ownership, or human playtest claim."},null,2));
} finally {await browser.close();await server.close();}
