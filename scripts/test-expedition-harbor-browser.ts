import { guide } from "./browser-controls";
import assert from "node:assert/strict";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {chromium,expect,type Page} from "@playwright/test";
import {createServer,transformWithOxc} from "vite";
import {KeyPair} from "near-api-js";
import courtFixtures from "../contracts/common/fixtures/court.json";
import {cardForDay} from "../web/src/tide/cards";
import {resultTitle,shelfGoods} from "../web/src/tide/run-day";
import {previewDock,seedPreview} from "../web/src/season/data";
import {VALUE,applyMove,legalMoves,startTide,type Move,type TideState} from "../web/src/run/engine";
import {cautiousMove} from "../web/src/run/bot";
import {dayResult} from "../web/src/run/save";
import {BROWSER_DAY,prepareBrowser} from "./browser-fixtures";

// Actual React controller/provider/panel; all account/RPC ports below are isolated synthetic fixtures.
const id="\0expedition-harbor-fixture.tsx",guidanceId="\0expedition-guidance-fixture.tsx",dir=await mkdtemp(join(tmpdir(),"familiar-expedition-harbor-"));
const fixturePublicKey=KeyPair.fromRandom("ed25519").getPublicKey().toString();
let publicViews=0;
const captureRoutes=courtFixtures.cases.filter(row=>["beacon-rope-objective","beacon-rope-rescue"].includes(row.id)).map(row=>({id:row.id,start:row.start,commands:row.commands}));
async function checkHarborLayout(page:Page,width:number,height:number){
 await page.setViewportSize({width,height});
 await page.evaluate(async()=>{await document.fonts.ready;await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));});
 const places=page.locator(".exp-home-places button:visible");
 await expect(places).toHaveCount(width<900?3:4);
 await expect(page.locator(".exp-place-satchel")).toBeVisible({visible:width>=900});
 for(const place of await places.all()){
  const art=place.locator("img");await expect(art).toHaveAttribute("src",/\/assets\/ui\/sign-(beacon|bram|workbench|satchel)\.webp$/);await expect(art).toHaveAttribute("alt","");await expect(art).toHaveAttribute("decoding","async");
  await expect.poll(()=>art.evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth>0)).toBe(true);
 }
 const geometry=await page.evaluate(()=>{
  const visible=(node:Element)=>node.getClientRects().length>0&&getComputedStyle(node).visibility!=="hidden";
  const bounds=(node:Element)=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  return {signs:[...document.querySelectorAll(".exp-home-places button")].filter(visible).map(node=>({name:node.textContent!,...bounds(node)})),
   obstacles:[...document.querySelectorAll(".exp-departure,.exp-phone-dock,.exp-brand")].filter(visible).map(node=>({name:node.className,...bounds(node)})),
   card:bounds(document.querySelector(".exp-departure")!),heading:(()=>{const node=document.querySelector(".exp-departure h1")!;return {...bounds(node),overflow:node.scrollWidth>node.clientWidth+1};})(),
   stamp:[...document.querySelectorAll(".tide-departure-stamp")].map(bounds),
   actions:[...document.querySelectorAll(".exp-departure-buttons>button")].map(node=>({...bounds(node),nowrap:getComputedStyle(node).whiteSpace,overflow:node.scrollWidth>node.clientWidth+1})),
   toast:[...document.querySelectorAll(".exp-feedback")].filter(node=>visible(node)&&!!node.textContent?.trim()).map(bounds)};
 });
 const tag=`${width}x${height}`,overlaps=(a:{x:number;y:number;right:number;bottom:number},b:{x:number;y:number;right:number;bottom:number})=>a.x<b.right-.5&&a.right>b.x+.5&&a.y<b.bottom-.5&&a.bottom>b.y+.5;
 for(const [i,sign] of geometry.signs.entries()){
  assert(sign.x>=0&&sign.y>=0&&sign.right<=width+.5&&sign.bottom<=height+.5,`${tag}: ${sign.name} stays inside the viewport`);
  assert(sign.bottom<=geometry.card.y,`${tag}: ${sign.name}'s stake bottom stays above the harbor card`);
  for(const other of geometry.signs.slice(i+1))assert(!overlaps(sign,other),`${tag}: ${sign.name} and ${other.name} do not overlap`);
  for(const obstacle of geometry.obstacles)assert(!overlaps(sign,obstacle),`${tag}: ${sign.name} clears ${obstacle.name}`);
 }
 assert(geometry.card.x>=0&&geometry.card.right<=width+.5&&geometry.card.bottom<=height+.5,`${tag}: harbor card stays inside the viewport`);
 assert(!geometry.heading.overflow&&geometry.heading.x>=geometry.card.x&&geometry.heading.right<=geometry.card.right&&geometry.heading.y>=geometry.card.y&&geometry.heading.bottom<=geometry.card.bottom,`${tag}: longest harbor heading stays inside the card without overflowing`);
 for(const stamp of geometry.stamp)assert(!overlaps(stamp,geometry.heading),`${tag}: stamp stays clear of the harbor heading`);
 const saved=await page.evaluate(()=>(window as any).__harbor?.port?.state.mode==="saved");
 await expect(page.locator(".exp-departure-heading .exp-preparation")).toHaveCount(saved?1:0);
 await expect(page.locator(".exp-departure").getByRole("button",{name:"Open the tide log",exact:true})).toHaveCount(0);
 for(const action of geometry.actions)assert(action.nowrap==="nowrap"&&!action.overflow,`${tag}: harbor button text never wraps or overflows`);
 if(width>=900||height<=500)for(const action of geometry.actions)assert(Math.abs(action.y-geometry.actions[0]!.y)<3,`${tag}: harbor actions share one row`);
 for(const toast of geometry.toast){
  assert(toast.bottom<=geometry.card.y-6,`${tag}: return toast has a gap above the harbor card`);
  for(const sign of geometry.signs)assert(!overlaps(toast,sign),`${tag}: return toast clears ${sign.name}`);
 }
}
/** A device harbor's daily is the tide run: each layout sails today's last move for real, or seeds the day's state, then checks the harbor card. */
async function checkReturnLayouts(browser:import("@playwright/test").Browser,origin:string){
 const day=20771;
 const sail=(seed:number,pick:(state:TideState)=>Move)=>{let state=startTide({seed});while(state.outcome==="active")state=applyMove(state,pick(state))!.after;return state;};
 const cautious=sail(day,state=>cautiousMove(state,VALUE)),early=sail(day,()=>"home"),rescued=sail(day,state=>legalMoves(state).includes("north")?"north":"wait");
 assert.equal(resultTitle(dayResult(cautious)),"All three kept.");assert(shelfGoods(dayResult(cautious)).some(Boolean),"the cautious tide brings reed or glass for Bram");
 assert.equal(resultTitle(dayResult(early)),"1 of 3 kept.");assert.equal(rescued.outcome,"rescued");assert.equal(resultTitle(dayResult(rescued)),"Nothing kept this time.");
 const shelvedDay=day-3,shelvedTide=sail(shelvedDay,state=>cautiousMove(state,VALUE));
 const scenarios:{name:string;day:number;moves:readonly Move[]|null;title:string;buttons:number;shelved:boolean}[]=[
  {name:"before",day,moves:null,title:"Today’s Tide Run.",buttons:1,shelved:false},
  {name:"all-three",day,moves:cautious.moves,title:"All three kept.",buttons:2,shelved:false},
  {name:"home-early",day,moves:early.moves,title:"1 of 3 kept.",buttons:1,shelved:false},
  {name:"rescued",day,moves:rescued.moves,title:"Nothing kept this time.",buttons:1,shelved:false},
  {name:"shelved",day:shelvedDay,moves:shelvedTide.moves,title:"Tomorrow’s Tide Run.",buttons:1,shelved:true}];
 for(const scenario of scenarios){
  const shelf=previewDock(seedPreview(null,scenario.day),[1,0],scenario.day);assert("market" in shelf);
  const context=await browser.newContext({viewport:{width:412,height:860},reducedMotion:"reduce"}),page=await context.newPage();
  try{
   const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
   const network=await prepareBrowser(page,origin,scenario.day);
   await page.addInitScript(({day,moves,market})=>{
    localStorage.setItem("familiar.expedition.local.v2",JSON.stringify({version:2,home:{banked:["lens","vane","moth"],lit:true,signaled:true,lantern:null},active:null,last:null}));
    if(moves)localStorage.setItem("familiar.expedition.local.v2:tide-run.v1",JSON.stringify({version:1,active:{seed:day,moves:moves.slice(0,-1)},days:[]}));
    if(market)localStorage.setItem("familiar.season.preview.v1",JSON.stringify(market));
   },{day:scenario.day,moves:scenario.moves,market:scenario.shelved?shelf.market:null});
   await page.goto(origin+"/__harbor-game");
   if(scenario.moves){
    const run=page.getByTestId("tide-run");await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready","true",{timeout:20000});
    await expect(run).toHaveAttribute("data-busy","false");await guide(page,scenario.moves.at(-1)!);
    // A tide that ends on its own goes straight home; a finish card waits for a press.
    const finish=page.getByTestId("tide-finish"),homeSheet=page.locator('.exp-panel[data-surface="home"]');
    await expect(finish.or(homeSheet)).toBeVisible({timeout:20000});if(await finish.isVisible())await finish.click();
   }
   await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-lease","held");
   if(scenario.moves){const home=page.locator('.exp-panel[data-surface="home"]');await expect(home).toBeVisible();await home.getByRole("button",{name:"Close panel",exact:true}).click();}
   await expect(page.locator(".exp-departure h1"),scenario.name).toHaveText(scenario.title);
   await expect(page.locator(".tide-departure-stamp")).toBeVisible();if(scenario.moves)await expect(page.getByTestId("expedition-feedback"),scenario.name).not.toHaveText("");
   await expect(page.locator(".exp-departure-buttons>button"),scenario.name).toHaveCount(scenario.buttons);
   for(const [width,height] of [[412,860],[390,844],[844,390],[900,800],[1280,800],[1440,900]])await checkHarborLayout(page,width!,height!);
   assert.equal(await page.evaluate(()=>(window as any).__harbor.sends.length),0,"layout checks send no account action");assert.deepEqual(errors,[],scenario.name);network.assertClean();publicViews+=network.rpc.length;
  }finally{await context.close();}
 }
}
const entry=`
import '/src/browser-globals.ts';
import React,{useEffect,useState} from 'react';import{createRoot}from'react-dom/client';
import{HarborSessionProvider,HarborAccountPanel,useHarborSession}from'/src/expedition/harbor-session.tsx';
import{startCourt,applyCommand,replayCourt}from'/src/expedition/engine.ts';
const root='familiar-game.testnet',pub=${JSON.stringify(fixturePublicKey)};
const owner={playerId:'fixture',network:'testnet',nearAccountId:'alice.'+root,signerPublicKey:pub,signerBindingId:'PRIVATE_IDENTITY_MARKER'};
const fixture=window.__harbor={owner,sends:[],reads:0,hold:false,release:null,pending:null,port:null};
const routes=${JSON.stringify(captureRoutes)};
fixture.captureRoute=async id=>{const row=routes.find(row=>row.id===id),state=replayCourt(row.start,row.commands),context={authority:'near-testnet',network:'testnet',root,accountId:owner.nearAccountId,publicKey:pub,companionId:'mochi.'+root,revision:0,checkpointHash:'a'.repeat(64),banked:[],lit:false,signaled:false};return await fixture.port.captureReturn(state,context)};
const journey={revision:1,banked:['lens'],lit:false,signaled:false,lens_claim:'b'.repeat(64),moth_claim:null,credit:'available',workshop_salvage:1,bram_budget:12,shells:0,burned_shells:0,commission_fulfilled:false,craft:null,polish:null,placement:null};
const items=[{mint:{id:'c'.repeat(64),token_id:'lantern:'+'d'.repeat(64),maker:'other-maker.'+root,origin_claim_id:'f'.repeat(64),motif:'crest',input_hash:'e'.repeat(64),rules_version:'tidebound_h1_v1',content_version:'first_light_v2'},finish:'original',finish_used:false,appearance_version:0}];
fixture.displayLantern=(motif,polished)=>{let item=items.find(i=>i.mint.motif===motif);if(!item){item={...structuredClone(items[0]),mint:{...items[0].mint,id:'7'.repeat(64),token_id:'lantern:'+'9'.repeat(64),origin_claim_id:'8'.repeat(64),motif}};items.push(item);}item.finish=polished?'harbor_polish':'original';item.finish_used=polished;item.appearance_version=polished?1:0;journey.placement={item_id:item.mint.token_id,socket:'porch'};};
fixture.removeHeldLantern=()=>items.splice(0);
const connection={adapter:{accountRoot:root,async restoreSession(){return fixture.owner},async authenticate(){return fixture.owner},async endSession(){},async provisionAccount(){throw Error('must not provision')}},accountExists:async()=>{},client:{root,itemsContract:'items.'+root,
 async snapshot(binding){fixture.reads++;const snapshot=structuredClone({readAt:'synthetic',binding,journey,checkpointHash:'a'.repeat(64),pets:[{token_id:'mochi.'+root}],items,nextItemIndex:null});return fixture.hold?new Promise(resolve=>fixture.release=()=>resolve(snapshot)):snapshot},
 async verifyStack(){},pending(){return fixture.pending},async send(binding,method,args){fixture.sends.push({account:binding.nearAccountId,method,args});journey.commission_fulfilled=true;journey.workshop_salvage=0;journey.bram_budget=0;journey.shells=12;journey.revision++;return 'finalized'},
 async resumeNative(){throw Error('no real resume in fixture')},async reconcileNative(){return 'checked'},async resolveExpiredNative(){return 'not proven'},async view(){throw Error('no unexpected view')},
}};
function Probe(){const session=useHarborSession();fixture.port=session;return <><p data-testid="authority">{session.state.mode}</p><p data-testid="motifs">{session.state.workshop.motifs.join(',')}</p><p data-testid="owned">{session.state.workshop.items.map(i=>i.mint.token_id).join(',')}</p><HarborAccountPanel/>
<button onClick={()=>session.review({kind:'commission'}).catch(()=>{})}>Talk to Bram</button><button onClick={()=>session.refresh().catch(()=>{})}>Refresh fixture</button>
<button onClick={async()=>{const c=session.runContext({banked:[],lit:false,signaled:false});const r=applyCommand(startCourt({area:'beacon',tool:'rope',banked:c.banked}),'return').after;await session.captureReturn(r,c)}}>Keep fixture memory</button>
{session.state.review&&<section role="dialog" aria-label={session.state.review.title}><h2>{session.state.review.title}</h2><p>{session.state.review.description}</p><p>{session.state.review.costs.join(' ')}</p><button onClick={()=>session.confirm(session.state.review.id).catch(()=>{})}>Confirm reviewed action</button><button onClick={()=>session.cancelReview()}>Cancel review</button></section>}</>}
const Game=React.lazy(()=>import('/src/expedition/Game.tsx'));
function GameProbe({initialRestorationComplete}){const session=useHarborSession();fixture.port=session;return <React.Suspense fallback={<p>Opening fixture world</p>}><Game session={session} initialRestorationComplete={initialRestorationComplete} accountPanel={<HarborAccountPanel/>}/></React.Suspense>}
function App(){const[open,setOpen]=useState(true);fixture.close=()=>setOpen(false);fixture.reopen=()=>setOpen(true);const game=location.pathname.endsWith('-game');return <div><p style={game?{position:'fixed',inset:'0 0 auto',zIndex:99999,fontSize:11,margin:0,background:'#fff4df',color:'#20291e',pointerEvents:'none'}:{}}>Synthetic controller fixture · no real identity or chain</p>{open?<HarborSessionProvider connection={connection}>{(_,complete)=>game?<GameProbe initialRestorationComplete={complete}/>:<Probe/>}</HarborSessionProvider>:<p>Controller closed</p>}</div>}
createRoot(document.getElementById('root')).render(<App/>);
`;
const guidanceEntry=`
import '/src/browser-globals.ts';
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import{HarborSessionProvider}from'/src/expedition/harbor-session.tsx';
const Game=React.lazy(()=>import('/src/expedition/Game.tsx'));
const root='familiar-game.testnet',pub=${JSON.stringify(fixturePublicKey)};
const fixture=window.__guidanceLifecycle={requests:[],reads:[],sends:[],port:null};
fixture.binding=name=>({playerId:'fixture-'+name,network:'testnet',nearAccountId:'helper-'+name.toLowerCase()+'.'+root,signerPublicKey:pub,signerBindingId:'synthetic-'+name});
function connection(name){return {name,adapter:{accountRoot:root,restoreSession(){return new Promise(resolve=>fixture.requests.push({name,finish:resolve}))},async authenticate(){return fixture.binding(name)},async endSession(){},async provisionAccount(){throw Error('must not provision')}},accountExists:async()=>{},client:{root,itemsContract:'items.'+root,
 async snapshot(binding){fixture.reads.push(name);return {readAt:'synthetic',binding,checkpointHash:'a'.repeat(64),pets:[{token_id:'mochi.'+root}],items:[],nextItemIndex:null,journey:{revision:1,banked:['lens'],lit:true,signaled:false,lens_claim:'b'.repeat(64),moth_claim:null,credit:'available',workshop_salvage:1,bram_budget:12,shells:0,burned_shells:0,commission_fulfilled:false,craft:null,polish:null,placement:null}}},
 async verifyStack(){},pending(){return null},async send(){fixture.sends.push(name);throw Error('unexpected synthetic signing')},async resumeNative(){throw Error('unexpected resume')},async reconcileNative(){throw Error('unexpected reconcile')},async resolveExpiredNative(){throw Error('unexpected expiry')},async view(){throw Error('unexpected view')},
}}}
function App(){const[current,setCurrent]=useState(()=>connection('A')),[revealed,setRevealed]=useState(false);fixture.replace=name=>setCurrent(connection(name));fixture.reveal=()=>setRevealed(true);return <HarborSessionProvider connection={current}>{(session,complete)=>{fixture.port=session;return <React.Suspense fallback={<p>Opening lifecycle fixture</p>}><output hidden data-testid="guidance-restoration" data-controller={current.name} data-complete={complete}/><Game session={session} initialRestorationComplete={complete} titleHandoffComplete={revealed}/></React.Suspense>}}</HarborSessionProvider>}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`;
async function checkGuidanceLifecycle(browser:import("@playwright/test").Browser,origin:string){
 const guidanceKey="familiar.guidance.keep-wrens-light.v1",saveKey="familiar.expedition.local.v2",bookKey=saveKey+":tide-run.v1";
 const fixture=async(earnedLens=false)=>{
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"}),page=await context.newPage(),errors:string[]=[];
  const network=await prepareBrowser(page,origin,BROWSER_DAY,{guidance:false});page.on("pageerror",error=>errors.push(error.message));
  if(earnedLens)await page.addInitScript(key=>localStorage.setItem(key,JSON.stringify({version:2,home:{banked:["lens"],lit:false,signaled:false,lantern:null},active:null,last:null})),saveKey);
  await page.goto(origin+"/__guidance");await page.bringToFront();
  await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true",{timeout:20000});
  await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-lease","held");
  await expect.poll(()=>page.evaluate(()=>(window as any).__guidanceLifecycle.requests.filter((request:any)=>request.name==="A").length)).toBe(2);
  await expect(page.getByTestId("guidance-restoration")).toHaveAttribute("data-complete","false");
  return {page,async close(){network.assertClean();assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>(window as any).__guidanceLifecycle.sends),[],"guidance lifecycle sends no account action");publicViews+=network.rpc.length;await context.close();}};
 };
 const settle=async(page:Page,name:string,index=-1,bound=false)=>{
  await expect.poll(()=>page.evaluate(({name,index})=>(window as any).__guidanceLifecycle.requests.filter((request:any)=>request.name===name).length>Math.max(0,index),{name,index})).toBe(true);
  await page.evaluate(({name,index,bound})=>{const f=(window as any).__guidanceLifecycle,requests=f.requests.filter((request:any)=>request.name===name),request=requests.at(index);assertFixture(request);request.finish(bound?f.binding(name):null);function assertFixture(value:unknown):asserts value{if(!value)throw Error("Missing deferred restoration");}},{name,index,bound});
 };
 const frames=async(page:Page)=>{await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));};
 const pristine=await fixture();
 try{
  const {page}=pristine,restoration=page.getByTestId("guidance-restoration"),intro=page.getByRole("dialog",{name:"Keep Wren’s Light",exact:true});
  await settle(page,"A",0,true);await frames(page);
  await expect(restoration).toHaveAttribute("data-complete","false");assert.deepEqual(await page.evaluate(()=>(window as any).__guidanceLifecycle.reads),[],"StrictMode cleanup fences the first restore before canonical reads");
  await page.evaluate(()=>(window as any).__guidanceLifecycle.replace("B"));
  await expect(restoration).toHaveAttribute("data-controller","B");await expect(restoration).toHaveAttribute("data-complete","false");
  await settle(page,"A",1,true);await frames(page);
  await expect(restoration).toHaveAttribute("data-complete","false");assert.equal(await page.evaluate(()=>(window as any).__guidanceLifecycle.port.state.binding),null,"old controller completion cannot restore its replacement");
  await settle(page,"B");await expect(restoration).toHaveAttribute("data-complete","true");await frames(page);await expect(intro).toHaveCount(0);
  await page.evaluate(()=>(window as any).__guidanceLifecycle.reveal());await expect(intro).toBeVisible();await expect(intro.getByRole("heading")).toBeFocused();
  await page.evaluate(()=>(window as any).__guidanceLifecycle.replace("C"));
  await expect(restoration).toHaveAttribute("data-controller","C");await expect(restoration).toHaveAttribute("data-complete","false");await expect(intro).toHaveCount(0);
  await settle(page,"C");await expect(restoration).toHaveAttribute("data-complete","true");await frames(page);await expect(intro).toHaveCount(0);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),guidanceKey),null,"cancelling a mismatched introduction changes no preference");
 }finally{await pristine.close();}
 const escaped=await fixture();
 try{
  const {page}=escaped;await settle(page,"A",1);await page.evaluate(()=>(window as any).__guidanceLifecycle.reveal());
  const intro=page.getByRole("dialog",{name:"Keep Wren’s Light",exact:true});await expect(intro.getByRole("heading")).toBeFocused();
  const untouched=await page.evaluate(keys=>keys.map(key=>localStorage.getItem(key)),[saveKey,bookKey]);await page.keyboard.press("Escape");await expect(intro).toHaveCount(0);
  assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),guidanceKey),{version:1,intro:"skip",buttons:false},"Escape records the current automatic introduction choice");
  assert.deepEqual(await page.evaluate(keys=>keys.map(key=>localStorage.getItem(key)),[saveKey,bookKey]),untouched,"Escape changes guidance only");
 }finally{await escaped.close();}
 const interacted=await fixture();
 try{
  const {page}=interacted;await page.getByRole("button",{name:"Game menu",exact:true}).click();await page.getByRole("button",{name:"Back to Mochi",exact:true}).click();
  await page.evaluate(()=>(window as any).__guidanceLifecycle.replace("B"));await expect(page.getByTestId("guidance-restoration")).toHaveAttribute("data-controller","B");
  await settle(page,"A",0,true);await settle(page,"A",1,true);await settle(page,"B");await expect(page.getByTestId("guidance-restoration")).toHaveAttribute("data-complete","true");
  await page.evaluate(()=>(window as any).__guidanceLifecycle.reveal());await frames(page);await expect(page.getByRole("dialog",{name:"Keep Wren’s Light",exact:true})).toHaveCount(0);
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),saveKey),null,"opening and closing a menu does not create progress");assert.equal(await page.evaluate(key=>localStorage.getItem(key),guidanceKey),null,"a prior local interaction suppresses a late introduction without recording Help or Skip");
 }finally{await interacted.close();}
 const local=await fixture();
 try{
  const {page}=local;await page.evaluate(()=>(window as any).__guidanceLifecycle.reveal());
  await page.getByRole("button",{name:"Prepare Chapter 1",exact:true}).click();await page.getByRole("button",{name:"Sail with Mochi",exact:true}).click();
  await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready","true");const trace=await page.evaluate(key=>localStorage.getItem(key),bookKey);
  await page.evaluate(()=>(window as any).__guidanceLifecycle.replace("B"));await expect(page.getByTestId("guidance-restoration")).toHaveAttribute("data-controller","B");
  await settle(page,"A",0,true);await settle(page,"A",1,true);await settle(page,"B",-1,true);
  await expect(page.getByTestId("guidance-restoration")).toHaveAttribute("data-complete","true");
  await page.getByRole("button",{name:"Pause outing",exact:true}).click();await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");
  await frames(page);await expect(page.getByRole("dialog",{name:"Keep Wren’s Light",exact:true})).toHaveCount(0);await expect(page.getByRole("button",{name:"Resume outing",exact:true})).toBeVisible();
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),trace,"restoration and replacement preserve a locally started outing");assert.equal(await page.evaluate(key=>localStorage.getItem(key),guidanceKey),null,"starting local play while restoration waits does not make an introduction choice");
 }finally{await local.close();}
 for(const replacement of ["controller","branch"] as const){
  const repair=await fixture(true);
  try{
   const {page}=repair;await settle(page,"A",1,true);await page.evaluate(()=>(window as any).__guidanceLifecycle.reveal());await expect(page.getByTestId("guidance-restoration")).toHaveAttribute("data-complete","true");
   await page.getByRole("button",{name:"Fit the Beacon Lens",exact:true}).click();await page.getByRole("dialog").getByRole("button",{name:"Fit the Beacon Lens",exact:true}).click();
   const exchange=page.getByRole("dialog",{name:"Wren’s light",exact:true});await expect(exchange).toContainText("Mochi lifts the lens into place. The beacon finds the bay again.");
   const earned=await page.evaluate(key=>localStorage.getItem(key),saveKey);
   if(replacement==="controller"){
    await page.evaluate(()=>(window as any).__guidanceLifecycle.replace("B"));await expect(exchange).toHaveCount(0);await settle(page,"B");
   }else{
    await page.evaluate(async()=>{await (window as any).__guidanceLifecycle.port.selectSaved();});await expect(page.getByTestId("guidance-restoration")).toHaveAttribute("data-complete","true");await expect(exchange).toHaveCount(0);
    await page.evaluate(()=>(window as any).__guidanceLifecycle.port.selectPreview());await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");
   }
   await frames(page);await expect(exchange).toHaveCount(0);assert.equal(await page.evaluate(key=>localStorage.getItem(key),saveKey),earned,`${replacement} cancellation preserves the earned repair`);
   await page.getByRole("button",{name:"Open the tide log",exact:true}).and(page.locator(":visible")).click();const log=page.getByRole("dialog",{name:"Bram’s tide log",exact:true});await expect(log.locator(".tide-memories summary")).toHaveCount(2);
  }finally{await repair.close();}
 }
}
const server=await createServer({configFile:false,root:resolve(import.meta.dir,"../web"),envDir:false,envPrefix:[],cacheDir:join(dir,"vite-cache"),logLevel:"error",
 plugins:[{name:"expedition-harbor-fixture",resolveId(source){return source==="/__harbor-fixture.tsx"?id:source==="/__guidance-fixture.tsx"?guidanceId:undefined;},async load(source){if(source===id||source===guidanceId)return (await transformWithOxc(source===id?entry:guidanceEntry,"harbor-fixture.tsx")).code;},configureServer(server){server.middlewares.use((req,res,next)=>{if(!["/__harbor","/__harbor-game","/__guidance"].includes(req.url??"")){next();return;}res.setHeader("Content-Type","text/html");res.end('<!doctype html><div id="root"></div><script type="module" src="'+(req.url==="/__guidance"?"/__guidance-fixture.tsx":"/__harbor-fixture.tsx")+'"></script>');});}}],server:{host:"127.0.0.1",port:0}});
