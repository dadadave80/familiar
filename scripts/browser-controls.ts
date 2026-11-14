import assert from "node:assert/strict";
import type { Page } from "@playwright/test";

/** Drive the public play surface, leaving command validation and saving to the game. */
export async function guide(page:Page,command:string){
  const game=page.locator('[data-testid="expedition-game"],[data-testid="passage-game"],[data-testid="tide-run"]').last();
  const key:Record<string,string>={"step:north":"ArrowUp","step:south":"ArrowDown","step:west":"ArrowLeft","step:east":"ArrowRight",north:"ArrowUp",south:"ArrowDown",west:"ArrowLeft",east:"ArrowRight",wait:"Space",return:"r",home:"r"};
  if(key[command]){await game.focus();await page.keyboard.press(key[command]);return;}
  if(command.startsWith("lure:")){
    await worldAction(page,"lantern");
    const lane=command.slice(5);await page.getByRole("button",{name:`Lure ${lane[0]!.toUpperCase()+lane.slice(1)}`,exact:true}).click();return;
  }
  if(command.startsWith("take:")||command.startsWith("reel:")){
    const item=command.split(":")[1],x=item==="lens"?0:item==="moth"?2:1;
    const tiles=JSON.parse((await page.getByTestId("expedition-world").getAttribute("data-tiles"))!) as {position:{x:number;y:number};x:number;y:number}[];
    const tile=tiles.find(tile=>tile.position.x===x&&tile.position.y===4);assert(tile,`world target for ${command}`);
    await page.mouse.click(tile.x,tile.y);return;
  }
  await worldAction(page,command);
}

export async function worldAction(page:Page,action:string,touch=false){
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  const world=page.locator('[data-testid="expedition-world"],[data-testid="tide-world"]').last();
  const actions=JSON.parse((await world.getAttribute("data-actions"))??"[]") as {action:string;x:number;y:number}[];
  const target=actions.find(target=>target.action===action);assert(target,`visible world action ${action}; position=${await world.getAttribute("data-position")}; turn=${await world.getAttribute("data-turn")??await world.getAttribute("data-beat")}; available=${JSON.stringify(actions)}`);
  const hit=await page.evaluate(({x,y})=>{const node=document.elementFromPoint(x,y);return{tag:node?.tagName,owner:node?.closest(".exp-command-tray,.exp-feedback,.exp-hud")?.className,html:node?.outerHTML.slice(0,180),viewport:[innerWidth,innerHeight],canvas:document.querySelector("canvas")?.getBoundingClientRect().toJSON()};},target);
  assert.equal(hit.tag,"CANVAS",`world action ${action} is covered at ${target.x},${target.y}: ${JSON.stringify(hit)}`);
  if(touch)await page.touchscreen.tap(target.x,target.y);else await page.mouse.click(target.x,target.y);
}

export async function buttonControls(page:Page,open=true){
  const controls=page.locator("details.exp-button-controls");
  if(await controls.evaluate(node=>(node as HTMLDetailsElement).open)!==open)await controls.locator("summary").click();
}

/** Original courts remain available from the Harbor chart beside the current story/daily tide. */
export async function departCourt(page:Page){
  const preparation=page.locator('.exp-panel[data-surface="sail"] .exp-primary');
  if(await preparation.isVisible()){await preparation.click();return;}
  const depart=page.locator('[data-action="depart"]');
  if(await depart.isVisible()){await depart.click();return;}
  await page.getByRole("button",{name:"Harbor chart",exact:true}).and(page.locator(":visible")).click();
  await page.locator('.exp-panel[data-surface="chart"] .harbor-routes > li').first().getByRole("button").click();
  await page.locator('.exp-panel[data-surface="sail"] .exp-primary').click();
}
