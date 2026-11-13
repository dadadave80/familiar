import assert from "node:assert/strict";
import {mkdtemp} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {chromium,expect,type Page} from "@playwright/test";
import {createServer,transformWithOxc} from "vite";

// Real Game, account panel and records UI over a synthetic session. RPC answers are intercepted
// with response shapes captured from https://test.rpc.fastnear.com on 2026-11-13; nothing reaches the network.
const shots=process.argv[2];
const root="familiar-game.testnet",player=`qa-maker-h1.${root}`,pet=`qa-mochi-h1.${root}`,items=`items.${root}`;
const signer="ed25519:2DP5Amx7h1JJ17P2B1VvwHMYf9adeuKuitqEEqWsRXt5",pinned="CQQ63d8dNsM8oVCeEsU57USX212396zFmhtnqjgeXi1J",RPC="https://rpc.records.fixture/";
const entry=`
import '/src/browser-globals.ts';
import React from 'react';import{createRoot}from'react-dom/client';
import{HarborSessionProvider,HarborAccountPanel,useHarborSession}from'/src/expedition/harbor-session.tsx';
const root=${JSON.stringify(root)};
const owner={playerId:'fixture',network:'testnet',nearAccountId:${JSON.stringify(player)},signerPublicKey:${JSON.stringify(signer)},signerBindingId:'fixture'};
const journey={revision:11,banked:[],lit:false,signaled:false,lens_claim:null,moth_claim:null,credit:'unclaimed',workshop_salvage:1,bram_budget:0,shells:0,burned_shells:0,commission_fulfilled:false,craft:null,polish:null,placement:null};
const pets=location.search.includes('nopet')?[]:[{token_id:${JSON.stringify(pet)}}];
const connection={adapter:{accountRoot:root,async restoreSession(){return location.search.includes('signedout')?null:owner},async authenticate(){return owner},async endSession(){},async provisionAccount(){throw Error('no')}},accountExists:async()=>{},client:{root,itemsContract:'items.'+root,
 async snapshot(binding){return structuredClone({readAt:'synthetic',binding,journey,checkpointHash:'a'.repeat(64),pets,items:[],nextItemIndex:null})},
 async verifyStack(){},pending(){return null},async send(){throw Error('no sends')},async resumeNative(){throw Error('no')},async reconcileNative(){return 'checked'},async resolveExpiredNative(){return 'not proven'},async view(){throw Error('no view')}}};
const Game=React.lazy(()=>import('/src/expedition/Game.tsx'));
function GameProbe(){const session=useHarborSession();return <React.Suspense fallback={<p>Opening</p>}><Game session={session} accountPanel={<HarborAccountPanel/>}/></React.Suspense>}
createRoot(document.getElementById('root')).render(<HarborSessionProvider connection={connection}><GameProbe/></HarborSessionProvider>);
`;
const encode=(v:unknown)=>[...new TextEncoder().encode(JSON.stringify(v))];
const full=(public_key:string,nonce:number)=>({access_key:{nonce,permission:"FullAccess"},public_key});
function answer(params:Record<string,string>):unknown {
  const args=params.args_base64?JSON.parse(atob(params.args_base64)):{};
  if(params.request_type==="view_account")return {result:{amount:"300000000000000000000000",block_hash:"EAcUNYLRd1NFDZqD3bw66pk9Rei3pYhMGR9pN8XCSg3N",block_height:277567587,code_hash:"11111111111111111111111111111111",global_contract_hash:pinned,locked:"0",storage_paid_at:0,storage_usage:397}};
  if(params.request_type==="view_access_key_list"){
    const keys=params.account_id===pet?[]:params.account_id===player?[full(signer,277414125000020),full("ed25519:Di7QPiWUz21DnQucab8pe6qYPAnWpZnQWXYPfwa8kn3S",277418725000001)]:[full("ed25519:9gqucqLaUsuGCLoK9HFDthu5nDXXZmzASyE6rZa6QNw",277411058000019)];
    return {result:{block_hash:"38XBR8EXcvJ8dcZkv4JSSp2FGyR2FMkufzjBWPeBbVCf",block_height:277567588,keys}};
  }
  const claim=(operation_id:string,id:string,lens:boolean)=>({operation_id,id,input_hash:"0a356c5cedbc1382d38a7d20487cdba3851ec4d8bf79716341300e053ecfa2aa",lens,moth:lens,rules_version:"tidebound_h1_v1",content_version:"first_light_v1"});
  const views:Record<string,unknown>={
    get_config:{relayer:`relayer.${root}`,pet_code_hash:pinned,items,bakery:`bakery.${root}`,market:`market.${root}`,pool:"kiln.pool.f863973.m0"},
    nft_token:args.token_id===pet?{token_id:pet,owner_id:player,metadata:{title:pet},approved_account_ids:{}}:null,
    tidebound_journey:{revision:11,shells:0,burned_shells:12,commission_fulfilled:true,claims:[claim("operator-qa:maker-lens-moth","8c5cbc6a02e6a0878b90723334c9e2e682e690a76758922ee445225a560072e5",true),claim("operator-qa:maker-wind-vane","be6ec9d4bde579ad041995d9a5a17d3473b77fd24c9866535cf1ed5a7fdf5c39",false)]},
    tidebound_protocol:{network:"testnet",rules_version:"tidebound_h1_v1",content_version:"first_light_v1",supported_content_versions:["first_light_v1","first_light_v2"],items,registry:root},
  };
  return {result:{block_hash:"GoSh9zRcxKwqSxwpgpGtibiegXckia6jF9To3xofH1if",block_height:277567589,logs:[],result:encode(views[params.method_name!])}};
}
async function serve(records:boolean) {
  const dir=await mkdtemp(join(tmpdir(),"familiar-records-")),id="\0records-fixture.tsx";
  const server=await createServer({configFile:false,root:resolve(import.meta.dir,"../web"),envDir:false,envPrefix:[],cacheDir:join(dir,"vite-cache"),logLevel:"error",
    define:{"import.meta.env.VITE_RECORDS_ENABLED":JSON.stringify(records?"true":"false"),"import.meta.env.VITE_NEAR_RPC_URL":JSON.stringify(RPC),"import.meta.env.VITE_ACCOUNT_PROVIDER":JSON.stringify("privy")},
    plugins:[{name:"records-fixture",resolveId(source){if(source==="/__records-fixture.tsx")return id;},async load(source){if(source===id)return (await transformWithOxc(entry,"records-fixture.tsx")).code;},
      configureServer(s){s.middlewares.use((req,res,next)=>{if((req.url??"").split("?")[0]!=="/__records"){next();return;}res.setHeader("Content-Type","text/html");res.end('<!doctype html><div id="root"></div><script type="module" src="/__records-fixture.tsx"></script>');});}}],
    optimizeDeps:{include:["react","react-dom","react-dom/client","react/jsx-dev-runtime"]},server:{host:"127.0.0.1",port:0}});
  await server.listen();return {server,origin:server.resolvedUrls!.local[0]!.replace(/\/$/,"")};
}
async function openAccount(page:Page,url:string,rpc:{count:number;fail?:boolean}) {
  await page.route(RPC,async route=>{rpc.count++;const body=JSON.parse(route.request().postData()!);assert.equal(body.params.finality,"final");
    await route.fulfill(rpc.fail?{status:502,body:"bad gateway"}:{contentType:"application/json",body:JSON.stringify({jsonrpc:"2.0",id:body.id,...answer(body.params) as object})});});
    await page.goto(url);await expect(page.getByTestId("expedition-world")).toHaveAttribute("data-ready","true",{timeout:20000});
  await page.getByRole("button",{name:"Game menu",exact:true}).click();await page.getByRole("button",{name:"Account & recovery",exact:true}).click();
}
const browser=await chromium.launch({headless:true}),on=await serve(true),off=await serve(false);
try {
  // Let each dev server finish its first dependency optimisation before any checked page loads.
  for(const origin of [on.origin,off.origin]){const warm=await browser.newPage();await warm.goto(origin+"/__records?signedout");await warm.getByTestId("expedition-world").waitFor({timeout:30000}).catch(()=>{});await warm.waitForTimeout(1500);await warm.close();}
  for(const [width,height] of [[390,844],[1440,900]] as const){
    const page=await browser.newPage({viewport:{width,height}}),errors:string[]=[],external:string[]=[],rpc={count:0};
    page.on("pageerror",e=>errors.push(e.message));page.on("request",r=>{const u=r.url();if(!u.startsWith(on.origin)&&!u.startsWith(RPC)&&!u.startsWith("blob:")&&!u.startsWith("data:"))external.push(u);});
    await openAccount(page,on.origin+"/__records",rpc);
    await expect(page.getByText("Mochi is home · confirmed for this saved account.")).toBeVisible();
    const toggle=page.getByRole("button",{name:"Read the harbor records",exact:true});await expect(toggle).toHaveAttribute("aria-expanded","false");
    assert.equal(rpc.count,0,"no reads before a record is opened");
    await toggle.focus();await page.keyboard.press("Enter");
    await expect(page.getByText("The harbor replayed your steps and agreed they bring Mochi home.")).toBeVisible();
    assert.equal(rpc.count,9);
    for(const text of [`The harbor register lists you, ${player}, as Mochi’s keeper.`,"No keys: no one, not you and not Familiar, can sign as Mochi’s account.","Runs the shared Mochi code the harbor pins; Mochi’s account carries no separate code.","Your harbor key lives in your Privy wallet.","Shells: 0 held, 12 spent.","Root and Items still have full-access admin keys on testnet, so the whole harbor is not immutable: their code can still be changed."])
      await expect(page.getByText(text,{exact:true})).toBeVisible();
    const panel=page.getByRole("dialog");
    const small=await panel.locator("button:visible").evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect()).filter(r=>r.height<44||r.width<44).length);assert.equal(small,0,"44px targets");
    const again=page.getByRole("button",{name:"Check again",exact:true});
    for(let i=0;i<30&&!(await again.evaluate(n=>n===document.activeElement));i++)await page.keyboard.press("Tab");
    await expect(again).toBeFocused();
    const scroll=await panel.evaluate(n=>n.scrollWidth<=n.clientWidth);assert(scroll,"no horizontal scroll in the panel");
    if(shots)for(const [name,at] of [["top",0],["middle",.5],["end",1]] as const){await panel.evaluate((n,f)=>n.scrollTo(0,(n.scrollHeight-n.clientHeight)*f),at);await page.screenshot({path:join(shots,`records-${width}x${height}-${name}.png`)});}
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);await page.close();
    console.log(`records ${width}x${height}: live-shape records, keyboard path, 44px targets passed`);
  }
  {const page=await browser.newPage({viewport:{width:390,height:844}}),rpc={count:0,fail:true};
    await openAccount(page,on.origin+"/__records",rpc);await page.getByRole("button",{name:"Read the harbor records",exact:true}).click();
    await expect(page.getByText("Mochi’s keeper couldn’t be checked just now.",{exact:true})).toBeVisible();
    for(const claim of ["No keys:","Privy wallet","replayed your steps","still has"])assert.equal(await page.getByText(claim).count(),0,`no ${claim} without its read`);
    if(shots)await page.screenshot({path:join(shots,"records-390x844-unreachable.png")});
    await page.close();console.log("records: failed reads say they couldn't be checked");}
  for(const [label,url] of [["signed out",on.origin+"/__records?signedout"],["no Mochi",on.origin+"/__records?nopet"],["flag off",off.origin+"/__records"]] as const){
    const page=await browser.newPage({viewport:{width:390,height:844}}),rpc={count:0},errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));await openAccount(page,url,rpc);
    await expect(page.getByRole("heading",{name:"Your saved harbor"})).toBeVisible();await page.waitForTimeout(300);
    assert.equal(await page.getByRole("button",{name:"Read the harbor records"}).count(),0,`${label}: no records`);assert.equal(rpc.count,0);assert.deepEqual(errors,[]);
    await page.close();console.log(`records ${label}: hidden, no reads`);
  }
} finally {await browser.close();await on.server.close();await off.server.close();}
