import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import SeasonBram, { Shelf, Status, TodayHaul, WishTab } from "./SeasonBram";
import SeasonBoundary from "./SeasonBoundary";
import { deviceDay, keepTide, seedPreview, type TideReturn } from "./data";
import type { ShelfView, TodayView } from "./model";
import type { DayResult } from "../tide/run-day";

const today:TodayView={day:20771,next_day_ns:0,rules_version:"tidebound_h1_v1",content_version:"first_light_v2",area:"beacon",command_limit:24,
  mapping:[["lens","glass"],["moth","reed"]],best_haul:[{tool:"rope",hauls:[[1,1]]},{tool:"lantern",hauls:[[1,1]]}],best_fp:12_000_000,minted_today:null,traded_today:null};
const shelf:ShelfView={day:20771,till:300,till_cap:300,till_refill:60,commission:0,shells_minted:0,goods_minted:[0,0],trade_seq:0,
  goods:(["glass","reed"] as const).map(good=>({good,stock:40,target:40,base:good==="glass"?8:4,heat_fp:0,price_fp:good==="glass"?8_000_000:4_000_000,buyback_fp:0,buy_price:good==="glass"?8:4,sell_price:good==="glass"?7:3,waiting_wishes:0}))};
const props={live:{shelf,today,account:null,wish:null,postcard:null,error:""},saved:false,registered:false,busy:false,preview:seedPreview(null),scope:"preview",
  onOpenTide:()=>{},onPreview:()=>{},onPreviewBlock:()=>{},act:async()=>{}};
const full=["step:north","step:north","step:west","wait","wait","step:east","reel:lens","step:east","step:west","step:east","take:moth","step:west","step:east","step:south","step:west","step:south","return"];
const lens=["wait","step:west","wait","step:north","step:north","take:lens","step:south","step:east","return"];
const entry=(id:string,commands:string[]):TideReturn=>({id,commands,contentVersion:"first_light_v2",tool:"rope",cargo:[],outcome:"returned",savedAt:"2026-11-14T23:59:59Z"});

test("the preview status explains blocked storage once in idle and confirmed states",()=>{
  const note="This shelf lasts only until the page closes. This browser isn’t keeping site data.";
  for(const state of [{kind:"idle"} as const,{kind:"confirmed",value:null} as const]){
    const html=renderToStaticMarkup(<Status state={state} confirmed="Shelved for this visit: 1 glass. Not recorded." previewSaved={false}/>);
    expect(html).toContain(note);
    expect(html.split(note)).toHaveLength(2);
    expect(html).not.toContain("Shelved on this device");
  }
  expect(renderToStaticMarkup(<Status state={{kind:"confirmed",value:null}} confirmed="Shelved on this device: 1 glass. Not recorded." previewSaved/>)).toContain("Shelved on this device");
  expect(renderToStaticMarkup(<Status state={{kind:"idle"}} confirmed="" previewSaved/>)).not.toContain(note);
});

test("a shelving press supplies distinct saved and in-memory confirmations",()=>withReturns([entry("full",full)],()=>{
  let texts:string[]=[];
  const haul=TodayHaul({...props,onPreview:(_market,saved,unsaved)=>{texts=[saved,unsaved??""];}});
  haul.props.children[0].props.children.find((child:{props:{onPress?:()=>void}})=>child.props.onPress).props.onPress();
  expect(texts).toEqual(["Shelved on this device: 1 glass and 1 reed bundle. Not recorded.","Shelved for this visit: 1 glass and 1 reed bundle. Not recorded."]);
}));

test("the shelf boundary preserves healthy content and gives a local reload message on failure",()=>{
  const boundary=new SeasonBoundary({children:<p>Bram’s shelf</p>});
  expect(renderToStaticMarkup(<>{boundary.render()}</>)).toContain("Bram’s shelf</p>");
  boundary.state=SeasonBoundary.getDerivedStateFromError();
  const html=renderToStaticMarkup(<p>“You’re back.”</p>)+renderToStaticMarkup(<>{boundary.render()}</>);
  expect(html).toContain("“You’re back.”");expect(html).toContain('class="ss-problem" role="alert"');
  expect(html).toContain("Bram’s shelf won’t open just now. Reload the page to try again.");
});

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
  expect(html).toContain("Device preview · not recorded");
  expect(html).not.toContain("Prices follow Bram’s formula on this device");
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
  expect(html.match(/class="ss-primary"/g)).toHaveLength(1);
  expect(html).toContain('class="ss-haul-art" aria-hidden="true"');
  expect(html).toContain('/assets/season/glass.webp');expect(html).toContain('/assets/season/reed.webp');
  expect(renderToStaticMarkup(<TodayHaul {...props} primary={false}/>)).not.toContain('class="ss-primary"');
  expect(renderToStaticMarkup(<TodayHaul {...props} saved/>)).toContain('aria-disabled="true"');
  expect(renderToStaticMarkup(<TodayHaul {...props} saved registered/>)).not.toContain('aria-disabled="true"');
}));

