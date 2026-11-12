import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect, type Page } from "@playwright/test";
import { createServer } from "vite";
import { mochiNameForPlayer } from "../web/src/account/names";

// Fixture-only module replacement. Production signing, account configuration, and contracts are untouched.
const fixtureModule = `
import { actions, KeyPair, KeyPairSigner, base64Encode, baseDecode, baseEncode, createTransaction, encodeTransaction } from 'near-api-js';
const root='tidebound-fixture.testnet', itemsContract='items.'+root;
const key=KeyPair.fromRandom('ed25519');
const binding={playerId:'fixture-player',network:'testnet',nearAccountId:'p-1.'+root,signerPublicKey:key.getPublicKey().toString(),signerBindingId:'fixture:google'};
const evidence={id:'a'.repeat(64),token_id:'lantern:'+ 'b'.repeat(64),maker:binding.nearAccountId,origin_claim_id:'c'.repeat(64),motif:'crest',input_hash:'d'.repeat(64),rules_version:'tidebound_h1_v1',content_version:'first_light_v1'};
const fixture=window.__tbFixture={authenticated:false,bound:true,provisions:0,authentications:0,authorizations:[],broadcasts:[],statuses:{},occupiedTokens:[],balance:'250000000000000000000000',gasUnavailable:false,gasReads:[],uncertainNext:false,delayJourney:false,releaseJourney:null,readsWaiting:0,pets:[{token_id:'mochi.'+root}],
 journey:{revision:1,banked:['lens'],lit:true,signaled:false,lens_claim:evidence.origin_claim_id,moth_claim:null,credit:'available',workshop_salvage:1,bram_budget:12,shells:0,burned_shells:0,commission_fulfilled:false,craft:null,polish:null,placement:null},items:[]};
const copy=value=>JSON.parse(JSON.stringify(value));
const finalHash='11111111111111111111111111111111';
const fee=(send_sir,send_not_sir,execution)=>({send_sir,send_not_sir,execution});
const protocol={chain_id:'testnet',protocol_version:88,transaction_validity_period:86400,runtime_config:{min_gas_purchase_price:'1000000000',storage_amount_per_byte:'10000000000000000000',transaction_costs:{
 action_receipt_creation_config:fee(108059500000,108059500000,108059500000),action_creation_config:{
  function_call_cost:fee(200000000000,200000000000,780000000000),function_call_cost_per_byte:fee(2235934,47683715,2235934),
  transfer_cost:fee(115123062500,115123062500,115123062500),add_key_cost:{full_access_cost:fee(101765125000,101765125000,101765125000)},
 },
}}};
function gasRead(method,blockHash){fixture.gasReads.push({method,blockHash});if(fixture.gasUnavailable)throw Error('fixture gas RPC unavailable');if(blockHash!==finalHash)throw Error('fixture gas quote must use the same finalized block')}
fixture.seedPendingAdoption=async name=>{
 const tx=createTransaction(binding.nearAccountId,key.getPublicKey(),root,BigInt(fixture.broadcasts.length)+1n,[actions.functionCall('adopt',{name},180000000000000n,0n)],baseDecode(finalHash));
 const transaction=base64Encode(encodeTransaction(tx)),hash=baseEncode(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(encodeTransaction(tx)))));
 const pending={operationId:'native:fixture-original-adoption',hash,method:'adopt',receiver:root,transaction,state:'prepared'};
 localStorage.setItem('familiar.tidebound.pending.v1:'+root+':'+binding.nearAccountId,JSON.stringify(pending));return copy(pending);
};
const provider={
 async getNetworkId(){return 'testnet'},
 async callFunction({method,args}){
  if(method==='tidebound_protocol')return {registry:root,items:itemsContract,network:'testnet',rules_version:'tidebound_h1_v1',content_version:'first_light_v1'};
  if(method==='craft_protocol')return {registry:root,network:'testnet',rules_version:'tidebound_h1_v1',content_version:'first_light_v1'};
  if(method==='tidebound_journey'){
    const value=copy(fixture.journey);
    if(fixture.delayJourney){fixture.readsWaiting++;return new Promise(resolve=>{fixture.releaseJourney=()=>{fixture.delayJourney=false;fixture.releaseJourney=null;fixture.readsWaiting--;resolve(value)}})}
    return value;
  }
  if(method==='tidebound_checkpoint_hash')return 'e'.repeat(64);
  if(method==='nft_tokens_for_owner')return copy(fixture.pets);
  if(method==='craft_inventory')return {items:copy(fixture.items),next_index:null};
  if(method==='mt_balance_of')return fixture.items.some(item=>item.mint.token_id===args.token_id)?'1':'0';
  if(method==='storage_balance_of')return {total:'10000000000000000000000',available:'10000000000000000000000'};
  throw Error('Unexpected fixture method '+method);
 },
 async viewAccount({blockQuery}={}){if(blockQuery)gasRead('view_account',blockQuery.blockId);return {amount:BigInt(fixture.balance),storage_usage:182}},
 async experimental_protocolConfig({blockId}){gasRead('EXPERIMENTAL_protocol_config',blockId);return copy(protocol)},
 async viewGasPrice(blockHash){gasRead('gas_price',blockHash);return {gas_price:100000000n}},
 async viewAccessKey(){return {permission:'FullAccess',nonce:BigInt(fixture.broadcasts.length)}},
 async viewBlock(){return {header:{hash:finalHash,height:100}}},
 async sendTransactionUntil(signed){
   const tx=signed.transaction,call=tx.actions[0].functionCall,args=JSON.parse(new TextDecoder().decode(new Uint8Array(call.args)));
   const j=fixture.journey;let failure=null;
   if(call.methodName==='adopt'){if(fixture.pets.length)throw Error('fixture duplicate adoption');if(fixture.occupiedTokens.some(token=>token.token_id===args.name+'.'+root))failure={ActionError:{kind:'ERR_NAME_TAKEN'}};else fixture.pets=[{token_id:args.name+'.'+root}]}
   else if(call.methodName==='tidebound_commission'){if(j.commission_fulfilled)throw Error('fixture duplicate commission');j.workshop_salvage=0;j.bram_budget=0;j.shells=12;j.commission_fulfilled=true}
   else if(call.methodName==='tidebound_craft'){if(j.credit!=='available')throw Error('fixture duplicate craft');j.credit='consumed';j.craft={evidence:copy(evidence),pet_id:'mochi.'+root,state:'confirmed',attempt:1};fixture.items=[{mint:copy(evidence),finish:'original',appearance_version:0,finish_used:false}]}
   else if(call.methodName==='tidebound_polish'){if(j.shells!==12||fixture.items[0].finish_used)throw Error('fixture invalid polish');j.shells=0;j.burned_shells=12;j.polish={state:'confirmed',attempt:1};fixture.items[0].finish='harbor_polish';fixture.items[0].appearance_version=1;fixture.items[0].finish_used=true}
   else if(call.methodName==='tidebound_place'){j.placement={item_id:args.item_id,socket:args.socket}}
   else throw Error('Unexpected fixture native method '+call.methodName);
   if(!failure)j.revision++;
   const hash=baseEncode(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(encodeTransaction(tx)))));
   fixture.broadcasts.push({method:call.methodName,signer:tx.signerId,receiver:tx.receiverId,deposit:call.deposit.toString(),args});
   const outcome={final_execution_status:'FINAL',status:failure?{Failure:failure}:{SuccessValue:''},transaction:{hash,signer_id:tx.signerId,receiver_id:tx.receiverId},receipts_outcome:[]};
   if(fixture.uncertainNext){fixture.uncertainNext=false;outcome.final_execution_status='EXECUTED_OPTIMISTIC';outcome.status='Unknown'}
   fixture.statuses[hash]=outcome;return outcome;
 },
 async viewTransactionStatusWithReceipts({txHash}){return fixture.statuses[txHash]},
};
const adapter={
 accountRoot:root,
 async checkUsername(username){return {username,accountId:username+'.'+root,available:true,root,network:'testnet'}},
 async restoreSession(){return fixture.authenticated&&fixture.bound?binding:null},
 async authenticate(){fixture.authentications++;fixture.authenticated=true;return fixture.bound?binding:null},
 async resolveBinding(){return fixture.authenticated&&fixture.bound?binding:null},
 async provisionAccount(username){if(fixture.bound)return binding;fixture.provisions++;fixture.bound=true;binding.nearAccountId=username+'.'+root;evidence.maker=binding.nearAccountId;return binding},
 async authorizeNative(tx,operationId){fixture.authorizations.push({operationId,signer:tx.signerId});return (await new KeyPairSigner(key).signTransaction(tx)).signedTransaction},
 markSubmitted(){},
 async endSession(){fixture.authenticated=false},
};
export function createRecoverableAccountConnection(){return window.__tbFixtureDisabled?null:{adapter,provider}}
`;
const captures = await mkdtemp(join(tmpdir(), "familiar-tidebound-account-fixture-"));
const server = await createServer({
  root: resolve(import.meta.dir, "../web"), envDir: false, envPrefix: [], logLevel: "error",
  cacheDir: join(captures, "vite-cache"),
  define: {
    "import.meta.env.VITE_TIDEBOUND_ENABLED": JSON.stringify("true"),
    "import.meta.env.VITE_NEAR_ROOT": JSON.stringify("tidebound-fixture.testnet"),
    "import.meta.env.VITE_NEAR_AUTH_CLIENT_ID": JSON.stringify("synthetic-fixture-client"),
    "import.meta.env.VITE_TIDEBOUND_AUTH_ORIGIN": JSON.stringify("https://fixture.invalid"),
  },
  plugins: [{ name: "isolated-synthetic-account", enforce: "pre", transform(_code, id) {
    if (id.split("?")[0]?.endsWith("/web/src/account/client.ts")) return { code: fixtureModule, map: null };
  } }],
  server: { host: "127.0.0.1", port: 0 },
});
await server.listen();
const origin = server.resolvedUrls!.local[0]!.replace(/\/$/, "");
const browser = await chromium.launch({ headless: true });
const results: unknown[] = [];
type Fixture = { authenticated:boolean; pets: {token_id:string}[]; occupiedTokens:{token_id:string;owner:string}[]; seedPendingAdoption(name:string):Promise<{operationId:string;hash:string;transaction:string}>; provisions: number; authentications: number; authorizations:{operationId:string;signer:string}[]; balance:string; gasUnavailable:boolean; gasReads:{method:string;blockHash:string}[]; statuses:Record<string,{final_execution_status:string;status:unknown}>; bound: boolean; uncertainNext:boolean; broadcasts: { method: string; signer: string; deposit: string;args:Record<string,unknown> }[]; delayJourney: boolean; readsWaiting: number; releaseJourney: (() => void) | null; journey: { credit: string; shells: number; burned_shells: number;revision:number }; items: { mint: { token_id: string; motif: string }; finish_used: boolean }[] };
async function fixture<T>(page: Page, work: (fixture: Fixture) => T): Promise<T> {
  return page.evaluate(work => (new Function("fixture", `return (${work})(fixture)`))((window as unknown as { __tbFixture: Fixture }).__tbFixture), work.toString());
}
async function fixedPage(page: Page, label: string) {
  const size = await page.evaluate(() => ({ x: scrollX, y: scrollY, width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
  assert.equal(size.x, 0, `${label}: window does not scroll sideways`);
  assert.equal(size.y, 0, `${label}: window does not scroll vertically`);
  assert(size.scrollWidth <= size.width && size.scrollHeight <= size.height + 1, `${label}: whole page fits the viewport`);
  await expect(page.getByRole("tab", { name: "Account", exact: true })).toBeInViewport();
}
async function reachableAccount(page: Page, label: string) {
  const pane = page.locator(".tb-account-harbor");
  const geometry = await pane.evaluate(node => ({ client: node.clientHeight, scroll: node.scrollHeight, overflow: getComputedStyle(node).overflowY }));
  assert(geometry.client > 80 && ["auto", "scroll"].includes(geometry.overflow), `${label}: account uses a bounded internal scroller`);
  const controls = pane.locator("button:visible, input:visible, select:visible, summary:visible, a:visible");
  for (let i = 0; i < await controls.count(); i++) {
    const control = controls.nth(i);
    await control.scrollIntoViewIfNeeded();
    const r = await control.boundingBox(), p = await pane.boundingBox();
    assert(r && p && r.x >= p.x - 1 && r.x + r.width <= p.x + p.width + 1 && r.y >= p.y - 1 && r.y + r.height <= p.y + p.height + 1, `${label}: ${await control.textContent()} is reachable inside the account pane`);
  }
  await fixedPage(page, label);
}
async function capture(page: Page, label: string) {
  await fixedPage(page, label);
  await page.evaluate(() => {
    const note = document.createElement("div");note.dataset.syntheticFixture = "true";
    note.textContent = "Synthetic local fixture · no real sign-in or chain ownership";
    note.style.cssText = "position:fixed;inset:0 0 auto;z-index:9999;padding:3px;background:#fff9ef;color:#1e1a17;font:11px/1.2 sans-serif;pointer-events:none";
    document.body.append(note);
  });
  await page.screenshot({ path: join(captures, `${label}.png`) });
  await page.locator("[data-synthetic-fixture]").evaluate(node => node.remove());
}

try {
  for (const viewport of [{width:320,height:568},{width:390,height:844},{width:1280,height:800}]) {
    const {width}=viewport;
    const context = await browser.newContext({ viewport, reducedMotion: "reduce" });
    const page = await context.newPage(); const errors: string[] = [], external: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (!request.url().startsWith(origin) && !request.url().startsWith("data:") && !request.url().startsWith("blob:")) external.push(request.url()); });
    await page.goto(origin + "/outing/");
    await page.getByRole("tab", { name: "Account", exact: true }).click();
    const account = page.locator(".tb-account-harbor");
    await expect(account.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled();
    assert.equal(await fixture(page, f => f.provisions), 0, "restore never provisions");
    await account.getByRole("button", { name: "Continue with Google", exact: true }).click();
    await expect(account.getByText(/Saved progress · NEAR testnet · revision 1/)).toBeVisible();
    assert.equal(await fixture(page, f => f.provisions), 0, "existing sign-in never provisions");
    await expect(account.getByRole("button",{name:"Adopt Mochi",exact:true})).toHaveCount(0);
    await expect(account.getByLabel("Mochi’s harbor name",{exact:true})).toHaveCount(0);
    assert.deepEqual(await fixture(page,f=>f.pets),[{token_id:"mochi.tidebound-fixture.testnet"}],"existing Mochi keeps its original identifier");
    await reachableAccount(page, `${width}-signed-in`);
    await account.getByRole("button", { name: "Use saved harbor for next outing", exact: true }).click();
    await expect(account.getByRole("button", { name: "Craft lantern on testnet", exact: true })).toBeEnabled();
    await account.getByRole("button", { name: /Fulfill Bram’s request/ }).click();
    await expect(account.getByText(/12 bound Shells · no cash redemption/)).toBeVisible();
    assert.equal(await fixture(page, f => f.journey.credit), "available", "commission preserves protected credit");
    await account.getByRole("button", { name: "Craft lantern on testnet", exact: true }).click();
    await expect(account.getByText("Owned item confirmed on NEAR testnet. Maker:", { exact: false })).toBeVisible();
    await account.getByText("Origin and token",{exact:true}).click();
    await reachableAccount(page,`${width}-origin-details`);
    await account.getByText("Origin and token",{exact:true}).click();
    await expect(account.getByRole("button", { name: "Preview harbor polish · 12 Shells", exact: true })).toBeEnabled();
    const tokenBefore = await fixture(page, f => f.items[0]!.mint.token_id);
    await account.getByRole("button", { name: "Preview harbor polish · 12 Shells", exact: true }).click();
    const polish = account.getByRole("region", { name: "Preview harbor polish", exact: true });
    await expect(polish).toBeFocused();
    await expect(polish.locator('[data-polished="false"]')).toHaveCount(1);
    await expect(polish.locator('[data-polished="true"]')).toHaveCount(1);
    await expect(polish.getByText("12 bound Shells, once for this token. Its motif, maker and origin stay the same.", { exact: true })).toBeVisible();
    assert.equal((await fixture(page, f => f.broadcasts)).filter(x => x.method === "tidebound_polish").length, 0, "preview spends nothing");
    await reachableAccount(page, `${width}-polish-review`);
    await polish.getByRole("button", { name: "Keep original finish", exact: true }).click();
    await expect(account.getByRole("button", { name: "Preview harbor polish · 12 Shells", exact: true })).toBeFocused();
    await account.getByRole("button", { name: "Preview harbor polish · 12 Shells", exact: true }).click();
    await capture(page, `${width}-polish-preview-fixture`);
    await polish.getByRole("button", { name: "Confirm polish · 12 Shells", exact: true }).click();
    await expect(account.getByText(/Harbor polish · finish used/)).toBeVisible();
    assert.equal(await fixture(page, f => f.items[0]!.mint.token_id), tokenBefore);
    assert.equal(await fixture(page, f => f.journey.shells), 0);
    assert.equal(await fixture(page, f => f.journey.burned_shells), 12);
    await expect(account.getByRole("button", { name: "Preview harbor polish · 12 Shells", exact: true })).toHaveCount(0);
    await account.getByRole("button", { name: "Place at dock", exact: true }).click();
    await expect(page.getByTestId("placed-lantern")).toHaveAttribute("data-socket", "dock");
    await reachableAccount(page, `${width}-owned-polished`);
    await capture(page, `${width}-owned-polished-fixture`);
    if(width===390) await page.setViewportSize({width:390,height:500});
    await account.getByLabel("Gift to a testnet account", {exact:true}).fill("recipient.testnet");
    await account.getByLabel("Gift to a testnet account", {exact:true}).focus();
    await reachableAccount(page, `${width}-recipient-keyboard`);
    await account.getByRole("button", {name:"Review gift",exact:true}).click();
    const gift=account.getByRole("region", {name:"Confirm lantern gift",exact:true});
    await expect(gift).toBeFocused();
    await expect(gift).toContainText("recipient.testnet");
    await expect(gift).toContainText("Your usable placement will disappear after confirmation");
    await reachableAccount(page, `${width}-gift-review`);
    if(width===390)await capture(page,"390x500-gift-review-fixture");
    await gift.getByRole("button",{name:"Cancel gift",exact:true}).click();
    await expect(account.getByRole("button",{name:"Review gift",exact:true})).toBeFocused();
    const downloadEvent=page.waitForEvent("download");
    await account.getByRole("button",{name:"Export progress and item references",exact:true}).click();
    const download=await downloadEvent;
    assert.equal(download.suggestedFilename(),"familiar-testnet-progress.json");
    const exported=await Bun.file((await download.path())!).json();
    assert.equal(exported.network,"testnet");
    assert(!/secret|signerBindingId|credential|google-oauth2/.test(JSON.stringify(exported)),"progress download excludes credentials and private keys");
    await expect(account.locator("textarea")).toHaveCount(0);
    await fixedPage(page,`${width}-export`);
    if(width===390) await page.setViewportSize(viewport);

    const broadcasts = await fixture(page, f => f.broadcasts);
    assert(broadcasts.every(tx => tx.signer === "p-1.tidebound-fixture.testnet" && tx.deposit === "0"), "native fixture actions use player signer and no sale-price sponsor deposit");

    await fixture(page,f=>{f.uncertainNext=true});
    await account.getByRole("button",{name:"Place at porch",exact:true}).click();
    await expect(account.getByRole("button",{name:"Resolve expired unexecuted request",exact:true})).toBeVisible();
    await expect(account.getByText(/Only a provably expired, unused signing request can be cleared/)).toBeVisible();
    await reachableAccount(page,`${width}-pending-proof-controls`);
    const beforeReceipt=await fixture(page,f=>({authorizations:f.authorizations.length,broadcasts:f.broadcasts.length,gasReads:f.gasReads.length}));
    await fixture(page,f=>{f.balance='0';f.gasUnavailable=true;for(const status of Object.values(f.statuses)){status.final_execution_status='FINAL';status.status={SuccessValue:''};}});
    await account.getByRole("button",{name:"Check original receipt",exact:true}).click();
    await expect(account.getByRole("button",{name:"Check original receipt",exact:true})).toHaveCount(0);
    assert.deepEqual(await fixture(page,f=>({authorizations:f.authorizations.length,broadcasts:f.broadcasts.length,gasReads:f.gasReads.length})),beforeReceipt,"submitted receipt reconciliation needs no affordability RPC, signature or rebroadcast even with zero balance");
    await fixture(page,f=>{f.balance='250000000000000000000000';f.gasUnavailable=false;});

    // Delay an old account's explicit refresh, sign out, then release that old response.
    await fixture(page, f => { f.delayJourney = true; });
    await account.getByRole("button", { name: "Check saved harbor", exact: true }).click();
    await expect.poll(() => fixture(page, f => f.readsWaiting)).toBe(1);
    await account.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(account.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled();
    await fixture(page, f => { f.releaseJourney!(); });
    await expect.poll(() => fixture(page, f => f.readsWaiting)).toBe(0);
    await page.waitForTimeout(100);
    await expect(account.getByText(/Saved progress · NEAR testnet/)).toHaveCount(0);
    await expect(account.getByText(/Owned item confirmed/)).toHaveCount(0);
    await expect(page.getByTestId("placed-lantern")).toHaveCount(0);
    assert.equal(await page.evaluate(() => localStorage.getItem("familiar.guest.v1")), null, "synthetic account route never touches legacy secret namespace");
    assert.deepEqual(errors, []); assert.deepEqual(external, [], "fixture makes no real auth, RPC, or service calls");
    assert((await fixture(page,f=>f.gasReads)).every(read=>read.blockHash==='11111111111111111111111111111111'),"all affordability reads share the transaction's finalized block");
    results.push({ ...viewport, pageScroll:"none",accountScroll:"contained",giftAndExport:"passed", commissionBeforeCraft: "passed", polishPreviewAndOnce: "passed", slowRefreshAfterSignOut: "passed", submittedReceiptWithoutGasRpc:"passed" });
    await context.close();
  }
  const choices = await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"});
  const choicePage=await choices.newPage();await choicePage.goto(origin+"/outing/");
  // Mount account controls first, then change the local preview through real game controls.
  await choicePage.getByRole("tab",{name:"Account",exact:true}).click();
  await expect(choicePage.getByRole("button",{name:"Continue with Google",exact:true})).toBeEnabled();
  await choicePage.getByRole("tab",{name:"Outing",exact:true}).click();
  await choicePage.locator('[data-action="depart"]').click();
  for(const command of ["wait","move:left","move:center","move:right","reel:lens","move:center","move:right","take:moth","move:center","return"])
    await choicePage.locator(`[data-action="${command}"]`).click();
  await choicePage.locator('[data-action="install"]').click();
  await choicePage.getByRole("tab",{name:"Workshop",exact:true}).click();
  await choicePage.getByRole("button",{name:"Choose motif",exact:true}).click();
  await choicePage.getByRole("radio",{name:/Moth Wing-shaped/}).check();
  await choicePage.getByRole("button",{name:"Use Moth motif",exact:true}).click();
  await choicePage.getByRole("button",{name:"Preview lantern",exact:true}).click();
  await choicePage.getByRole("button",{name:"Choose placement",exact:true}).click();
  await choicePage.getByRole("radio",{name:/Dock A light/}).check();
  await choicePage.getByRole("button",{name:"Place here",exact:true}).click();
  await choicePage.getByRole("tab",{name:"Account",exact:true}).click();
  const choiceAccount=choicePage.locator(".tb-account-harbor");
  await choiceAccount.getByRole("button",{name:"Continue with Google",exact:true}).click();
  await expect(choiceAccount.getByRole("combobox",{name:"Earned motif",exact:true})).toHaveValue("moth");
  await expect(choiceAccount.getByText(/Your device preview chose Moth at the dock/)).toBeVisible();
  await expect(choiceAccount.getByRole("button",{name:"Craft lantern on testnet",exact:true})).toBeDisabled();
  await choiceAccount.getByRole("combobox",{name:"Earned motif",exact:true}).selectOption("crest");
  await choiceAccount.getByRole("button",{name:"Craft lantern on testnet",exact:true}).click();
  await expect(choiceAccount.getByText(/The saved lantern keeps its original Crest motif/)).toBeVisible();
  await expect(choiceAccount.getByText(/Your device preview uses the dock/)).toBeVisible();
  assert.equal(await fixture(choicePage,f=>f.items[0]!.mint.motif),"crest","minted motif is not overwritten by another preview");
  const preview=await choicePage.evaluate(()=>JSON.parse(localStorage.getItem("familiar.first-light.beacon.v1")!).storycraft.lantern);
  assert.deepEqual(preview,{motif:"moth",socket:"dock"},"local choice remains a private preview after login");
  await fixture(choicePage,f=>{f.items=[]});
  await choiceAccount.getByRole("button",{name:"Check saved harbor",exact:true}).click();
  await expect(choiceAccount.getByText(/This preview stays a private memory; it cannot mint a replacement/)).toBeVisible();
  await expect(choiceAccount.getByRole("button",{name:"Craft lantern on testnet",exact:true})).toHaveCount(0);
  await reachableAccount(choicePage,"390-transferred-preview-conflict");
  await choices.close();
  const fresh = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const first = await fresh.newPage(); await first.goto(origin + "/outing/");
  await first.getByRole("tab", { name: "Account", exact: true }).click();
  const firstAccount = first.locator(".tb-account-harbor");
  await expect(firstAccount.getByRole("button", { name: "Continue with Google", exact: true })).toBeEnabled();
  await fixture(first, f => { f.bound = false; f.pets=[]; });
  await firstAccount.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(firstAccount.getByRole("button", { name: "Create my testnet player", exact: true })).toBeVisible();
  assert.equal(await fixture(first, f => f.provisions), 0, "a new identity's login requires explicit provisioning");
  await firstAccount.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(firstAccount.getByRole("button",{name:"Continue with Google",exact:true})).toBeEnabled();
  await expect(firstAccount.getByLabel("Choose a username",{exact:true})).toHaveCount(0);
  assert.equal(await fixture(first,f=>f.authenticated),false,"unbound identity can sign out before creation");
  assert.equal(await fixture(first,f=>f.provisions),0,"unbound sign out creates nothing");
  await firstAccount.getByRole("button",{name:"Continue with Google",exact:true}).click();
  await expect(firstAccount.getByRole("button",{name:"Create my testnet player",exact:true})).toBeVisible();
  assert.equal(await fixture(first,f=>f.authentications),2,"the same new identity can sign in again after leaving signup");
  assert.equal(await fixture(first,f=>f.provisions),0);
  await firstAccount.getByLabel("Choose a username",{exact:true}).fill("items");
  await expect(firstAccount.getByRole("button",{name:"Check availability",exact:true})).toBeDisabled();
  await firstAccount.getByLabel("Choose a username",{exact:true}).fill("new-player");
  await expect(firstAccount.getByRole("button",{name:"Create my testnet player",exact:true})).toBeDisabled();
  await firstAccount.getByRole("button",{name:"Check availability",exact:true}).click();
  await expect(firstAccount.getByText(/new-player.tidebound-fixture.testnet is available now/)).toBeVisible();
  await firstAccount.getByLabel("Choose a username",{exact:true}).fill("other-player");
  await expect(firstAccount.getByRole("button",{name:"Create my testnet player",exact:true})).toBeDisabled();
  await firstAccount.getByLabel("Choose a username",{exact:true}).fill("new-player");
  await firstAccount.getByRole("button",{name:"Check availability",exact:true}).click();
  await firstAccount.getByRole("button", { name: "Create my testnet player", exact: true }).click();
  await expect(firstAccount.getByText(/Saved progress · NEAR testnet · revision 1/)).toBeVisible();
  await expect(firstAccount.getByText("new-player.tidebound-fixture.testnet",{exact:true})).toBeVisible();
  assert.equal(await fixture(first, f => f.provisions), 1);
  await first.setViewportSize({width:390,height:500});
  await expect(firstAccount.getByLabel("Mochi’s harbor name",{exact:true})).toHaveCount(0);
  await expect(firstAccount.getByRole("textbox")).toHaveCount(0);
  await firstAccount.getByRole("button",{name:"Adopt Mochi",exact:true}).focus();
  await reachableAccount(first,"390x500-adoption");
  await first.setViewportSize({width:390,height:844});
  await fixture(first,f=>{f.balance='150000000000000000000000';});
  const beforeUnderfunded=await fixture(first,f=>({authorizations:f.authorizations.length,broadcasts:f.broadcasts.length,provisions:f.provisions}));
  const pendingBefore=await first.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('familiar.tidebound.pending.v1:')));
  assert.deepEqual(pendingBefore,[]);
  await firstAccount.getByRole("button",{name:"Adopt Mochi",exact:true}).click();
  const underfundedNotice=firstAccount.getByText(/needs more test NEAR for gas prepayment and the attached deposit/);
  await expect(underfundedNotice).toBeVisible();
  assert.deepEqual(await fixture(first,f=>({authorizations:f.authorizations.length,broadcasts:f.broadcasts.length,provisions:f.provisions})),beforeUnderfunded,"0.15 test NEAR rejects adoption before a signature, broadcast or replacement account");
  assert.deepEqual(await first.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('familiar.tidebound.pending.v1:'))),pendingBefore,"underfunding creates no pending native request");
  await reachableAccount(first,"390-underfunded-adoption");await underfundedNotice.scrollIntoViewIfNeeded();await expect(underfundedNotice).toBeInViewport();await capture(first,"390-underfunded-adoption-fixture");
  await fixture(first,f=>{f.balance='250000000000000000000000';});
  await firstAccount.getByRole("button",{name:"Adopt Mochi",exact:true}).click();
  await expect(firstAccount.getByRole("button",{name:"Adopt Mochi",exact:true})).toHaveCount(0);
  assert.equal(await fixture(first,f=>f.authorizations.length),beforeUnderfunded.authorizations+1,"0.25 test NEAR permits one synthetic approval");
  assert.equal(await fixture(first,f=>f.broadcasts.filter(tx=>tx.method==='adopt').length),1,"funded retry executes once in the fixture");
  const automaticName=await mochiNameForPlayer("new-player.tidebound-fixture.testnet","tidebound-fixture.testnet");
  assert.equal(await fixture(first,f=>f.broadcasts.find(tx=>tx.method==='adopt')!.args.name),automaticName);
  assert.deepEqual(await fixture(first,f=>f.pets),[{token_id:automaticName+".tidebound-fixture.testnet"}],"first adoption uses the stable internal identifier without another field");
  await firstAccount.getByRole("button", { name: "Sign out", exact: true }).click();
  await firstAccount.getByRole("button", { name: "Continue with Google", exact: true }).click();
  await expect(firstAccount.getByText(/Saved progress · NEAR testnet · revision 2/)).toBeVisible();
  assert.equal(await fixture(first, f => f.provisions), 1, "returning login never provisions a second fixture player");
  await fresh.close();
  for(const scenario of ["existing-pet-arrived","occupied-internal-name","original-pending-adoption"]) {
    const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:"reduce"}),page=await context.newPage(),errors:string[]=[],external:string[]=[];
    page.on("pageerror",error=>errors.push(error.message));page.on("request",request=>{if(!request.url().startsWith(origin)&&!request.url().startsWith("data:")&&!request.url().startsWith("blob:"))external.push(request.url());});
    await page.goto(origin+"/outing/");await page.getByRole("tab",{name:"Account",exact:true}).click();await expect(page.getByRole("button",{name:"Continue with Google",exact:true})).toBeEnabled();
    await fixture(page,f=>{f.pets=[];});
    const original=scenario==="original-pending-adoption"?await fixture(page,f=>f.seedPendingAdoption("old-mochi")):null;
    await page.getByRole("button",{name:"Continue with Google",exact:true}).click();const account=page.locator(".tb-account-harbor");
    await expect(account.getByRole("button",{name:"Adopt Mochi",exact:true})).toBeVisible();await expect(account.getByRole("textbox")).toHaveCount(0);
    if(scenario==="existing-pet-arrived") {
      await fixture(page,f=>{f.pets=[{token_id:'bramble-old.tidebound-fixture.testnet'}];});
      await account.getByRole("button",{name:"Adopt Mochi",exact:true}).click();
      await expect(account.getByRole("button",{name:"Adopt Mochi",exact:true})).toHaveCount(0);
      assert.deepEqual(await fixture(page,f=>f.pets),[{token_id:'bramble-old.tidebound-fixture.testnet'}]);
      assert.equal(await fixture(page,f=>f.authorizations.length),0,"a fresh owned-pet read prevents replacing an existing Mochi");assert.equal(await fixture(page,f=>f.broadcasts.length),0);
    }else if(scenario==="occupied-internal-name") {
      const name=await mochiNameForPlayer("p-1.tidebound-fixture.testnet","tidebound-fixture.testnet"),occupied={token_id:name+'.tidebound-fixture.testnet',owner:'another-holder.testnet'};
      await page.evaluate(token=>(window as unknown as {__tbFixture:Fixture}).__tbFixture.occupiedTokens=[token],occupied);
      await account.getByRole("button",{name:"Adopt Mochi",exact:true}).click();await expect(account.getByText(/A receipt failed/)).toBeVisible();
      assert.deepEqual(await fixture(page,f=>f.occupiedTokens),[occupied],"an occupied token keeps its existing holder");assert.deepEqual(await fixture(page,f=>f.pets),[]);
      assert.equal(await fixture(page,f=>f.broadcasts.length),1,"a collision does not trigger a random-name fallback or automatic retry");assert.equal(await fixture(page,f=>f.broadcasts[0]!.args.name),name);assert.equal(await fixture(page,f=>f.provisions),0);assert.equal(await fixture(page,f=>f.journey.revision),1);
    }else {
      await expect(account.getByRole("button",{name:"Adopt Mochi",exact:true})).toBeDisabled();
      assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('familiar.tidebound.pending.v1:tidebound-fixture.testnet:p-1.tidebound-fixture.testnet')!).transaction),original!.transaction);
      await account.getByRole("button",{name:"Resume original action",exact:true}).click();await expect(account.getByRole("button",{name:"Adopt Mochi",exact:true})).toHaveCount(0);
      assert.equal(await fixture(page,f=>f.broadcasts[0]!.args.name),"old-mochi","pending adoption keeps its original pre-update name");assert.equal(await fixture(page,f=>f.authorizations[0]!.operationId),original!.operationId);
      assert.deepEqual(await fixture(page,f=>f.pets),[{token_id:'old-mochi.tidebound-fixture.testnet'}]);assert.equal(await fixture(page,f=>f.broadcasts.length),1);
    }
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await reachableAccount(page,scenario);await capture(page,`${scenario}-fixture`);await context.close();
  }
  const disabled = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await disabled.addInitScript(() => { (window as unknown as { __tbFixtureDisabled: boolean }).__tbFixtureDisabled = true; });
  const off = await disabled.newPage(); await off.goto(origin + "/outing/");
  await off.getByRole("tab", { name: "Account", exact: true }).click();
  await expect(off.locator(".tb-account-harbor").getByText(/Cross-device saving is not connected at this address/)).toBeVisible();
  await expect(off.getByRole("button", { name: "Continue with Google", exact: true })).toHaveCount(0);
  await expect(off.getByText(/Owned item confirmed/)).toHaveCount(0);
  await disabled.close();
  console.log(JSON.stringify({ results, disabledFixture: "passed", explicitProvisioning: "passed", simulatedKeyboardHeight:500, previewChoiceAndTransferredConflict:"passed",underfundedAdoptionBeforeSigning:"passed at synthetic 0.15 test NEAR",fundedAdoption:"passed at synthetic 0.25 test NEAR",automaticMochiIdentifier:"stable; second name field absent",existingMochiAndNameCollision:"preserved without fallback",originalPendingAdoption:"original name and operation resumed", captures, limits: "Explicitly synthetic local Chromium fixtures. No OAuth, native chain execution, physical device, wallet recovery, human playtest, or retention claim. Viewport shrink simulates keyboard space; actual Android/iPad keyboards were not tested." }, null, 2));
} finally { await browser.close(); await server.close(); }
