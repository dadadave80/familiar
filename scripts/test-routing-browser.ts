import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, webkit } from "@playwright/test";
import { createServer } from "vite";

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
      const game = page.getByTestId("expedition-game"), world = page.getByTestId("expedition-world");
      await expect(world).toHaveAttribute("data-ready", "true");
      await page.getByRole("button", { name: "Game menu" }).click();
      await page.getByRole("button", { name: "Account & recovery" }).click();
      await expect(page.getByRole("heading", { name: "Your saved harbor" })).toBeVisible();
      await page.getByRole("button", { name: "Close panel" }).click();
      await page.locator('[data-action="depart"]').click();
      await page.locator('[data-command="step:west"]').click();
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
        await expect(game, path).toHaveAttribute("data-mode", "court");
        await expect(world, path).toHaveAttribute("data-position", "0,0");
        await expect(world, path).toHaveAttribute("data-ready", "true");
        assert.equal(await page.evaluate(key => localStorage.getItem(key), saveKey), saved, path);
        assert.deepEqual(await page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), Object.keys(oldRecords)), oldRecords, path);
      }
      await page.reload();
      await expect(world).toHaveAttribute("data-turn", "1");
      console.info(`${engine.name()}: introduction, account boundary, ${paths.length} game entry URLs, saved-run resume and preserved original records passed`);
    } finally { await browser.close(); }
  }
} finally { await server?.close();compiled?.stop(true); }
