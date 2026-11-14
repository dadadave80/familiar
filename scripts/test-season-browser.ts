import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { createServer } from "vite";
import { VALUE, applyMove, startTide } from "../web/src/run/engine";
import { cautiousMove } from "../web/src/run/bot";
import { dayResult } from "../web/src/run/save";
import { shelfGoods } from "../web/src/tide/run-day";
import { haulLine } from "../web/src/season/model";

// Bram's shelf panels, against the live season.<root> views (public RPC).
// Signed out uses the real game; signed in uses the dev-only harness, whose signing is mocked.
const shots=resolve(process.argv[2]??await mkdtemp(join(tmpdir(),"season-shots-")));await mkdir(shots,{recursive:true});
const server=await createServer({root:resolve(import.meta.dir,"../web"),envDir:false,envPrefix:[],cacheDir:await mkdtemp(join(tmpdir(),"familiar-season-")),logLevel:"error",
  server:{host:"127.0.0.1",port:0,hmr:false,watch:null}});
const bookKey="familiar.expedition.local.v2:tide-run.v1";
/** Today's daily tide as the cautious bot sails it; it banks reed or glass on the days probed, and the suite fails loudly if not. */
function dailyTide() {
  let daily=startTide({seed:Math.floor(Date.now()/86_400_000)});
  while(daily.outcome==="active")daily=applyMove(daily,cautiousMove(daily,VALUE))!.after;
  const goods=shelfGoods(dayResult(daily));
  assert.ok(goods[0]+goods[1]>0,"today's cautious tide brings reed or glass home");
  return {daily,goods,shelveName:`Shelve ${haulLine(goods)}`};
}
async function checkTargets(page:Page,label:string) {
  const small=await page.locator(".ss button:visible, .ss summary:visible").evaluateAll(els=>els.filter(e=>{const r=e.getBoundingClientRect();return r.height<44||r.width<44;}).map(e=>e.textContent));
  assert.deepEqual(small,[],`${label}: controls under 44px`);
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
      await expect(page.locator(".ss-mode")).toHaveText("Device preview · not recorded");
      await expect(page.locator(".ss-good").first()).toContainText("on the shelf",{timeout:15000});
      await expect(page.locator(".ss-mode[data-mode=preview]")).toHaveCount(1);
      await expect(page.locator(".ss-trade-card")).toHaveCount(4);
      for(const card of await page.locator(".ss-trade-card").all()){
        await expect(card.getByRole("button",{name:/^(Buy|Sell) \d+$/})).toHaveCount(1);
        await expect(card.locator("img")).toBeVisible();
      }
      const pricing=page.locator(".ss-good").first().locator("details.ss-pricing");
      await expect(pricing).not.toHaveAttribute("open","");
      await expect(pricing.locator(".ss-reason")).toBeHidden();
      const pricingToggle=pricing.locator("summary");
      await expect(pricingToggle).toHaveText("How Bram prices this");
      await pricingToggle.focus();await page.keyboard.press("Enter");
      await expect(pricing.locator(".ss-reason")).toBeVisible();
      await expect(pricing.locator(".ss-reason")).toContainText("base 8");
      await pricingToggle.press("Space");
      await expect(pricing.locator(".ss-reason")).toBeHidden();
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
      // A device harbor's daily is the tide run: before today's tide Bram only points at it.
      await expect(page.locator(".ss-haul")).toContainText("Sail today’s tide and bring something home. Bram shelves reed and glass, up to three of each a day.");
      await expect(page.locator(".ss-haul").getByRole("button",{name:"See today’s tide",exact:true})).toBeVisible();
      await expect(page.getByRole("button",{name:/^Shelve /})).toHaveCount(0);
      // Sailing is checked by test-tide-run-browser; this suite seeds today's finished tide run.
      const {daily,goods,shelveName}=dailyTide();
      await page.evaluate(({key,seed,moves})=>localStorage.setItem(key,JSON.stringify({version:1,active:null,days:[{seed,moves}]})),{key:bookKey,seed:daily.seed,moves:daily.moves});
      const before=await page.evaluate(key=>({home:JSON.parse(localStorage.getItem("familiar.expedition.local.v2")??"null")?.home??null,returns:localStorage.getItem("familiar.expedition.returns.v2:preview"),book:localStorage.getItem(key)}),bookKey);
      const held=await page.evaluate(()=>JSON.parse(localStorage.getItem("familiar.season.preview.v1")!).goods as [number,number]);
      await page.reload();
      await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true",{timeout:30000});
      await page.locator(".exp-place-bram").click();
      await expect(page.locator(".ss-haul")).toContainText(`From today’s tide run: Banked ${daily.score} · Bram guessed `);
      const shelve=page.getByRole("button",{name:shelveName,exact:true});
      await expect(shelve).toHaveAttribute("aria-disabled","false");
      await expect(shelve).toHaveClass(/ss-primary/);
      await expect(page.locator(".ss .ss-primary")).toHaveCount(1);
      await expect(page.locator(".ss-haul-art img")).toHaveCount(goods.filter(Boolean).length);
      await checkTargets(page,`${tag} run haul`);
      await shelve.click();
      await expect(page.locator(".ss-status")).toContainText(`Shelved on this device: ${haulLine(goods)}. Not recorded.`);
      await expect.poll(()=>page.evaluate(()=>!!document.activeElement?.closest(".ss")),{message:"focus stays in the panel after shelving removes its button"}).toBe(true);
      assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem("familiar.season.preview.v1")!).goods),[held[0]+goods[0],held[1]+goods[1]]);
      const docked="Today’s haul is on Bram’s shelf. He takes one a day; bring another find tomorrow.";
      await expect(page.locator(".ss-haul")).toContainText(docked);
      await expect(shelve).toHaveCount(0);
      await page.screenshot({path:join(shots,`preview-shelved-${tag}.png`)});
      await page.getByRole("button",{name:"Start the preview again"}).click();
      await expect(page.locator(".ss-haul")).toContainText(docked);
      await page.reload();
      await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true",{timeout:30000});
      await page.locator(".exp-place-bram").click();
      await expect(page.locator(".ss-haul")).toContainText(docked);
      await expect(page.getByRole("button",{name:/^Shelve /})).toHaveCount(0);
      const after=await page.evaluate(key=>({home:JSON.parse(localStorage.getItem("familiar.expedition.local.v2")??"null")?.home??null,returns:localStorage.getItem("familiar.expedition.returns.v2:preview"),book:localStorage.getItem(key)}),bookKey);
      assert.deepEqual(after.home,before.home,"First Light home unchanged by shelving");
      assert.equal(after.returns,before.returns,"First Light return memories unchanged");
      assert.equal(after.book,before.book,"today's tide run unchanged by shelving");
      await page.getByRole("tab",{name:"Shelf & till"}).focus();
      await page.keyboard.press("ArrowRight");
      await expect(page.getByRole("tab",{name:"Mochi’s wish"})).toHaveAttribute("aria-selected","true");
      await expect(page.locator(".ss-panel")).toContainText("Mochi’s wishes need a saved harbor.");
      await expect(page.locator(".ss-panel")).not.toContainText("Sign in from the menu");
      await page.screenshot({path:join(shots,`preview-wish-${tag}.png`)});

      await page.goto(new URL("/outing/?season-harness",origin).href);
      await expect(page.getByRole("note")).toContainText("signing are mocked");
      await expect(page.getByRole("button",{name:"Open my ledger page"})).toBeVisible({timeout:15000});
      await expect(page.getByRole("button",{name:"Open my ledger page"})).toHaveClass(/ss-primary/);
      await expect(page.locator(".ss .ss-primary")).toHaveCount(1);
      // The signed-in harbor keeps the refereed Beacon Court haul, shelved on odd days.
      await expect(page.locator(".ss-haul")).toContainText(/See today’s ask|today isn’t one/,{timeout:15000});
      const v2Day=await page.getByRole("button",{name:"See today’s ask",exact:true}).isVisible();
      if(v2Day){await page.getByRole("button",{name:"See today’s ask",exact:true}).click();await expect(page.getByText("Would open today’s ask.")).toBeVisible();}
      await checkTargets(page,`${tag} harness`);
      await page.screenshot({path:join(shots,`harness-ledger-${tag}.png`)});
      const route=["step:north","step:north","step:west","wait","wait","step:east","reel:lens","step:east","step:west","step:east","take:moth","step:west","step:east","step:south","step:west","step:south","return"];
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
      await expect(page.locator(".ss .ss-primary")).toHaveCount(1);
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
      console.info(`${tag}: preview shelf/sell/run haul/shelve/wish and harness ledger/refusal/sale/wish/postcard passed`);
    }
  }finally{await browser.close();}
  console.info(`Screenshots: ${shots}`);
}finally{await server.close();}
