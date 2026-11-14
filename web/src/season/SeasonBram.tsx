import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { HarborSession, SeasonIntent } from "../expedition/harbor-port";
import { dayLabel } from "../tide/cards";
import { GOODS, type Good } from "./pricing";
import {
  GOOD_INDEX, PURSE_MAX, WISH_QTY_MAX, claimable, goodName, haulLine, postcardLines, quoteBuy, quoteLine, quoteSell, reasonLine, scoreLine,
  OPEN_REQUEST, settle, settleError, tradeArgs, tradeBlock, wishBlock, wishStatus,
  type ActionState, type Mint, type Postcard, type SeasonAccount, type ShelfView, type TodayView, type Trade, type Wish, type WishResult,
} from "./model";
import { PREVIEW_SAMPLE, deviceDay, previewDock, previewTrade, rollPreview, previewView, readPreview, readTide, seasonView, seedPreview, writePreview, type PreviewMarket } from "./data";
import "./season.css";

const ART = "/assets/season/";
const STORAGE_NEAR = "0.0125";
type Tab = "shelf" | "wish";
const TABS: [Tab, string][] = [["shelf","Shelf & till"],["wish","Mochi’s wish"]];

interface Live { shelf:ShelfView|null;today:TodayView|null;account:SeasonAccount|null|undefined;wish:Wish|null;postcard:Postcard|null;error:string }
const empty:Live = { shelf:null,today:null,account:undefined,wish:null,postcard:null,error:"" };

function useSeason(accountId:string|null, pet:string|null) {
  const [live,setLive]=useState<Live>(empty),[loading,setLoading]=useState(true),request=useRef(0);
  const refresh=useCallback(async()=>{
    const id=++request.current;setLoading(true);
    try{
      const [shelf,today,account,wish,postcard]=await Promise.all([
        seasonView<ShelfView>("get_shelf"),
        seasonView<TodayView>("get_today",{account_id:accountId}),
        accountId?seasonView<SeasonAccount|null>("get_account",{account_id:accountId}):Promise.resolve(undefined),
        pet?seasonView<Wish|null>("get_wish",{pet}):Promise.resolve(null),
        pet?seasonView<Postcard|null>("get_postcard",{pet}):Promise.resolve(null),
      ]);
      if(id===request.current)setLive({shelf,today,account,wish,postcard,error:""});
    }catch(error){if(id===request.current)setLive(l=>({...l,error:error instanceof Error?error.message:"Bram’s shelf could not be read just now."}));}
    finally{if(id===request.current)setLoading(false);}
  },[accountId,pet]);
  useEffect(()=>{void refresh();},[refresh]);
  return {live,loading,refresh};
}

export const Status=({state,confirmed,previewSaved=true,ref}:{state:ActionState<unknown>;confirmed:string;previewSaved?:boolean;ref?:React.Ref<HTMLParagraphElement>})=>{
  const text=state.kind==="pending"?state.label:state.kind==="confirmed"?confirmed:state.kind==="refused"||state.kind==="uncertain"?state.words:"";
  return <p ref={ref} tabIndex={-1} className="ss-status" role="status" aria-live="polite" data-state={state.kind}>{text}{!previewSaved&&`${text?" ":""}This shelf lasts only until the page closes. This browser isn’t keeping site data.`}</p>;
};
/**
 * A button that stays focusable while unavailable (aria-disabled), so a press that makes it
 * unavailable never drops keyboard focus out of the panel.
 */
function Press({off,onPress,children,className,describedBy,label}:{off:boolean;onPress:()=>void;children:ReactNode;className?:string;describedBy?:string;label?:string}) {
  return <button className={className} aria-disabled={off} aria-describedby={describedBy} aria-label={label} onClick={()=>{if(!off)onPress();}}>{children}</button>;
}

export interface SeasonBramProps { session?:HarborSession;onOpenTide:()=>void;tideScope:string }

