import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { chromium,expect,type Page } from "@playwright/test";
import { createServer } from "vite";
import { applyCommand,findPosition,stepDestination,startCourt } from "../web/src/expedition/engine";
import { solveCourt } from "./court-v2-solver";
import type { Command,CourtState } from "../web/src/expedition/types";

const captures=await mkdtemp(join(tmpdir(),"familiar-expedition-browser-"));
const server=await createServer({root:resolve(import.meta.dir,"../web"),cacheDir:join(captures,"vite-cache"),envDir:false,envPrefix:[],logLevel:"error",server:{host:"127.0.0.1",port:0}});
await server.listen();const origin=server.resolvedUrls!.local[0]!.replace(/\/$/,"");
const browser=await chromium.launch({headless:true});
const results:unknown[]=[];
const saveKey="familiar.expedition.local.v2";
async function settled(page:Page){await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-busy","false");}
function nextBeat(page:Page,kind:string){return page.evaluate(kind=>new Promise<void>((resolve,reject)=>{const game=document.querySelector('[data-testid="expedition-game"]')!;const timer=setTimeout(()=>{observer.disconnect();reject(Error(`The next ${kind} presentation beat did not start.`));},10000);const observer=new MutationObserver(()=>{if(!game.getAttribute("data-beat")?.endsWith(`:${kind}`))return;clearTimeout(timer);observer.disconnect();resolve();});observer.observe(game,{attributes:true,attributeFilter:["data-beat"]});}),kind);}
async function record(page:Page,label:string){
  await page.evaluate(()=>document.fonts.ready);await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");
  if(await page.getByTestId("expedition-game").getAttribute("data-mode")==="court")await expect.poll(async()=>JSON.parse((await page.getByTestId("expedition-world").getAttribute("data-tiles"))!).length).toBe(15);
  assert(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight&&document.documentElement.scrollWidth<=innerWidth&&scrollX===0&&scrollY===0),`${label}: page never scrolls`);
  const box=await page.getByTestId("expedition-world").boundingBox(),viewport=page.viewportSize()!;
  assert(box&&box.width===viewport.width&&box.height===viewport.height,`${label}: canvas world fills viewport`);
  for(const button of await page.locator("button:visible,a:visible").all()){
    await button.scrollIntoViewIfNeeded();
    const r=await button.boundingBox();assert(r&&r.width>=43.5&&r.height>=43.5,`${label}: ${await button.textContent()} has44px target`);
    assert(r.x>=-.5&&r.y>=-.5&&r.x+r.width<=viewport.width+.5&&r.y+r.height<=viewport.height+.5,`${label}: active control is reachable`);
    if(!await page.getByRole("dialog").count())assert(await button.evaluate(node=>{const r=node.getBoundingClientRect();return [[r.x+r.width/2,r.y+r.height/2],[r.x+8,r.y+8],[r.right-8,r.y+8],[r.x+8,r.bottom-8],[r.right-8,r.bottom-8],[r.x+r.width/2,r.y+2],[r.x+r.width/2,r.bottom-2],[r.x+2,r.y+r.height/2],[r.right-2,r.y+r.height/2]].every(([x,y])=>{const top=document.elementFromPoint(x!,y!);return top===node||!!top&&node.contains(top);});}),`${label}: ${await button.textContent()} is actually clickable above the world`);
  }
  if(await page.getByTestId("expedition-game").getAttribute("data-mode")==="court"&&!await page.getByRole("dialog").count()){
    const tiles=JSON.parse((await page.getByTestId("expedition-world").getAttribute("data-tiles"))!) as {x:number;y:number}[];
    const obscured=await page.evaluate(tiles=>tiles.filter(tile=>document.elementFromPoint(tile.x,tile.y)?.tagName!=="CANVAS"),tiles);
    assert.deepEqual(obscured,[],`${label}: world destinations remain uncovered by menus or HUD`);
  }
  await page.locator(".exp-panel").evaluateAll(nodes=>nodes.forEach(node=>node.scrollTop=0));
  await page.screenshot({path:join(captures,`${label}.png`),fullPage:false});
}
async function act(page:Page,command:Command){
  if(command.startsWith("lure:")){await page.getByRole("button",{name:"Lure the wave",exact:true}).click();await page.getByRole("button",{name:`Lure ${command.slice(5,6).toUpperCase()+command.slice(6)}`,exact:true}).click();}
  else await page.locator(`[data-command="${command}"]`).click();
  await settled(page);
}
async function pointerCell(page:Page,x:number,y:number){
  await expect.poll(async()=>JSON.parse((await page.getByTestId("expedition-world").getAttribute("data-tiles"))!).length).toBe(15);
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const world=page.getByTestId("expedition-world"),tiles=JSON.parse((await world.getAttribute("data-tiles"))!) as {position:{x:number;y:number};x:number;y:number}[];
  const target=tiles.find(tile=>tile.position.x===x&&tile.position.y===y)!;assert(target,"rendered target exists");
  const before=Number(await world.getAttribute("data-turn")),box=(await world.boundingBox())!;await page.mouse.click(box.x+target.x,box.y+target.y);await expect(world).toHaveAttribute("data-turn",String(before+1));await settled(page);
}
async function playRoute(page:Page,commands:readonly Command[],start:CourtState,label:string){
  let state=start;
  for(const [index,input]of commands.entries()){
    const accepted=applyCommand(state,input)!;assert(accepted,"golden route remains legal");
    if(input.startsWith("take:")||input.startsWith("reel:")){
      const target=findPosition(state,input.slice(5) as "lens"|"moth"|"vane")!;await pointerCell(page,target.x,target.y);
      const stored=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),saveKey);
      assert.equal(stored.active.state.commands.at(-1),input,"tapping the find executes exactly its canonical take/reel");
      assert.deepEqual(stored.active.state.position,state.position,"taking the object adds no movement");
      assert.equal(stored.active.state.turn,state.turn+1,"taking the object spends exactly one decision");
      if(input.endsWith("lens"))await record(page,`${label}-carrying-lens`);
    }else if(input.startsWith("step:")){
      const destination=stepDestination(state,input.slice(5) as "north"|"south"|"west"|"east")!;
      await pointerCell(page,destination.x,Math.abs(destination.y-state.position.y)===2?2:destination.y);
    }else await act(page,input);
    state=accepted.after;
    if(state.outcome==="active"){
      await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-turn",String(state.turn));
      await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-position",`${state.position.x},${state.position.y}`);
    }else await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-mode","harbor");
    if(index===6&&state.outcome==="active"){
      const prior=await page.evaluate(key=>localStorage.getItem(key),saveKey);await page.reload();await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),saveKey),prior,"reload never repeats the accepted command or cargo");
    }
  }
  return state;
}
try{
  const quick=process.argv.includes("--quick");
  for(const [width,height]of (quick?[[390,844],[1280,800]]:[[320,568],[390,844],[768,1024],[1280,800],[1920,1080],[2560,1080],[844,390]]).filter(([w])=>!process.argv.some(a=>a.startsWith("--only="))||Number(process.argv.find(a=>a.startsWith("--only="))!.slice(7))===w)){
    const context=await browser.newContext({viewport:{width,height},reducedMotion:"reduce"}),page=await context.newPage(),errors:string[]=[];
    page.on("pageerror",error=>errors.push(error.message));
    await page.route("**/api/**",route=>route.abort());
    await page.goto(`${origin}/outing/`);await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");
    await record(page,`${width}-harbor`);await page.locator('[data-action="depart"]').click();await record(page,`${width}-court`);
    await pointerCell(page,0,0);await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-position","0,0");
    await act(page,"wait");await expect(page.getByTestId("expedition-forecast")).toContainText("Left source → Left wave");
    await record(page,`${width}-marked`);await act(page,"step:east");await expect(page.getByTestId("expedition-feedback")).toContainText("opens");await record(page,`${width}-bridge`);
    if(!quick){
      const beforeResize=await page.evaluate(key=>localStorage.getItem(key),saveKey);await page.setViewportSize({width:height,height:width});await record(page,`${width}-rotated`);assert.equal(await page.evaluate(key=>localStorage.getItem(key),saveKey),beforeResize,"resize preserves the exact accepted transcript");await page.setViewportSize({width,height});
      await act(page,"return");await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-mode","harbor");
      await page.locator('[data-action="depart"]').click();
      const initial=startCourt({area:"beacon",tool:"rope",banked:[]}),route=solveCourt(initial,["lens","moth"],{dry:true})!;assert(route);
      const returned=await playRoute(page,route.commands,initial,`${width}`);assert.equal(returned.resolve,3);assert.deepEqual(returned.cargo,["lens","moth"]);
      await record(page,`${width}-returned`);await expect(page.locator('[data-action="home-next"]')).toHaveText("Bring the lens to the beacon");await page.locator('[data-action="home-next"]').click();await page.getByRole("button",{name:"Restore the beacon",exact:true}).click();
      await expect(page.locator('[data-action="home-next"]')).toHaveText("Make a little light");await page.locator('[data-action="home-next"]').click();await page.getByRole("radio",{name:"Moth",exact:true}).check();await expect(page.locator('.exp-lantern-preview .tb-lantern')).toHaveAttribute("data-motif","moth");await page.getByRole("button",{name:"Preview one lantern",exact:true}).click();await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-lantern-motif","moth");await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-lantern-finish","original");await record(page,`${width}-lantern-home`);
      await page.getByRole("button",{name:"Workbench",exact:true}).click();await page.getByText("Light’s origin",{exact:true}).click();await expect(page.getByText("Mochi returned with the wind-moth. 17 choices with the Rope.",{exact:true})).toBeVisible();await expect(page.getByText(/Static illustration of this device’s validated return/)).toBeVisible();await record(page,`${width}-local-origin`);await page.getByRole("button",{name:"Place at the dock",exact:true}).click();
      const home=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),saveKey);assert(home.home.lit);assert.equal(home.home.lantern.motif,"moth");assert.equal(home.home.lantern.socket,"dock");assert.deepEqual(home.home.banked,["lens","moth"]);
      if(width===390||width===1280){
        await page.getByRole("button",{name:/Change preparation/}).click();await page.getByRole("radio",{name:"Wind Gate",exact:true}).check();await page.getByRole("button",{name:"Sail to Wind Gate",exact:true}).click();
        const wind=startCourt({area:"wind",tool:"rope",banked:["lens","moth"]}),route=solveCourt(wind,["vane"],{dry:true})!;
        await playRoute(page,route.commands,wind,`${width}-wind`);await record(page,`${width}-wind-returned`);
        await page.getByRole("button",{name:/Beacon Light restored/}).click();await page.getByRole("button",{name:"Repair the signal post",exact:true}).click();
        assert((await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),saveKey)).home.signaled,"Wind goal changes the returned harbor");
      }
    }
    assert.deepEqual(errors,[],`${width}: no browser exceptions`);results.push({width,height,canvas:true,actualPointerMove:true,pageScroll:false});await context.close();
  }
  if(!process.argv.includes("--quick")){
    // Normal-motion input buffering and keyboard continuity use actual user events.
    const context=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:"no-preference"}),page=await context.newPage();
    await page.goto(`${origin}/expedition/`);await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");await page.locator('[data-action="depart"]').click();
    await page.locator('[data-command="step:north"]').click();await page.keyboard.press("ArrowRight");await page.keyboard.press("ArrowLeft");await settled(page);
    await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-turn","2");
    assert.deepEqual((await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),saveKey)).active.state.commands,["step:north","step:east"],"one input is buffered; the third cannot skip presentation");
    await page.getByRole("button",{name:"Game menu",exact:true}).click();const paused=await page.evaluate(key=>localStorage.getItem(key),saveKey);await page.keyboard.press("ArrowLeft");assert.equal(await page.evaluate(key=>localStorage.getItem(key),saveKey),paused,"menu gates movement");
    for(let n=0;n<12;n++){await page.keyboard.press("Tab");assert(await page.evaluate(()=>!!document.activeElement?.closest('[role="dialog"]')),"focus stays in the active menu");}
    await page.keyboard.press("Escape");await expect(page.getByRole("dialog")).toHaveCount(0);const waveStarted=nextBeat(page,"wave");await page.keyboard.press("ArrowLeft");await waveStarted;
    const waveState=await page.evaluate(key=>localStorage.getItem(key),saveKey);await page.setViewportSize({width:844,height:390});await settled(page);assert.equal(await page.evaluate(key=>localStorage.getItem(key),saveKey),waveState,"mid-wave resize preserves the accepted command and finishes its presentation");await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-turn","3");await record(page,"normal-motion-wave-resized");await page.setViewportSize({width:1280,height:800});
    const accepted=await page.evaluate(key=>localStorage.getItem(key),saveKey);await page.locator("canvas").dispatchEvent("webglcontextlost");await expect(page.getByRole("button",{name:"Reload the scene",exact:true})).toBeVisible();await page.getByRole("button",{name:"Reload the scene",exact:true}).click();await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");assert.equal(await page.evaluate(key=>localStorage.getItem(key),saveKey),accepted,"drawing-surface retry preserves accepted moves without replaying effects");
    await record(page,"normal-motion-context-recovery");await context.close();
    const pickupContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"no-preference"}),pickup=await pickupContext.newPage();
    await pickup.goto(`${origin}/expedition/`);await expect(pickup.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");await pickup.locator('[data-action="depart"]').click();
    const rescue=solveCourt({area:"beacon",tool:"rope",banked:[]},["lens","moth"],{dry:true})!;
    for(const input of rescue.commands.slice(0,5))await act(pickup,input);
    await pickup.locator('[data-command="step:east"]').click();await expect(pickup.getByTestId("expedition-game")).toHaveAttribute("data-busy","true");await expect(pickup.locator('[data-command="reel:lens"]')).toHaveCount(0);await expect(pickup.getByTestId("expedition-forecast")).toContainText(/Resolving|Mochi is acting/);await expect(pickup.getByRole("region",{name:"Expedition status"})).toContainText("Surge tide 6/24");await settled(pickup);await expect(pickup.locator('[data-command="reel:lens"]')).toBeVisible();
    const pickupStarted=nextBeat(pickup,"pickup");await pickup.locator('[data-command="reel:lens"]').click();await pickupStarted;
    const duringPickup=await pickup.evaluate(key=>localStorage.getItem(key),saveKey);await pickup.setViewportSize({width:844,height:390});await settled(pickup);assert.equal(await pickup.evaluate(key=>localStorage.getItem(key),saveKey),duringPickup,"mid-rope resize never destroys the travelling object or duplicates pickup");assert.deepEqual(JSON.parse(duringPickup!).active.state.cargo,["lens"]);await record(pickup,"normal-motion-rope-resized");
    // The visibility handler is driven explicitly; this is not a physical-device backgrounding claim.
    await pickup.keyboard.press("ArrowRight");await pickup.keyboard.press("ArrowLeft");await pickup.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>true});document.dispatchEvent(new Event("visibilitychange"));window.dispatchEvent(new Event("blur"));});
    const hiddenState=await pickup.evaluate(key=>localStorage.getItem(key),saveKey);await pickup.waitForTimeout(250);assert.equal(await pickup.evaluate(key=>localStorage.getItem(key),saveKey),hiddenState,"hidden/blur clears the one buffered command");
    await pickup.evaluate(()=>{Object.defineProperty(document,"hidden",{configurable:true,get:()=>false});document.dispatchEvent(new Event("visibilitychange"));window.dispatchEvent(new Event("focus"));});await settled(pickup);assert.equal(await pickup.evaluate(key=>localStorage.getItem(key),saveKey),hiddenState,"returning to the page finishes presentation without advancing another turn");await pickupContext.close();
    const shared=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"}),first=await shared.newPage();await first.goto(`${origin}/expedition/`);await expect(first.getByTestId("expedition-game")).toHaveAttribute("data-lease","held");await first.locator('[data-action="depart"]').click();await act(first,"step:west");
    const second=await shared.newPage();await second.goto(`${origin}/expedition/`);await expect(second.getByTestId("expedition-game")).toHaveAttribute("data-lease","blocked");const owned=await second.evaluate(key=>localStorage.getItem(key),saveKey);await second.keyboard.press("ArrowRight");assert.equal(await second.evaluate(key=>localStorage.getItem(key),saveKey),owned,"second tab cannot overwrite the active branch");await first.close();await second.getByRole("button",{name:"Check this tab again",exact:true}).click();await expect(second.getByTestId("expedition-game")).toHaveAttribute("data-lease","held");await expect(second.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");await second.keyboard.press("ArrowRight");await settled(second);assert.deepEqual((await second.evaluate(key=>JSON.parse(localStorage.getItem(key)!),saveKey)).active.state.commands,["step:west","step:east"],"reacquired lease loads the original tab’s latest move");await shared.close();
    const storage=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"}),saving=await storage.newPage();await saving.addInitScript(key=>{const original=Storage.prototype.setItem;(globalThis as unknown as {rejectExpedition:string|null}).rejectExpedition="active";Storage.prototype.setItem=function(name,value){const mode=(globalThis as unknown as {rejectExpedition:string|null}).rejectExpedition;if(mode==="active"&&name===key||mode==="returns"&&name.startsWith("familiar.expedition.returns.v2:"))throw new DOMException("The browser rejected this write.","QuotaExceededError");original.call(this,name,value);};},saveKey);
    await saving.goto(`${origin}/expedition/`);await expect(saving.getByTestId("expedition-game")).toHaveAttribute("data-lease","held");await saving.locator('[data-action="depart"]').click();assert.equal(await saving.evaluate(key=>localStorage.getItem(key),saveKey),null,"rejected first save cannot create a phantom expedition");await expect(saving.getByRole("button",{name:"Check device saving again",exact:true})).toBeVisible();await saving.evaluate(()=>{(globalThis as unknown as {rejectExpedition:string|null}).rejectExpedition=null;});await saving.getByRole("button",{name:"Check device saving again",exact:true}).click();await saving.locator('[data-action="depart"]').click();await act(saving,"step:north");await act(saving,"step:south");await saving.evaluate(()=>{(globalThis as unknown as {rejectExpedition:string|null}).rejectExpedition="returns";});await act(saving,"return");await expect(saving.getByRole("button",{name:"Retry recording this return",exact:true})).toBeVisible();assert.equal((await saving.evaluate(key=>JSON.parse(localStorage.getItem(key)!),saveKey)).active.state.outcome,"returned","failed return write preserves the terminal transcript");await saving.evaluate(()=>{(globalThis as unknown as {rejectExpedition:string|null}).rejectExpedition=null;});await saving.getByRole("button",{name:"Retry recording this return",exact:true}).click();await expect(saving.getByTestId("expedition-game")).toHaveAttribute("data-mode","harbor");assert.equal((await saving.evaluate(()=>JSON.parse(localStorage.getItem("familiar.expedition.returns.v2:preview")!))).length,1,"retry records one original return");
    await saving.locator('[data-action="depart"]').click();for(const input of solveCourt({area:"beacon",tool:"rope",banked:[]},["lens"],{dry:true})!.commands)await act(saving,input);await expect(saving.getByTestId("expedition-game")).toHaveAttribute("data-mode","harbor");await saving.locator('[data-action="home-next"]').click();await saving.evaluate(()=>{(globalThis as unknown as {rejectExpedition:string|null}).rejectExpedition="active";});await saving.getByRole("button",{name:"Restore the beacon",exact:true}).click();assert.equal((await saving.evaluate(key=>JSON.parse(localStorage.getItem(key)!),saveKey)).home.lit,false,"failed repair keeps the previously saved dark beacon");await expect(saving.getByRole("dialog")).toBeVisible();await expect(saving.getByTestId("expedition-feedback")).not.toContainText("Mochi lifts the lens into place");await saving.evaluate(()=>{(globalThis as unknown as {rejectExpedition:string|null}).rejectExpedition=null;});await saving.getByRole("button",{name:"Check device saving again",exact:true}).click();await saving.getByRole("button",{name:"Restore the beacon",exact:true}).click();assert.equal((await saving.evaluate(key=>JSON.parse(localStorage.getItem(key)!),saveKey)).home.lit,true,"repair success appears only after the retry is durable");await saving.locator('[data-action="home-next"]').click();await expect(saving.locator('.exp-lantern-preview .tb-lantern')).toHaveAttribute("data-motif","crest");await expect(saving.getByRole("radio",{name:"Moth",exact:true})).toBeDisabled();await saving.getByRole("button",{name:"Preview one lantern",exact:true}).click();await expect(saving.getByTestId("expedition-world")).toHaveAttribute("data-lantern-motif","crest");await expect(saving.getByTestId("expedition-world")).toHaveAttribute("data-lantern-finish","original");await record(saving,"validated-crest-preview");await storage.close();
    // Asset failure is visible and must not silently replace or erase the stored expedition.
    const failed=await browser.newContext({viewport:{width:390,height:844}}),failure=await failed.newPage();await failure.route("**/assets/expedition-v2/runtime/stone-island-v2.webp",route=>route.abort());await failure.goto(`${origin}/expedition/`);await expect(failure.getByRole("button",{name:"Reload the scene",exact:true})).toBeVisible();await expect(failure.getByRole("alert")).toContainText("artwork did not load");assert.equal(await failure.evaluate(key=>localStorage.getItem(key),saveKey),null,"failed artwork cannot fabricate a new save");await failed.close();
  }
  console.log(JSON.stringify({captures,results},null,2));
}finally{await browser.close();await server.close();}
