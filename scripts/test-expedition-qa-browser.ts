import assert from "node:assert/strict";
import { mkdir,mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname,join,resolve,sep } from "node:path";
import { chromium,webkit,expect,type Page } from "@playwright/test";

// Compiled static files only: no account server, identity input, signing or chain writes.
const supplied=resolve(process.argv[2]??"web/dist"),staticRoot=await Bun.file(join(supplied,"index.html")).exists()?supplied:join(supplied,".vercel/output/static");
assert(await Bun.file(join(staticRoot,"outing/index.html")).exists(),"Build the web app or pass a prepared release.");
const captures=process.env.FAMILIAR_QA_CAPTURES??await mkdtemp(join(tmpdir(),"familiar-qa-browser-"));await mkdir(captures,{recursive:true});
const baseline=process.argv.includes("--baseline"),quick=process.argv.includes("--quick"),networkOnly=process.argv.includes("--network-only");
const server=Bun.serve({hostname:"127.0.0.1",port:0,idleTimeout:255,async fetch(request){
  const url=new URL(request.url);let pathname:string;try{pathname=decodeURIComponent(url.pathname);}catch{return new Response("Invalid path",{status:400});}
  if(!["GET","HEAD"].includes(request.method)||pathname.split("/").some(p=>p.startsWith("."))||pathname.startsWith("/api/"))return new Response("Static QA only",{status:404});
  let path=resolve(staticRoot,"."+pathname);if(!path.startsWith(staticRoot+sep))return new Response("Not found",{status:404});if(!extname(path))path=join(path,"index.html");
  const file=Bun.file(path);if(!await file.exists())return new Response("Not found",{status:404});
  const headers:Record<string,string>={"content-type":file.type,"cache-control":"no-store"};let bytes=await file.bytes();
  if(/\.(?:html|js|css|json|svg)$/.test(path)&&request.headers.get("accept-encoding")?.includes("gzip")){bytes=new Uint8Array(Bun.gzipSync(bytes));headers["content-encoding"]="gzip";}
  return new Response(request.method==="HEAD"?null:bytes,{headers});
}}),origin=process.argv.includes("--public")?"https://familiar-two.vercel.app":`http://127.0.0.1:${server.port}`,engine=process.argv.includes("--webkit")?webkit:chromium,browser=await engine.launch({headless:true}),results:unknown[]=[],failures:string[]=[];
const key="familiar.expedition.local.v2";
async function ready(page:Page){await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true",{timeout:120000});await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-lease","held");}
async function capture(page:Page,label:string){await page.screenshot({path:join(captures,`${label}.png`)});}
// Rounded corners need inset hits; straight-edge midpoints expose partially covered controls.
async function bounds(page:Page,label:string){
  const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight,x:scrollX,y:scrollY}));
  assert(geometry.scrollWidth<=geometry.width&&geometry.scrollHeight<=geometry.height+1&&geometry.x===0&&geometry.y===0,`${label}: no page scrolling`);
  if(!await page.getByRole("dialog").count())for(const control of await page.locator("button:visible,a:visible").all()){
    const rect=await control.boundingBox();assert(rect&&rect.width>=43.5&&rect.height>=43.5,`${label}: ${await control.textContent()}44px`);
    assert(rect.x>=-.5&&rect.y>=-.5&&rect.x+rect.width<=geometry.width+.5&&rect.y+rect.height<=geometry.height+.5,`${label}: control clipped`);
    assert(await control.evaluate(node=>{const r=node.getBoundingClientRect();return [[r.x+r.width/2,r.y+r.height/2],[r.x+8,r.y+8],[r.right-8,r.y+8],[r.x+8,r.bottom-8],[r.right-8,r.bottom-8],[r.x+r.width/2,r.y+2],[r.x+r.width/2,r.bottom-2],[r.x+2,r.y+r.height/2],[r.right-2,r.y+r.height/2]].every(([x,y])=>{const top=document.elementFromPoint(x!,y!);return top===node||!!top&&node.contains(top);});}),`${label}: control obscured`);
  }
  return geometry;
}
try{
 if(!networkOnly)for(const [width,height,touch]of (quick?[[390,844,true],[1280,800,false]]:[[320,480,true],[390,480,true],[320,568,true],[360,640,true],[390,844,true],[430,932,true],[768,1024,true],[1024,768,true],[844,390,true],[667,375,true],[1280,800,false],[1920,1080,false],[2560,1080,false]]) as [number,number,boolean][]){
  const context=await browser.newContext({viewport:{width,height},hasTouch:touch,isMobile:touch,deviceScaleFactor:touch?2:1,reducedMotion:"reduce"}),page=await context.newPage(),errors:string[]=[],mutations:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));await context.route("**/*",route=>{if(!["GET","HEAD","OPTIONS"].includes(route.request().method())){mutations.push(new URL(route.request().url()).pathname);return route.abort();}return route.continue();});
  try{
   await page.goto(origin+"/outing/");await ready(page);const geometry=await bounds(page,`${width}x${height}-home`);await capture(page,`${width}x${height}-home`);
   const action=page.locator('[data-action="depart"]');if(touch)await action.tap();else await action.click();await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-mode","court");
   await bounds(page,`${width}x${height}-court`);await capture(page,`${width}x${height}-court`);
   const tiles=JSON.parse((await page.getByTestId("expedition-world").getAttribute("data-tiles"))!) as {position:{x:number;y:number};x:number;y:number}[],target=tiles.find(t=>t.position.x===0&&t.position.y===0)!;
   assert(target);if(touch)await page.touchscreen.tap(target.x,target.y);else await page.mouse.click(target.x,target.y);
   await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-position","0,0");await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-busy","false");
   const beforeMenu=await page.evaluate(k=>localStorage.getItem(k),key);if(touch)await page.getByRole("button",{name:"Game menu",exact:true}).tap();else await page.getByRole("button",{name:"Game menu",exact:true}).click();
   await expect(page.getByRole("dialog")).toBeVisible();await capture(page,`${width}x${height}-menu`);await page.keyboard.press("ArrowUp");assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),beforeMenu,"menu blocks game commands");
   await page.keyboard.press("Tab");assert(await page.getByRole("dialog").evaluate(node=>node.contains(document.activeElement)),"dialog contains keyboard focus");
   await page.getByRole("button",{name:"Close panel",exact:true}).click();await page.reload();await ready(page);assert.equal(await page.evaluate(k=>localStorage.getItem(k),key),beforeMenu,"reload preserves exact transcript");
   assert.deepEqual(errors,[]);assert(!mutations.some(path=>/\/(?:wallet|player|relay)(?:\/|$)/.test(path)),"no native identity/signing action");results.push({width,height,touch,geometry,blockedSdkTelemetry:mutations.length,status:"pass"});
  }catch(e){failures.push(`${width}x${height}: ${String(e)}`);await capture(page,`${width}x${height}-failure`);}
  finally{await context.close();}
 }
 if(!baseline){
  const failuresContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"}),failed=await failuresContext.newPage();
  await failed.route("**/assets/Game-*.js",route=>route.abort());await failed.goto(origin+"/outing/");
  await expect(failed.locator("[data-boot-status]")).toContainText("could not download");await expect(failed.getByRole("link",{name:"Reload Familiar"})).toBeVisible();await capture(failed,"after-entry-download-failure");
  await failuresContext.close();
  const sdkContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"}),sdkFailure=await sdkContext.newPage();
  await sdkContext.route("**/*",route=>["GET","HEAD","OPTIONS"].includes(route.request().method())?route.continue():route.abort());
  let blockedSdk=false;await sdkFailure.route("**/assets/PrivyProvider-*.js",route=>{blockedSdk=true;return route.abort();});await sdkFailure.goto(origin+"/outing/");
  await expect.poll(async()=>blockedSdk||await sdkFailure.getByTestId("expedition-game").count()>0).toBe(true);
  // A configured release mounts this lazy module after entry() has already returned.
  if(blockedSdk){await expect(sdkFailure.getByRole("alert")).toContainText("original requests are unchanged");await expect(sdkFailure.getByRole("link",{name:"Reload Familiar"})).toBeVisible();await capture(sdkFailure,"after-lazy-account-download-failure");}
  await sdkContext.close();
  const loadingContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"}),loading=await loadingContext.newPage();let release!:()=>void;const held=new Promise<void>(r=>{release=r;});
  await loading.route("**/assets/expedition-v2/runtime/lens.webp",async route=>{await held;await route.continue();});await loading.goto(origin+"/outing/");
  await expect(loading.getByRole("heading",{name:"Unpacking the harbor."})).toBeVisible();assert.equal(await loading.locator('[data-action="depart"]').count(),0,"No departure before the scene is ready");assert.equal(await loading.evaluate(k=>localStorage.getItem(k),key),null);await capture(loading,"after-art-loading-gate");release();await ready(loading);await expect(loading.locator('[data-action="depart"]')).toBeEnabled();await loadingContext.close();
 }
 if(engine===chromium){
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:"reduce"}),page=await context.newPage(),cdp=await context.newCDPSession(page);
 await context.route("**/*",route=>["GET","HEAD","OPTIONS"].includes(route.request().method())?route.continue():route.abort());
 await cdp.send("Network.enable");await cdp.send("Network.setCacheDisabled",{cacheDisabled:true});await cdp.send("Network.emulateNetworkConditions",{offline:false,latency:400,downloadThroughput:50000,uploadThroughput:50000,connectionType:"cellular3g"});await cdp.send("Emulation.setCPUThrottlingRate",{rate:4});
 const start=Date.now(),navigation=page.goto(origin+"/outing/",{waitUntil:"domcontentloaded",timeout:120000});
 await page.waitForTimeout(2000);await capture(page,`${baseline?"before":"after"}-3g-2s`);const early=await page.locator("body").innerText();if(!baseline)assert(early.includes("Familiar")||early.includes("familiar"),"A cold slow3G load has visible content before module download");
 await navigation;const domMs=Date.now()-start;await ready(page);const readyMs=Date.now()-start;await capture(page,`${baseline?"before":"after"}-3g-ready`);
 await page.locator('[data-action="depart"]').tap();await page.getByRole("button",{name:"Move north",exact:true}).tap();await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-busy","false");
 const beforeOffline=await page.evaluate(k=>localStorage.getItem(k),key);await context.setOffline(true);await page.getByRole("button",{name:"Wait for the tide",exact:true}).tap();await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-busy","false");assert.notEqual(await page.evaluate(k=>localStorage.getItem(k),key),beforeOffline,"accepted local decisions save while offline");
 const resources=await page.evaluate(()=>performance.getEntriesByType("resource").map(e=>{const r=e as PerformanceResourceTiming;return {name:new URL(r.name).pathname,bytes:r.encodedBodySize,duration:r.duration};}).sort((a,b)=>b.bytes-a.bytes).slice(0,12));
 results.push({profile:"cold slow3G, gzip, touch, CPU4",resources,latencyMs:400,downloadBytesPerSecond:50000,uploadBytesPerSecond:50000,cache:false,domMs,readyMs,early,offlineLocalDecision:"pass"});await context.close();
 }
 console.log(JSON.stringify({captures,origin,engine:engine.name(),browser:browser.version(),results,failures,scope:"Browser emulation; no physical device or personal identity/signing actions."},null,2));
 assert.deepEqual(failures,[],"All viewport profiles pass");
}finally{await browser.close();server.stop(true);}