export default function SeasonBram({session,onOpenTide,tideScope}:SeasonBramProps) {
  const saved=session?.state.mode==="saved"&&!!session.state.snapshot&&!!session.seasonAct;
  const accountId=saved?session!.state.snapshot!.binding.nearAccountId:null,pet=saved?session!.state.snapshot!.pets[0]?.token_id??null:null;
  const {live,loading,refresh}=useSeason(accountId,pet);
  const [tab,setTab]=useState<Tab>("shelf");
  const tabRefs=useRef<(HTMLButtonElement|null)[]>([]);
  const [action,setAction]=useState<ActionState<unknown>>({kind:"idle"}),[confirmedText,setConfirmedText]=useState("");
  const [storedPreview,setPreview]=useState<PreviewMarket|null>(()=>readPreview());
  const [previewSaved,setPreviewSaved]=useState(true);
  const preview=storedPreview&&rollPreview(storedPreview);
  useEffect(()=>{if(!saved&&!preview&&live.shelf){const seeded=seedPreview(live.shelf);setPreview(seeded);setPreviewSaved(writePreview(seeded));}},[saved,preview,live.shelf]);
  const openRequest=saved&&!!session?.state.pending;
  const busy=action.kind==="pending"||!!session?.state.busy||openRequest;
  const rootRef=useRef<HTMLElement>(null),statusRef=useRef<HTMLParagraphElement>(null);
  function onPreview(next:PreviewMarket,text:string,unsavedText=text) {
    setPreview(next);const kept=writePreview(next);setPreviewSaved(kept);setAction({kind:"confirmed",value:null});setConfirmedText(kept?text:unsavedText);
    requestAnimationFrame(()=>{if(!rootRef.current?.contains(document.activeElement))statusRef.current?.focus();});
  }
  const onPreviewBlock=(words:string)=>setAction({kind:"refused",code:"PREVIEW",words});

  async function act<T>(intent:SeasonIntent,label:string,done:(value:T)=>string) {
    if(!session?.seasonAct||busy)return;
    setAction({kind:"pending",label});setConfirmedText("");
    let next:ActionState<T>;
    try{next=settle<T>(await session.seasonAct(intent));}catch(error){next=settleError(error);}
    if(next.kind==="confirmed")setConfirmedText(done(next.value));
    setAction(next);await refresh();
    // A control that pressed this may be gone now (the ledger offer, a taken-back wish); keep focus in the panel.
    requestAnimationFrame(()=>{if(!rootRef.current?.contains(document.activeElement))statusRef.current?.focus();});
  }
  function keyTabs(event:KeyboardEvent<HTMLDivElement>) {
    const i=TABS.findIndex(([t])=>t===tab),step=event.key==="ArrowRight"?1:event.key==="ArrowLeft"?-1:0;
    if(!step)return;event.preventDefault();const n=(i+step+TABS.length)%TABS.length;setTab(TABS[n]![0]);tabRefs.current[n]?.focus();
  }

  const registered=saved&&live.account!==undefined&&live.account!==null;
  const needsLedger=saved&&live.account===null;
  const holdings=saved?live.account:preview?{shells:preview.shells,goods:preview.goods,traded:preview.traded}:null;

  return <section ref={rootRef} className="ss" aria-label="Bram’s shelf">
    <header className="ss-head">
      <img src={`${ART}shelf-till.webp`} alt="" width="72" height="72"/>
      <div>
        <h3>Bram’s shelf</h3>
        <p className="ss-mode" data-mode={saved?"saved":"preview"}>{saved?`Bram’s ledger for ${accountId}`:"Device preview. Prices follow Bram’s formula on this device; nothing here is recorded."}</p>
      </div>
    </header>
    {holdings&&<p className="ss-holdings"><img src={`${ART}purse.webp`} alt="" width="28" height="28"/><span><b>{holdings.shells}</b> Shells</span><span><b>{holdings.goods[0]}</b> glass</span><span><b>{holdings.goods[1]}</b> reed</span>{!saved&&<small>Sample haul of {haulLine(PREVIEW_SAMPLE)} for the preview</small>}</p>}
    {live.error&&<p className="ss-problem" role="alert">{live.error} <button className="ss-link" onClick={()=>void refresh()}>Read again</button></p>}
    {needsLedger&&<div className="ss-ledger">
      <p>Bram keeps a ledger page for each harbor. Open yours before your first trade, tide or wish.</p>
      <div className="ss-act"><Press className="exp-primary" off={busy} onPress={()=>void act<unknown>({kind:"register"},"Bram is writing your page…",()=>"Your ledger page is open. Recorded.")}>Open my ledger page</Press><span className="ss-info">Holds {STORAGE_NEAR} test NEAR as its storage deposit</span></div>
    </div>}
    <section className="ss-returns ss-haul" aria-label="Today’s haul">
      <h4>Today’s haul</h4>
      <TodayHaul live={live} saved={saved} registered={registered} busy={busy} preview={preview} scope={tideScope} onOpenTide={onOpenTide} onPreview={onPreview} onPreviewBlock={onPreviewBlock} act={act}/>
    </section>
    <div className="ss-tabs" role="tablist" aria-label="Bram’s shelf" onKeyDown={keyTabs}>
      {TABS.map(([id,label],i)=><button key={id} ref={el=>{tabRefs.current[i]=el;}} role="tab" id={`ss-tab-${id}`} aria-controls={`ss-panel-${id}`} aria-selected={tab===id} tabIndex={tab===id?0:-1} onClick={()=>setTab(id)}>{label}</button>)}
    </div>
    {openRequest&&action.kind!=="pending"&&<p className="ss-problem" role="status">{OPEN_REQUEST}</p>}
    <Status ref={statusRef} state={action} confirmed={confirmedText} previewSaved={saved||previewSaved}/>
    <div role="tabpanel" id={`ss-panel-${tab}`} aria-labelledby={`ss-tab-${tab}`} className="ss-panel" aria-busy={loading}>
      {tab==="shelf"&&<Shelf live={live} saved={saved} registered={registered} busy={busy} preview={preview}
        onPreview={onPreview} onPreviewBlock={onPreviewBlock}
        onResetPreview={()=>{const seeded={...seedPreview(live.shelf),docked:preview?.docked};setPreview(seeded);setPreviewSaved(writePreview(seeded));setAction({kind:"idle"});}}
        act={act}/>}
      {tab==="wish"&&<WishTab live={live} saved={saved} registered={registered} hasPet={!!pet} busy={busy} act={act}/>}
    </div>
  </section>;
}

