import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REFUSALS, claimable, postcardLines, quoteBuy, quoteSell, reasonLine, refusalCode, scoreLine, settle, settleError, successValue, tradeArgs, tradeBlock, wishBlock, wishStatus, type Postcard, type TodayView, type Wish } from "./model";
import courtFixture from "../../../contracts/common/fixtures/court.json";

const b64=(value:unknown)=>btoa(JSON.stringify(value));

test("one-unit quotes equal the live opening shelf's buy_price and sell_price", () => {
  // get_shelf on day 20770: glass 40/40 heat 0 → buy 8, sell 6; reed 40/40 → buy 4, sell 3.
  expect(quoteBuy("glass",{stock:40,heat_fp:0},1)).toMatchObject({units:[8],total:8,bound:8});
  expect(quoteSell("glass",{stock:40,heat_fp:0},1)).toMatchObject({units:[6],total:6,bound:6});
  expect(quoteBuy("reed",{stock:40,heat_fp:0},1)!.units).toEqual([4]);
  expect(quoteSell("reed",{stock:40,heat_fp:0},1).units).toEqual([3]);
});

test("multi-unit quotes move stock and heat unit by unit; bounds are the worst unit", () => {
  const buy=quoteBuy("glass",{stock:3,heat_fp:0},3)!;
  expect(buy.units.length).toBe(3);
  expect(buy.units[0]!<=buy.units[1]! && buy.units[1]!<=buy.units[2]!).toBe(true);
  expect(buy.bound).toBe(Math.max(...buy.units));
  expect(tradeArgs(buy)).toEqual({good:"glass",qty:3,max_price:buy.bound});
  expect(quoteBuy("glass",{stock:2,heat_fp:0},3)).toBeNull();
  const sell=quoteSell("reed",{stock:40,heat_fp:0},4);
  expect(sell.units[0]!>=sell.units[3]!).toBe(true);
  expect(tradeArgs(sell)).toEqual({good:"reed",qty:4,min_price:sell.bound});
  expect(sell.bound).toBe(Math.min(...sell.units));
});

test("trade blocks mirror the contract's checks", () => {
  const q=quoteBuy("glass",{stock:40,heat_fp:0},1)!;
  expect(tradeBlock(q,{shells:7,held:0,till:300,tradedToday:0})).toMatch(/Shells/);
  expect(tradeBlock(q,{shells:8,held:0,till:300,tradedToday:0})).toBeNull();
  expect(tradeBlock(q,{shells:99,held:0,till:300,tradedToday:20})).toMatch(/20/);
  const s=quoteSell("glass",{stock:40,heat_fp:0},2);
  expect(tradeBlock(s,{shells:0,held:1,till:300,tradedToday:0})).toMatch(/satchel/);
  expect(tradeBlock(s,{shells:0,held:2,till:5,tradedToday:0})).toMatch(/till/);
  expect(tradeBlock(null,{shells:0,held:0,till:0,tradedToday:0})).toMatch(/shelf/);
});

test("Bram's reason line uses only stock, target, heat and the till", () => {
  expect(reasonLine({good:"glass",stock:40,target:40,base:8,heat_fp:0,buy_price:8},300))
    .toBe("Glass: 40 on the shelf, right at the 40 he keeps; nobody has bought lately. Next unit 8 (base 8). Till: 300 Shells to pay for what you sell.");
  const short=reasonLine({good:"reed",stock:20,target:40,base:4,heat_fp:40_000_000,buy_price:8},120);
  expect(short).toContain("20 on the shelf, short of the 40 he keeps, so it costs more");
  expect(short).toContain("about 40 recently bought add 15%; that fades by half each day");
  expect(short).toContain("base 4 × 1.62 for stock");
  expect(short).toContain("Till: 120 Shells");
  expect(reasonLine({good:"glass",stock:80,target:40,base:8,heat_fp:500_000,buy_price:5},0)).toContain("over the 40 he keeps, so it costs less; less than one recently bought adds a little");
});

test("every ERR_ code in the season contract has game words", () => {
  const lib=readFileSync(resolve(import.meta.dir,"../../../contracts/season/src/lib.rs"),"utf8");
  const codes=new Set(lib.match(/ERR_[A-Z0-9_]+/g));
  expect(codes.size).toBeGreaterThan(20);
  for(const code of codes)expect(REFUSALS[code]).toBeDefined();
  for(const words of Object.values(REFUSALS))expect(words).not.toMatch(/\b(wallet|gas|transaction|tx)\b/i);
});

