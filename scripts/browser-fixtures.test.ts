import { expect, test } from "bun:test";
import type { Page, Route } from "@playwright/test";
import { runInNewContext } from "node:vm";
import { BROWSER_DAY, prepareBrowser, seasonRpcFixture } from "./browser-fixtures";

const rpc=(method:string,args:unknown={},receiver="season.familiar-game.testnet")=>JSON.stringify({jsonrpc:"2.0",id:"season",method:"query",params:{request_type:"call_function",finality:"final",account_id:receiver,method_name:method,args_base64:btoa(JSON.stringify(args))}});
test("browser RPC fixtures match endpoint, receiver, method and exact arguments",()=>{
  expect(seasonRpcFixture("https://test.rpc.fastnear.com","POST",rpc("get_shelf"),BROWSER_DAY)).toMatchObject({day:BROWSER_DAY});
  expect(seasonRpcFixture("https://test.rpc.fastnear.com","POST",rpc("get_today",{account_id:null}),BROWSER_DAY)).toMatchObject({day:BROWSER_DAY,content_version:"first_light_v2"});
  for(const [method,args] of [["get_account",{account_id:"alice.familiar-game.testnet"}],["get_wish",{pet:"mochi.familiar-game.testnet"}],["get_postcard",{pet:"mochi.familiar-game.testnet"}]] as const)
    expect(seasonRpcFixture("https://test.rpc.fastnear.com","POST",rpc(method,args),BROWSER_DAY)).toBeNull();
  for(const [url,verb,body] of [["https://test.rpc.fastnear.com.evil/","POST",rpc("get_shelf")],["https://test.rpc.fastnear.com/other","POST",rpc("get_shelf")],["https://test.rpc.fastnear.com","GET",rpc("get_shelf")],["https://test.rpc.fastnear.com","POST",rpc("get_shelf",{},"other.testnet")],["https://test.rpc.fastnear.com","POST",rpc("unknown")],["https://test.rpc.fastnear.com","POST",rpc("get_shelf",{unexpected:true})],["https://test.rpc.fastnear.com","POST",rpc("get_today",{account_id:null,extra:true})],["https://test.rpc.fastnear.com","POST",rpc("get_today",{account_id:"unknown.testnet"})]])
    expect(()=>seasonRpcFixture(url!,verb!,body!,BROWSER_DAY)).toThrow();
});

