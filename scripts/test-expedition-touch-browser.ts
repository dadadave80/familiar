import { guide, worldAction, buttonControls, departCourt } from "./browser-controls";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {chromium,expect,type Page,type CDPSession} from "@playwright/test";
import {createServer} from "vite";
import {solveCourt} from "./court-solver";
import {cardForDay} from "../web/src/tide/cards";
import {replayRun,solve} from "../web/src/tide/asks";

const phase=process.argv.find(arg=>arg.startsWith("--phase="))?.slice(8)??"after";
const captureArg=process.argv.find(arg=>arg.startsWith("--captures="))?.slice(11);
const scratch=await mkdtemp(join(tmpdir(),"familiar-touch-qa-"));
const captures=captureArg?resolve(captureArg):scratch;await mkdir(captures,{recursive:true});
const server=await createServer({root:resolve(import.meta.dir,"../web"),cacheDir:join(scratch,"vite-cache"),envDir:false,envPrefix:[],logLevel:"error",server:{host:"127.0.0.1",port:0,hmr:false,watch:null}});
await server.listen();const origin=server.resolvedUrls!.local[0]!.replace(/\/$/,"");
const browser=await chromium.launch({headless:true}),key="familiar.expedition.local.v2";
const results:Record<string,unknown>[]=[];
const tideFixtureDay=20771,tideFixtureCard=cardForDay(tideFixtureDay),tideFixtureRoute=solve(tideFixtureCard.tool,tideFixtureCard.asks,tideFixtureCard.best);
assert(tideFixtureRoute?.at(-1)==="return","the tide fixture ends with a real dock return");
const tideFixtureRun=replayRun(tideFixtureCard.tool,tideFixtureRoute.slice(0,-1));
assert(tideFixtureRun&&tideFixtureRun.state.outcome==="active"&&tideFixtureRun.state.resolve<3,"the active tide fixture has taken its one splash");
async function state(page:Page){return page.evaluate(key=>{const raw=localStorage.getItem(key);return raw?JSON.parse(raw).active?.state??null:null;},key);}
async function touch(cdp:CDPSession,type:"touchStart"|"touchMove"|"touchEnd"|"touchCancel",point?:{x:number;y:number}){await cdp.send("Input.dispatchTouchEvent",{type,touchPoints:point?[{id:1,x:point.x,y:point.y,radiusX:2,radiusY:2,force:1}]:[]});}
async function open(tide=false,freshTide=false){const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:"reduce"}),page=await context.newPage();await page.route("**/*",route=>route.request().url().startsWith(origin)&&!new URL(route.request().url()).pathname.startsWith("/api/")?route.continue():route.abort());if(tide)await page.addInitScript(({key,day,state})=>{
 localStorage.setItem(key,JSON.stringify({version:2,home:{banked:["lens"],lit:true,signaled:false,lantern:null},last:null,active:{context:{authority:"local-preview",banked:[],lit:true,signaled:false},state,season:true}}));
 localStorage.setItem("familiar.tide.pending.v1:preview",JSON.stringify({day,late:false}));
 },{key,day:tideFixtureDay,state:freshTide?replayRun(tideFixtureCard.tool,[])!.state:tideFixtureRun!.state});await page.goto(origin+"/outing/?play");await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-lease","held");return {context,page,cdp:await context.newCDPSession(page)};}
