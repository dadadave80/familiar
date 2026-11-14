/** A fresh device harbor sails the three story tides and today's tide run, leaving and reloading one of them half way. */
import assert from "node:assert/strict";
import { guide, worldAction, buttonControls, sailStory } from "./browser-controls";
import { BROWSER_DAY, prepareBrowser } from "./browser-fixtures";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, expect, type Locator, type Page } from "@playwright/test";
import { createServer } from "vite";
import { VALUE, applyMove, legalMoves, replayTide, startTide, stepDestination, type Move, type TideStart, type TideState } from "../web/src/run/engine";
import { cautiousMove } from "../web/src/run/bot";
import { CHAPTERS, storyStart } from "../web/src/run/story";
import { dayLabel } from "../web/src/tide/cards";
import { GUIDANCE_KEY } from "../web/src/run/guidance";

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

async function storyComposition(page:Page) {
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await expect.poll(()=>page.getByTestId("expedition-world").evaluate(node=>Boolean(JSON.parse(node.getAttribute("data-harbor-anchors")??"{}").story))).toBe(true);
  const geometry=await page.evaluate(()=>{
    const panel=document.querySelector(".exp-story-panel")!,rect=panel.getBoundingClientRect();
    const story=JSON.parse(document.querySelector('[data-testid="expedition-world"]')!.getAttribute("data-harbor-anchors")!).story;
    return{panel:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},story,width:innerWidth,height:innerHeight};
  });
  assert(geometry.story,"staged art reports actual scene bounds");
  for(const name of ["bram","mochi","lanternRoom",...(geometry.story.keeper?["keeper"]:[])]) {
    const art=geometry.story[name];assert(art&&art.width>0&&art.height>0,`${name} is visible in the held composition`);
    assert(art.x>=0&&art.y>=0&&art.x+art.width<=geometry.width+.5&&art.y+art.height<=geometry.height+.5,`${name} remains inside the viewport`);
    assert(art.y+art.height<=geometry.panel.y+.5,`${name} stays unobscured above the parchment`);
  }
}

async function exposedTideTargets(page:Page,state:TideState) {
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const destinations=legalMoves(state).flatMap(move=>{const position=stepDestination(state,move);return position?[position]:[];});
  const geometry=await page.getByTestId("tide-world").evaluate((node,destinations)=>{
    const tiles=JSON.parse(node.getAttribute("data-tiles")!),actions=JSON.parse(node.getAttribute("data-actions")!),actor=JSON.parse(node.getAttribute("data-actor")!);
    const active=[...tiles.filter((tile:any)=>destinations.some(position=>position.x===tile.position.x&&position.y===tile.position.y)),...actions];
    return{actor,actions:actions.map((action:any)=>action.action),active:active.map((target:any)=>({...target,exposed:[[0,0],[-.45,-.45],[.45,-.45],[-.45,.45],[.45,.45]].every(([x,y])=>document.elementFromPoint(target.x+x!*target.width,target.y+y!*target.height)?.tagName==="CANVAS")})),width:innerWidth,height:innerHeight};
  },destinations);
  assert(geometry.actions.includes("wait"),"labelled Wait remains exposed");
  if(legalMoves(state).includes("home")&&state.moves.length)assert(geometry.actions.includes("home"),"Finish remains exposed at the dock");
  for(const[index,target]of geometry.active.entries()) {
    assert(target.width>=44&&target.height>=44,"every active world target retains a 44px hit area");
    assert(target.exposed&&target.x-target.width/2>=0&&target.x+target.width/2<=geometry.width&&target.y-target.height/2>=0&&target.y+target.height/2<=geometry.height,"active hit areas fit and remain uncovered with native controls open");
    assert(Math.abs(target.x-geometry.actor.x)>=(target.width+geometry.actor.width)/2||Math.abs(target.y-geometry.actor.y)>=(target.height+geometry.actor.height)/2,"Mochi's Phaser exclusion bounds leave every active target usable");
    for(const other of geometry.active.slice(index+1))assert(Math.abs(target.x-other.x)>=(target.width+other.width)/2||Math.abs(target.y-other.y)>=(target.height+other.height)/2,"legal destinations, Wait and Finish do not overlap");
  }
}

