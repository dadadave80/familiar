import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import SeasonBram, { TodayHaul } from "./SeasonBram";
import { deviceDay, keepTide, seedPreview, type TideReturn } from "./data";
import type { ShelfView, TodayView } from "./model";

const today:TodayView={day:20771,next_day_ns:0,rules_version:"tidebound_h1_v1",content_version:"first_light_v2",area:"beacon",command_limit:24,
  mapping:[["lens","glass"],["moth","reed"]],best_haul:[{tool:"rope",hauls:[[1,1]]},{tool:"lantern",hauls:[[1,1]]}],best_fp:12_000_000,minted_today:null,traded_today:null};
const shelf:ShelfView={day:20771,till:300,till_cap:300,till_refill:60,commission:0,shells_minted:0,goods_minted:[0,0],trade_seq:0,
  goods:(["glass","reed"] as const).map(good=>({good,stock:40,target:40,base:good==="glass"?8:4,heat_fp:0,price_fp:good==="glass"?8_000_000:4_000_000,buyback_fp:0,buy_price:good==="glass"?8:4,sell_price:good==="glass"?7:3,waiting_wishes:0}))};
const props={live:{shelf,today,account:null,wish:null,postcard:null,error:""},saved:false,registered:false,busy:false,preview:seedPreview(null),scope:"preview",
  onOpenTide:()=>{},onPreview:()=>{},onPreviewBlock:()=>{},act:async()=>{}};
const full=["step:north","step:north","step:west","wait","wait","step:east","reel:lens","step:east","step:west","step:east","take:moth","step:west","step:east","step:south","step:west","step:south","return"];
const lens=["wait","step:west","wait","step:north","step:north","take:lens","step:south","step:east","return"];
const entry=(id:string,commands:string[]):TideReturn=>({id,commands,contentVersion:"first_light_v2",tool:"rope",cargo:[],outcome:"returned",savedAt:"2026-11-14T23:59:59Z"});
function withReturns(entries:TideReturn[],check:()=>void) {
  const previous=Object.getOwnPropertyDescriptor(globalThis,"localStorage"),items=new Map<string,string>();
  const store={getItem:(key:string)=>items.get(key)??null,setItem:(key:string,value:string)=>{items.set(key,value);}};
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:store});
  try{for(const value of entries)keepTide("preview",value,store);check();}
  finally{if(previous)Object.defineProperty(globalThis,"localStorage",previous);else Reflect.deleteProperty(globalThis,"localStorage");}
}

test("Bram has one haul block before two tabs and keeps the action status region",()=>withReturns([],()=>{
  const html=renderToStaticMarkup(<SeasonBram tideScope="preview" onOpenTide={()=>{}}/>);
  expect(html).toContain('aria-label="Bram’s shelf"');expect(html).toContain('role="status"');
  expect(html.match(/role="tab"/g)).toHaveLength(2);
  expect(html).toContain("Shelf &amp; till");expect(html).toContain("Mochi’s wish");
  expect(html.indexOf("Today’s haul")).toBeLessThan(html.indexOf('role="tablist"'));
  expect(html).not.toContain("Sail today’s tide");expect(html).not.toContain("Bram’s season");
}));

test("the haul states read the ledger first, then a saved docking before the other route",()=>{
  expect(renderToStaticMarkup(<TodayHaul {...props} live={{...props.live,today:null}}/>)).toContain("Reading Bram’s ledger…");
  const minted={day:20771,content_version:"first_light_v1",tool:"rope",goods:[1,1] as [number,number],value_fp:12_000_000,best_fp:12_000_000,score_bp:10_000};
  const html=renderToStaticMarkup(<TodayHaul {...props} saved live={{...props.live,today:{...today,content_version:"first_light_v1",minted_today:minted}}}/>);
  expect(html).toContain("Bram shelved 1 glass and 1 reed bundle today");expect(html).not.toContain("every other day");
  expect(renderToStaticMarkup(<TodayHaul {...props} live={{...props.live,today:{...today,content_version:"first_light_v1"}}}/>)).toContain("Keep today’s find; he can shelve it tomorrow.");
});

test("empty and invalid returns lead to the Tidekeeper's ask",()=>withReturns([entry("empty",["return"])],()=>{
  const html=renderToStaticMarkup(<TodayHaul {...props}/>);
  expect(html).toContain("Bring a find home from today’s tide and Bram will shelve it.");expect(html).toContain("See today’s ask");expect(html).not.toContain("Shelve ");
}));

test("shelving offers replayed hauls best first, names the outing day and works signed out",()=>withReturns([entry("full",full),entry("lens",lens)],()=>{
  const html=renderToStaticMarkup(<TodayHaul {...props}/>);
  expect(html.indexOf("Shelve 1 glass and 1 reed bundle")).toBeLessThan(html.indexOf("Shelve 1 glass</button>"));
  expect(html).toContain("Rope · Saturday 14 November");expect(html).not.toContain('aria-disabled="true"');
  expect(renderToStaticMarkup(<TodayHaul {...props} saved/>)).toContain('aria-disabled="true"');
  expect(renderToStaticMarkup(<TodayHaul {...props} saved registered/>)).not.toContain('aria-disabled="true"');
}));

test("a device docking removes the shelving offers for that day",()=>withReturns([entry("full",full)],()=>{
  const html=renderToStaticMarkup(<TodayHaul {...props} preview={{...props.preview,docked:deviceDay()}}/>);
  expect(html).toContain("Today’s haul is on Bram’s shelf. He takes one a day; bring another find tomorrow.");expect(html).not.toContain("Shelve ");
}));
