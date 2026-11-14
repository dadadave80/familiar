import { expect, test } from "bun:test";
import { SEASON_ROOT, keepTide, previewDock, previewTrade, readPreview, readTide, rollPreview, seasonView, seedPreview, shelfNote, shelvesBeaconCourt, writePreview, type TideReturn } from "./data";

const memory=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);}};};

test("a haul joins the preview satchel once a day, with another allowed after the day rolls", () => {
  const current={...seedPreview(null,20771),traded:[20,0] as [number,number],till:200};
  const docked=previewDock(current,[1,1],20771);if("block"in docked)throw Error(docked.block);
  expect(docked.market).toMatchObject({goods:[2,3],docked:20771});
  expect(current.goods).toEqual([1,2]);expect(current).not.toHaveProperty("docked");
  expect(previewDock(docked.market,[1,0],20771)).toEqual({block:"Bram has already shelved a haul today."});
  const next=previewDock(docked.market,[0,1],20772);if("block"in next)throw Error(next.block);
  expect(next.market).toMatchObject({day:20772,goods:[2,4],docked:20772,traded:[0,0],till:260});
});

test("preview saves accept a valid docking day, discard invalid ones and retain older saves", () => {
  const store=memory(),market=seedPreview(null,20771);
  writePreview(market,store);expect(readPreview(store,20771)).toEqual(market);
  for(const docked of [0,20771]){writePreview({...market,docked},store);expect(readPreview(store,20771)?.docked).toBe(docked);}
  for(const docked of [-1,1.5,Number.MAX_SAFE_INTEGER+1,"20771",null]){
    store.setItem("familiar.season.preview.v1",JSON.stringify({...market,docked}));
    expect(readPreview(store,20771)).toEqual(market);
  }
});

test("the shelf note follows the contract's alternating Beacon Court days and stays quiet for empty cargo", () => {
  expect(shelvesBeaconCourt(20771)).toBe(true);expect(shelvesBeaconCourt(20772)).toBe(false);
  expect(shelfNote({cargo:[],day:20771})).toBe("");expect(shelfNote({cargo:[],day:20772})).toBe("");
  expect(shelfNote({cargo:["lens"],day:20771})).toBe(" Bram can shelve it today.");
  expect(shelfNote({cargo:["moth"],day:20772})).toBe(" Bram can shelve it tomorrow.");
});

test("the device preview prices like the contract and refuses what the contract refuses", () => {
  const m=seedPreview(null);
  expect(m).toMatchObject({till:300,shells:0,goods:[1,2]});
  expect(previewTrade(m,"buy","glass",1)).toEqual({block:"Not enough Shells for that."});
  const sold=previewTrade(m,"sell","reed",2);if("block"in sold)throw Error(sold.block);
  expect(sold.quote.units).toEqual([3,3]);
  expect(sold.market).toMatchObject({shells:6,goods:[1,0],till:294,traded:[0,2]});
  expect(sold.market.shelf[1]).toEqual({stock:42,heat_fp:0});
  const bought=previewTrade(sold.market,"buy","reed",1);if("block"in bought)throw Error(bought.block);
  expect(bought.market.shelf[1]).toEqual({stock:41,heat_fp:1_000_000});
  expect(bought.market.shells).toBe(6-bought.quote.total);
  expect(previewTrade(m,"sell","glass",2)).toEqual({block:"Not enough in your satchel."});
  expect(previewTrade({...m,traded:[20,0]},"sell","glass",1)).toEqual({block:"Bram trades 20 of each good with you a day."});
  const store=memory();writePreview(sold.market,store);expect(readPreview(store)).toEqual(sold.market);
  store.setItem("familiar.season.preview.v1",'{"version":1,"shelf":[]}');expect(readPreview(store)).toBeNull();
});

test("the device preview rolls over each day like the contract: heat halves, till refills, limits reset", () => {
  const m={...seedPreview(null,100),till:200,traded:[20,3] as [number,number],shelf:[{stock:30,heat_fp:8_000_000},{stock:40,heat_fp:1}]};
  expect(rollPreview(m,100)).toBe(m);
  expect(rollPreview(m,101)).toMatchObject({day:101,till:260,traded:[0,0],shelf:[{stock:30,heat_fp:4_000_000},{stock:40,heat_fp:0}]});
  expect(rollPreview(m,103)).toMatchObject({till:300,shelf:[{heat_fp:1_000_000},{heat_fp:0}]});
  expect(rollPreview({...m,till:340},101).till).toBe(340);
  expect(rollPreview(m,100+64).shelf[0]!.heat_fp).toBe(0);
  expect(previewTrade(m,"sell","glass",1,100)).toEqual({block:"Bram trades 20 of each good with you a day."});
  expect("market"in previewTrade(m,"sell","glass",1,101)).toBe(true);
  const store=memory();writePreview(m,store);expect(readPreview(store,102)).toMatchObject({day:102,traded:[0,0],till:300});
  const old=memory();const {day:_,...legacy}=m;old.setItem("familiar.season.preview.v1",JSON.stringify(legacy));expect(readPreview(old,105)?.day).toBe(105);
});

test("tide returns are kept per harbor, newest first, ten at most", () => {
  const store=memory();
  const entry=(id:string):TideReturn=>({id,contentVersion:"first_light_v2",tool:"rope",commands:["return"],cargo:[],outcome:"returned",savedAt:"t"});
  for(let i=0;i<12;i++)keepTide("preview",entry(String(i)),store);
  const kept=readTide("preview",store);expect(kept.map(r=>r.id)).toEqual(["11","10","9","8","7","6","5","4","3","2"]);
  expect(readTide("alice.familiar-game.testnet",store)).toEqual([]);
});

test("views read final state from season.<root> and decode the result bytes", async () => {
  let body:Record<string,unknown>={};
  const fetcher=(async(_url:string,init:RequestInit)=>{body=JSON.parse(String(init.body));return new Response(JSON.stringify({result:{result:[...new TextEncoder().encode('{"day":1}')]}}));}) as unknown as typeof fetch;
  expect(await seasonView<{day:number}>("get_today",{account_id:null},fetcher)).toEqual({day:1});
  expect(body).toMatchObject({method:"query",params:{request_type:"call_function",finality:"final",account_id:"season."+SEASON_ROOT,method_name:"get_today"}});
  const failing=(async()=>new Response(JSON.stringify({error:{}}))) as unknown as typeof fetch;
  await expect(seasonView("get_shelf",{},failing)).rejects.toThrow("could not be read");
});