test("market cards keep both quotes and trade actions, with formulas in closed details",()=>{
  const html=renderToStaticMarkup(<Shelf {...props} onResetPreview={()=>{}}/>);
  const cards=[...html.matchAll(/<article class="ss-trade-card">(.*?)<\/article>/g)].map(match=>match[1]!);
  expect(cards).toHaveLength(4);
  for(const card of cards){
    expect(card.match(/<button/g)).toHaveLength(1);
    expect(card).toMatch(/\b(Buy|Sell) 1<\/button>/);
    expect(card).toContain('alt="" width="56" height="56"');
    expect(card).toContain('aria-describedby="ss-');
  }
  expect(html.match(/<details class="ss-pricing"><summary>How Bram prices this<\/summary><p class="ss-reason">/g)).toHaveLength(2);
  expect(html).toContain("base 8");expect(html).toContain("base 4");
  expect(html).toContain('aria-label="Fewer: glass to trade"');expect(html).toContain('aria-label="More: reed bundles to trade"');
  expect(html).not.toContain("Prices here use the same formula as Bram’s ledger");
});

test("wishes explain the saved harbor requirement and retain the saved wish controls",()=>{
  const preview=renderToStaticMarkup(<WishTab {...props} hasPet={false}/>);
  expect(preview).toContain("Mochi’s wishes need a saved harbor.");expect(preview).not.toContain("Sign in from the menu");
  expect(preview).not.toContain("Set Mochi’s wish");
  const saved=renderToStaticMarkup(<WishTab {...props} saved registered hasPet/>);
  expect(saved).toContain('role="radiogroup" aria-label="Good"');expect(saved).toContain('role="radiogroup" aria-label="How many"');
  expect(saved).toContain('aria-label="Highest price per unit"');expect(saved).toContain("Set Mochi’s wish");
  expect(saved).toContain('class="ss-primary"');
});

test("a device docking removes the shelving offers for that day",()=>withReturns([entry("full",full)],()=>{
  const html=renderToStaticMarkup(<TodayHaul {...props} preview={{...props.preview,docked:deviceDay()}}/>);
  expect(html).toContain("Today’s haul is on Bram’s shelf. He takes one a day; bring another find tomorrow.");expect(html).not.toContain("Shelve ");
}));

const run:DayResult={day:20771,score:6,guess:6,banked:["reed","reed","reed","glass","pearl"],stamps:{home:true,guess:true,dry:true},splashes:0};
const unread={...props.live,shelf:null,today:null,error:"Bram’s shelf could not be read just now."};

test("a run harbor offers today's tide without waiting for the season ledger or the court's day",()=>{
  for(const live of [unread,{...props.live,today:{...today,content_version:"first_light_v1" as const}}]){
    const html=renderToStaticMarkup(<TodayHaul {...props} live={live} run={null}/>);
    expect(html).toContain("Sail today’s tide and bring something home. Bram shelves reed and glass, up to three of each a day.");
    expect(html).toContain('class="ss-link">See today’s tide</button>');
    expect(html).not.toContain("Reading Bram’s ledger");expect(html).not.toContain("every other day");
    expect(html).not.toContain("Shelve ");
  }
  expect(renderToStaticMarkup(<SeasonBram tideScope="preview" onOpenTide={()=>{}} run={null}/>)).toContain("See today’s tide");
});