/** A device harbor's daily is the tide run; the classic court is still a route on the Harbor chart. */
async function court(page:Page){await page.locator(".exp-phone-dock").getByRole("button",{name:"Harbor chart",exact:true}).tap();await page.locator('.exp-panel[data-surface="chart"] .harbor-routes > li').first().getByRole("button").tap();await page.locator('.exp-panel[data-surface="sail"] .exp-primary').tap();await expect.poll(async()=>JSON.parse((await page.getByTestId("expedition-world").getAttribute("data-tiles"))!).length).toBe(15);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));}
async function cell(page:Page,x:number,y:number){const tiles=JSON.parse((await page.getByTestId("expedition-world").getAttribute("data-tiles"))!) as {position:{x:number;y:number};x:number;y:number}[];return tiles.find(tile=>tile.position.x===x&&tile.position.y===y)!;}
try{
  {
    const {context,page}=await open();
    const dock=page.locator(".exp-phone-dock");
    await expect(dock.getByRole("button")).toHaveCount(4);
    for(const name of ["Harbor chart","Open the tide log","Game menu"])
      await expect(dock.getByRole("button",{name,exact:true})).toBeVisible();
    await expect(dock.getByRole("button",{name:/Satchel/})).toBeVisible();
    await page.setViewportSize({width:844,height:390});
    await expect(dock).toBeHidden();
    await page.getByRole("button",{name:"Game menu",exact:true}).click();
    await page.getByRole("dialog").getByRole("button",{name:"Satchel",exact:true}).click();
    await expect(page.getByRole("heading",{name:"What came home.",exact:true})).toBeVisible();
    await page.keyboard.press("Escape");
    await page.setViewportSize({width:390,height:844});
    await court(page);
    const tray=page.locator(".exp-command-tray");
    assert.equal(await tray.evaluate(node=>getComputedStyle(node).backgroundColor),"rgb(251, 243, 226)","court tray has an opaque card surface");
    assert.equal(await tray.evaluate(node=>getComputedStyle(node).backdropFilter),"none","court tray does not blur the board");
    await expect(page.locator(".exp-control-hints")).toContainText("Swipe to move");
    await expect(page.locator(".exp-directions button:visible")).toHaveCount(0);
    const summary=page.locator(".exp-button-controls summary");
    const summaryBounds=await summary.boundingBox();assert(summaryBounds&&summaryBounds.height>=44,"optional controls have a reachable 44px summary");
    const beforeControls=await state(page);await summary.focus();await page.keyboard.press("Space");
    await expect(page.locator(".exp-button-controls")).toHaveAttribute("open","");
    for(const button of await page.locator(".exp-directions button:visible").all()){
      const bounds=await button.boundingBox();assert(bounds&&bounds.width>=44&&bounds.height>=44,"optional direction controls retain 44px targets");
    }
    assert.equal((await state(page)).turn,beforeControls.turn,"Space on summary only opens controls");
    await page.getByRole("button",{name:"Wait for the tide",exact:true}).tap();
    await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-busy","false");
    assert.deepEqual((await state(page)).commands,["wait"],"native optional Wait accepts exactly one command");
    await buttonControls(page,false);
    await worldAction(page,"wait",true);await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-busy","false");
    assert.deepEqual((await state(page)).commands,["wait","wait"],"Mochi tap and optional Wait are equivalent");
    await expect(page.locator(".exp-directions button:visible")).toHaveCount(0);
    const beforeInspect=(await state(page)).turn;
    const inspect=page.getByRole("button",{name:"Inspect",exact:true});await inspect.tap();
    const shade=page.locator(".exp-panel-shade");
    assert.equal(await shade.evaluate(node=>getComputedStyle(node).backdropFilter),"none","Inspect leaves the court sharp");
    assert.equal(await page.locator(".exp-world").evaluate(node=>getComputedStyle(node).filter),"none","Inspect does not blur the world");
    await page.keyboard.press("Escape");await expect(inspect).toBeFocused();assert.equal((await state(page)).turn,beforeInspect,"Inspect and dismissal spend no decisions");
    await context.close();
  }
  {
    const {context,page}=await open(true),tray=page.locator(".exp-command-tray"),asks=tray.locator(".exp-tray-reading > .tide-outing");
    await expect(asks.locator(".tide-asks>li")).toHaveCount(3);
    const emptyFeedback=page.getByTestId("expedition-feedback");await expect(emptyFeedback).toHaveText("");
    assert(await emptyFeedback.evaluate(node=>{const box=node.getBoundingClientRect();return box.width===0&&box.height===0;}),"empty feedback stays in the DOM without painting a box");
    await expect(page.locator(".exp-mochi-portrait")).toHaveAttribute("src","/assets/ui/mochi-portrait-splashed.webp");
    await expect(page.getByTestId("expedition-objective")).toHaveCount(1);
    const asksBefore=await asks.boundingBox(),movesBefore=await page.locator(".exp-control-hints").boundingBox();
    const dockBottom=await page.getByTestId("expedition-world").evaluate(node=>Math.max(...(JSON.parse(node.getAttribute("data-tiles")!) as {y:number;height:number}[]).map(tile=>tile.y+tile.height/2)));
    const trayBounds=await tray.boundingBox();assert(trayBounds&&trayBounds.y>=dockBottom,"phone tide tray clears the dock platform");
    await tray.locator(".exp-tray-scroll").evaluate(node=>node.scrollTo({top:node.scrollHeight,behavior:"instant"}));
    assert.deepEqual(await asks.boundingBox(),asksBefore,"asks stay pinned above the scrolling reading area");
    assert.deepEqual(await page.locator(".exp-control-hints").boundingBox(),movesBefore,"tide reading never scrolls the movement row away");
    for(const size of [{width:390,height:844},{width:412,height:860},{width:844,height:390}]){
      await page.setViewportSize(size);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      for(const button of await tray.locator(".exp-control-hints summary").all()){
        const bounds=await button.boundingBox();assert(bounds&&bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=size.width+.5&&bounds.y+bounds.height<=size.height+.5,`${size.width}x${size.height}: movement and context actions stay visible without scrolling`);
      }
      if(size.height<=500){
        await expect(page.locator(".exp-phone-dock")).toBeHidden();
        const hud=await page.locator(".exp-hud").boundingBox(),tiles=JSON.parse((await page.getByTestId("expedition-world").getAttribute("data-tiles"))!) as {x:number;y:number;width:number;height:number}[];
        assert(hud&&tiles.every(tile=>hud.x+hud.width<=tile.x-tile.width/2||hud.x>=tile.x+tile.width/2||hud.y+hud.height<=tile.y-tile.height/2||hud.y>=tile.y+tile.height/2),"landscape status card stays clear of the court platforms");
      }
    }
    await worldAction(page,"wait",true);
    await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-busy","false");
    await expect(asks.getByRole("button",{name:"Start this tide over",exact:true})).toBeVisible();
    for(const size of [{width:390,height:844},{width:412,height:860},{width:844,height:390}]){
      await page.setViewportSize(size);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      const bounds=await tray.boundingBox();assert(bounds);
      for(const control of await tray.locator(".tide-asks>li,.tide-restart,.exp-control-hints summary").all()){
        const box=await control.boundingBox();assert(box&&box.x>=bounds.x&&box.x+box.width<=bounds.x+bounds.width+.5&&box.y>=bounds.y&&box.y+box.height<=bounds.y+bounds.height+.5,`${size.width}x${size.height}: slipped asks, restart and actions fit inside the tray`);
      }
    }
    await context.close();
  }
  {
    const {context,page,cdp}=await open();await court(page);const before=await state(page),west=await cell(page,0,0);await touch(cdp,"touchStart",west);await touch(cdp,"touchCancel");await page.waitForTimeout(350);const after=await state(page);
    const result={case:"browser-canceled world touch",before,after,spentDecision:after.turn-before.turn};results.push(result);
    await page.screenshot({path:join(captures,`F02-${phase}-touch-cancel.png`),fullPage:false});await writeFile(join(captures,`F02-${phase}-transcript.json`),JSON.stringify(result,null,2)+"\n");await context.close();
  }
  {
    const {context,page,cdp}=await open(),depart=await page.locator(".exp-departure-buttons > .exp-primary").boundingBox();assert(depart);await touch(cdp,"touchStart",{x:depart.x+depart.width/2,y:depart.y+depart.height/2});await touch(cdp,"touchCancel");await page.waitForTimeout(200);
    await expect(page.getByTestId("tide-run")).toHaveCount(0);const tideRun=await page.evaluate(key=>JSON.parse(localStorage.getItem(key+":tide-run.v1")??"null")?.active??null,key);
    results.push({case:"browser-canceled home button touch",active:await state(page)??tideRun});await context.close();
  }
  {
    const {context,page,cdp}=await open();await court(page);const before=await state(page),center=await cell(page,1,0),west=await cell(page,0,0);await touch(cdp,"touchStart",center);await touch(cdp,"touchMove",west);await touch(cdp,"touchEnd");await page.waitForTimeout(350);results.push({case:"drag ending over neighbor",before,after:await state(page)});await page.screenshot({path:join(captures,`${phase}-drag-to-neighbor.png`),fullPage:false});await context.close();
  }
  {
    const {context,page,cdp}=await open();await court(page);const center=await cell(page,1,0),west=await cell(page,0,0),boundary=(center.x+west.x)/2;await touch(cdp,"touchStart",{x:boundary+3,y:west.y});await touch(cdp,"touchMove",{x:boundary-3,y:west.y});await touch(cdp,"touchEnd");await page.waitForTimeout(120);results.push({case:"release over another target after only six pixels",after:await state(page)});await context.close();
  }
  {
    const {context,page,cdp}=await open();await court(page);const west=await cell(page,0,0);await touch(cdp,"touchStart",west);await page.waitForTimeout(500);await touch(cdp,"touchEnd");await page.waitForTimeout(120);const held=await state(page);assert.equal(held.turn,0,"holding a destination inspects without spending a decision");await expect(page.getByTestId("expedition-feedback")).toContainText("stone foothold");await page.touchscreen.tap(west.x,west.y);await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-turn","1");results.push({case:"hold inspects; genuine tap walks",held,after:await state(page)});await context.close();
  }
  for(const input of ["mouse","keyboard"] as const){
    const {context,page}=await open();await court(page);const west=await cell(page,0,0);if(input==="mouse")await page.mouse.click(west.x,west.y);else await guide(page,"step:west");await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-turn","1");assert.deepEqual((await state(page)).commands,["step:west"],`${input} remains equivalent to one genuine touch tap`);results.push({case:`${input} equivalence`,after:await state(page)});await context.close();
  }
  {
    const {context,page}=await open();await court(page);const west=await cell(page,0,0);await page.mouse.click(west.x,west.y,{button:"right"});assert.equal((await state(page)).turn,0);await expect(page.getByTestId("expedition-feedback")).toContainText("stone foothold");results.push({case:"right-click inspects for free",after:await state(page)});await context.close();
  }
  {
    const {context,page}=await open();await court(page);const game=page.getByTestId("expedition-game");
    await game.focus();await page.keyboard.press("W");await expect(game).toHaveAttribute("data-busy","false");
    assert.deepEqual((await state(page)).commands,["step:north"],"uppercase WASD uses the same canonical movement");
    const summary=page.locator(".exp-button-controls summary");await summary.focus();await page.keyboard.press("a");
    assert.equal((await state(page)).turn,1,"single-letter keys do not move while a native summary is focused");
    await page.evaluate(()=>{document.body.tabIndex=-1;document.body.focus();});await page.keyboard.press("ArrowLeft");
    assert.equal((await state(page)).turn,1,"keyboard movement requires intentional game focus");
    await game.focus();await page.keyboard.press("Control+a");
    await game.evaluate(node=>{node.dispatchEvent(new KeyboardEvent("keydown",{key:"a",repeat:true,bubbles:true}));node.dispatchEvent(new KeyboardEvent("keydown",{key:"d",isComposing:true,bubbles:true}));});
    assert.equal((await state(page)).turn,1,"modifiers, held-key repeat and IME never send commands");
    const beforeInspect=await page.evaluate(k=>localStorage.getItem(k),key);await page.keyboard.press("i");
    await expect(page.getByRole("dialog")).toBeVisible();await page.keyboard.press("ArrowLeft");await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),beforeInspect,"I and dialog keyboard input preserve the exact saved state");
    results.push({case:"focused keyboard shortcuts and native control isolation",after:await state(page)});await context.close();
  }
  for(const gesture of ["short-drag","diagonal","out-and-back","two-fingers","rotate","modal"] as const){
    const {context,page,cdp}=await open();await court(page);const west=await cell(page,0,0);
    await touch(cdp,"touchStart",west);
    if(gesture==="short-drag")await touch(cdp,"touchMove",{x:west.x+20,y:west.y});
    if(gesture==="diagonal")await touch(cdp,"touchMove",{x:west.x+45,y:west.y-45});
    if(gesture==="out-and-back"){await touch(cdp,"touchMove",{x:west.x+45,y:west.y});await touch(cdp,"touchMove",west);}
    if(gesture==="two-fingers")await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{id:1,x:west.x,y:west.y},{id:2,x:west.x+50,y:west.y}]});
    if(gesture==="rotate")await page.setViewportSize({width:844,height:390});
    if(gesture==="modal")await page.getByRole("button",{name:"Inspect",exact:true}).click();
    await touch(cdp,"touchEnd");await page.waitForTimeout(100);
    assert.equal((await state(page)).turn,0,`${gesture}: an unfinished or ambiguous gesture spends no decision`);
    if(gesture==="modal"){await page.keyboard.press("Escape");await worldAction(page,"wait",true);await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-turn","1");}
    results.push({case:`gesture ${gesture}`,after:await state(page)});await context.close();
  }
  for(const [dx,dy,command] of [[0,-70,"step:north"],[-70,0,"step:west"],[70,0,"step:east"]] as const){
    const {context,page,cdp}=await open();await court(page);const from=await cell(page,1,1);
    await touch(cdp,"touchStart",from);await touch(cdp,"touchMove",{x:from.x+dx,y:from.y+dy});await touch(cdp,"touchEnd");
    await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-turn","1");
    await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-busy","false");
    assert.deepEqual((await state(page)).commands,[command],`${command}: one true touch release is one step`);
    if(command==="step:north"){
      const next=await cell(page,1,1);await touch(cdp,"touchStart",next);await touch(cdp,"touchMove",{x:next.x,y:next.y+70});await touch(cdp,"touchEnd");
      await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-turn","2");
      assert.deepEqual((await state(page)).commands,[command,"step:south"]);
    }
    results.push({case:`swipe ${command}`,after:await state(page)});await page.screenshot({path:join(captures,`direct-${command.replace(":","-")}.png`)});await context.close();
  }
  for(const daily of [false,true]){
    const {context,page,cdp}=await open(daily,true);if(!daily)await court(page);
    const route:readonly string[]=daily?tideFixtureRoute!:solveCourt({area:"beacon",tool:"rope",banked:[]},["lens"],{dry:true})!.commands;
    for(const [index,command] of route.entries()){
      if(command.startsWith("step:")){
        const from=await cell(page,1,2),direction=command.slice(5),dx=direction==="west"?-60:direction==="east"?60:0,dy=direction==="north"?-60:direction==="south"?60:0;
        await touch(cdp,"touchStart",from);await touch(cdp,"touchMove",{x:from.x+dx,y:from.y+dy});await touch(cdp,"touchEnd");
      }else if(command.startsWith("take:")||command.startsWith("reel:")){
        const item=command.split(":")[1],target=await cell(page,item==="lens"?0:item==="moth"?2:1,4);await page.touchscreen.tap(target.x,target.y);
      }else await worldAction(page,command,true);
      await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-busy","false");
      const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)!),key);
      const actual=saved.active?.state??saved.last;
      assert.deepEqual(actual.commands,route.slice(0,index+1),"each touch accepts exactly its intended next decision");
    }
    await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-mode","harbor");
    const saved=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)!),key);assert.deepEqual(saved.last.commands,route,"full swipe/tap journey preserves the exact route");
    assert(saved.last.cargo.includes("lens"),"the swipe/tap route returns the lens");
    await page.screenshot({path:join(captures,`direct-${daily?"daily":"beacon"}-return.png`)});
    results.push({case:`full ${daily?"legacy daily court":"Beacon"} touch route`,commands:saved.last.commands});await context.close();
  }
  await writeFile(join(captures,`touch-${phase}-results.json`),JSON.stringify({phase,viewport:[390,844],input:"CDP touch events, not a physical device",results},null,2)+"\n");
  console.log(JSON.stringify({phase,captures,cases:results.map(result=>result.case),transcripts:join(captures,`touch-${phase}-results.json`)},null,2));
  assert.equal(results[0]!.spentDecision,0,"A browser-canceled touch must never accept a game decision");
  assert.equal(results[1]!.active,null,"A canceled home-button gesture must not start a court");
  assert.equal((results[2]!.after as {turn:number}).turn,1,"A qualifying swipe is one movement decision, without a destination tap");
  assert.deepEqual((results[2]!.after as {commands:string[]}).commands,["step:west"]);
  assert.equal((results[3]!.after as {turn:number}).turn,0,"Press and release must target the same platform even below the drag threshold");
}finally{await browser.close();await server.close();}
