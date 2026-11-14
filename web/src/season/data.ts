/** Season 2 reads (public RPC, finality final), the signed-out device preview and today's tide returns. */
import { GOODS, type Good } from "./pricing";
import { quoteBuy, quoteSell, tradeBlock, type GoodView, type Quote, type SeasonAccount, type ShelfView } from "./model";

export const SEASON_ROOT = import.meta.env.VITE_NEAR_ROOT || "familiar-game.testnet";
export const SEASON_CONTRACT = `season.${SEASON_ROOT}`;
const RPC = import.meta.env.VITE_NEAR_RPC_URL || "https://test.rpc.fastnear.com";

export async function seasonView<T>(method:string, args:Record<string,unknown>={}, fetcher:typeof fetch=fetch):Promise<T> {
  const response=await fetcher(RPC,{method:"POST",signal:AbortSignal.timeout(8000),headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:"season",method:"query",
    params:{request_type:"call_function",finality:"final",account_id:SEASON_CONTRACT,method_name:method,args_base64:btoa(JSON.stringify(args))}})});
  const body=await response.json() as {result?:{result?:number[]};error?:unknown};
  if(!response.ok||!body.result?.result)throw Error("Bram’s shelf could not be read just now.");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(body.result.result))) as T;
}

// ---------- device preview ----------