test("a run harbor's docking takes priority even before a run or ledger is available",()=>{
  for(const result of [null,run]){
    const html=renderToStaticMarkup(<TodayHaul {...props} live={unread} preview={{...props.preview,docked:deviceDay()}} run={result}/>);
    expect(html).toContain('class="ss-docked" data-docked="true"');
    expect(html).toContain("Today’s haul is on Bram’s shelf. He takes one a day; bring another find tomorrow.");
    expect(html).not.toContain("Shelve ");expect(html).not.toContain("See today’s tide");
  }
  expect(renderToStaticMarkup(<TodayHaul {...props} preview={{...props.preview,docked:deviceDay()-1}} run={run}/>)).toContain("Shelve 1 glass and 3 reed bundles");
});

test("an empty run haul has nothing to press and pearls stay with Mochi",()=>{
  for(const [banked,keep] of [
    [[],""],[["pearl"]," Mochi keeps the pearl."],[["pearl","pearl"]," Mochi keeps the 2 pearls."],
  ] as const){
    const html=renderToStaticMarkup(<TodayHaul {...props} live={unread} run={{...run,banked}}/>);
    expect(html).toBe(`<p>Today’s tide brought no reed or glass.${keep}</p>`);
    expect(html).not.toContain("<button");expect(html).not.toContain("ss-haul-art");
  }
});

test("a run shelving offer shows counted goods, its banked line and the pearl reminder",()=>{
  const html=renderToStaticMarkup(<TodayHaul {...props} live={unread} run={run}/>);
  expect(html).toContain('class="ss-act ss-haul-offer ss-run-haul"');
  expect(html).toContain('/assets/season/glass.webp');expect(html).toContain('/assets/season/reed.webp');
  expect(html).toContain('width="56" height="56"/>×1</span>');
  expect(html).toContain('width="56" height="56"/>×3</span>');
  expect(html).not.toContain('/assets/run/pearl.webp');
  expect(html).toContain("From today’s tide run: Banked 6 · Bram guessed 6.");
  expect(html).toContain("Shelve 1 glass and 3 reed bundles");
  expect(html).toContain('class="ss-info">Mochi keeps the pearl.</span>');
  expect(html).toContain('class="ss-primary" aria-disabled="false"');
  expect(renderToStaticMarkup(<TodayHaul {...props} run={run} primary={false}/>)).not.toContain('class="ss-primary"');
  expect(renderToStaticMarkup(<TodayHaul {...props} run={run} busy/>)).toContain('aria-disabled="true"');
  expect(renderToStaticMarkup(<TodayHaul {...props} run={{...run,banked:["glass","pearl","pearl"]}}/>)).toContain("Mochi keeps the 2 pearls.");
  expect(renderToStaticMarkup(<TodayHaul {...props} run={{...run,banked:["glass"]}}/>)).not.toContain("Mochi keeps");
});

test("a run press caps each shelf good and seeds a device preview when the RPC is unreadable",()=>{
  let next:ReturnType<typeof seedPreview>|undefined;
  let texts:string[]=[];
  const result:DayResult={...run,banked:["glass","glass","glass","glass","reed","reed","reed","reed","pearl"]};
  const component=TodayHaul({...props,live:unread,preview:null,run:result,onPreview:(market,saved,unsaved)=>{next=market;texts=[saved,unsaved??""];},onPreviewBlock:()=>{throw Error("unexpected block");}});
  const offer=(component.type as (props:typeof component.props)=>typeof component)(component.props);
  offer.props.children.find((child:{props?:{onPress?:()=>void}})=>child?.props?.onPress).props.onPress();
  expect(next?.goods).toEqual([4,5]);
  expect(next?.docked).toBe(deviceDay());
  expect(next?.shelf).toEqual([{stock:40,heat_fp:0},{stock:40,heat_fp:0}]);
  expect(texts).toEqual(["Shelved on this device: 3 glass and 3 reed bundles. Not recorded.","Shelved for this visit: 3 glass and 3 reed bundles. Not recorded."]);
});

test("signed-in hauls and omitted run props keep the legacy ledger flow",()=>withReturns([entry("full",full)],()=>{
  for(const result of [null,run]){
    expect(renderToStaticMarkup(<TodayHaul {...props} saved registered run={result}/>)).toBe(renderToStaticMarkup(<TodayHaul {...props} saved registered/>));
    expect(renderToStaticMarkup(<TodayHaul {...props} saved live={unread} run={result}/>)).toBe("<p>Reading Bram’s ledger…</p>");
  }
  expect(renderToStaticMarkup(<TodayHaul {...props} run={undefined}/>)).toBe(renderToStaticMarkup(<TodayHaul {...props}/>));
}));
