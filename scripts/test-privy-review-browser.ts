import assert from "node:assert/strict";
import { lstat, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve, sep } from "node:path";
import { chromium, expect, type BrowserContext, type Page } from "@playwright/test";
import { replayCourt } from "../web/src/expedition/engine";
import type { Command } from "../web/src/expedition/types";

// Usage: bun scripts/test-privy-review-browser.ts RELEASE_DIR_OR_STATIC_DIR [--h1]
// This serves compiled static bytes only. It does not load or proxy the release function.
const arguments_=process.argv.slice(2),h1=arguments_.includes("--h1"),argument=arguments_.find(argument=>!argument.startsWith("--"));
assert(arguments_.filter(argument=>!argument.startsWith("--")).length===1 && arguments_.filter(argument=>argument.startsWith("--")).every(argument=>argument==="--h1"),"Use one release directory and optional --h1.");
assert(argument,"Pass the prepared review release directory, or its .vercel/output/static directory.");
const supplied=resolve(argument);
const staticRoot=await Bun.file(join(supplied,"index.html")).exists()?supplied:join(supplied,".vercel/output/static");
for(const route of ["index.html","plan/index.html","legacy/index.html","privy-spike/index.html",...(h1?["outing/index.html"]:[])])
  assert(await Bun.file(join(staticRoot,route)).exists(),`The review artifact is missing ${route}.`);