type Act=<T>(intent:SeasonIntent,label:string,done:(value:T)=>string)=>Promise<void>;
const tradeText=(t:Trade)=>`${t.side==="buy"?"Bought":"Sold"} ${t.qty} ${goodName(t.good,t.qty)} for ${t.unit_prices.join(" + ")}${t.qty>1?` = ${t.total}`:""} Shells. Recorded.${t.fills.length?` Bram’s trade also filled ${t.fills.length} waiting wish${t.fills.length>1?"es":""}.`:""}`;

function Stepper({value,min,max,onChange,label}:{value:number;min:number;max:number;onChange:(n:number)=>void;label:string}) {
  return <div className="ss-stepper" role="group" aria-label={label}>
    <Press label={`Fewer: ${label}`} off={value<=min} onPress={()=>onChange(value-1)}>−</Press>
    <output aria-live="polite">{value}</output>
    <Press label={`More: ${label}`} off={value>=max} onPress={()=>onChange(value+1)}>+</Press>
  </div>;
}

function Shelf({live,saved,registered,busy,preview,onPreview,onPreviewBlock,onResetPreview,act}:{live:Live;saved:boolean;registered:boolean;busy:boolean;preview:PreviewMarket|null;
  onPreview:(m:PreviewMarket,text:string,unsavedText?:string)=>void;onPreviewBlock:(words:string)=>void;onResetPreview:()=>void;act:Act}) {
  const [qty,setQty]=useState<Record<Good,number>>({glass:1,reed:1});
  const till=saved?live.shelf?.till:preview?.till;
  if(!live.shelf&&!preview)return <p>Reading Bram’s shelf…</p>;
  return <>
    <p className="ss-till"><b>Till</b> {till??"…"} Shells{live.shelf?` · tops up by ${live.shelf.till_refill} each morning to ${live.shelf.till_cap}`:""}</p>
    {GOODS.map(good=>{
      const i=GOOD_INDEX[good];
      const view=saved?live.shelf?.goods.find(g=>g.good===good):preview?previewView(preview,good):undefined;
      if(!view)return null;
      const n=qty[good],shelfState={stock:view.stock,heat_fp:view.heat_fp};
      const buy=quoteBuy(good,shelfState,n),sell=quoteSell(good,shelfState,n);
      const ctx=saved?{shells:live.account?.shells??0,held:live.account?.goods[i]??0,till:live.shelf?.till??0,tradedToday:live.today?.traded_today?.[i]??0}
        :{shells:preview!.shells,held:preview!.goods[i]!,till:preview!.till,tradedToday:preview!.traded[i]!};
      const buyBlock=tradeBlock(buy,ctx),sellBlock=tradeBlock(sell,ctx),locked=busy||(saved&&!registered);
      function trade(side:"buy"|"sell") {
        const quote=side==="buy"?buy:sell;if(!quote)return;
        if(!saved){const r=previewTrade(preview!,side,good,n);if("block"in r)onPreviewBlock(r.block);else onPreview(r.market,`Preview: ${side==="buy"?"bought":"sold"} ${n} ${goodName(good,n)} for ${quoteLine(r.quote)}. Not recorded.`);return;}
        const args=tradeArgs(quote);
        void act<Trade>(side==="buy"?{kind:"buy",good,qty:n,maxPrice:(args as {max_price:number}).max_price}:{kind:"sell",good,qty:n,minPrice:(args as {min_price:number}).min_price},
          side==="buy"?"Bram is wrapping your goods…":"Bram is counting out Shells…",tradeText);
      }
      return <article key={good} className="ss-good">
        <img src={`${ART}${good}.webp`} alt="" width="56" height="56"/>
        <div className="ss-good-body">
          <h4>{good==="glass"?"Sea glass":"Reed bundles"} <span>{view.stock} on the shelf</span></h4>
          <dl className="ss-prices"><div><dt>Bram sells at</dt><dd>{view.buy_price}</dd></div><div><dt>Bram pays</dt><dd>{view.sell_price}</dd></div></dl>
          <p className="ss-reason">{reasonLine({...view,buy_price:view.buy_price},till??0)}</p>
          <div className="ss-trade">
            <Stepper value={n} min={1} max={20} label={`${goodName(good,2)} to trade`} onChange={v=>setQty(q=>({...q,[good]:v}))}/>
            <div className="ss-act"><Press off={locked||!!buyBlock} describedBy={`ss-buy-${good}`} onPress={()=>trade("buy")}>Buy {n}</Press><span className="ss-info" id={`ss-buy-${good}`}>{buyBlock??`costs ${buy?quoteLine(buy):"…"}`}</span></div>
            <div className="ss-act"><Press off={locked||!!sellBlock} describedBy={`ss-sell-${good}`} onPress={()=>trade("sell")}>Sell {n}</Press><span className="ss-info" id={`ss-sell-${good}`}>{sellBlock??`pays ${quoteLine(sell)}`}</span></div>
          </div>
        </div>
      </article>;
    })}
    <p className="ss-note">{saved?"Each trade is priced unit by unit and refused if any unit moves past the quote shown.":"Prices here use the same formula as Bram’s ledger, starting from the shelf as last read."}</p>
    {!saved&&<button className="ss-link" onClick={onResetPreview}>Start the preview again</button>}
  </>;
}

