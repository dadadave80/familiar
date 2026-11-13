import { expect, test } from "bun:test";
import { keepTide, previewTrade, readPreview, readTide, seasonView, seedPreview, writePreview, type TideReturn } from "./data";

const memory=()=>{const m=new Map<string,string>();return {getItem:(k:string)=>m.get(k)??null,setItem:(k:string,v:string)=>{m.set(k,v);}};};

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
  expect(body).toMatchObject({method:"query",params:{request_type:"call_function",finality:"final",account_id:"season.familiar-game.testnet",method_name:"get_today"}});
  const failing=(async()=>new Response(JSON.stringify({error:{}}))) as unknown as typeof fetch;
  await expect(seasonView("get_shelf",{},failing)).rejects.toThrow("could not be read");
});
