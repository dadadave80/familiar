import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";

const captures=await mkdtemp(join(tmpdir(),"familiar-privy-browser-"));
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1280,height:800}});
  const errors:string[]=[];
  page.on("pageerror",error=>errors.push(error.message));
  const providers:string[]=[];
  page.on("request",request=>{if(/privy\.io|PrivyProvider/.test(request.url()))providers.push(request.url());});
  await page.goto("http://localhost:3000/outing/?classic=1");
  await page.getByRole("tab",{name:"Account",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Keep your harbor on all your devices",exact:true})).toBeVisible();
  await expect(page.getByRole("button",{name:"Continue with email",exact:true})).toHaveCount(0);
  assert.deepEqual(providers,[],"Disabled game issuance must not initialize Privy even when public app configuration exists.");
  await page.goto("http://localhost:3000/privy-spike/");
  await expect(page.getByRole("heading",{name:"Check your recovery wallet",exact:true})).toBeVisible({timeout:15000});
  await expect(page.getByRole("button",{name:"Sign in with email",exact:true})).toBeEnabled({timeout:30000});
  assert.deepEqual(errors,[],"The actual SDK must initialize in a browser, beyond a successful build.");
  await page.screenshot({path:join(captures,"desktop-ready.png")});
  await page.getByRole("button",{name:"Sign in with email",exact:true}).click();
  // Privy's dialog wrapper has zero height; its positioned form is the visible surface.
  await expect(page.locator("#privy-dialog")).toBeAttached();
  await expect(page.getByPlaceholder("your@email.com",{exact:true})).toBeVisible();
  assert.deepEqual(errors,[],"The real provider login form opens without browser exceptions.");
  await page.screenshot({path:join(captures,"desktop-email-modal.png")});
  console.info(JSON.stringify({ready:"passed",emailForm:"passed",captures,limits:"Real SDK startup/form only. No email submitted, wallet created, signature requested, chain broadcast, or device recovery tested."}));
}finally{await browser.close();}