export function TodayHaul({live,saved,registered,busy,preview,scope,onOpenTide,onPreview,onPreviewBlock,act}:{live:Live;saved:boolean;registered:boolean;busy:boolean;preview:PreviewMarket|null;scope:string;onOpenTide:()=>void;
  onPreview:(m:PreviewMarket,text:string,unsavedText?:string)=>void;onPreviewBlock:(words:string)=>void;act:Act}) {
  const today=live.today;
  if(!today)return <p>Reading Bram’s ledger…</p>;
  const minted=saved?today.minted_today:null;
  if(minted)return <p className="ss-docked" data-docked="true">Bram shelved {haulLine(minted.goods)} today: {scoreLine(minted)}.</p>;
  if(today.content_version!=="first_light_v2")return <p className="ss-note">Bram shelves Beacon Court hauls every other day, and today isn’t one. Keep today’s find; he can shelve it tomorrow.</p>;
  if(!saved&&preview?.docked===deviceDay())return <p className="ss-docked" data-docked="true">Today’s haul is on Bram’s shelf. He takes one a day; bring another find tomorrow.</p>;
  const returns=scope==="preview"?readTide(scope):[...readTide(scope),...readTide("preview")];
  const candidates=returns.map(r=>({r,c:claimable(today,{tool:r.tool,commands:r.commands,contentVersion:r.contentVersion})})).filter(x=>x.c);
  const value=(goods:[number,number])=>GOODS.reduce((n,g,i)=>n+goods[i]!*(live.shelf?.goods.find(s=>s.good===g)?.price_fp??0),0);
  candidates.sort((a,b)=>value(b.c!.goods)-value(a.c!.goods));
  if(!candidates.length)return <><p>Bring a find home from today’s tide and Bram will shelve it.</p><button className="ss-link" onClick={onOpenTide}>See today’s ask</button></>;
  return <>
    {candidates.map(({r,c})=><div key={r.id} className="ss-act">
      <Press off={busy||(saved?!registered:!preview)} onPress={()=>{
        if(!saved){const result=previewDock(preview!,c!.goods);if("block"in result)onPreviewBlock(result.block);else onPreview(result.market,`Shelved on this device: ${haulLine(c!.goods)}. Not recorded.`,`Shelved for this visit: ${haulLine(c!.goods)}. Not recorded.`);return;}
        void act<Mint>({kind:"claim",contentVersion:r.contentVersion,tool:r.tool,commands:r.commands},"The harbor is replaying Mochi’s steps…",m=>`Shelved ${haulLine(m.goods)}: ${scoreLine(m)}. Recorded.`);
      }}>Shelve {haulLine(c!.goods)}</Press>
      <span className="ss-info">{r.tool==="rope"?"Rope":"Lantern"} · {dayLabel(deviceDay(Date.parse(r.savedAt)))}</span>
    </div>)}
  </>;
}

