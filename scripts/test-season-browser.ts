import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { createServer } from "vite";

// Bram's shelf panels, against the live season.<root> views (public RPC).
// Signed out uses the real game; signed in uses the dev-only harness, whose signing is mocked.
const shots=resolve(process.argv[2]??await mkdtemp(join(tmpdir(),"season-shots-")));await mkdir(shots,{recursive:true});
const server=await createServer({root:resolve(import.meta.dir,"../web"),envDir:false,envPrefix:[],cacheDir:await mkdtemp(join(tmpdir(),"familiar-season-")),logLevel:"error",
  server:{host:"127.0.0.1",port:0,hmr:false,watch:null}});
async function checkTargets(page:Page,label:string) {
  const small=await page.locator(".ss button:visible").evaluateAll(els=>els.filter(e=>{const r=e.getBoundingClientRect();return r.height<44||r.width<44;}).map(e=>e.textContent));
  assert.deepEqual(small,[],`${label}: buttons under 44px`);
  const overflow=await page.locator(".exp-panel").evaluate(e=>e.scrollWidth>e.clientWidth+1);assert.equal(overflow,false,`${label}: panel scrolls sideways`);
  const priced=await page.locator(".ss button:visible").evaluateAll(els=>els.map(e=>e.textContent??"").filter(t=>/\d+\s*Shell|NEAR/i.test(t)));
  assert.deepEqual(priced,[],`${label}: prices on pressables`);
}
try{
  await server.listen();const origin=server.resolvedUrls!.local[0]!;
  const browser=await chromium.launch();
  try{
    for(const viewport of [{width:390,height:844},{width:1440,height:900}]){
      const tag=`${viewport.width}x${viewport.height}`,page=await browser.newPage({viewport});
      await page.goto(new URL("/outing/?play",origin).href);
      await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true",{timeout:30000});
      await page.locator(".exp-place-bram").click();
      await expect(page.locator(".ss-mode")).toContainText("Device preview");
      await expect(page.locator(".ss-good").first()).toContainText("on the shelf",{timeout:15000});
      await checkTargets(page,`${tag} shelf`);
      await page.screenshot({path:join(shots,`preview-shelf-${tag}.png`)});
      const reed=page.locator(".ss-good").nth(1);
      await reed.getByRole("button",{name:"Sell 1"}).click();
      await expect(page.locator(".ss-status")).toContainText("Preview: sold 1 reed bundle");
      await expect(page.locator(".ss-holdings")).toContainText("Shells");
      await page.screenshot({path:join(shots,`preview-sold-${tag}.png`)});
      const tabs=page.getByRole("tab");await tabs.first().focus();await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("tab",{name:"Mochi’s wish"})).toHaveAttribute("aria-selected","true");
      await expect(tabs).toHaveCount(2);
      await expect(page.getByRole("tab",{name:"Today’s tide"})).toHaveCount(0);
      await expect(page.locator(".ss-haul")).toContainText("Today’s haul");
      await checkTargets(page,`${tag} haul`);
      await page.screenshot({path:join(shots,`preview-haul-${tag}.png`)});
      const v2Day=await page.getByRole("button",{name:"See today’s ask",exact:true}).isVisible();
      // Sailing is checked by test-tide-browser; this suite starts with a kept sandbox route.
      const route=["step:north","step:north","step:west","wait","wait","step:east","reel:lens","step:east","step:west","step:east","take:moth","step:west","step:east","step:south","step:west","step:south","return"];
      await page.evaluate(commands=>localStorage.setItem("familiar.season.tide.v1:preview",JSON.stringify([{id:"route",contentVersion:"first_light_v2",tool:"rope",commands,cargo:["lens","moth"],outcome:"returned",savedAt:new Date().toISOString()}])),route);
      const before=await page.evaluate(()=>({home:JSON.parse(localStorage.getItem("familiar.expedition.local.v2")??"null")?.home??null,returns:localStorage.getItem("familiar.expedition.returns.v2:preview")}));
      await page.reload();
      await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true",{timeout:30000});
      await page.locator(".exp-place-bram").click();
      if(v2Day){
        await expect(page.locator(".ss-haul")).toContainText("Rope · ");
        const shelve=page.getByRole("button",{name:"Shelve 1 glass and 1 reed bundle",exact:true});
        await expect(shelve).toHaveAttribute("aria-disabled","false");
        await shelve.click();
        await expect(page.locator(".ss-status")).toContainText("Shelved on this device: 1 glass and 1 reed bundle. Not recorded.");
        await expect.poll(()=>page.evaluate(()=>!!document.activeElement?.closest(".ss")),{message:"focus stays in the panel after shelving removes its button"}).toBe(true);
        await expect(page.locator(".ss-holdings")).toContainText("Sample haul of 1 glass and 2 reed bundles for the preview");
        assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem("familiar.season.preview.v1")!).goods),[2,2]);
        await expect(page.locator(".ss-haul")).toContainText("Today’s haul is on Bram’s shelf. He takes one a day; bring another find tomorrow.");
        await expect(shelve).toHaveCount(0);
        await page.screenshot({path:join(shots,`preview-shelved-${tag}.png`)});
        await page.getByRole("button",{name:"Start the preview again"}).click();
        await expect(page.locator(".ss-haul")).toContainText("Today’s haul is on Bram’s shelf. He takes one a day; bring another find tomorrow.");
        await page.reload();
        await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true",{timeout:30000});
        await page.locator(".exp-place-bram").click();
        await expect(page.locator(".ss-haul")).toContainText("Today’s haul is on Bram’s shelf. He takes one a day; bring another find tomorrow.");
        const after=await page.evaluate(()=>({home:JSON.parse(localStorage.getItem("familiar.expedition.local.v2")??"null")?.home??null,returns:localStorage.getItem("familiar.expedition.returns.v2:preview"),tide:JSON.parse(localStorage.getItem("familiar.season.tide.v1:preview")??"[]")}));
        assert.deepEqual(after.home,before.home,"First Light home unchanged by shelving");
        assert.equal(after.returns,before.returns,"First Light return memories unchanged");
        assert.equal(after.tide.length,1);assert.deepEqual(after.tide[0].commands,route);assert.deepEqual(after.tide[0].cargo,["lens","moth"]);
      }else{
        await expect(page.locator(".ss-haul")).toContainText("Keep today’s find; he can shelve it tomorrow.");
        await expect(page.getByRole("button",{name:/^Shelve /})).toHaveCount(0);
      }
      await page.getByRole("tab",{name:"Shelf & till"}).focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("tab",{name:"Mochi’s wish"})).toHaveAttribute("aria-selected","true");
      await expect(page.locator(".ss-panel")).toContainText("Sign in from the menu");
      await page.screenshot({path:join(shots,`preview-wish-${tag}.png`)});

      await page.evaluate(()=>localStorage.removeItem("familiar.season.tide.v1:preview"));
      await page.goto(new URL("/outing/?season-harness",origin).href);
      await expect(page.getByRole("note")).toContainText("signing are mocked");
      await expect(page.getByRole("button",{name:"Open my ledger page"})).toBeVisible({timeout:15000});
      if(v2Day){await page.getByRole("button",{name:"See today’s ask",exact:true}).click();await expect(page.getByText("Would open today’s ask.")).toBeVisible();}
      await checkTargets(page,`${tag} harness`);
      await page.screenshot({path:join(shots,`harness-ledger-${tag}.png`)});
      await page.evaluate(commands=>localStorage.setItem("familiar.season.tide.v1:harness",JSON.stringify([{id:"route",contentVersion:"first_light_v2",tool:"rope",commands,cargo:["lens","moth"],outcome:"returned",savedAt:new Date().toISOString()}])),route);
      await page.getByRole("button",{name:"Open my ledger page"}).click();
      await expect(page.locator(".ss-status")).toHaveAttribute("data-state","pending");
      await expect(page.locator(".ss-status")).not.toContainText("Recorded");
      await expect(page.locator(".ss-status")).toContainText("Recorded",{timeout:10000});
      const focusInside=()=>page.evaluate(()=>!!document.activeElement?.closest(".ss"));
      await expect.poll(focusInside,{message:"focus stays in the panel after the ledger offer goes away"}).toBe(true);
      await page.locator(".ss-good").first().getByRole("button",{name:"Buy 1"}).click();
      await expect(page.locator(".ss-status")).toContainText("price moved",{timeout:10000});
      await page.screenshot({path:join(shots,`harness-refused-${tag}.png`)});
      await page.locator(".ss-good").nth(1).getByRole("button",{name:"Sell 1"}).click();
      await expect(page.locator(".ss-status")).toContainText("Sold 1 reed bundle",{timeout:10000});
      await page.getByRole("tab",{name:"Mochi’s wish"}).click();
      await page.getByRole("button",{name:"Set Mochi’s wish"}).click();
      await expect(page.locator(".ss-status")).toContainText("waiting",{timeout:10000});
      await expect(page.locator(".ss-wish-head")).toContainText("Mochi is waiting for");
      await checkTargets(page,`${tag} wish`);
      await page.screenshot({path:join(shots,`harness-wish-${tag}.png`),fullPage:true});
      await page.getByRole("button",{name:"Take the wish back"}).click();
      await expect(page.locator(".ss-postcard")).toContainText("CANCELLED_BY_OWNER",{timeout:10000});
      await expect.poll(focusInside,{message:"focus stays in the panel after the wish is taken back"}).toBe(true);
      await page.screenshot({path:join(shots,`harness-postcard-${tag}.png`),fullPage:true});
      if(v2Day){
        await page.getByRole("button",{name:"Shelve 1 glass and 1 reed bundle",exact:true}).first().click();
        await expect(page.locator(".ss-status")).toContainText("Shelved 1 glass and 1 reed bundle: 100% of the best haul",{timeout:10000});
        await page.screenshot({path:join(shots,`harness-docked-${tag}.png`)});
      }
      await page.close();
      console.info(`${tag}: preview shelf/sell/haul/wish and harness ledger/refusal/sale/wish/postcard passed`);
    }
  }finally{await browser.close();}
  console.info(`Screenshots: ${shots}`);
}finally{await server.close();}