async function destinationEdgeTaps(browser:import("@playwright/test").Browser,origin:URL) {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:"reduce"});
  const network=await prepareBrowser(page,origin,BROWSER_DAY);
  try {
    await page.goto(new URL("/outing/?play",origin).href);
    await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");await sailStory(page);
    const run=page.getByTestId("tide-run"),world=page.getByTestId("tide-world");
    await expect(world).toHaveAttribute("data-ready","true");await buttonControls(page,true);
    await expect.poll(()=>page.getByRole("region",{name:"Outing guidance",exact:true}).evaluate(node=>{
      const reading=node.getBoundingClientRect(),tray=node.closest(".passage-tray")!.getBoundingClientRect();
      const controls=node.closest(".tide-controls")!.querySelector(".exp-button-controls")!.getBoundingClientRect();
      return reading.top>=tray.top&&reading.bottom<=controls.top;
    })).toBe(true);
    await exposedTideTargets(page,startTide(storyStart("lens")));
    await freeActorTaps(page,"open controls before destination-edge taps");
    let state=startTide(storyStart("lens"));
    const accept=async(move:Move,act:()=>Promise<void>)=>{
      state=applyMove(state,move)!.after;
      await act();await expect(run).toHaveAttribute("data-beat",String(state.beat));await expect(run).toHaveAttribute("data-busy","false");
      assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).active.moves,bookKey),state.moves,"an edge tap accepts exactly its destination move");
    };
    const directions=["north","west","east"] as const,edges=[[0,-1],[-1,0],[1,0],[0,1]] as const;
    for(const move of directions)for(const [index,[dx,dy]] of edges.entries()) {
      await exposedTideTargets(page,state);
      const to=stepDestination(state,move)!;
      const tile=await world.evaluate((node,to)=>{
        const tiles=JSON.parse(node.getAttribute("data-tiles")!);
        return tiles.find((tile:any)=>tile.position.x===to.x&&tile.position.y===to.y) as {x:number;y:number;width:number;height:number};
      },to);
      await accept(move,()=>page.touchscreen.tap(tile.x+dx*(tile.width/2-1),tile.y+dy*(tile.height/2-1)));
      if(move!=="east"||index!==edges.length-1)await accept(move==="north"?"south":move==="west"?"east":"west",()=>guide(page,move==="north"?"south":move==="west"?"east":"west"));
    }
    await freeActorTaps(page,"open controls after destination-edge taps");
  }finally{network.assertClean();await page.close();}
}

async function persistentTeaching(browser:import("@playwright/test").Browser,origin:URL) {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:"reduce"});
  const network=await prepareBrowser(page,origin,BROWSER_DAY);
  await page.addInitScript(key=>localStorage.setItem(key,JSON.stringify({version:1,intro:"help",buttons:false})),GUIDANCE_KEY);
  try {
    await page.goto(new URL("/outing/?play",origin).href);
    await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");await sailStory(page);
    const run=page.getByTestId("tide-run"),feedback=page.getByTestId("tide-feedback");
    await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready","true");
    let beat=0;
    const take=async(move:Move)=>{await guide(page,move);await expect(run).toHaveAttribute("data-beat",String(++beat));await expect(run).toHaveAttribute("data-busy","false");};
    for(const move of ["wait","north","south"] as const)await take(move);
    const bridge="That wave moved the bridge to the left lane. Cross the channel there.";
    await expect(feedback).toHaveText(bridge);await take("wait");await expect(feedback).toHaveText(bridge);
    await page.getByRole("button",{name:"Dismiss cue",exact:true}).click();await take("wait");
    await expect(feedback).not.toHaveText(bridge);
    // Start the actual authored trace afresh, so pickup and splash occur in the running component.
    await page.evaluate(key=>localStorage.removeItem(key),bookKey);await page.reload();
    await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");await sailStory(page);
    await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready","true");beat=0;
    for(const move of zeroLens.slice(0,7))await take(move);
    const carried="Mochi has the Beacon Lens. Bring it to the center dock before taking more risks.";
    await expect(feedback).toHaveText(carried);await take("wait");await expect(feedback).toHaveText(carried);
    await take("east");
    await expect(feedback).toContainText("Splashed.");await expect(feedback).not.toContainText("Mochi has the Beacon Lens");
    await expect(page.getByTestId("tide-prize-status")).toHaveCount(0);
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).active.moves,bookKey),[...zeroLens.slice(0,7),"wait","east"]);
  }finally{network.assertClean();await page.close();}
}