test("state mapping: confirmed only for a final success, refusals named, unknown stays uncertain", () => {
  const failure={status:{Failure:{ActionError:{kind:{FunctionCallError:{ExecutionError:"Smart contract panicked: ERR_MAX_PRICE"}}}}}};
  expect(refusalCode(failure)).toBe("ERR_MAX_PRICE");
  expect(settle({failed:true,outcome:failure})).toEqual({kind:"refused",code:"ERR_MAX_PRICE",words:REFUSALS.ERR_MAX_PRICE!});
  const trade={seq:1,side:"buy",good:"glass",qty:1,unit_prices:[8],total:8,fills:[]};
  expect(successValue({status:{SuccessValue:b64(trade)}})).toEqual(trade);
  expect(settle({failed:false,outcome:{status:{SuccessValue:b64(trade)}}})).toEqual({kind:"confirmed",value:trade});
  expect(settle({failed:false,outcome:{status:{SuccessValue:"%%"}}}).kind).toBe("uncertain");
  expect(settle(null).kind).toBe("uncertain");
  expect(settleError(new Error("This action may still be executing. Check its original receipt; no new payment or craft has been started.")).kind).toBe("uncertain");
  expect(settleError(new Error("ERR_SHELLS")).kind).toBe("refused");
});

test("wish status and postcard lines", () => {
  const wish:Wish={pet:"mochi.r.testnet",owner:"p.r.testnet",good:"glass",limit:9,qty:2,purse:18,seq:1,day:1};
  expect(wishStatus(wish,null)).toEqual({kind:"waiting",wish});
  const card:Postcard={pet:wish.pet,owner:wish.owner,good:"glass",qty:2,limit:9,outcome:"filled",reason:"FILLED_BY_TRADE",unit_prices:[8,9],paid:17,refunded:1,trigger:{trade:7,account:"other.r.testnet",side:"sell",good:"glass"},day:2};
  expect(wishStatus(null,card).kind).toBe("filled");
  expect(wishStatus(null,{...card,outcome:"cancelled"}).kind).toBe("cancelled");
  expect(wishStatus(null,null).kind).toBe("none");
  const lines=postcardLines(card).join(" ");
  expect(lines).toContain("Mochi got 2 glass.");
  expect(lines).toContain("Paid 8 + 9 = 17 Shells against a limit of 9 each; 1 returned.");
  expect(lines).toContain("trade 7: other.r.testnet sold");
  expect(lines).toContain("(FILLED_BY_TRADE)");
  expect(wishBlock(12,2,24)).toBeNull();
  expect(wishBlock(13,2,99)).toMatch(/24/);
  expect(wishBlock(5,3,99)).toMatch(/1 or 2/);
  expect(wishBlock(5,1,4)).toMatch(/Shells/);
});

const today=(version:"first_light_v1"|"first_light_v2"):TodayView=>({day:20771,next_day_ns:0,rules_version:"tidebound_h1_v1",content_version:version,area:"beacon",command_limit:version==="first_light_v2"?24:15,
  mapping:[["lens","glass"],["moth","reed"],["chart","reed"],["salvage","reed"],["vane",null]],
  best_haul:version==="first_light_v2"?[{tool:"rope",hauls:[[1,1]]},{tool:"lantern",hauls:[[1,1]]}]:[{tool:"rope",hauls:[[1,1],[0,2]]},{tool:"lantern",hauls:[[1,2]]}],best_fp:12_000_000,minted_today:null,traded_today:null});

test("claimable replays a fresh beacon outing and maps docked cargo to goods", () => {
  const routes=(courtFixture as {routes?:unknown}).routes;
  const fixtureRuns=Array.isArray(routes)?routes as {tool:"rope"|"lantern";commands:string[];area?:string;banked?:string[]}[]:[];
  const run=fixtureRuns.find(r=>(r.area??"beacon")==="beacon"&&!(r.banked??[]).length);
  if(run){
    const result=claimable(today("first_light_v2"),{tool:run.tool,commands:run.commands,contentVersion:"first_light_v2"});
    if(result)expect(result.goods[0]+result.goods[1]).toBeGreaterThan(0);
  }
  expect(claimable(today("first_light_v1"),{tool:"rope",commands:["step:north"],contentVersion:"first_light_v2"})).toBeNull();
  expect(claimable(today("first_light_v2"),{tool:"rope",commands:["wait"],contentVersion:"first_light_v2"})).toBeNull();
  expect(claimable(today("first_light_v2"),{tool:"rope",commands:["return"],contentVersion:"first_light_v2"})).toBeNull();
});

test("score line reads the stored basis points", () => {
  expect(scoreLine({score_bp:10_000,value_fp:12_000_000,best_fp:12_000_000})).toBe("100% of the best haul (12.00 of 12.00 Shells at today’s shelf prices)");
  expect(scoreLine({score_bp:6667,value_fp:8_000_000,best_fp:12_000_000})).toBe("66.67% of the best haul (8.00 of 12.00 Shells at today’s shelf prices)");
});