await server.listen();const origin=server.resolvedUrls!.local[0]!.replace(/\/$/,""),browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage(),external:string[]=[],errors:string[]=[];
 const network=await prepareBrowser(page,origin,BROWSER_DAY);page.on("pageerror",error=>{errors.push(error.message);console.error("Synthetic browser error:",error.message);});
 await page.goto(origin+"/__harbor");await expect(page.getByTestId("authority")).toHaveText("preview");await expect(page.getByText(/alice.familiar-game.testnet · NEAR testnet/)).toBeVisible();
 assert.equal(await page.evaluate(()=>(window as any).__harbor.sends.length),0);
 await page.getByRole("button",{name:"Use saved harbor",exact:true}).click();await expect(page.getByTestId("authority")).toHaveText("saved");await expect(page.getByTestId("motifs")).toHaveText("crest");await expect(page.getByTestId("owned")).toContainText("lantern:");
 assert.equal(await page.evaluate(()=>localStorage.getItem("familiar.first-light.beacon.v1")),null,"canonical workshop needs no local origins");
 await page.getByRole("button",{name:"Talk to Bram",exact:true}).click();const dialog=page.getByRole("dialog",{name:"Bram’s lantern frame",exact:true});await expect(dialog).toContainText("1 workshop salvage → 12 bound Shells");
 assert.equal(await page.evaluate(()=>(window as any).__harbor.sends.length),0,"world review does not send");await dialog.getByRole("button",{name:"Cancel review"}).click();
 await page.getByRole("button",{name:"Talk to Bram",exact:true}).click();await dialog.getByRole("button",{name:"Confirm reviewed action"}).click();await expect(dialog).toHaveCount(0);
 assert.equal(await page.evaluate(()=>(window as any).__harbor.sends.length),1,"one explicit in-world confirmation");
 await page.getByRole("button",{name:"Keep fixture memory",exact:true}).click();await expect.poll(()=>page.evaluate(()=>(window as any).__harbor.port.state.returns.length)).toBe(1);await page.getByText("Return memories",{exact:true}).click();const downloadEvent=page.waitForEvent("download");await page.getByRole("button",{name:"Download return memories",exact:true}).click();const download=await downloadEvent,exported=await Bun.file((await download.path())!).json();
 assert.equal(exported.records.length,1);assert(!JSON.stringify(exported).includes("PRIVATE_IDENTITY_MARKER"));assert(!JSON.stringify(exported).includes("signedTransaction"));
 const second=await page.context().newPage(),secondNetwork=await prepareBrowser(second,origin,BROWSER_DAY);await second.goto(origin+"/__harbor");await expect(second.getByText(/alice.familiar-game.testnet · NEAR testnet/)).toBeVisible();
 const captured=await Promise.all([page.evaluate(()=>(window as any).__harbor.captureRoute('beacon-rope-objective')),second.evaluate(()=>(window as any).__harbor.captureRoute('beacon-rope-rescue'))]);
 assert.notEqual(captured[0].id,captured[1].id);
 for(const tab of [page,second]){const records=await tab.evaluate(()=>JSON.parse((window as any).__harbor.port.exportReturns()).records);assert.equal(records.length,3);assert(records.some((r:any)=>r.cargo.includes('moth')));assert(records.some((r:any)=>r.cargo.length===1&&r.cargo[0]==='lens'));}
 secondNetwork.assertClean();await second.close();
 await page.evaluate(()=>{const f=(window as any).__harbor;f.hold=true;f.oldPort=f.port;localStorage.setItem('fixture-original-pending','EXACT_ORIGINAL_BYTES');});await page.getByRole("button",{name:"Refresh fixture",exact:true}).click();await expect.poll(()=>page.evaluate(()=>!!(window as any).__harbor.release)).toBe(true);
 await page.evaluate(()=>(window as any).__harbor.close());await expect(page.getByText("Controller closed",{exact:true})).toBeVisible();await page.evaluate(()=>(window as any).__harbor.release());
 const closed=await page.evaluate(async()=>{const f=(window as any).__harbor,reads=f.reads,result=await f.oldPort.review({kind:'commission'}).then(()=>"unexpected-success",()=>"closed");return {result,reads,after:f.reads,binding:f.oldPort.state.binding,pending:localStorage.getItem('fixture-original-pending')};});
 assert.equal(closed.result,"closed");assert.equal(closed.reads,closed.after);assert.equal(closed.binding,null);assert.equal(closed.pending,"EXACT_ORIGINAL_BYTES");
 await page.evaluate(()=>{const f=(window as any).__harbor;f.hold=false;f.owner={...f.owner,nearAccountId:'bob.familiar-game.testnet',playerId:'bob'};f.reopen();});await expect(page.getByText(/bob.familiar-game.testnet · NEAR testnet/)).toBeVisible();await expect(page.getByTestId("authority")).toHaveText("preview");
 const gameContext=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"}),game=await gameContext.newPage();
 const gameNetwork=await prepareBrowser(game,origin,BROWSER_DAY);game.on("pageerror",error=>errors.push(error.message));
 await game.goto(origin+"/__harbor-game");await game.bringToFront();await expect(game.getByTestId("expedition-world")).toHaveAttribute("data-ready","true",{timeout:20000});
 await game.getByRole("button",{name:"Game menu",exact:true}).click();await game.getByRole("button",{name:"Account & recovery",exact:true}).click();await expect(game.getByText(/alice.familiar-game.testnet · NEAR testnet/)).toBeVisible();
 await game.getByRole("button",{name:"Use saved harbor",exact:true}).click();await expect.poll(()=>game.evaluate(()=>(window as any).__harbor.port.state.mode)).toBe("saved");await game.getByRole("button",{name:"Close panel",exact:true}).click();
 for(const [width,height] of [[412,860],[390,844],[844,390],[900,800],[1280,800],[1440,900]])await checkHarborLayout(game,width!,height!);
 await game.setViewportSize({width:390,height:844});
 const workbench=game.getByRole("button",{name:"Workbench",exact:true});
 const workbenchBounds=await workbench.boundingBox(),bramBounds=await game.getByRole("button",{name:"Bram",exact:true}).boundingBox();
 assert(workbenchBounds&&bramBounds&&(workbenchBounds.x+workbenchBounds.width<=bramBounds.x||workbenchBounds.x>=bramBounds.x+bramBounds.width||workbenchBounds.y+workbenchBounds.height<=bramBounds.y||workbenchBounds.y>=bramBounds.y+bramBounds.height),"phone Workbench and Bram labels do not overlap");
 await workbench.focus();await game.keyboard.press("Enter");await expect(game.getByRole("button",{name:"Make the Crest lantern",exact:true})).toBeVisible();await expect(game.getByText("Crest lantern · Original finish",{exact:true})).toBeVisible();
 assert.equal(await game.evaluate(()=>localStorage.getItem('familiar.first-light.beacon.v1')),null);assert.equal(await game.evaluate(()=>localStorage.getItem('familiar.expedition.local.v2')),null,"fresh-device canonical view does not invent or merge a local home");
 await expect(game.locator('.exp-owned-item .tb-lantern')).toHaveAttribute('data-motif','crest');await expect(game.locator('.exp-owned-item .tb-lantern')).toHaveAttribute('data-polished','false');
 await game.screenshot({path:join(dir,"fresh-device-canonical-workbench-fixture.png")});
 const workbenchPanel=game.getByRole("dialog");await workbenchPanel.evaluate(n=>n.scrollTo({top:n.scrollHeight,behavior:"instant"}));
 const panelBounds=await workbenchPanel.boundingBox(),closeBounds=await workbenchPanel.getByRole("button",{name:"Close panel",exact:true}).boundingBox(),headingBounds=await workbenchPanel.getByRole("heading").first().boundingBox();
 assert(panelBounds&&closeBounds&&headingBounds&&closeBounds.y>=panelBounds.y&&headingBounds.y>=panelBounds.y,"workbench keeps its heading and close control visible while scrolling");
 await game.keyboard.press("Escape");await expect(workbench).toBeFocused();
 await workbench.click();

 const lantern=await game.getByTestId("expedition-world").evaluate(node=>JSON.parse(node.getAttribute("data-harbor-anchors")!).landmarks.lantern as {x:number;y:number});
 const porchClip={x:lantern.x-20,y:lantern.y-50,width:40,height:75};
 await game.getByRole("button",{name:"Close panel",exact:true}).click();await game.evaluate(async()=>{const f=(window as any).__harbor;f.displayLantern('crest',false);await f.port.refresh();});await expect(game.getByTestId('expedition-world')).toHaveAttribute('data-lantern-motif','crest');await expect(game.getByTestId('expedition-world')).toHaveAttribute('data-lantern-finish','original');await game.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));const crestPixels=await game.screenshot({clip:porchClip});
 await game.evaluate(async()=>{const f=(window as any).__harbor;f.displayLantern('moth',true);await f.port.refresh();});await expect(game.getByTestId('expedition-world')).toHaveAttribute('data-lantern-motif','moth');await expect(game.getByTestId('expedition-world')).toHaveAttribute('data-lantern-finish','harbor_polish');await game.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));const mothPixels=await game.screenshot({clip:porchClip});assert(!crestPixels.equals(mothPixels),'Actual rendered canonical motif/finish must differ at the visible porch prop; changing hidden data attributes alone is insufficient');await game.screenshot({path:join(dir,'canonical-moth-polish-placement-fixture.png')});
 assert.deepEqual(await game.evaluate(()=>(window as any).__harbor.port.state.workshop.motifs),['crest'],"Receiving or displaying another maker’s Moth lantern does not grant their achievement");assert.equal(await game.evaluate(()=>(window as any).__harbor.sends.length),0,"Canonical appearance refresh does not issue a craft, finish or placement transaction");
 await game.getByRole('button',{name:'Workbench',exact:true}).click();const mothItem=game.locator('.exp-owned-item').filter({has:game.getByText('Moth lantern · Harbor polish',{exact:true})});await expect(mothItem.locator('.tb-lantern')).toHaveAttribute('data-motif','moth');await expect(mothItem.locator('.tb-lantern')).toHaveAttribute('data-polished','true');await mothItem.locator('.tb-lantern').evaluate(node=>node.scrollIntoView({block:'center'}));await expect(mothItem.locator('.tb-lantern')).toBeInViewport();await expect(mothItem.getByText('Moth lantern · Harbor polish',{exact:true})).toBeInViewport();await expect(game.getByRole('button',{name:'Make the Moth lantern',exact:true})).toHaveCount(0);await game.screenshot({path:join(dir,'canonical-moth-polish-workbench-fixture.png')});
 await game.getByRole("button",{name:"Make the Crest lantern",exact:true}).click();const makeReview=game.getByRole("dialog",{name:"Make the First Light lantern",exact:true});await expect(makeReview).toContainText("1 protected First Light craft credit");assert.equal(await game.evaluate(()=>(window as any).__harbor.sends.length),0);await makeReview.getByRole("button",{name:"Back",exact:true}).click();
 await game.reload();await expect(game.getByTestId("expedition-world")).toHaveAttribute("data-ready","true",{timeout:20000});await expect.poll(()=>game.evaluate(()=>(window as any).__harbor.port.state.mode)).toBe("saved");
 await game.getByRole("button",{name:"Bram",exact:true}).click();await game.getByRole("button",{name:"Help Bram with the workshop salvage",exact:true}).click();const busyReview=game.getByRole("dialog",{name:"Bram’s lantern frame",exact:true});
 await game.evaluate(()=>{const f=(window as any).__harbor;f.hold=true;f.release=null;});await busyReview.getByRole("button",{name:"Give Bram the salvage",exact:true}).click();await expect.poll(()=>game.evaluate(()=>!!(window as any).__harbor.release)).toBe(true);
 await game.keyboard.press("Escape");assert.deepEqual(errors,[],"Escape during the original confirmation must not cause an uncaught busy-review error");await expect(busyReview).toBeVisible();await expect(busyReview.getByRole("button",{name:"Close panel",exact:true})).toBeDisabled();await expect(busyReview.getByRole("button",{name:"Back",exact:true})).toBeDisabled();assert.equal(await game.evaluate(()=>(window as any).__harbor.sends.length),0,"Checking the original confirmation has not submitted another action");
 await game.evaluate(()=>{const f=(window as any).__harbor;f.hold=false;f.release();});await expect(busyReview).toHaveCount(0);assert.equal(await game.evaluate(()=>(window as any).__harbor.sends.length),1,"The held original confirmation sends exactly once after its check completes");
 await game.evaluate(async()=>{const f=(window as any).__harbor;f.displayLantern('moth',true);await f.port.refresh();});await expect(game.getByTestId('expedition-world')).toHaveAttribute('data-lantern-motif','moth');
 await game.evaluate(async()=>{const f=(window as any).__harbor;f.removeHeldLantern();await f.port.refresh();});await expect(game.getByTestId('expedition-world')).not.toHaveAttribute('data-lantern-motif',/.+/);await expect(game.getByTestId('expedition-world')).not.toHaveAttribute('data-lantern-finish',/.+/);assert.equal(await game.evaluate(()=>(window as any).__harbor.sends.length),1);
 const geometry=await game.evaluate(()=>({x:scrollX,y:scrollY,scroll:document.documentElement.scrollHeight,height:innerHeight}));assert.equal(geometry.x,0);assert.equal(geometry.y,0);assert(geometry.scroll<=geometry.height+1);
 network.assertClean();gameNetwork.assertClean();publicViews+=network.rpc.length+gameNetwork.rpc.length;await gameContext.close();await checkReturnLayouts(browser,origin);await checkGuidanceLifecycle(browser,origin);assert.deepEqual(external,[]);assert.deepEqual(errors,[]);console.log(JSON.stringify({status:"passed",actualReactController:true,actualGameAndPhaser:true,freshDeviceCanonicalMotifAndItem:true,canonicalAppearance:"Crest/original to Moth/polish; hidden after current holding disappears; no achievement inheritance",rememberedExplicitSelectionReload:true,explicitBramReview:true,busyReviewDismissalFenced:true,workingMemoryDownload:true,twoTabDistinctReturns:"both retained through actual Web Locks",lateOwnerFenced:true,guidanceLifecycle:"StrictMode stale restoration, replacement identities, title handoff, local play while restoration waits, no late introduction, controller/branch exchange cancellation",harborLayouts:"fresh, before today’s tide, all three kept, one kept, rescued, longest Tomorrow; six viewports",externalRequests:0,mockedRpcViews:publicViews,chainActions:0,captures:dir,limits:"Synthetic account/RPC ports only; no physical-device, provider-recovery or human-playtest claim."},null,2));
}finally{await browser.close();await server.close();}
