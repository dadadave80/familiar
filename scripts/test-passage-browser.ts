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
      await page.goto(new URL("/outing/",origin).href);
      const original=await page.evaluate(key=>localStorage.getItem(key),key);
      for(const job of ["bell","reed"] as const){
        await page.getByRole("button",{name:"Choose a crossing",exact:true}).click();
        await page.getByRole("button",{name:job==="bell"?/Bell Steps · Send supplies/:/Reed Steps · Bring the skiff home/}).click();
        const game=page.getByTestId("passage-game");
        const steps=job==="bell"?["north","west","ride","south","south","east","return"]:["north","north","west","east","east","west","north","wait","east","wait","south","ride","south","west","return"];
        for(const [index,step] of steps.entries()){
          const command=["north","west","south","east"].includes(step)?`step:${step}`:step;
          const button=page.locator(`[data-command="${command}"]`);
          if(phone)await button.tap();else await button.click();
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
        const title=job==="bell"?"Supplies at Bell Steps.":"The reed skiff is home.";
        await expect(page.getByRole("heading",{name:title})).toBeVisible();
        await page.reload();
        await expect(page.getByRole("heading",{name:title})).toBeVisible();
        await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true");
        await page.screenshot({path:join(output,`${engine.name()}-${job}-harbor.png`)});
      }
      assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),original);
      await page.getByRole("button",{name:"Bram",exact:true}).click();
      await expect(page.getByText(/just as at the reeds/)).toBeVisible();
      assert.deepEqual(errors,[],"all court and harbor textures decode");
      if(record){const video=page.video()!;await page.close();await video.saveAs(join(output,"both-crossings.webm"));}
      console.info(engine.name(),"Bell and Reed deliveries, interrupted runs, moth memory and independent save passed");
    }finally{await browser.close();}
  }
  console.info(output);
}finally{await server.close();}
