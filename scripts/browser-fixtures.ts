import assert from "node:assert/strict";
import type { Page } from "@playwright/test";
import type { ShelfView, TodayView } from "../web/src/season/model";

export const BROWSER_DAY=20771;
const RPC="https://test.rpc.fastnear.com/",ROOT="familiar-game.testnet";
const accounts=new Set([`alice.${ROOT}`,`bob.${ROOT}`,`harness.${ROOT}`]);
const pets=new Set([`mochi.${ROOT}`,`mochi-harness.${ROOT}`]);

/** Public reads only. A mismatched envelope is an unexpected request, never a live fallback. */
export function seasonRpcFixture(url:string,verb:string,body:string,day:number):unknown {
  assert.equal(new URL(url).href,RPC,"fixture RPC endpoint");assert.equal(verb,"POST","fixture RPC verb");
  const request=JSON.parse(body),p=request.params;
  assert.equal(request.jsonrpc,"2.0");assert.equal(request.method,"query");
  assert.equal(p?.request_type,"call_function");assert.equal(p.finality,"final");assert.equal(p.account_id,`season.${ROOT}`);
  const args=JSON.parse(Buffer.from(p.args_base64,"base64").toString("utf8"));
  switch(p.method_name){
    case "get_shelf":{
      assert.deepEqual(args,{});
      return {day,till:300,till_cap:300,till_refill:60,commission:12,goods:[
        {good:"glass",stock:40,target:40,base:8,heat_fp:0,price_fp:8_000_000,buyback_fp:6_400_000,buy_price:8,sell_price:6,waiting_wishes:0},
        {good:"reed",stock:40,target:40,base:4,heat_fp:0,price_fp:4_000_000,buyback_fp:3_200_000,buy_price:4,sell_price:3,waiting_wishes:0},
      ],shells_minted:0,goods_minted:[0,0],trade_seq:0} satisfies ShelfView;
    }
    case "get_today":{
      assert.deepEqual(Object.keys(args),["account_id"]);assert(args.account_id===null||accounts.has(args.account_id));
      const beacon=day%2===1;
      return {day,next_day_ns:(day+1)*86_400_000_000_000,rules_version:"tidebound_h1_v1",content_version:beacon?"first_light_v2":"first_light_v1",area:"beacon",command_limit:beacon?24:15,
        mapping:[["lens","glass"],["moth","reed"],["chart","reed"],["salvage","reed"],["vane",null]],
        best_haul:beacon?[{tool:"rope",hauls:[[1,1]]},{tool:"lantern",hauls:[[1,1]]}]:[{tool:"rope",hauls:[[1,1],[0,2]]},{tool:"lantern",hauls:[[1,2]]}],best_fp:beacon?12_000_000:16_000_000,minted_today:null,traded_today:null} satisfies TodayView;
    }
    case "get_account":assert.deepEqual(Object.keys(args),["account_id"]);assert(accounts.has(args.account_id));return null;
    case "get_wish":case "get_postcard":assert.deepEqual(Object.keys(args),["pet"]);assert(pets.has(args.pet));return null;
    default:throw Error(`Unknown fixture RPC method: ${String(p.method_name)}`);
  }
}

function shiftBrowserDate(time:number) {
  const OriginalDate=Date,offset=time-OriginalDate.now();
  globalThis.Date=new Proxy(OriginalDate,{
    apply:()=>new OriginalDate(OriginalDate.now()+offset).toString(),
    construct:(target,args,newTarget)=>Reflect.construct(target,args.length?args:[target.now()+offset],newTarget),
    get:(target,key)=>key==="now"?()=>target.now()+offset:Reflect.get(target,key),
  });
}

/** Date drives the UTC day; native frame/timer clocks must keep driving Phaser. */
export async function prepareBrowser(page:Page,origin:string|URL,day=BROWSER_DAY,{clock=true}: {clock?:boolean|"manual"}={}) {
  const resourceUrl=new URL(origin),local=resourceUrl.origin,unexpected:string[]=[],rpc:string[]=[];
  assert(["localhost","127.0.0.1","[::1]"].includes(resourceUrl.hostname)||local==="https://familiar-two.vercel.app","Browser fixtures require a local server or the existing hosted QA origin");
  if(clock==="manual")await page.clock.install({time:new Date(day*86_400_000+43_200_000)});
  else if(clock)await page.addInitScript(shiftBrowserDate,day*86_400_000+43_200_000);
  await page.route("**/*",async route=>{
    const request=route.request(),url=new URL(request.url());
    if(url.origin===local&&!/^\/(?:api|npc-api)(?:\/|$)/.test(url.pathname)&&["GET","HEAD"].includes(request.method()))return route.continue();
    try{
      const value=seasonRpcFixture(request.url(),request.method(),request.postData()??"",day);
      rpc.push(JSON.parse(request.postData()!).params.method_name);
      return route.fulfill({contentType:"application/json",body:JSON.stringify({jsonrpc:"2.0",id:JSON.parse(request.postData()!).id,result:{result:[...new TextEncoder().encode(JSON.stringify(value))]}})});
    }catch(error){unexpected.push(`${request.method()} ${request.url()}: ${String(error)}`);return route.abort();}
  });
  // Date shifts affect this document only; navigation and RPC fixtures retain their explicit starting day.
  return {rpc,setTime:async(time:number)=>{
    assert.equal(clock,true,"Date shifts require the native-frame fixture clock");
    await page.evaluate(shiftBrowserDate,time);
  },assertClean:()=>assert.deepEqual(unexpected,[],"Unexpected browser requests must be explicitly fixture-backed")};
}