function WishTab({live,saved,registered,hasPet,busy,act}:{live:Live;saved:boolean;registered:boolean;hasPet:boolean;busy:boolean;act:Act}) {
  const [good,setGood]=useState<Good>("glass"),[qty,setQty]=useState(1),[limit,setLimit]=useState(8);
  const status=wishStatus(live.wish,live.postcard);
  const shells=live.account?.shells??0,maxLimit=Math.floor(PURSE_MAX/qty),block=wishBlock(limit,qty,shells);
  const card=status.kind==="filled"||status.kind==="cancelled"?status.card:live.postcard;
  return <>
    <header className="ss-wish-head"><img src={`${ART}wish-token.webp`} alt="" width="56" height="56"/>
      <p>{status.kind==="waiting"?<>Mochi is waiting for <b>{status.wish.qty} {goodName(status.wish.good,status.wish.qty)}</b> at up to <b>{status.wish.limit}</b> Shells each. Her purse holds {status.wish.purse} Shells.</>
        :status.kind==="filled"?"Mochi’s last wish was filled. Her postcard is below.":status.kind==="cancelled"?"Mochi’s last wish was taken back. Her postcard is below.":"Mochi has no wish waiting. She can hold up to 24 Shells in her purse for one."}</p>
    </header>
    {!saved?<p className="ss-note">Mochi’s wish lives in your saved harbor. Sign in from the menu to set one.</p>:!hasPet?<p className="ss-note">Bring Mochi home in your saved harbor before setting a wish.</p>:<>
      {status.kind==="waiting"&&<div className="ss-act"><Press off={busy} onPress={()=>void act<Postcard>({kind:"cancel-wish"},"Taking the wish back…",c=>`Wish taken back; ${c.refunded} Shells returned. Recorded.`)}>Take the wish back</Press><span className="ss-info">Returns {status.wish.purse} Shells</span></div>}
      <fieldset className="ss-wish-form" disabled={!registered}>
        <legend>{status.kind==="waiting"?"Replace the wish":"Set a wish"}</legend>
        <span className="ss-field">Good</span><div className="ss-choice" role="radiogroup" aria-label="Good">{GOODS.map(g=><label key={g}><input type="radio" name="ss-wish-good" checked={good===g} onChange={()=>setGood(g)}/><img src={`${ART}${g}.webp`} alt="" width="32" height="32"/><span>{g==="glass"?"Glass":"Reed"}</span></label>)}</div>
        <span className="ss-field">How many</span><div className="ss-choice" role="radiogroup" aria-label="How many">{Array.from({length:WISH_QTY_MAX},(_,i)=>i+1).map(q=><label key={q}><input type="radio" name="ss-wish-qty" checked={qty===q} onChange={()=>{setQty(q);setLimit(l=>Math.min(l,Math.floor(PURSE_MAX/q)));}}/><span>{q}</span></label>)}</div>
        <div className="ss-limit"><span id="ss-limit-label">Highest price per unit</span><Stepper value={limit} min={1} max={maxLimit} onChange={setLimit} label="Highest price per unit"/></div>
        <div className="ss-act"><Press className="exp-primary" off={!!block||busy} onPress={()=>void act<WishResult>({kind:"set-wish",good,limit,qty},"Bram is checking Mochi’s papers…",
          r=>r.status==="filled"?`Filled at once: ${r.postcard?postcardLines(r.postcard)[1]:""} Recorded.`:r.status==="waiting"?`Mochi’s wish is waiting. Her purse holds ${r.wish?.purse??limit*qty} Shells. Recorded.`:"Recorded.")}>Set Mochi’s wish</Press>
          <span className="ss-info">{block??`Purse ${limit*qty} of ${PURSE_MAX} Shells${status.kind==="waiting"?"; the old purse comes back once the new wish is placed":""}`}</span></div>
        {live.shelf&&<p className="ss-note">Bram sells {goodName(good,2)} at {live.shelf.goods.find(g=>g.good===good)?.buy_price} now. A wish whose limit covers every unit fills at once; otherwise a later trade that brings the price within it does.</p>}
      </fieldset>
    </>}
    {card&&<article className="ss-postcard" aria-label="Mochi’s postcard"><img src={`${ART}purse.webp`} alt="" width="40" height="40"/><div>{postcardLines(card).map(line=><p key={line}>{line}</p>)}</div></article>}
  </>;
}