async function freeActorTaps(page:Page,label:string) {
  const run=page.getByTestId("tide-run"),world=page.getByTestId("tide-world");
  await expect(run).toHaveAttribute("data-busy","false");
  await expect(world).toHaveAttribute("data-actor",/^\{/);
  const actor=JSON.parse((await world.getAttribute("data-actor"))!) as {x:number;y:number;width:number;height:number};
  const before=await page.evaluate(key=>localStorage.getItem(key),bookKey),beat=await run.getAttribute("data-beat");
  for(const[name,y]of [["body",actor.y],["head",actor.y-actor.height*.35]] as const) {
    const target={x:actor.x,y};
    assert.equal(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.tagName,target),"CANVAS",`${label}: Mochi’s ${name} is exposed`);
    await page.touchscreen.tap(target.x,target.y);
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    await expect(run).toHaveAttribute("data-beat",beat!);
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),before,`${label}: tapping Mochi’s ${name} spends zero moves`);
  }
}

async function earnedExchange(page:Page,kind:"lens"|"vane"|"moth",engine:string) {
  const lines=kind==="lens"?["Mochi lifts the lens into place. The beacon finds the bay again.","The Tidekeeper goes still beneath the light.",...CHAPTERS.lens.after]
    :kind==="vane"?["The vane catches the breeze.",...CHAPTERS.vane.after]
    :["The little wings sound rather like a kettle beginning to sing. Bram makes room beside the hearth.",...CHAPTERS.moth.after];
  const dialog=page.getByRole("dialog").filter({has:page.getByRole("button",{name:/^Continue(?: with Mochi)?$/,exact:true})});
  await expect(dialog).toBeVisible();
  const persisted=await page.evaluate(keys=>keys.map(key=>localStorage.getItem(key)),[bookKey,"familiar.expedition.local.v2"]);
  for(const[index,line]of lines.entries()) {
    await expect(dialog).toContainText(line);
    await expect(dialog.getByRole("heading")).toBeFocused();
    await expect(page.getByTestId("expedition-game")).toHaveAttribute("data-story-beat",String(index));
    await storyComposition(page);
    if(kind==="lens"&&index===1)await expect.poll(()=>page.getByTestId("expedition-world").evaluate(node=>Boolean(JSON.parse(node.getAttribute("data-harbor-anchors")!).story.keeper))).toBe(true);
    await page.screenshot({path:join(cacheDir,`${engine}-${kind}-exchange-${index}-390x844.png`)});
    await dialog.getByRole("button",{name:index===lines.length-1?"Continue with Mochi":"Continue",exact:true}).click();
  }
  assert.deepEqual(await page.evaluate(keys=>keys.map(key=>localStorage.getItem(key)),[bookKey,"familiar.expedition.local.v2"]),persisted,"reading earned exchanges spends no moves or extra saves");
}

async function milestoneFocus(page:Page) {
  const opener=page.getByRole("button",{name:"Open the tide log",exact:true}).and(page.locator(":visible"));
  await opener.focus();await page.keyboard.press("Enter");
  const log=page.getByRole("dialog",{name:"Bram’s tide log",exact:true});
  const summaries=log.locator(".tide-memories summary"),close=log.getByRole("button",{name:"Close panel",exact:true});
  await expect(summaries).toHaveCount(2);
  await expect(log).not.toContainText("Chart of Mochi’s route");
  await summaries.first().focus();await page.keyboard.press("Enter");
  await expect(summaries.first().locator("..")).toHaveAttribute("open","");
  await page.keyboard.press("Space");await expect(summaries.first().locator("..")).not.toHaveAttribute("open","");
  await summaries.last().focus();await page.keyboard.press("Tab");await expect(close).toBeFocused();
  await page.keyboard.press("Shift+Tab");await expect(summaries.last()).toBeFocused();
  await page.keyboard.press("Escape");await expect(opener).toBeFocused();
  const preferences=await page.evaluate(key=>localStorage.getItem(key),GUIDANCE_KEY);
  const progress=await page.evaluate(key=>localStorage.getItem(key),bookKey);
  await page.getByRole("button",{name:"Game menu",exact:true}).click();
  await page.getByRole("button",{name:"Read introduction",exact:true}).click();
  const replay=page.getByRole("dialog",{name:"How it began",exact:true});
  await expect(replay).toContainText("The storm had taken the beacon’s lens. Mochi was ready to help.");
  await expect(replay.getByRole("button",{name:"Help Mochi",exact:true})).toHaveCount(0);
  await expect(replay).not.toContainText("Bring the Beacon Lens home from the left shell.");
  await replay.getByRole("button",{name:"Back to Mochi",exact:true}).click();
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),GUIDANCE_KEY),preferences,"manual replay does not change guidance preferences");
  assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),progress,"manual replay preserves the original trace");
}

