import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile} from "node:fs/promises";
import {join,resolve} from "node:path";
import {tmpdir} from "node:os";
import {chromium,expect,type Page,type CDPSession} from "@playwright/test";
import {createServer} from "vite";

const phase=process.argv.find(arg=>arg.startsWith("--phase="))?.slice(8)??"after";
const captureArg=process.argv.find(arg=>arg.startsWith("--captures="))?.slice(11);
const scratch=await mkdtemp(join(tmpdir(),"familiar-touch-qa-"));
const captures=captureArg?resolve(captureArg):scratch;await mkdir(captures,{recursive:true});
const server=await createServer({root:resolve(import.meta.dir,"../web"),cacheDir:join(scratch,"vite-cache"),envDir:false,envPrefix:[],logLevel:"error",server:{host:"127.0.0.1",port:0,hmr:false,watch:null}});
await server.listen();const origin=server.resolvedUrls!.local[0]!.replace(/\/$/,"");
const browser=await chromium.launch({headless:true}),key="familiar.expedition.local.v2";
const results:Record<string,unknown>[]=[];
async function state(page:Page){return page.evaluate(key=>{const raw=localStorage.getItem(key);return raw?JSON.parse(raw).active?.state??null:null;},key);}
async function touch(cdp:CDPSession,type:"touchStart"|"touchMove"|"touchEnd"|"touchCancel",point?:{x:number;y:number}){await cdp.send("Input.dispatchTouchEvent",{type,touchPoints:point?[{id:1,x:point.x,y:point.y,radiusX:2,radiusY:2,force:1}]:[]});}
async function open(){const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:"reduce"}),page=await context.newPage();await page.route("**/*",route=>route.request().url().startsWith(origin)&&!new URL(route.request().url()).pathname.startsWith("/api/")?route.continue():route.abort());await page.goto(origin+"/outing/");await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-lease","held");return {context,page,cdp:await context.newCDPSession(page)};}
async function court(page:Page){await page.locator('[data-action="depart"]').tap();await expect.poll(async()=>JSON.parse((await page.getByTestId("expedition-world").getAttribute("data-tiles"))!).length).toBe(15);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));}
async function cell(page:Page,x:number,y:number){const tiles=JSON.parse((await page.getByTestId("expedition-world").getAttribute("data-tiles"))!) as {position:{x:number;y:number};x:number;y:number}[];return tiles.find(tile=>tile.position.x===x&&tile.position.y===y)!;}
try{
  {
    const {context,page,cdp}=await open();await court(page);const before=await state(page),west=await cell(page,0,0);await touch(cdp,"touchStart",west);await touch(cdp,"touchCancel");await page.waitForTimeout(350);const after=await state(page);
    const result={case:"browser-canceled world touch",before,after,spentDecision:after.turn-before.turn};results.push(result);
    await page.screenshot({path:join(captures,`F02-${phase}-touch-cancel.png`),fullPage:false});await writeFile(join(captures,`F02-${phase}-transcript.json`),JSON.stringify(result,null,2)+"\n");await context.close();
  }
  {
    const {context,page,cdp}=await open(),depart=await page.locator('[data-action="depart"]').boundingBox();assert(depart);await touch(cdp,"touchStart",{x:depart.x+depart.width/2,y:depart.y+depart.height/2});await touch(cdp,"touchCancel");await page.waitForTimeout(200);results.push({case:"browser-canceled home button touch",active:await state(page)});await context.close();
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
    const {context,page}=await open();await court(page);const west=await cell(page,0,0);if(input==="mouse")await page.mouse.click(west.x,west.y);else await page.keyboard.press("ArrowLeft");await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-turn","1");assert.deepEqual((await state(page)).commands,["step:west"],`${input} remains equivalent to one genuine touch tap`);results.push({case:`${input} equivalence`,after:await state(page)});await context.close();
  }
  {
    const {context,page}=await open();await court(page);const west=await cell(page,0,0);await page.mouse.click(west.x,west.y,{button:"right"});assert.equal((await state(page)).turn,0);await expect(page.getByTestId("expedition-feedback")).toContainText("stone foothold");results.push({case:"right-click inspects for free",after:await state(page)});await context.close();
  }
  await writeFile(join(captures,`touch-${phase}-results.json`),JSON.stringify({phase,viewport:[390,844],input:"CDP touch events, not a physical device",results},null,2)+"\n");
  console.log(JSON.stringify({phase,captures,cases:results.map(result=>result.case),transcripts:join(captures,`touch-${phase}-results.json`)},null,2));
  assert.equal(results[0]!.spentDecision,0,"A browser-canceled touch must never accept a game decision");
  assert.equal(results[1]!.active,null,"A canceled home-button gesture must not start an outing");
  assert.equal((results[2]!.after as {turn:number}).turn,0,"A drag must not masquerade as a destination tap");
  assert.equal((results[3]!.after as {turn:number}).turn,0,"Press and release must target the same platform even below the drag threshold");
}finally{await browser.close();await server.close();}
