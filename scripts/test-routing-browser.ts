import { guide } from "./browser-controls";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, webkit } from "@playwright/test";
import { createServer } from "vite";
import { cautiousTide } from "../web/src/run/bot";
import { replayTide } from "../web/src/run/engine";
import { dayResult, shelfHaul } from "../web/src/run/save";

const cacheDir = await mkdtemp(join(tmpdir(), "familiar-routing-"));
const artifact=process.argv[2]?resolve(process.argv[2],".vercel/output"):null;
const server = artifact?null:await createServer({
  root: resolve(import.meta.dir, "../web"), envDir: false, envPrefix: [], cacheDir, logLevel: "error",
  server: { host: "127.0.0.1", port: 0, hmr: false, watch: null },
});
const routing=artifact?await Bun.file(join(artifact,"config.json")).json():null;
const compiled=artifact?Bun.serve({hostname:"127.0.0.1",port:0,async fetch(request){
  const url=new URL(request.url);let path:string;
  try{path=decodeURIComponent(url.pathname);}catch{return new Response("Invalid path",{status:400});}
  if(request.method!=="GET"||path.startsWith("/api/")||path.split("/").some(p=>p===".."||p.startsWith(".")))return new Response("Static check only",{status:404});
  const headers:Record<string,string>={};
  for(const route of routing.routes){
    if(!route.src||!new RegExp(route.src).test(path))continue;
    Object.assign(headers,route.headers);
    if(route.status)return new Response(null,{status:route.status,headers});
    if(route.dest){path=route.dest;break;}
  }
  const site=resolve(artifact,"static"),filePath=resolve(site,"."+path);
  if(!filePath.startsWith(site+"/"))return new Response("Not found",{status:404});
  const file=Bun.file(filePath);if(!await file.exists())return new Response("Not found",{status:404});
  headers["content-type"]=file.type;return new Response(file,{headers});
}}):null;
const oldRecords = {
  "familiar.guest.v1": '{"original":"guest"}',
  "familiar.first-light.beacon.v1": '{"original":"harbor"}',
  "familiar.tidebound.run.v1:earlier.testnet": '{"original":"run"}',
  "familiar.tidebound.pending.v1:earlier.testnet:player.testnet": '{"original":"operation"}',
};
const saveKey = "familiar.expedition.local.v2";
const bookKey = `${saveKey}:tide-run.v1`;
const returnDay=20771,returned=cautiousTide(returnDay),beforeReturn=replayTide({seed:returnDay},returned.moves.slice(0,-1));
assert(beforeReturn?.outcome==="active");
const returnHaul=shelfHaul(dayResult(returned));
assert(returnHaul.reed+returnHaul.glass>0,"focus fixture brings a haul to Bram's shelf");
try {
  await server?.listen();
  const origin = new URL(compiled?`http://127.0.0.1:${compiled.port}`:server!.resolvedUrls!.local[0]!);
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      const mobile = engine === webkit;
      const page = await browser.newPage({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, hasTouch: mobile, reducedMotion: "reduce" });
      await page.route("**/*", route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin.origin || /^\/(?:api|npc-api)\//.test(url.pathname)) return route.abort();
        return route.continue();
      });
      await page.goto(origin.href);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("A small friend.");
      await page.evaluate(records => { for (const [key, value] of Object.entries(records)) localStorage.setItem(key, value); }, oldRecords);
      await page.getByRole("link", { name: "Play Familiar", exact: true }).first().click();
      await expect(page).toHaveURL(new URL("/outing/", origin).href);
      const game = page.getByTestId("expedition-game"), world = page.getByTestId("expedition-world"), opening = page.getByTestId("opening");
      const passTitle = async (path: string) => {
        await expect(opening, path).toHaveAttribute("data-mode", "title");
        await page.keyboard.press("Enter");
        await page.locator('[data-plank="continue"],[data-plank="new"]').click();
        await expect(opening, path).toHaveCount(0);
      };
      await passTitle("/outing/");
      await expect(world).toHaveAttribute("data-ready", "true");
      await page.getByRole("button", { name: "Game menu" }).click();
      await page.getByRole("button", { name: "Account & recovery" }).click();
      await expect(page.getByRole("heading", { name: "Your saved harbor" })).toBeVisible();
      const menuOpener=page.getByRole("button",{name:"Game menu",exact:true}).and(page.locator(":visible"));
      await page.getByRole("button", { name: "Close panel" }).click();
      await expect(menuOpener).toBeFocused();
      if(mobile){
        const dock=page.locator(".exp-phone-dock");
        await expect(dock.getByRole("button")).toHaveCount(4);
        const logOpener=dock.getByRole("button",{name:"Open the tide log",exact:true});
        await logOpener.click();await expect(page.getByRole("dialog",{name:"Bram’s tide log",exact:true})).toBeVisible();
        await page.keyboard.press("Escape");await expect(logOpener).toBeFocused();
      }else{
        await expect(page.locator(".exp-harbor-tools").getByRole("button",{name:"Harbor chart",exact:true})).toBeVisible();
      }
      await page.getByRole("button",{name:"Harbor chart",exact:true}).and(page.locator(":visible")).click();
      await page.locator('.exp-panel[data-surface="chart"] .harbor-routes > li').first().getByRole("button").click();
      await page.locator('.exp-panel[data-surface="sail"] .exp-primary').click();
      await guide(page,"step:west");
      await expect(game).toHaveAttribute("data-busy", "false");
      const saved = await page.evaluate(key => localStorage.getItem(key), saveKey);
      assert(saved && JSON.parse(saved).active.state.turn === 1);
      for (const path of ["/plan/", "/plan/index.html", "/plan/overview"]) {
        await page.goto(new URL(path, origin).href);
        await expect(page.getByRole("heading", { level: 1 }), path).toContainText("A small friend.");
        assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), saved, path);
      }
      const paths = ["/legacy/", "/motion/", "/privy-spike/", "/expedition/", "/outing/?classic=1", "/outing/?challenge=two-shells-v1", "/legacy/index.html", "/privy-spike/index.html", "/outing/index.html"];
      for (const path of paths) {
        await page.goto(new URL(path, origin).href);
        await passTitle(path);
        await expect(game, path).toHaveAttribute("data-mode", "court");
        await expect(world, path).toHaveAttribute("data-position", "0,0");
        await expect(world, path).toHaveAttribute("data-ready", "true");
        assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), saved, path);
        assert.deepEqual(await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(oldRecords)), oldRecords, path);
      }
      await page.reload();
      await passTitle("reload");
      await expect(world).toHaveAttribute("data-turn", "1");
      await page.clock.install({time:new Date(returnDay*86_400_000+43_200_000)});
      await page.clock.setFixedTime(new Date(returnDay*86_400_000+43_200_000));
      await page.evaluate(({saveKey,bookKey,state})=>{
        localStorage.setItem(saveKey,JSON.stringify({version:2,home:{banked:["lens"],lit:true,signaled:false,lantern:null},last:null,active:null}));
        localStorage.setItem(bookKey,JSON.stringify({version:1,active:{seed:state.seed,moves:state.moves},days:[]}));
        localStorage.removeItem("familiar.tide.pending.v1:preview");
        localStorage.removeItem("familiar.tide.log.v1:preview");localStorage.removeItem("familiar.season.preview.v1");
      },{saveKey,bookKey,state:beforeReturn});
      await page.goto(new URL("/outing/?play",origin).href);
      const tideRun=page.getByTestId("tide-run");
      await expect(page.getByTestId("tide-world")).toHaveAttribute("data-ready","true");
      await expect(tideRun).toHaveAttribute("data-busy","false");
      await guide(page,returned.moves.at(-1)!);
      const home=page.locator('.exp-panel[data-surface="home"]');await expect(home).toBeVisible();
      const filed=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)!),bookKey);
      assert.equal(filed.active,null);
      assert.deepEqual(filed.days.map((entry:{seed:number;moves:string[]})=>[entry.seed,entry.moves.length]),[[returnDay,returned.moves.length]]);
      await home.locator(".exp-secondary").click();
      await expect(page.locator('.exp-panel[data-surface="log"] .tide-log-run')).toBeVisible();
      await page.keyboard.press("Escape");
      const harborPrimary=page.locator(".exp-departure .exp-primary");
      await expect(harborPrimary).toHaveAttribute("data-action","tide");await expect(harborPrimary).toBeFocused();
      await harborPrimary.click();await expect(page.locator('.exp-panel[data-surface="bram"]')).toBeVisible();
      await page.keyboard.press("Escape");await expect(harborPrimary).toBeFocused();
      assert.deepEqual(await page.evaluate(keys=>Object.fromEntries(keys.map(key=>[key,localStorage.getItem(key)])),Object.keys(oldRecords)),oldRecords);
      console.info(`${engine.name()}: introduction, account boundary, ${paths.length} game entry URLs, saved-run resume and preserved original records passed`);
    } finally { await browser.close(); }
  }
} finally { await server?.close();compiled?.stop(true); }
