/**
 * Season 2 view models: quotes, Bram's reason line, refusal words and state mapping.
 * Pure functions only. Every number shown comes from a contract view or from `pricing.ts`.
 */
import { BASE, S, TARGET, buyShells, pow07, priceFp, sellShells, type Good } from "./pricing";
import { replayCourt } from "../expedition/engine";
import { replayOuting } from "../compatibility/return-rules";

export const SEASON_RULES_VERSION = "tidebound_h1_v1";
export const DAILY_UNITS = 20;
export const PURSE_MAX = 24;
export const WISH_QTY_MAX = 2;

export interface GoodView { good:Good;stock:number;target:number;base:number;heat_fp:number;price_fp:number;buyback_fp:number;buy_price:number;sell_price:number;waiting_wishes:number }
export interface ShelfView { day:number;till:number;till_cap:number;till_refill:number;commission:number;goods:GoodView[];shells_minted:number;goods_minted:[number,number];trade_seq:number }
export interface Mint { day:number;content_version:string;tool:string;goods:[number,number];value_fp:number;best_fp:number;score_bp:number }
export interface TodayView {
  day:number;next_day_ns:number;rules_version:string;content_version:"first_light_v1"|"first_light_v2";area:string;command_limit:number;
  mapping:[string,string|null][];best_haul:{tool:string;hauls:[number,number][]}[];best_fp:number;minted_today:Mint|null;traded_today:[number,number]|null;
}
export interface SeasonAccount { shells:number;goods:[number,number];trade_day:number;traded:[number,number];last_mint:Mint|null }
export interface Wish { pet:string;owner:string;good:Good;limit:number;qty:number;purse:number;seq:number;day:number }
export interface Trigger { trade:number;account:string;side:"buy"|"sell";good:Good }
export interface Postcard { pet:string;owner:string;good:Good;qty:number;limit:number;outcome:"filled"|"cancelled"|"replaced";reason:string;unit_prices:number[];paid:number;refunded:number;trigger:Trigger|null;day:number }
export interface Trade { seq:number;side:"buy"|"sell";good:Good;qty:number;unit_prices:number[];total:number;fills:Postcard[] }
export interface WishResult { status:"filled"|"waiting"|"refused";reason:string;wish:Wish|null;postcard:Postcard|null }

export const GOOD_INDEX:Record<Good,0|1> = { glass:0, reed:1 };
export const goodName = (good:Good, qty=1) => good==="glass" ? "glass" : qty===1 ? "reed bundle" : "reed bundles";
export const courtName = (version:string) => version==="first_light_v2" ? "Beacon Court" : "the old First Light route";

// ---------- quotes ----------

export interface Quote { side:"buy"|"sell";good:Good;qty:number;units:number[];total:number;bound:number }
export interface ShelfState { stock:number;heat_fp:number }

/** Unit-by-unit, exactly as the contract's `quote_buy`: each unit moves stock and heat before the next. */
export function quoteBuy(good:Good, shelf:ShelfState, qty:number):Quote|null {
  let stock=BigInt(shelf.stock), heat=BigInt(shelf.heat_fp);
  const units:number[]=[];
  for(let i=0;i<qty;i++) {
    if(stock===0n)return null;
    units.push(Number(buyShells(priceFp(BASE[good],TARGET[good],stock,heat))));
    stock-=1n;heat+=S;
  }
  return { side:"buy", good, qty, units, total:units.reduce((a,b)=>a+b,0), bound:Math.max(...units) };
}
/** As `quote_sell`: Bram pays at the post-unit stock, so each unit pays a little less. */
export function quoteSell(good:Good, shelf:ShelfState, qty:number):Quote {
  let stock=BigInt(shelf.stock);const heat=BigInt(shelf.heat_fp),units:number[]=[];
  for(let i=0;i<qty;i++){stock+=1n;units.push(Number(sellShells(priceFp(BASE[good],TARGET[good],stock,heat))));}
  return { side:"sell", good, qty, units, total:units.reduce((a,b)=>a+b,0), bound:Math.min(...units) };
}
/** The bound is the shown quote's worst unit, so any later price movement refuses instead of surprising. */
export function tradeArgs(quote:Quote) {
  return quote.side==="buy" ? { good:quote.good, qty:quote.qty, max_price:quote.bound } : { good:quote.good, qty:quote.qty, min_price:quote.bound };
}
export const quoteLine = (quote:Quote) =>
  quote.qty===1 ? `${quote.total} Shell${quote.total===1?"":"s"}` : `${quote.units.join(" + ")} = ${quote.total} Shells`;