async function skipIntroduction(browser:import("@playwright/test").Browser,origin:URL) {
  const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:"reduce"});
  const network=await prepareBrowser(page,origin,BROWSER_DAY,{guidance:false});
  try {
    await page.goto(new URL("/outing/?play",origin).href);
    const introduction=page.getByRole("dialog",{name:"Keep Wren’s Light",exact:true});await expect(introduction).toBeVisible();
    const untouched=await page.evaluate(keys=>keys.map(key=>localStorage.getItem(key)),[bookKey,"familiar.expedition.local.v2"]);
    await introduction.getByRole("button",{name:"Skip introduction",exact:true}).click();
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),GUIDANCE_KEY),{version:1,intro:"skip",buttons:false});
    assert.deepEqual(await page.evaluate(keys=>keys.map(key=>localStorage.getItem(key)),[bookKey,"familiar.expedition.local.v2"]),untouched,"Skip changes guidance alone");
    await page.reload();await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");
    await expect(introduction).toHaveCount(0);
    await page.getByRole("button",{name:"Game menu",exact:true}).click();
    await page.getByRole("button",{name:"Guidance: off",exact:true}).click();
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),GUIDANCE_KEY),{version:1,intro:"help",buttons:false});
    await page.getByRole("button",{name:"Guidance: on",exact:true}).click();
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),GUIDANCE_KEY),{version:1,intro:"skip",buttons:false});
    assert.deepEqual(await page.evaluate(keys=>keys.map(key=>localStorage.getItem(key)),[bookKey,"familiar.expedition.local.v2"]),untouched,"changing guidance spends no moves");
  }finally{network.assertClean();await page.close();}
}

async function preferenceWriteFailure(browser:import("@playwright/test").Browser,origin:URL) {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:"reduce"});
  const network=await prepareBrowser(page,origin,BROWSER_DAY,{guidance:false}),errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.addInitScript(key=>{
    const write=Storage.prototype.setItem;
    Storage.prototype.setItem=function(name,value){if(name===key)throw new DOMException("Guidance storage is blocked","QuotaExceededError");return write.call(this,name,value);};
  },GUIDANCE_KEY);
  try {
    await page.goto(new URL("/outing/?play",origin).href);
    const intro=page.getByRole("dialog",{name:"Keep Wren’s Light",exact:true});await expect(intro).toBeVisible();
    await intro.getByRole("button",{name:"Use buttons",exact:true}).click();
    await expect(intro).toContainText("Button controls will be open when you sail.");
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),GUIDANCE_KEY),null,"failed preference writes preserve the original absence");
    await intro.getByRole("button",{name:"Help Mochi",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Chapter 1: First light",exact:true})).toBeVisible();
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),null,"Help still opens preparation without departing");
    await expect(page.locator(".exp-save-problem")).toHaveCount(0);
    await page.getByRole("button",{name:"Sail with Mochi",exact:true}).click();
    const run=page.getByTestId("tide-run");await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready","true");
    await expect(run).toHaveAttribute("data-buttons-open","true");
    await expect(page.getByTestId("tide-feedback")).toHaveText("Swipe on the board, or tap a glowing neighboring stone. Mochi moves one step at a time.");
    const trace=await page.evaluate(key=>localStorage.getItem(key),bookKey);
    await buttonControls(page,false);await expect(run).toHaveAttribute("data-buttons-open","false");
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),trace,"a failed preference write while closing controls never changes the outing");
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),GUIDANCE_KEY),null);
    await guide(page,"wait");await expect(run).toHaveAttribute("data-beat","1");await expect(run).toHaveAttribute("data-busy","false");
    await expect(page.getByTestId("tide-feedback")).toHaveText("Every step or wait advances the water by one move. Reading and menus do not.");
    assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).active.moves,bookKey),["wait"],"play accepts a real saved decision despite blocked preference storage");
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),GUIDANCE_KEY),null);assert.deepEqual(errors,[]);
  }finally{network.assertClean();await page.close();}
}