for(const origin of ["http://localhost:3000","http://127.0.0.1:3000","http://[::1]:3000","https://familiar-two.vercel.app"])
test(`browser preparation shifts only the running wall clock and validates every request at ${origin}`,async()=>{
  const calls:unknown[]=[];
  let dateScript!:(time:number)=>void;
  let handle!:(route:Route)=>Promise<unknown>;
  const page={clock:{install:async(value:unknown)=>{calls.push(["install",value]);}},addInitScript:async(callback:typeof dateScript,time:number)=>{dateScript=callback;calls.push(["date",time]);},evaluate:async(callback:typeof dateScript,time:number)=>{dateScript=callback;calls.push(["shift",time]);},route:async(pattern:string,callback:typeof handle)=>{calls.push(["route",pattern]);handle=callback;}} as unknown as Page;
  const network=await prepareBrowser(page,origin,BROWSER_DAY);
  const noon=BROWSER_DAY*86_400_000+43_200_000;
  expect(calls).toEqual([["date",noon],["route","**/*"]]);
  let elapsed=10_000;
  class WallDate extends Date { static now(){return elapsed;} }
  const native={performance:{now:()=>elapsed},setTimeout,requestAnimationFrame:()=>1};
  const context={Date:WallDate,...native,time:noon};
  runInNewContext(`(${dateScript.toString()})(time)`,context);
  expect(context.Date.now()).toBe(noon);
  elapsed+=16;
  expect(context.Date.now()).toBe(noon+16);
  expect(new context.Date().getTime()).toBe(noon+16);
  expect(new context.Date(123).getTime()).toBe(123);
  expect(new context.Date("2026-11-14T00:00:00Z").getTime()).toBe(BROWSER_DAY*86_400_000);
  expect(context.Date.parse("2026-11-14T00:00:00Z")).toBe(BROWSER_DAY*86_400_000);
  expect(context.Date.UTC(2026,10,14)).toBe(BROWSER_DAY*86_400_000);
  expect((context.Date as unknown as ()=>string)()).toBe(new Date(noon+16).toString());
  expect(context.performance).toBe(native.performance);
  expect(context.setTimeout).toBe(native.setTimeout);
  expect(context.requestAnimationFrame).toBe(native.requestAnimationFrame);
  expect(new context.Date()).toBeInstanceOf(WallDate);
  runInNewContext(`class SavedDate extends Date {}; globalThis.savedDate = new SavedDate(); globalThis.SavedDate = SavedDate;`,context);
  expect((context as any).savedDate).toBeInstanceOf((context as any).SavedDate);
  expect((context as any).savedDate.getTime()).toBe(noon+16);
  await network.setTime(noon+86_400_000);
  context.time=noon+86_400_000;
  runInNewContext(`(${dateScript.toString()})(time)`,context);
  elapsed+=16;
  expect(context.Date.now()).toBe(noon+86_400_000+16);
  expect(new context.Date().getTime()).toBe(noon+86_400_000+16);
  const request=async(url:string,method="GET",body:string|null=null)=>{
    const actions:{kind:string;body?:string}[]=[];
    await handle({request:()=>({url:()=>url,method:()=>method,postData:()=>body}),continue:async()=>{actions.push({kind:"continue"});},abort:async()=>{actions.push({kind:"abort"});},fulfill:async(response:{body:string})=>{actions.push({kind:"fulfill",body:response.body});}} as unknown as Route);
    return actions;
  };
  expect(await request(`${origin}/assets/harbor.webp`)).toEqual([{kind:"continue"}]);
  const fulfilled=await request("https://test.rpc.fastnear.com/","POST",rpc("get_shelf"));
  expect(fulfilled[0]?.kind).toBe("fulfill");
  const response=JSON.parse(fulfilled[0]!.body!);
  expect(JSON.parse(new TextDecoder().decode(Uint8Array.from(response.result.result)))).toMatchObject({day:BROWSER_DAY});
  expect(network.rpc).toEqual(["get_shelf"]);expect(()=>network.assertClean()).not.toThrow();
  expect(await request("https://unexpected.example/telemetry")).toEqual([{kind:"abort"}]);
  expect(await request(`${origin}/api/player`)).toEqual([{kind:"abort"}]);
  expect(await request(`${origin}/npc-api/note`)).toEqual([{kind:"abort"}]);
  expect(await request(`${origin}/assets/harbor.webp`,"POST")).toEqual([{kind:"abort"}]);
  expect(await request("https://test.rpc.fastnear.com/","POST",rpc("unknown"))).toEqual([{kind:"abort"}]);
  expect(()=>network.assertClean()).toThrow("Unexpected browser requests");
});

test("only deliberate timer-control scenarios install Playwright's full clock",async()=>{
  const calls:unknown[]=[];
  const page={clock:{install:async(value:unknown)=>{calls.push(["manual",value]);}},addInitScript:async()=>{calls.push(["date"]);},route:async()=>{}} as unknown as Page;
  const manual=await prepareBrowser(page,"http://localhost:3000",BROWSER_DAY,{clock:"manual"});
  expect(calls).toEqual([["manual",{time:new Date(BROWSER_DAY*86_400_000+43_200_000)}]]);
  calls.length=0;
  const unclocked=await prepareBrowser(page,"http://localhost:3000",BROWSER_DAY,{clock:false});
  expect(calls).toEqual([]);
  await expect(manual.setTime(0)).rejects.toThrow("Date shifts require");
  await expect(unclocked.setTime(0)).rejects.toThrow("Date shifts require");
});

test("browser fixtures reject every hosted origin except the existing QA deployment",async()=>{
  for(const origin of ["https://unexpected.example","http://familiar-two.vercel.app","https://familiar-two.vercel.app:444","https://familiar-two.vercel.app.evil"])
    await expect(prepareBrowser({} as Page,origin)).rejects.toThrow("Browser fixtures require a local server or the existing hosted QA origin");
});