/** Why a trade cannot be offered right now, from the same inputs the contract checks. Null means it can be tried. */
export function tradeBlock(quote:Quote|null, ctx:{shells:number;held:number;till:number;tradedToday:number}):string|null {
  if(!quote)return "Bram’s shelf does not have that many.";
  if(ctx.tradedToday+quote.qty>DAILY_UNITS)return `Bram trades ${DAILY_UNITS} of each good with you a day.`;
  if(quote.side==="buy"&&ctx.shells<quote.total)return "Not enough Shells for that.";
  if(quote.side==="sell"&&ctx.held<quote.qty)return "Not enough in your satchel.";
  if(quote.side==="sell"&&ctx.till<quote.total)return "Bram’s till cannot pay that much today.";
  return null;
}

// ---------- Bram's reason line ----------

/**
 * Built only from the pricing inputs: stock against target, recent buying (heat) and the till.
 * The till never moves a price; it only limits what Bram can pay out.
 */
export function reasonLine(view:Pick<GoodView,"good"|"stock"|"target"|"base"|"heat_fp"|"buy_price">, till:number):string {
  const name=view.good==="glass"?"Glass":"Reed";
  const stockPart = view.stock===view.target
    ? `${view.stock} on the shelf, right at the ${view.target} he keeps`
    : view.stock<view.target
      ? `${view.stock} on the shelf, short of the ${view.target} he keeps, so it costs more`
      : `${view.stock} on the shelf, over the ${view.target} he keeps, so it costs less`;
  const ratio=BigInt(view.target)*S/BigInt(Math.max(view.stock,1));
  const factor=Number(pow07(ratio))/1e6;
  const heatPct=Math.floor(view.heat_fp*15/(view.target*1e6));
  const recent=view.heat_fp/1e6;
  const heatPart = view.heat_fp===0
    ? "nobody has bought lately"
    : `${recent<1?"less than one":`about ${Math.round(recent)}`} recently bought add${heatPct>0?` ${heatPct}%`:"s a little"}; that fades by half each day`;
  const shapePart = view.stock===view.target ? `base ${view.base}` : `base ${view.base} × ${factor.toFixed(2)} for stock`;
  return `${name}: ${stockPart}; ${heatPart}. Next unit ${view.buy_price} (${shapePart}). Till: ${till} Shells to pay for what you sell.`;
}

// ---------- refusals and outcomes ----------

