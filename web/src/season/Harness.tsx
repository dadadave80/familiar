/**
 * Development-only check of the signed-in Season 2 panel (`/outing/?season-harness`, dev server only).
 * get_shelf and get_today are read live; this harness account's ledger, wish and postcard are
 * mocked, and signing is mocked: nothing is signed or sent. The page says so on screen.
 */
import { useState } from "react";
import SeasonBram from "./SeasonBram";
import type { HarborSession, SeasonIntent } from "../expedition/harbor-port";
import type { Postcard, SeasonAccount, Trade, Wish } from "./model";
import "../expedition/game.css";

const account="harness.familiar-game.testnet",pet="mochi-harness.familiar-game.testnet";
let ledger:SeasonAccount|null=null,wish:Wish|null=null,postcard:Postcard|null=null;
const mocked:Record<string,()=>unknown>={get_account:()=>ledger,get_wish:()=>wish,get_postcard:()=>postcard};
const realFetch=globalThis.fetch.bind(globalThis);
globalThis.fetch=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  try{const body=JSON.parse(String(init?.body??"{}")),method=body?.params?.method_name as string;
    if(method in mocked){const bytes=[...new TextEncoder().encode(JSON.stringify(mocked[method]!()))];return new Response(JSON.stringify({result:{result:bytes}}));}}catch{/* not a season view */}
  return realFetch(input,init);
}) as typeof fetch;
const ok=(value:unknown)=>({failed:false,outcome:{status:{SuccessValue:btoa(JSON.stringify(value))}}});
async function seasonAct(intent:SeasonIntent) {
  await new Promise(r=>setTimeout(r,900));
  switch(intent.kind){
    case "register":ledger={shells:30,goods:[1,1],trade_day:0,traded:[0,0],last_mint:null};return ok({total:"12500000000000000000000",available:"0"});
    case "buy":return {failed:true,outcome:{status:{Failure:{ActionError:{kind:{FunctionCallError:{ExecutionError:"Smart contract panicked: ERR_MAX_PRICE"}}}}}}};
    case "sell":{const trade:Trade={seq:1,side:"sell",good:intent.good,qty:intent.qty,unit_prices:Array(intent.qty).fill(intent.minPrice),total:intent.minPrice*intent.qty,fills:[]};
      if(ledger){ledger.goods[intent.good==="glass"?0:1]-=intent.qty;ledger.shells+=trade.total;}return ok(trade);}
    case "set-wish":wish={pet,owner:account,good:intent.good,limit:intent.limit,qty:intent.qty,purse:intent.limit*intent.qty,seq:1,day:0};if(ledger)ledger.shells-=wish.purse;return ok({status:"waiting",reason:"WAITING",wish,postcard:null});
    case "cancel-wish":{if(!wish)return null;postcard={pet,owner:account,good:wish.good,qty:wish.qty,limit:wish.limit,outcome:"cancelled",reason:"CANCELLED_BY_OWNER",unit_prices:[],paid:0,refunded:wish.purse,trigger:null,day:0};if(ledger)ledger.shells+=wish.purse;wish=null;return ok(postcard);}
    case "claim":return ok({day:0,content_version:intent.contentVersion,tool:intent.tool,goods:[1,1],value_fp:12_000_000,best_fp:12_000_000,score_bp:10_000});
  }
}
const session={state:{mode:"saved",busy:false,snapshot:{binding:{nearAccountId:account},pets:[{token_id:pet}]}},seasonAct} as unknown as HarborSession;

export default function SeasonHarness() {
  const [sailed,setSailed]=useState("");
  return <main className="exp-game" style={{position:"fixed",inset:0,overflow:"auto",background:"#3d5a4c"}}>
    <div className="exp-panel exp-panel-season" style={{margin:"16px auto"}}>
      <p role="note" style={{background:"#7a3020",color:"#fff5dc",padding:"8px 10px",borderRadius:8,fontSize:13}}>Development harness. Shelf and today’s tide are read live; this account’s ledger, wish and signing are mocked. Nothing is signed or sent.</p>
      <h2>“You’re back.”</h2>
      <SeasonBram session={session} tool="rope" canSail onSailTide={t=>setSailed(`Would sail with the ${t}.`)} tideScope="harness"/>
      {sailed&&<p role="status">{sailed}</p>}
    </div>
  </main>;
}