async function inventory(directory:string):Promise<string[]> {
  const result:string[]=[];
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const path=join(directory,entry.name),stat=await lstat(path);
    assert(!stat.isSymbolicLink(),`Static review must not serve a symlink: ${relative(staticRoot,path)}`);
    if(entry.isDirectory())result.push(...await inventory(path));else if(entry.isFile())result.push(path);
  }
  return result;
}
const files=await inventory(staticRoot);
for(const path of files) {
  const name=relative(staticRoot,path).split(sep).join("/");
  assert(!/(^|\/)(?:\.env(?:\.|$)|\.git|\.vercel|node_modules|src|functions|services|contracts)(?:\/|$)|\.(?:tsx?|jsx|map)$/.test(name),`Unexpected source/server artifact in static output: ${name}`);
  if(/\.(?:html|[cm]?js|css|json|webmanifest)$/.test(name))
    assert(!/PRIVY_APP_SECRET|VITE_PRIVY_APP_SECRET|RELAYER_PRIVATE_KEY|ROOT_PRIVATE_KEY|NPC_ADMIN_PRIVATE_KEY|NPC_PRIVATE_KEY|NEAR_PRIVATE_KEY|-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{64,}-----END/.test(await Bun.file(path).text()),`Server configuration or PEM key material appears in static output: ${name}`);
}
const server=Bun.serve({hostname:"127.0.0.1",port:0,async fetch(request) {
  if(!["GET","HEAD"].includes(request.method))return new Response("Static review only",{status:405});
  let pathname:string;try{pathname=decodeURIComponent(new URL(request.url).pathname);}catch{return new Response("Invalid path",{status:400});}
  if(pathname.split("/").some(part=>part.startsWith(".")) || /^\/(?:api|src|functions|node_modules)(?:\/|$)/.test(pathname))return new Response("Not found",{status:404});
  const path=resolve(staticRoot,"."+pathname);
  if(path!==staticRoot && !path.startsWith(staticRoot+sep))return new Response("Not found",{status:404});
  let file=Bun.file(path);if(!extname(path))file=Bun.file(join(path,"index.html"));
  if(!await file.exists())return new Response("Not found",{status:404});
  return new Response(request.method==="HEAD"?null:file,{headers:{"content-type":file.type,"cache-control":"no-store"}});
}});
assert(server.port!==3000,"The review test must not use the user's active authentication origin.");
const origin=`http://localhost:${server.port}`;
const captures=await mkdtemp(join(tmpdir(),"familiar-privy-review-browser-"));
const browser=await chromium.launch({headless:true});
const results:unknown[]=[],h1Results:unknown[]=[],blockedMutations=new Map<string,number>();
async function guardMutations(context:BrowserContext) {
  await context.route("**/*",route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===origin || ["GET","HEAD","OPTIONS"].includes(request.method()))return route.continue();
    const label=`${request.method()} ${url.origin}${url.pathname}`;
    blockedMutations.set(label,(blockedMutations.get(label)??0)+1);return route.abort();
  });
}
async function noPageOverflow(page:Page,label:string) {
  const geometry=await page.evaluate(()=>({x:scrollX,y:scrollY,width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));
  assert(geometry.x===0 && geometry.y===0 && geometry.scrollWidth<=geometry.width && geometry.scrollHeight<=geometry.height+1,`${label}: the page must remain inside the viewport`);
  return geometry;
}
async function emptyEmailForm(page:Page,width:number) {
  await expect(page.locator("#privy-dialog")).toBeAttached();
  const email=page.getByPlaceholder("your@email.com",{exact:true});await expect(email).toBeVisible({timeout:15000});await expect(email).toHaveValue("");
  await expect.poll(()=>email.evaluate(node=>{let opacity=1,current:Element|null=node;while(current){opacity*=Number(getComputedStyle(current).opacity);current=current.parentElement;}return opacity;}),{message:"The real provider form has finished fading in",timeout:5000}).toBeGreaterThanOrEqual(.99);
  // The provider animates its sheet even under reduced motion; visibility can precede its final position.
  await expect.poll(async()=>{const bounds=await email.boundingBox(),height=page.viewportSize()!.height;return !!bounds && bounds.x>=0 && bounds.y>=0 && bounds.x+bounds.width<=width+1 && bounds.y+bounds.height<=height+1;},{message:`${width}: settled SDK email field fits the viewport`,timeout:5000}).toBe(true);
}
const dryBeaconCommands=["step:north","step:north","step:west","wait","wait","step:east","step:west","take:lens","step:east","step:west","step:south","step:east","step:south","return"] as const satisfies readonly Command[];
const dryBeacon=replayCourt({area:"beacon",tool:"rope",banked:[]},dryBeaconCommands);
assert(dryBeacon?.outcome==="returned" && dryBeacon.resolve===3 && dryBeacon.turn===14 && JSON.stringify(dryBeacon.cargo)===JSON.stringify(["lens"]),"The compiled integration route must remain a legal dry lens return.");
try {
  for(const path of ["/.env.privy.local","/src/account/PrivyProvider.tsx","/.vercel/output/functions/api.func/index.mjs","/api/v1/privy/wallet"])
    assert.equal((await fetch(origin+path)).status,404,`Static preview must not expose ${path}`);
  assert.equal((await fetch(origin+"/api/v1/privy/wallet",{method:"POST"})).status,405,"The static server must not execute wallet routes");

  for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1280,height:800}]) {
    const context=await browser.newContext({viewport,reducedMotion:"reduce"}),page=await context.newPage(),errors:string[]=[];
    page.on("pageerror",error=>errors.push(error.message));
    await guardMutations(context);
    const response=await page.goto(origin+"/privy-spike/",{waitUntil:"domcontentloaded"});assert.equal(response?.status(),200);
    await expect(page.getByRole("heading",{name:"Check your recovery wallet",exact:true})).toBeVisible();
    const signIn=page.getByRole("button",{name:"Sign in with email",exact:true});
    await expect(signIn).toBeEnabled({timeout:30000});
    const readyGeometry=await noPageOverflow(page,`${viewport.width}-ready`);
    assert.deepEqual(errors,[],"The actual compiled SDK must initialize without browser exceptions");
    await page.screenshot({path:join(captures,`${viewport.width}-compiled-ready.png`)});
    await signIn.click();
    await emptyEmailForm(page,viewport.width);
    await noPageOverflow(page,`${viewport.width}-email-form`);assert.deepEqual(errors,[]);
    await page.screenshot({path:join(captures,`${viewport.width}-compiled-email-form.png`)});
    assert.equal(await page.getByRole("button",{name:"Create my recovery wallet",exact:true}).count(),0,"A fresh private context must not claim a signed-in owner");
    results.push({...viewport,sdkStartup:"passed",emptyEmailForm:"passed",pageScroll:"none",readyGeometry});await context.close();
  }

  if(h1)for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1280,height:800}]) {
    const context=await browser.newContext({viewport,reducedMotion:"reduce"}),page=await context.newPage(),errors:string[]=[],apiMutations:string[]=[];
    page.on("pageerror",error=>errors.push(error.message));
    page.on("request",request=>{const url=new URL(request.url());if(url.origin===origin && url.pathname.startsWith("/api/") && !["GET","HEAD","OPTIONS"].includes(request.method()))apiMutations.push(`${request.method()} ${url.pathname}`);});
    await guardMutations(context);
    const response=await page.goto(origin+"/outing/",{waitUntil:"domcontentloaded"});assert.equal(response?.status(),200);
    const depart=page.getByRole("button",{name:"Set out with Mochi",exact:true});await expect(depart).toBeEnabled({timeout:15000});await expect(depart).toBeInViewport();
    const game=page.getByTestId("expedition-game"),scene=page.getByTestId("expedition-world");
    await expect(game).toHaveAttribute("data-lease","held");await expect(scene).toHaveAttribute("data-ready","true");await expect(game).toHaveAttribute("data-content","first_light_v2");
    const world=await scene.boundingBox();assert(world && world.x===0 && world.y===0 && world.width===viewport.width && world.height===viewport.height,"The compiled game uses an edge-to-edge world");
    const button=await depart.boundingBox();assert(button && button.height>=44,"The primary game action keeps its touch target");
    await noPageOverflow(page,`${viewport.width}-h1-home`);await page.screenshot({path:join(captures,`${viewport.width}-h1-home.png`)});
    await page.getByRole("button",{name:"Game menu",exact:true}).click();await expect(page.getByRole("link",{name:"Earlier First Light game",exact:true})).toHaveAttribute("href","/outing/?classic=1");await page.getByRole("button",{name:"Back to Mochi",exact:true}).click();
    await depart.click();
    for(const [index,command] of dryBeaconCommands.entries()){
      await page.locator(`[data-command="${command}"]`).click();await expect(game).toHaveAttribute("data-busy","false");
      if(command!=="return")await expect(scene).toHaveAttribute("data-turn",String(index+1));
      if(index===4){await noPageOverflow(page,`${viewport.width}-h1-active`);await page.screenshot({path:join(captures,`${viewport.width}-h1-active.png`)});}
    }
    await expect(game).toHaveAttribute("data-mode","harbor");
    const returned=await page.evaluate(()=>JSON.parse(localStorage.getItem("familiar.expedition.local.v2")!));
    assert.deepEqual(returned.last,dryBeacon,"The actual compiled controls produce the exact accepted dry return");assert.deepEqual(returned.home.banked,["lens"]);
    const memories=await page.evaluate(()=>JSON.parse(localStorage.getItem("familiar.expedition.returns.v2:preview")!));assert.equal(memories.length,1);assert.equal(memories[0].disposition,"private-memory");assert.deepEqual(memories[0].commands,dryBeaconCommands,"The durable original return is captured before the active expedition clears");
    await expect(page.locator('[data-action="home-next"]')).toHaveText("Bring the lens to the beacon");await page.locator('[data-action="home-next"]').click();await page.getByRole("button",{name:"Restore the beacon",exact:true}).click();
    await expect(page.locator('[data-action="home-next"]')).toHaveText("Make a little light");await page.locator('[data-action="home-next"]').click();
    const workshop=page.getByRole("dialog",{name:"Workbench",exact:true});await expect(workshop.getByRole("button",{name:"Preview one lantern",exact:true})).toBeEnabled();
    await workshop.getByRole("button",{name:"Preview one lantern",exact:true}).click();await expect(game).toHaveAttribute("data-mode","harbor");
    const light=await page.evaluate(()=>JSON.parse(localStorage.getItem("familiar.expedition.local.v2")!));assert.equal(light.home.lit,true);assert.deepEqual(light.home.lantern,{motif:"crest",socket:"porch"});
    await noPageOverflow(page,`${viewport.width}-h1-workshop`);await page.screenshot({path:join(captures,`${viewport.width}-h1-workshop.png`)});
    await page.getByRole("button",{name:"Workbench",exact:true}).click();await page.getByText("Light’s origin",{exact:true}).click();await expect(page.getByText("Mochi returned with the Beacon Lens. 14 choices with the Rope.",{exact:true})).toBeVisible();await expect(page.getByText(/Static illustration of this device’s validated return, not a recorded screenshot or an accepted NEAR claim/)).toBeVisible();
    await noPageOverflow(page,`${viewport.width}-h1-origin`);
    await page.getByRole("button",{name:"Close panel",exact:true}).click();await page.getByRole("button",{name:"Game menu",exact:true}).click();await page.getByRole("button",{name:"Account & recovery",exact:true}).click();
    const account=page.getByRole("region",{name:"Account and recovery",exact:true}),login=account.getByRole("button",{name:"Continue with email",exact:true});
    await expect(login).toBeEnabled({timeout:30000});await login.scrollIntoViewIfNeeded();await expect(login).toBeInViewport();
    await expect(account.getByRole("button",{name:"Create my testnet player",exact:true})).toHaveCount(0);
    await noPageOverflow(page,`${viewport.width}-h1-account`);await page.screenshot({path:join(captures,`${viewport.width}-h1-account.png`)});
    await login.click();await emptyEmailForm(page,viewport.width);await noPageOverflow(page,`${viewport.width}-h1-account-form`);
    await page.screenshot({path:join(captures,`${viewport.width}-h1-account-email-form.png`)});
    assert.deepEqual(apiMutations,[],"Opening the compiled game's real login form must not call wallet/player APIs");assert.deepEqual(errors,[]);
    h1Results.push({...viewport,world:"edge-to-edge Phaser spatial court",content:"first_light_v2",localBeaconReturn:"14 legal spatial decisions; Resolve3/3; one durable private memory",workshopPreview:"validated local origin; not an accepted NEAR claim",accountProvider:"real Privy empty email form",pageScroll:"none",staticApiMutations:0});await context.close();
  }
  if(h1){
    const context=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:"reduce"}),page=await context.newPage(),errors:string[]=[];
    page.on("pageerror",error=>errors.push(error.message));await guardMutations(context);
    for(const query of ["classic=1","challenge=two-shells-v1"]){await page.goto(origin+"/outing/?"+query);await expect(page.getByTestId("outing-scene")).toBeVisible();await expect(page.getByTestId("expedition-game")).toHaveCount(0);await noPageOverflow(page,query);}
    assert.deepEqual(errors,[],"Explicit classic access and existing v1 invitations must still open the preserved game");await context.close();
    h1Results.push({classicRouting:"explicit classic=1 and challenge=two-shells-v1 preserve the prior game"});
  }

  // Check carried-forward pages plus the selected review home. Byte preservation is a separate manifest check.
  const context=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:"reduce"}),page=await context.newPage(),errors:string[]=[],baseline:unknown[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await context.route("**/*",route=>route.request().url().startsWith(origin+"/")?route.continue():route.abort());
  for(const route of ["/","/plan/","/legacy/"]) {
    const response=await page.goto(origin+route,{waitUntil:"domcontentloaded"});assert.equal(response?.status(),200);
    if(route!=="/plan/")await expect(page.locator("#root")).not.toBeEmpty();
    else await expect(page.getByRole("heading").first()).toBeVisible();
    const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,scrollHeight:document.documentElement.scrollHeight}));
    assert(geometry.scrollWidth<=geometry.width,`Preserved ${route} must not overflow horizontally`);
    baseline.push({route,title:await page.title(),...geometry});await page.screenshot({path:join(captures,route==="/"?"review-root.png":`preserved-${route.slice(1,-1)}.png`)});
  }
  const images=files.filter(path=>/\.(?:png|jpe?g|webp|avif|svg)$/i.test(path)).map(path=>"/"+relative(staticRoot,path).split(sep).join("/"));
  const decoded=await page.evaluate(async paths=>Promise.all(paths.map(async path=>{const image=new Image();image.src=path;try{await image.decode();return {path,width:image.naturalWidth,height:image.naturalHeight,ok:image.naturalWidth>0&&image.naturalHeight>0};}catch{return {path,width:0,height:0,ok:false};}})),images);
  assert(decoded.length>0 && decoded.every(image=>image.ok),`Shipped art failed to decode: ${decoded.filter(image=>!image.ok).map(image=>image.path).join(", ")}`);
  assert.deepEqual(errors,[],"Preserved compiled pages must render without browser exceptions");await context.close();
  console.info(JSON.stringify({staticRoot,staticFiles:files.length,serverSourceFiles:"absent",serverConfigMarkersAndPemPayloads:"absent",functionServing:"disabled",results,h1Results,renderedPages:baseline,decodedImages:decoded.length,blockedExternalMutations:[...blockedMutations].map(([request,count])=>({request,count})),captures,limits:"Compiled artifact, optional local H1 preview flow, and actual Privy SDK startup/empty email forms only. No identity submitted, wallet created, signature requested, chain call broadcast, publishing or device recovery tested. The production function is not served by this test; server endpoint smoke tests are separate. Historical reading-page vertical scroll is preserved. Static marker scanning is not a general secret audit; public SDK PEM-format labels alone are not key material."},null,2));
} finally {await browser.close();await server.stop(true);}