/** Every refusal code the season contract can return, in game words. */
export const REFUSALS:Record<string,string> = {
  ERR_MAX_PRICE:"The price moved above the quote you saw. Nothing changed; look again.",
  ERR_MIN_PRICE:"Bram’s offer fell below the quote you saw. Nothing changed; look again.",
  ERR_SHELLS:"Not enough Shells for that.",
  ERR_GOODS:"Not enough in your satchel.",
  ERR_TILL_EMPTY:"Bram’s till cannot pay that much today. It refills each morning.",
  ERR_SHELF_EMPTY:"Bram’s shelf has run out of that.",
  ERR_DAILY_LIMIT:`Bram trades ${DAILY_UNITS} of each good with you a day.`,
  ERR_TRADE_QTY:`Trade between 1 and ${DAILY_UNITS} at a time.`,
  ERR_GOOD:"Bram does not keep that.",
  ERR_NOT_REGISTERED:"Open your page in Bram’s ledger first.",
  ERR_STORAGE_DEPOSIT:"The ledger page needs its full storage deposit.",
  ERR_STORAGE:"Your ledger page has no room for another of Mochi’s records.",
  ERR_ALREADY_MINTED:"You have already docked today’s tide. Come back tomorrow.",
  ERR_WRONG_COURT:"That return is from a different day’s tide.",
  ERR_RULES_VERSION:"That return follows different rules.",
  ERR_COMMAND_BOUND:"That return has too many moves for today’s tide.",
  ERR_REPLAY_CONTEXT:"Today’s tide is a fresh Beacon Court outing.",
  ERR_REPLAY:"The harbor could not replay those steps.",
  ERR_RETURN_REQUIRED:"Mochi has to reach the dock for the haul to count.",
  ERR_NO_GOODS:"Nothing in that haul becomes a good, so the day is still yours.",
  ERR_HAUL_BOUND:"That haul is larger than today’s tide allows.",
  ERR_PET_ID:"That is not Mochi’s name.",
  ERR_WISH_QTY:`Mochi can wish for 1 or ${WISH_QTY_MAX}.`,
  ERR_PURSE_LIMIT:`Mochi’s purse holds at most ${PURSE_MAX} Shells.`,
  ERR_GAS:"The wish needed more room to check Mochi’s papers. Nothing was taken.",
  ERR_NOT_OWNER:"Only Mochi’s keeper can set her wish.",
  ERR_OWNER_LOOKUP:"Mochi’s papers could not be checked. Nothing was taken.",
  ERR_WISH_QUEUE_FULL:"Too many wishes are waiting for that good. Try the other one.",
  ERR_NO_WISH:"Mochi has no wish waiting.",
  ERR_NOT_WISH_OWNER:"Only the keeper who set this wish can cancel it.",
  ERR_TESTNET_ONLY:"This harbor only runs on the test network.",
  ERR_ONE_YOCTO:"That request needs exactly one unit attached.",
  ERR_NOTHING_TO_WITHDRAW:"Nothing to take back.",
};
export const refusalWords = (code:string) => REFUSALS[code] ?? "Bram could not do that. Nothing changed.";

export function refusalCode(outcome:unknown):string|null {
  const text=JSON.stringify(outcome??"");
  return text.match(/ERR_[A-Z0-9_]+/)?.[0] ?? null;
}
/** The final return value of a successful transaction (the outer status), parsed as JSON. */
export function successValue<T>(outcome:unknown):T|null {
  const status=(outcome as {status?:{SuccessValue?:unknown}}|null)?.status;
  if(typeof status?.SuccessValue!=="string")return null;
  try{return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(status.SuccessValue),c=>c.charCodeAt(0)))) as T;}catch{return null;}
}

export type ActionState<T> =
  | {kind:"idle"}
  | {kind:"pending";label:string}
  | {kind:"confirmed";value:T}
  | {kind:"refused";code:string;words:string}
  | {kind:"uncertain";words:string};

/** Maps a reconciled final outcome to a state. Only a final, non-failed receipt is "confirmed". */
export function settle<T>(final:{failed:boolean;outcome:unknown}|null):ActionState<T> {
  if(!final)return {kind:"uncertain",words:"The harbor has not seen the result yet. Check again before trying anything new."};
  if(final.failed){const code=refusalCode(final.outcome)??"ERR_UNKNOWN";return {kind:"refused",code,words:refusalWords(code)};}
  const value=successValue<T>(final.outcome);
  if(value===null)return {kind:"uncertain",words:"The result arrived but could not be read. Your ledger is read again below."};
  // A refused wish is a successful receipt whose value says so (the owner check runs in a callback that never panics).
  const refused=value as {status?:unknown;reason?:unknown};
  if(refused&&typeof refused==="object"&&refused.status==="refused"&&typeof refused.reason==="string")return {kind:"refused",code:refused.reason,words:refusalWords(refused.reason)};
  return {kind:"confirmed",value};
}
/** A thrown send is never a refusal: the action may still land. */
export function settleError(error:unknown):ActionState<never> {
  const message=error instanceof Error?error.message:"";
  const code=message.match(/ERR_[A-Z0-9_]+/)?.[0];
  if(code&&REFUSALS[code])return {kind:"refused",code,words:refusalWords(code)};
  return {kind:"uncertain",words:message||"The result is not known yet. Check the original request before trying again."};
}

// ---------- Mochi's wish ----------

export type WishStatus =
  | {kind:"none"}
  | {kind:"waiting";wish:Wish}
  | {kind:"filled";card:Postcard}
  | {kind:"cancelled";card:Postcard};