async function guidedJourney(browser:import("@playwright/test").Browser,engine:typeof chromium,origin:URL,input:"buttons"|"touch") {
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,reducedMotion:"reduce"});
  const network=await prepareBrowser(page,origin,BROWSER_DAY,{guidance:false});
  try {
    await page.goto(new URL("/outing/?play",origin).href);
    const intro=page.getByRole("dialog",{name:"Keep Wren’s Light",exact:true});
    await expect(intro.getByRole("heading")).toBeFocused();
    await storyComposition(page);
    await expect(intro).toContainText("You guide Mochi as a volunteer harbor helper.");
    await readable(intro.locator(".exp-story-objective"));
    if(input==="buttons") {
      await intro.getByRole("button",{name:"Use buttons",exact:true}).click();
      await expect(intro).toContainText("Button controls will be open when you sail.");
      await readable(intro.locator(".exp-story-objective"));
      assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),GUIDANCE_KEY),{version:1,intro:null,buttons:true});
      await page.goto(new URL("/outing/",origin).href);
      await expect(page.locator('[data-el="begin"]')).toHaveText("Begin");
      await page.locator('[data-el="begin"]').click();await page.locator('[data-plank="new"]').click();
      await expect(intro).toBeVisible();
    }
    await page.screenshot({path:join(cacheDir,`${engine.name()}-${input}-prologue-390x844.png`)});
    await intro.getByRole("button",{name:"Help Mochi",exact:true}).click();
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),null,"Help opens preparation without departing");
    await page.getByRole("button",{name:"Sail with Mochi",exact:true}).click();
    const run=page.getByTestId("tide-run"),world=page.getByTestId("tide-world");
    await expect(world).toHaveAttribute("data-ready","true");
    await exposedTideTargets(page,startTide(storyStart("lens")));
    await expect(page.getByTestId("tide-feedback")).toHaveText("Swipe on the board, or tap a glowing neighboring stone. Mochi moves one step at a time.");
    const original=await page.evaluate(key=>localStorage.getItem(key),bookKey);
    const tileAt=async(x:number,y:number)=>{
      const tiles=JSON.parse((await world.getAttribute("data-tiles"))!) as {position:{x:number;y:number};x:number;y:number}[];
      const tile=tiles.find(tile=>tile.position.x===x&&tile.position.y===y);assert(tile);return tile;
    };
    await freeActorTaps(page,`${engine.name()} ${input} initial`);
    if(input==="touch") {
      const distant=await tileAt(2,4);await page.touchscreen.tap(distant.x,distant.y);
      await expect(page.getByTestId("tide-feedback")).toHaveText("Choose a glowing neighboring stone. Mochi moves one step at a time.");
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),original,"distant feedback spends zero moves");
    }
    await page.evaluate(key=>{
      const write=Storage.prototype.setItem;
      Storage.prototype.setItem=function(name,value){if(name===key){Storage.prototype.setItem=write;throw new DOMException("Blocked fixture save","QuotaExceededError");}return write.call(this,name,value);};
    },bookKey);
    await guide(page,"wait");
    await expect(page.getByTestId("tide-feedback")).toHaveText("This move could not be saved. Try it again when this browser can save.");
    await expect(run).toHaveAttribute("data-beat","0");
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),original,"rejected saves do not observe a lesson or spend a move");
    const cdp=engine===chromium&&input==="touch"?await page.context().newCDPSession(page):null;
    for(const[index,move]of zeroLens.entries()) {
      await expect(run).toHaveAttribute("data-busy","false");
      if(input==="buttons")await page.locator(`[data-move="${move}"]`).click();
      else if(cdp) {
        const from=index===0?JSON.parse((await world.getAttribute("data-actor"))!) as {x:number;y:number}:await tileAt(1,2),dx=move==="west"?-60:move==="east"?60:0,dy=move==="north"?-60:move==="south"?60:0;
        await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{id:1,x:from.x,y:from.y}]});
        await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{id:1,x:from.x+dx,y:from.y+dy}]});
        await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
      }else {
        const after=applyMove(replayTide(storyStart("lens"),zeroLens.slice(0,index))!,move)!.after;
        const target=await tileAt(after.position.x,after.position.y);await page.touchscreen.tap(target.x,target.y);
      }
      await expect(run).toHaveAttribute("data-beat",String(index+1));
      await expect(run).toHaveAttribute("data-busy","false");
      if(index===0)await expect(page.getByTestId("tide-feedback")).toHaveText("Every step or wait advances the water by one move. Reading and menus do not.");
      if(index===1)await expect(page.getByTestId("tide-feedback")).toHaveText("The numbers show moves until the next wave. Mochi moves first, then the wave lands.");
      assert.deepEqual(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).active.moves,bookKey),zeroLens.slice(0,index+1));
      const settled=replayTide(storyStart("lens"),zeroLens.slice(0,index+1))!;
      if(settled.pack.includes("lens"))await exposedTideTargets(page,settled);
    }
    const decision=page.getByTestId("tide-lens-decision");await expect(decision).toBeVisible();
    const banked=await page.evaluate(key=>localStorage.getItem(key),bookKey);
    await run.focus();await page.keyboard.press("Space");
    assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),banked,"lens decision pauses commands");
    await decision.getByRole("button",{name:"Keep gathering",exact:true}).click();
    await expect(run).toBeFocused();assert.equal(await page.evaluate(key=>localStorage.getItem(key),bookKey),banked);
    await exposedTideTargets(page,zeroLensState);
    await buttonControls(page,true);await exposedTideTargets(page,zeroLensState);
    await freeActorTaps(page,`${engine.name()} ${input} lens banked with buttons open`);
    await page.getByTestId("tide-finish-return").click();
    await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");
    assert.equal(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!).active,bookKey),null);
    const home=await page.evaluate(()=>JSON.parse(localStorage.getItem("familiar.expedition.local.v2")!).home);
    assert.deepEqual(home.banked,["lens"]);assert.equal(home.lit,false);
    return zeroLens;
  }finally{network.assertClean();await page.close();}
}
try {
  await server.listen();
  const origin = new URL(server.resolvedUrls!.local[0]!);
  for(const engine of [chromium,webkit]) {
  const browser = await engine.launch();
  try {
    await destinationEdgeTaps(browser,origin);
    await persistentTeaching(browser,origin);
    await preferenceWriteFailure(browser,origin);
    await skipIntroduction(browser,origin);
    assert.deepEqual(await guidedJourney(browser,engine,origin,"touch"),await guidedJourney(browser,engine,origin,"buttons"),"guided gestures and native buttons accept the same canonical decisions");
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
    await buttonControls(probe);await probe.locator('[data-move="wait"]').click();
    await expect(probeRun).toHaveAttribute("data-beat","2");await buttonControls(probe,false);
    assert.deepEqual(await probe.evaluate(key=>JSON.parse(localStorage.getItem(key)!).active.moves,bookKey),["wait","wait"],"labelled world Wait and native Wait each spend exactly one move");
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
        await buttonControls(probe);await readable(probe.locator(".exp-button-controls-body"));await exposedTideTargets(probe,zeroLensState);await buttonControls(probe,false);
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
      if(start.story==="moth")await earnedExchange(page,"moth",engine.name());
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
      await buttonControls(page);await readable(page.locator(".exp-button-controls-body"));await exposedTideTargets(page,startTide(storyStart("lens")));await buttonControls(page,false);
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
    await earnedExchange(page,"lens",engine.name());
    await milestoneFocus(page);

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
    await earnedExchange(page,"vane",engine.name());

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