export interface PreviewMarket { version:1;day:number;docked?:number;shelf:{stock:number;heat_fp:number}[];till:number;shells:number;goods:[number,number];traded:[number,number] }
/** The device's day, on the contract's boundary (floor of UTC time / 24 h). */
export const deviceDay=(now=Date.now())=>Math.floor(now/86_400_000);
// contracts/season/src/lib.rs:88, court_of: odd days replay first_light_v2 (Beacon Court).
export const shelvesBeaconCourt=(day:number):boolean=>day%2===1;
export const shelfNote=({cargo,day}:{cargo:readonly string[];day:number}):string=>cargo.length?` Bram can shelve it ${shelvesBeaconCourt(day)?"today":"tomorrow"}.`:"";
const TILL_CAP=300,TILL_REFILL=60,HEAT_HALVINGS_CAP=64;
/** The contract's lazy day effects: heat halves per day, the till refills toward its cap, daily limits reset. */
export function rollPreview(m:PreviewMarket,day=deviceDay()):PreviewMarket {
  const days=day-m.day;if(days<=0)return m;
  return {...m,day,traded:[0,0],
    shelf:m.shelf.map(s=>({stock:s.stock,heat_fp:days>=HEAT_HALVINGS_CAP?0:Number(BigInt(s.heat_fp)>>BigInt(days))})),
    till:m.till<TILL_CAP?Math.min(TILL_CAP,m.till+TILL_REFILL*days):m.till};
}
const PREVIEW_KEY="familiar.season.preview.v1";
/** A sample haul so the preview has something to sell. It is not a real haul and is labelled as such. */
export const PREVIEW_SAMPLE:[number,number]=[1,2];
export function seedPreview(shelf:ShelfView|null,day=deviceDay()):PreviewMarket {
  return {version:1,day:shelf?.day??day,shelf:GOODS.map(g=>{const v=shelf?.goods.find(x=>x.good===g);return {stock:v?.stock??40,heat_fp:v?.heat_fp??0};}),till:shelf?.till??300,shells:0,goods:[...PREVIEW_SAMPLE],traded:[0,0]};
}
export function readPreview(store?:Pick<Storage,"getItem">,day=deviceDay()):PreviewMarket|null {
  try{const v=JSON.parse((store??localStorage).getItem(PREVIEW_KEY)??"null") as PreviewMarket;
    const n=(x:unknown)=>Number.isSafeInteger(x)&&(x as number)>=0;
    if(v?.version!==1||v.shelf?.length!==2||!v.shelf.every(s=>n(s.stock)&&n(s.heat_fp))||![v.till,v.shells,...v.goods,...v.traded].every(n))return null;
    const {docked,...market}=v;
    return rollPreview({...market,day:n(v.day)?v.day:day,...(n(docked)?{docked}:{})},day);}catch{return null;}
}
export function writePreview(value:PreviewMarket,store?:Pick<Storage,"setItem">):boolean {try{(store??localStorage).setItem(PREVIEW_KEY,JSON.stringify(value));return true;}catch{return false;}}
export function previewDock(current:PreviewMarket,goods:[number,number],day=deviceDay()):{market:PreviewMarket}|{block:string} {
  const m=rollPreview(current,day);
  if(m.docked===day)return {block:"Bram has already shelved a haul today."};
  return {market:{...m,goods:[m.goods[0]+goods[0],m.goods[1]+goods[1]],docked:day}};
}
export const previewView=(m:PreviewMarket,good:Good):Pick<GoodView,"good"|"stock"|"heat_fp"|"target"|"base"|"buy_price"|"sell_price">=>{
  const i=GOODS.indexOf(good),s=m.shelf[i]!;
  return {good,stock:s.stock,heat_fp:s.heat_fp,target:40,base:good==="glass"?8:4,buy_price:quoteBuy(good,s,1)?.units[0]??0,sell_price:quoteSell(good,s,1).units[0]!};
};
/** Applies a trade to the preview with the same unit-by-unit pricing and checks as the contract. */
export function previewTrade(current:PreviewMarket,side:"buy"|"sell",good:Good,qty:number,day=deviceDay()):{market:PreviewMarket;quote:Quote}|{block:string} {
  const m=rollPreview(current,day),i=GOODS.indexOf(good),shelf=m.shelf[i]!;
  const quote=side==="buy"?quoteBuy(good,shelf,qty):quoteSell(good,shelf,qty);
  const block=tradeBlock(quote,{shells:m.shells,held:m.goods[i]!,till:m.till,tradedToday:m.traded[i]!});
  if(block||!quote)return {block:block??"Bram’s shelf does not have that many."};
  const next=structuredClone(m),s=next.shelf[i]!;
  if(side==="buy"){s.stock-=qty;s.heat_fp+=qty*1_000_000;next.shells-=quote.total;next.goods[i]!+=qty;next.till+=quote.total;}
  else{s.stock+=qty;next.goods[i]!-=qty;next.shells+=quote.total;next.till-=quote.total;}
  next.traded[i]!+=qty;
  return {market:next,quote};
}
export const previewAccount=(m:PreviewMarket):Pick<SeasonAccount,"shells"|"goods"|"traded">=>({shells:m.shells,goods:m.goods,traded:m.traded});

// ---------- today's tide returns ----------

export interface TideReturn { id:string;contentVersion:"first_light_v2";tool:"rope"|"lantern";commands:string[];cargo:string[];outcome:"returned"|"rescued";savedAt:string }
const tideKey=(scope:string)=>`familiar.season.tide.v1:${scope}`;
export function readTide(scope:string,store?:Pick<Storage,"getItem">):TideReturn[] {
  try{const v=JSON.parse((store??localStorage).getItem(tideKey(scope))??"[]");return Array.isArray(v)?v.filter(r=>r&&typeof r.id==="string"&&Array.isArray(r.commands)&&r.commands.every((c:unknown)=>typeof c==="string")&&(r.tool==="rope"||r.tool==="lantern")):[];}catch{return [];}
}
/** Keeps the latest ten tide returns for this harbor; the oldest drop off first. */
export function keepTide(scope:string,entry:TideReturn,store?:Pick<Storage,"getItem"|"setItem">) {
  store=store??localStorage;
  const next=[entry,...readTide(scope,store).filter(r=>r.id!==entry.id)].slice(0,10),text=JSON.stringify(next);
  store.setItem(tideKey(scope),text);if(store.getItem(tideKey(scope))!==text)throw Error("Today’s tide return could not be saved on this device.");
}