export function wishStatus(wish:Wish|null, card:Postcard|null):WishStatus {
  if(wish)return {kind:"waiting",wish};
  if(card?.outcome==="filled")return {kind:"filled",card};
  if(card)return {kind:"cancelled",card};
  return {kind:"none"};
}
export const POSTCARD_REASONS:Record<string,string> = {
  FILLED_ON_SET:"Bram’s price was already within the limit when the wish was set.",
  FILLED_BY_TRADE:"A trade at Bram’s shelf brought the price within the limit.",
  CANCELLED_BY_OWNER:"The wish was taken back and the purse returned.",
  REPLACED_BY_OWNER:"A new wish replaced it and the purse was returned.",
};
export function postcardLines(card:Postcard):string[] {
  const what=`${card.qty} ${goodName(card.good,card.qty)}`;
  const lines=[card.outcome==="filled"?`Mochi got ${what}.`:`Mochi’s wish for ${what} was ${card.outcome==="cancelled"?"cancelled":"replaced"}.`];
  if(card.outcome==="filled")lines.push(`Paid ${card.unit_prices.join(" + ")} = ${card.paid} Shells against a limit of ${card.limit} each; ${card.refunded} returned.`);
  else lines.push(`${card.refunded} Shells returned from the purse.`);
  if(card.trigger)lines.push(`It happened on trade ${card.trigger.trade}: ${card.trigger.account} ${card.trigger.side==="buy"?"bought":"sold"} ${goodName(card.trigger.good,2)}.`);
  lines.push(`${POSTCARD_REASONS[card.reason]??"Reason recorded by the harbor."} (${card.reason})`);
  return lines;
}
export function wishBlock(limit:number, qty:number, shells:number):string|null {
  if(!Number.isInteger(limit)||limit<1)return "Choose a limit of at least 1 Shell.";
  if(!Number.isInteger(qty)||qty<1||qty>WISH_QTY_MAX)return `Mochi can wish for 1 or ${WISH_QTY_MAX}.`;
  if(limit*qty>PURSE_MAX)return `Mochi’s purse holds at most ${PURSE_MAX} Shells.`;
  if(shells<limit*qty)return "Not enough Shells to fill the purse.";
  return null;
}

// ---------- today's tide ----------

export interface ReplayCandidate { tool:"rope"|"lantern";commands:readonly string[];contentVersion:string }
export interface Claimable { goods:[number,number];cargo:string[] }
/** Replays as the contract does (fresh beacon outing, nothing banked) and maps docked cargo to goods. */
export function claimable(today:Pick<TodayView,"content_version"|"command_limit"|"mapping"|"best_haul">, run:ReplayCandidate):Claimable|null {
  if(run.contentVersion!==today.content_version||run.commands.length>today.command_limit)return null;
  const replay=today.content_version==="first_light_v2"
    ? replayCourt({area:"beacon",tool:run.tool,banked:[]},run.commands)
    : replayOuting(run.tool,[],run.commands,"beacon");
  if(!replay||replay.outcome!=="returned")return null;
  const goods:[number,number]=[0,0];
  for(const item of replay.cargo){const g=today.mapping.find(([name])=>name===item)?.[1];if(g==="glass")goods[0]++;if(g==="reed")goods[1]++;}
  if(goods[0]+goods[1]===0)return null;
  const hauls=today.best_haul.find(h=>h.tool===run.tool)?.hauls??[];
  if(!hauls.some(([g,r])=>goods[0]<=g&&goods[1]<=r))return null;
  return {goods,cargo:[...replay.cargo]};
}
export const haulLine = (goods:readonly [number,number]) =>
  [goods[0]?`${goods[0]} glass`:"",goods[1]?`${goods[1]} ${goodName("reed",goods[1])}`:""].filter(Boolean).join(" and ")||"nothing";
export const scoreLine = (mint:Pick<Mint,"score_bp"|"value_fp"|"best_fp">) =>
  `${(mint.score_bp/100).toFixed(mint.score_bp%100?2:0)}% of the best haul (${(mint.value_fp/1e6).toFixed(2)} of ${(mint.best_fp/1e6).toFixed(2)} Shells at today’s shelf prices)`;
export function bestHaulLine(today:Pick<TodayView,"best_haul">):string {
  return today.best_haul.map(t=>`${t.tool}: ${t.hauls.map(h=>haulLine(h)).join(" or ")}`).join(" · ");
}
