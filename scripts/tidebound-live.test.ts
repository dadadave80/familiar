import {expect,test} from "bun:test";
import {assertAllocation,assertCanonicalCraft,assertNoInheritedAchievement,assertPlacement,expectedMint,parseLiveArguments,verifyFinalOutcome,QA_ROOT} from "./tidebound-live";

const maker=`qa-maker-h1.${QA_ROOT}`;
const blank=()=>({revision:0,banked:[],lit:false,signaled:false,lens_claim:null,moth_claim:null,credit:"unclaimed",workshop_salvage:0,bram_budget:0,shells:0,burned_shells:0,commission_fulfilled:false,craft:null,polish:null,placement:null});
const first=()=>({...blank(),revision:1,banked:["lens","moth"],lens_claim:"a".repeat(64),moth_claim:"a".repeat(64),credit:"available",workshop_salvage:1,bram_budget:12});

test("the live acceptance driver requires the sole explicit live flag",()=>{
  expect(parseLiveArguments([])).toBe(false);expect(parseLiveArguments(["--live"])).toBe(true);
  for(const args of [["--live","--root=legacy.testnet"],["--live","--live"],["--fund"],["--mainnet"]])expect(()=>parseLiveArguments(args)).toThrow();
});
test("finite allocation and provenance checks reject commission spending the craft credit or another maker's event",()=>{
  expect(()=>assertAllocation(first(),false)).not.toThrow();
  const commissioned={...first(),workshop_salvage:0,bram_budget:0,shells:12,commission_fulfilled:true};
  expect(()=>assertAllocation(commissioned,true)).not.toThrow();
  expect(()=>assertAllocation({...commissioned,credit:"consumed"},true)).toThrow();
  expect(()=>assertAllocation({...first(),workshop_salvage:2},false)).toThrow();
  const mint=expectedMint(maker,"a".repeat(64)),journey={...commissioned,credit:"consumed",craft:{evidence:mint,pet_id:`qa-mochi-h1.${QA_ROOT}`,state:"confirmed",attempt:1}};
  const item={mint,finish:"original",finish_used:false,appearance_version:0};
  expect(()=>assertCanonicalCraft(journey,item,"1",maker)).not.toThrow();
  expect(()=>assertCanonicalCraft(journey,item,"2",maker)).toThrow();
  expect(()=>assertCanonicalCraft(journey,{...item,mint:{...mint,maker:`qa-holder-h1.${QA_ROOT}`}},"1",maker)).toThrow();
  expect(()=>assertCanonicalCraft(journey,{...item,mint:{...mint,origin_claim_id:"b".repeat(64)}},"1",maker)).toThrow();
});
test("a received placement does not confer the maker's personal allocation",()=>{
  expect(()=>assertNoInheritedAchievement({...blank(),revision:1,placement:{item_id:`lantern:${"c".repeat(64)}`,socket:"dock"}})).not.toThrow();
  expect(()=>assertNoInheritedAchievement(first())).toThrow();
});
test("a successful no-op cannot stand in for either placement socket or recipient placement",()=>{
  const before=blank(),token=`lantern:${"c".repeat(64)}`;
  const after={...before,revision:1,placement:{item_id:token,socket:"dock"}};
  expect(()=>assertPlacement(before,after,token,"dock")).not.toThrow();
  expect(()=>assertPlacement(before,before,token,"dock")).toThrow();
  expect(()=>assertPlacement(before,{...after,revision:0},token,"dock")).toThrow();
  expect(()=>assertPlacement(before,after,token,"porch")).toThrow();
  expect(()=>assertPlacement(before,{...after,placement:{item_id:`lantern:${"d".repeat(64)}`,socket:"dock"}},token,"dock")).toThrow();
});
test("only the exact final transaction and specifically expected rejection can settle durable evidence",()=>{
  const expected={hash:"known-hash",signer:maker,receiver:`items.${QA_ROOT}`};
  const success={final_execution_status:"FINAL",transaction:{hash:expected.hash,signer_id:maker,receiver_id:expected.receiver},status:{SuccessValue:""},transaction_outcome:{id:expected.hash,outcome:{executor_id:maker,status:{SuccessReceiptId:"execution"}}},receipts_outcome:[{id:"execution",outcome:{executor_id:expected.receiver,status:{SuccessValue:""}}}]};
  expect(()=>verifyFinalOutcome(success,expected)).not.toThrow();
  for(const changed of [{...success,final_execution_status:"EXECUTED_OPTIMISTIC"},{...success,transaction:{...success.transaction,hash:"wrong"}},{...success,transaction:{...success.transaction,signer_id:`qa-holder-h1.${QA_ROOT}`}}])expect(()=>verifyFinalOutcome(changed,expected)).toThrow();
  const rejection={...success,status:{Failure:{ActionError:"Balance of the sender is insufficient"}},receipts_outcome:[{id:"execution",outcome:{executor_id:expected.receiver,status:{Failure:{ActionError:"Balance of the sender is insufficient"}}}}]};
  expect(()=>verifyFinalOutcome(rejection,expected,/Balance of the sender is insufficient/)).not.toThrow();
  expect(()=>verifyFinalOutcome(rejection,expected)).toThrow();
  expect(()=>verifyFinalOutcome({...rejection,receipts_outcome:[{id:"execution",outcome:{executor_id:expected.receiver,status:{Failure:{ActionError:"Exceeded the prepaid gas"}}}}]},expected,/Balance of the sender is insufficient/)).toThrow();
  expect(()=>verifyFinalOutcome(success,expected,/ERR_APPEARANCE/)).toThrow();
  const rootPolish={...expected,receiver:QA_ROOT};
  const rootPrecheck={...success,transaction:{...success.transaction,receiver_id:QA_ROOT},status:{Failure:{ActionError:"ERR_ITEM"}},receipts_outcome:[{id:"execution",outcome:{executor_id:QA_ROOT,status:{Failure:{ActionError:"ERR_ITEM"}}}}]};
  expect(()=>verifyFinalOutcome(rootPrecheck,rootPolish,/ERR_APPEARANCE/,`items.${QA_ROOT}`)).toThrow();
  const itemFence={...success,transaction:{...success.transaction,receiver_id:QA_ROOT},receipts_outcome:[{id:"execution",outcome:{executor_id:QA_ROOT,status:{SuccessReceiptId:"callback"}}},{id:"callback",outcome:{executor_id:QA_ROOT,status:{SuccessValue:""}}},{id:"item-rejection",outcome:{executor_id:`items.${QA_ROOT}`,status:{Failure:{ActionError:"ERR_APPEARANCE"}}}}]};
  expect(()=>verifyFinalOutcome(itemFence,rootPolish,/ERR_APPEARANCE/,`items.${QA_ROOT}`)).not.toThrow();
  for(const receipts_outcome of [[],[{id:"execution",outcome:{executor_id:expected.receiver,status:"Unknown"}}],[{id:"execution",outcome:{executor_id:expected.receiver}}],[{id:"execution",outcome:{executor_id:expected.receiver,status:{SuccessReceiptId:"absent"}}}],[{id:"execution",outcome:{executor_id:expected.receiver,status:{SuccessReceiptId:"execution"}}}], [...success.receipts_outcome,...success.receipts_outcome]])expect(()=>verifyFinalOutcome({...success,receipts_outcome},expected)).toThrow();
  expect(()=>verifyFinalOutcome({...success,transaction_outcome:undefined},expected)).toThrow();
  expect(()=>verifyFinalOutcome({...success,transaction_outcome:{...success.transaction_outcome,outcome:{executor_id:maker,status:{Failure:{ActionError:"transaction failed"}}}}},expected)).toThrow();
  expect(()=>verifyFinalOutcome({...itemFence,receipts_outcome:[...itemFence.receipts_outcome,{id:"unknown-sibling",outcome:{executor_id:QA_ROOT,status:"Unknown"}}]},rootPolish,/ERR_APPEARANCE/,`items.${QA_ROOT}`)).toThrow();
});
