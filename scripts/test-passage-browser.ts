import { guide, worldAction, buttonControls } from "./browser-controls";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, webkit, expect } from "@playwright/test";
import { createServer } from "vite";

const output=await mkdtemp(join(tmpdir(),"familiar-passages-"));
const server=await createServer({root:resolve(import.meta.dir,"../web"),envDir:false,envPrefix:[],cacheDir:join(output,"cache"),logLevel:"error",server:{host:"127.0.0.1",port:0,hmr:false,watch:null}});
await server.listen();
const origin=server.resolvedUrls!.local[0]!;
const key="familiar.expedition.local.v2";
try {
  for(const engine of [chromium,webkit]){
    const browser=await engine.launch();
    try {
      const phone=engine===webkit;
      const record=process.argv.includes("--record")&&!phone;
      const page=await browser.newPage({...(record?{recordVideo:{dir:output,size:{width:1280,height:800}}}:{}),viewport:phone?{width:390,height:844}:{width:1280,height:800},hasTouch:phone,reducedMotion:phone?"reduce":"no-preference"});
      await page.route("**/api/**",r=>r.abort());
      const errors:string[]=[];
      page.on("console",msg=>{if(msg.type()==="error"&&msg.text().includes("Failed to process file"))errors.push(msg.text());});
      await page.addInitScript(key=>{
        if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify({version:2,active:null,last:null,home:{banked:["lens","vane"],lit:true,signaled:true,lantern:null}}));
      },key);
      await page.goto(new URL("/outing/?play",origin).href);
      const original=await page.evaluate(key=>localStorage.getItem(key),key);
      await page.getByRole("button",{name:"Harbor chart",exact:true}).click();
      await expect(page.getByRole("heading",{name:"Wind Gate",exact:true})).toBeVisible();
      await page.getByRole("button",{name:"Close panel",exact:true}).click();
      for(const job of ["bell","reed"] as const){
        await page.getByRole("button",{name:"Harbor chart",exact:true}).click();
        await page.getByRole("button",{name:job==="bell"?"Send Bram’s supplies":"Follow Mochi to Reed",exact:true}).click();
        const game=page.getByTestId("passage-game");
        const beforeSound=await game.getAttribute("data-turn");
        await page.getByRole("button",{name:"Enable game audio",exact:true}).click();
        await expect(page.getByRole("button",{name:"Mute game audio",exact:true})).toBeVisible();
        await page.getByRole("button",{name:"Mute game audio",exact:true}).click();
        assert.equal(await game.getAttribute("data-turn"),beforeSound,"sound control spends no turn");
        await game.focus();await page.keyboard.press("i");
        await expect(page.getByRole("dialog")).toBeVisible();await page.keyboard.press("Escape");
        await expect(game).toBeFocused();
        const steps=job==="bell"?["north","west","ride","south","south","east","return"]:["north","north","west","east","east","west","north","wait","east","wait","south","ride","south","west","return"];
        for(const [index,step] of steps.entries()){
          const command=["north","west","south","east"].includes(step)?`step:${step}`:step;
          if(index===0)await page.keyboard.press("ArrowUp");
          else if(phone && !command.startsWith("step:"))await worldAction(page,command,true);else await guide(page,command);
          await expect(game).toHaveAttribute("data-turn",String(index+1));
          await expect(game).toHaveAttribute("data-busy","false");
          if(index===2){
            await page.reload();
            await expect(game).toHaveAttribute("data-turn","3");
            await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");
          }
          if(command==="ride")await page.screenshot({path:join(output,`${engine.name()}-${job}-crossing.png`)});
        }
        await expect(game).toHaveAttribute("data-stage","delivered");
        if(job==="reed")await expect(game).toHaveAttribute("data-watched","true");
        await page.getByTestId("passage-finish").click();
        await expect(page.locator(".exp-departure h1")).toHaveText(/^Today’s tide:/);
        const title=(await page.locator(".exp-departure h1").textContent())!;
        await expect(page.getByTestId("expedition-feedback")).toContainText(job==="bell"?"Bram’s supplies are stacked at Bell Steps.":"Mochi’s skiff is tied up at the quay.");
        await page.reload();
        await expect(page.getByRole("heading",{name:title})).toBeVisible();
        await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");
        await page.screenshot({path:join(output,`${engine.name()}-${job}-harbor.png`)});
      }
      const passageKey=key+":shore-passages.v1";
      const beforeRest=await page.evaluate(k=>localStorage.getItem(k),passageKey);
      await page.getByRole("button",{name:"Harbor chart",exact:true}).click();
      await expect(page.getByRole("heading",{name:"A harbor connected.",exact:true})).toBeVisible();
      await expect(page.getByRole("heading",{name:"Bell Steps",exact:true})).toBeVisible();
      await expect(page.getByText("Bram’s crates are stacked on the far work platform.",{exact:true})).toBeVisible();
      await page.screenshot({path:join(output,`${engine.name()}-chart.png`)});
      await page.getByRole("button",{name:"Sit with Mochi",exact:true}).click();
      await expect(page.getByRole("heading",{name:"A moment together."})).toBeVisible();
      await page.getByRole("button",{name:"Offer a hand",exact:true}).click();
      await expect(page.getByText(/Mochi rests a paw against your hand/)).toBeVisible();
      await page.screenshot({path:join(output,`${engine.name()}-rest.png`)});
      assert.equal(await page.evaluate(k=>localStorage.getItem(k),passageKey),beforeRest);
      await page.getByRole("button",{name:"Back to the harbor",exact:true}).click();
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),original);
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      const actor={x:(phone?390:1280)*.49,y:phone?302:620};
      if(!phone){
        await page.mouse.click(actor.x,actor.y,{button:"right"});
        await expect(page.getByRole("heading",{name:"A moment together."})).toHaveCount(0);
        await page.mouse.move(actor.x,actor.y);await page.mouse.down();
        await page.mouse.move(actor.x+40,actor.y);await page.mouse.move(actor.x,actor.y);await page.mouse.up();
        await expect(page.getByRole("heading",{name:"A moment together."})).toHaveCount(0);
        await page.mouse.click(actor.x,actor.y);
      }else await page.touchscreen.tap(actor.x,actor.y);
      await expect(page.getByRole("heading",{name:"A moment together."})).toBeVisible();
      assert.equal(await page.evaluate(k=>localStorage.getItem(k),passageKey),beforeRest,"touching Mochi has no saved reward");
      await page.getByRole("button",{name:"Back to the harbor",exact:true}).click();
      await page.getByRole("button",{name:"Bram",exact:true}).click();
      await expect(page.getByText(/just as at the reeds/)).toBeVisible();
      await page.getByRole("button",{name:"Close panel",exact:true}).click();
      await page.getByRole("button",{name:"Harbor chart",exact:true}).click();
      await page.getByRole("button",{name:"Explore with Mochi",exact:true}).click();
      const game=page.getByTestId("passage-game");
      await expect(game).toHaveAttribute("data-bell-rigged","false");
      async function move(step:string){
        const command=["north","west","south","east"].includes(step)?`step:${step}`:step;
        const turn=Number(await game.getAttribute("data-turn"));
        if(phone && !command.startsWith("step:"))await worldAction(page,command,true);else await guide(page,command);
        await expect(game).toHaveAttribute("data-turn",String(turn+1));
        await expect(game).toHaveAttribute("data-busy","false");
      }
      for(const step of ["north","west","ride","north","east","west"])await move(step);
      const beforeInspect=await page.evaluate(k=>localStorage.getItem(k),passageKey);
      await page.getByTestId("passage-inspect").click();
      await page.locator('[data-preview-command="listen"]').click();
      await expect(page.locator(".exp-inspect-reading")).toContainText("One turn listening");
      assert.equal(await page.evaluate(k=>localStorage.getItem(k),passageKey),beforeInspect);
      await page.getByRole("button",{name:"Close panel",exact:true}).click();
      if(phone)await move("listen");else{
        await game.focus();await page.keyboard.press("e");
        await expect(game).toHaveAttribute("data-turn","7");
        await expect(game).toHaveAttribute("data-busy","false");
      }
      await expect(game).toHaveAttribute("data-heard-bell","true");
      await page.reload();
      await expect(game).toHaveAttribute("data-turn","7");
      await expect(game).toHaveAttribute("data-heard-bell","true");
      await expect(game).toHaveAttribute("data-bell-rigged","false");
      await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");
      await page.screenshot({path:join(output,`${engine.name()}-bell-discovery.png`)});
      for(const step of ["south","east","west","south","east","south","return"])await move(step);
      await page.getByTestId("passage-finish").click();
      await expect(page.getByTestId("expedition-feedback")).toContainText("Bram rigs a bell pull");
      await page.reload();
      await page.getByRole("button",{name:"Bram",exact:true}).click();
      await expect(page.getByText(/One good tug calls the Tidekeeper/)).toBeVisible();
      await page.getByRole("button",{name:"Close panel",exact:true}).click();
      await page.screenshot({path:join(output,`${engine.name()}-bell-harbor.png`)});
      for(const job of ["bell","reed"]){
        await page.getByRole("button",{name:"Harbor chart",exact:true}).click();
        await page.getByRole("button",{name:job==="bell"?"Try the bell pull":"Sail Reed Steps again",exact:true}).click();
        await expect(game).toHaveAttribute("data-bell-rigged","true");
        await move("north");await move("north");
        await page.getByTestId("passage-inspect").click();
        await page.locator('[data-preview-command="wait"]').click();
        await expect(page.locator(".exp-inspect-reading")).toContainText("Mochi is splashed");
        await page.locator('[data-preview-command="ring"]').click();
        await expect(page.locator(".exp-inspect-reading")).toContainText("Bridge left. Mochi stays dry.");
        await expect(game).toHaveAttribute("data-turn","2");
        await page.getByRole("button",{name:"Close panel",exact:true}).click();
        await buttonControls(page);await page.locator('[data-command="ring"]').focus();
        await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-preview-exit","0");
        await expect(game).toHaveAttribute("data-turn","2");
        if(!phone&&job==="bell")await page.screenshot({path:join(output,"chromium-bell-preview.png")});
        if(phone&&job==="reed"){
          const geometry=await page.getByTestId("expedition-world").getAttribute("data-tiles");
          await page.setViewportSize({width:844,height:390});
          await expect(page.getByTestId("expedition-world")).not.toHaveAttribute("data-tiles",geometry!);
          const sound=page.getByRole("button",{name:"Enable game audio",exact:true});
          const hud=await page.locator(".exp-hud").boundingBox(),audio=await sound.boundingBox();
          assert(hud&&audio&&hud.x+hud.width<=audio.x,"tide status leaves the sound control visible in landscape");
          await sound.tap();
          await page.getByRole("button",{name:"Mute game audio",exact:true}).tap();
          await expect(game).toHaveAttribute("data-turn","2");
        }
        await buttonControls(page,false);
        if(phone){
          await worldAction(page,"ring",true);
          await expect(game).toHaveAttribute("data-turn","3");
          await expect(game).toHaveAttribute("data-busy","false");
        }else await move("ring");
        await expect(game).toHaveAttribute("data-pull-spent","true");
        assert.equal(await page.locator('[data-command="ring"]').count(),0);
        const overflow=await page.evaluate(()=>({x:document.documentElement.scrollWidth-innerWidth,y:document.documentElement.scrollHeight-innerHeight}));
        assert.deepEqual(overflow,{x:0,y:0});
        await page.screenshot({path:join(output,`${engine.name()}-${job}-bell-pull.png`)});
        await page.reload();
        await expect(game).toHaveAttribute("data-turn","3");
        await expect(game).toHaveAttribute("data-pull-spent","true");
        await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");
        for(const step of job==="bell"?["west","south","ride","south","south","east","return"]:["wait","east","ride","south","west","return"])await move(step);
        await expect(game).toHaveAttribute("data-stage","delivered");
        await expect(page.locator(".exp-hud")).toContainText("Resolve 3/3");
        await page.getByTestId("passage-finish").click();
        if(phone)await page.setViewportSize({width:390,height:844});
      }
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),original,"companion and discovery never rewrite the H1 save");
      assert.equal(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)!).heardBell,passageKey),true);
      assert.deepEqual(errors,[],"all court and harbor textures decode");
      if(record){const video=page.video()!;await page.close();await video.saveAs(join(output,"both-crossings.webm"));}
      console.info(engine.name(),"Bell and Reed deliveries, discovery, bell routes, touch/keyboard, interrupted runs, companion and independent save passed");
    }finally{await browser.close();}
  }
  console.info(output);
}finally{await server.close();}
