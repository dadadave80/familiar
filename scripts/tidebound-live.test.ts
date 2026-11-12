import {expect,test} from "bun:test";
import {assertAllocation,assertCanonicalCraft,assertNoInheritedAchievement,assertPlacement,assertResumeProof,reviewedTopup,assertConcurrentPrepayment,reviewedMakerFloat,assertCodeOnlyUpgrade,qaFunctionArgs,assertExactQAAction,qaStorageDeposit,assertPostDockJournal,assertPostDockState,POST_DOCK_CHECKPOINT,POST_DOCK_STEPS,POST_DOCK_HASHES,expectedMint,parseLiveArguments,verifyFinalOutcome,QA_ROOT,REVIEWED_REJECTION,type ResumeProof} from "./tidebound-live";
import {actions,base64Decode,base64Encode,baseEncode,createTransaction,decodeTransaction,encodeTransaction,teraToGas} from "near-api-js";
import {createHash} from "node:crypto";
import {validateNativeIntent} from "../services/relayer/src/auth/sign";
import upgrade from "../docs/TIDEBOUND-NATIVE-GAS-UPGRADE.json";

const maker=`qa-maker-h1.${QA_ROOT}`;
const blank=()=>({revision:0,banked:[],lit:false,signaled:false,lens_claim:null,moth_claim:null,credit:"unclaimed",workshop_salvage:0,bram_budget:0,shells:0,burned_shells:0,commission_fulfilled:false,craft:null,polish:null,placement:null});
const first=()=>({...blank(),revision:1,banked:["lens","moth"],lens_claim:"a".repeat(64),moth_claim:"a".repeat(64),credit:"available",workshop_salvage:1,bram_budget:12});

test("the live acceptance driver requires the sole explicit live flag",()=>{
  expect(parseLiveArguments([])).toBe(false);expect(parseLiveArguments(["--live"])).toBe(true);
  expect(parseLiveArguments(["--live",`--resume-known-rejection=${REVIEWED_REJECTION}`,`--root-upgrade=${"1".repeat(32)}`])).toBe(true);
  expect(parseLiveArguments(["--live",`--continue-post-dock=${POST_DOCK_CHECKPOINT}`])).toBe(true);
  for(const args of [["--live","--root=legacy.testnet"],["--live","--live"],["--fund"],["--mainnet"],["--live",`--resume-known-rejection=${REVIEWED_REJECTION}`],["--live","--resume-known-rejection=other",`--root-upgrade=${"1".repeat(32)}`]])expect(()=>parseLiveArguments(args)).toThrow();
});
test("zero storage minimum does not stand in for the bounded recipient's actual transfer-storage credit",()=>{
  expect(qaStorageDeposit({min:"0",max:null})).toBe(20000000000000000000000n);
  expect(qaStorageDeposit({min:"1",max:"20000000000000000000000"})).toBe(20000000000000000000000n);
  for(const bounds of [{min:"01",max:null},{min:"-1",max:null},{min:0,max:null},{min:"0"},{min:"20000000000000000000001",max:null},{min:"0",max:"1"}])expect(()=>qaStorageDeposit(bounds)).toThrow();
});
test("only the exact all-final post-dock journal may start one separate gift continuation",()=>{
  const evidence={version:1,kind:"operator-controlled-QA-not-Privy-recovery",network:"testnet",root:QA_ROOT,status:"stopped-review-required",reviews:[{originalHash:REVIEWED_REJECTION}],steps:POST_DOCK_STEPS.map((name,i)=>({name,state:"final",hash:POST_DOCK_HASHES[i]!}))};
  expect(()=>assertPostDockJournal(evidence)).not.toThrow();
  for(const changed of [{status:"complete"},{root:"legacy.testnet"},{reviews:[]},{reviews:[...evidence.reviews,...evidence.reviews]},{continuations:[{}]},{steps:evidence.steps.slice(0,-1)},{steps:[...evidence.steps,{name:"register-QA-recipient",state:"final",hash:"new"}]},{steps:evidence.steps.map((s,i)=>i===2?{...s,state:"uncertain"}:s)},{steps:evidence.steps.map((s,i)=>i===22?{...s,hash:"wrong"}:s)},{steps:evidence.steps.map((s,i)=>i===1?{...s,hash:"unique-0"}:s)}])expect(()=>assertPostDockJournal({...evidence,...changed})).toThrow();
  expect(()=>parseLiveArguments(["--live","--continue-post-dock=wrong"])).toThrow();
});
test("post-dock proof requires the same consumed credit, finished supply-one item and untouched recipient",()=>{
  const mint=expectedMint(maker,"a".repeat(64));
  const j={...first(),revision:11,banked:["lens","moth","vane"],lit:true,signaled:true,credit:"consumed",workshop_salvage:0,bram_budget:0,shells:0,burned_shells:12,commission_fulfilled:true,craft:{evidence:mint,pet_id:`qa-mochi-h1.${QA_ROOT}`,state:"confirmed",attempt:1},polish:{state:"confirmed",attempt:1},placement:{item_id:mint.token_id,socket:"dock"}};
  const item={mint,finish:"harbor_polish",finish_used:true,appearance_version:1};
  expect(()=>assertPostDockState(j,blank(),item,"1","1","0")).not.toThrow();
  for(const changed of [{revision:10},{credit:"available"},{burned_shells:0},{placement:{...j.placement,socket:"porch"}},{polish:{state:"reserved",attempt:1}}])expect(()=>assertPostDockState({...j,...changed},blank(),item,"1","1","0")).toThrow();
  expect(()=>assertPostDockState(j,first(),item,"1","1","0")).toThrow();expect(()=>assertPostDockState(j,blank(),item,"2","1","0")).toThrow();expect(()=>assertPostDockState(j,blank(),item,"1","0","1")).toThrow();expect(()=>assertPostDockState(j,blank(),{...item,finish_used:false},"1","1","0")).toThrow();
});
test("individual affordability cannot conceal two simultaneous reservations against the same balance",()=>{
  const required=[121000000000000000000000n,121000000000000000000000n],available=230000000000000000000000n;
  expect(required.every(value=>available>value)).toBe(true);
  expect(()=>assertConcurrentPrepayment(available,required)).toThrow("BOTH");
  expect(reviewedMakerFloat(available,required)).toBe(36000000000000000000000n);
  expect(()=>assertConcurrentPrepayment(available+reviewedMakerFloat(available,required),required)).not.toThrow();
  expect(reviewedMakerFloat(450000000000000000000000n,required)).toBe(0n);
  expect(()=>reviewedMakerFloat(100000000000000000000000n,required)).toThrow("0.10");
});
test("the actual finalized code-only upgrade carries a base64 digest, rather than the deployed bytecode",()=>{
  const action=upgrade.receipt.transaction.actions[0]!;
  expect(()=>verifyFinalOutcome(upgrade.receipt,{hash:upgrade.transactionHash,signer:QA_ROOT,receiver:QA_ROOT})).not.toThrow();
  expect(Buffer.from(action.DeployContract.code,"base64").length).toBe(32);
  expect(()=>assertCodeOnlyUpgrade(upgrade.receipt.transaction.actions,upgrade.afterCodeHash)).not.toThrow();
  expect(()=>assertCodeOnlyUpgrade(upgrade.receipt.transaction.actions,upgrade.beforeCodeHash)).toThrow();
  for(const actions of [[],[action,{FunctionCall:{method_name:"new"}}],[{...action,FunctionCall:{method_name:"new"}}],[{DeployContract:{...action.DeployContract,extra:"unknown"}}],[{DeployContract:{code:Buffer.alloc(31).toString("base64")}}],[{DeployContract:{code:"invalid"}}],[{DeployContract:{code:action.DeployContract.code+"\n"}}]])expect(()=>assertCodeOnlyUpgrade(actions,upgrade.afterCodeHash)).toThrow();
});
test("the exact public adoption envelope and every QA action survive the actual SDK Borsh roundtrip",()=>{
  // Public unsigned bytes from the original GEM4... rejection; no signature or private key is stored here.
  const original="IgAAAHFhLWhvbGRlci1oMS5mYW1pbGlhci1nYW1lLnRlc3RuZXQApPmUCD00X5YmEZd4WxZj87aZgtKw3vUXssWwv+N/NBzBGCqETvwAABUAAABmYW1pbGlhci1nYW1lLnRlc3RuZXQ14dtGCi/qjAxmss+9PXt26asniYmFdEjM4QZkc3OdwwEAAAACBQAAAGFkb3B0GAAAAHsibmFtZSI6InFhLWJyYW1ibGUtaDEifQBAD4S1owAAAAAAAAAAAAAAAAAAAAAAAA==";
  const tx=decodeTransaction(base64Decode(original)),call=tx.actions[0]!.functionCall!;
  expect(baseEncode(createHash("sha256").update(encodeTransaction(tx)).digest())).toBe(REVIEWED_REJECTION);
  expect(base64Encode(encodeTransaction(tx))).toBe(original);expect(Array.isArray(call.args)).toBe(true);
  expect(qaFunctionArgs(call.args)).toEqual({name:"qa-bramble-h1"});
  expect(()=>validateNativeIntent(tx,{root:QA_ROOT,items:`items.${QA_ROOT}`})).not.toThrow();
  const intents=[actions.functionCall("adopt",{name:"qa-bramble-h1"},teraToGas(180),0n),actions.transfer(100000000000000000000000n),actions.addFullAccessKey(tx.publicKey)];
  expect(()=>assertExactQAAction(tx,intents[0]!)).not.toThrow();
  for(const action of intents){
    const constructed=createTransaction(tx.signerId,tx.publicKey,tx.receiverId,tx.nonce,[action],new Uint8Array(tx.blockHash));
    const decoded=decodeTransaction(encodeTransaction(constructed));
    expect(()=>assertExactQAAction(constructed,action)).not.toThrow();expect(()=>assertExactQAAction(decoded,action)).not.toThrow();
    expect(base64Encode(encodeTransaction(decoded))).toBe(base64Encode(encodeTransaction(constructed)));
    if(action.functionCall){expect(qaFunctionArgs(action.functionCall.args)).toEqual(qaFunctionArgs(decoded.actions[0]!.functionCall!.args));expect(()=>assertExactQAAction(decoded,actions.functionCall("adopt",{name:"different"},teraToGas(180),0n))).toThrow();}
    if(action.transfer){const deposit=action.transfer.deposit;expect(()=>assertExactQAAction(decoded,actions.transfer(deposit+1n))).toThrow();}
    if(action.addKey)expect(()=>assertExactQAAction(decoded,actions.addFunctionCallAccessKey(tx.publicKey,QA_ROOT,["adopt"],0n))).toThrow();
  }
  for(const value of ['{"name":"qa-bramble-h1"}',"e30=",[256],[-1],[1.5],new Uint8Array([255]),new TextEncoder().encode("[]"),new TextEncoder().encode("null"),new TextEncoder().encode("\"string\"")])expect(()=>qaFunctionArgs(value)).toThrow();
});
test("the sole reviewed rejection requires pinned unused nonce, exact binding, typed-unknown hash, absent pet and unexpired original bytes",()=>{
  const p:ResumeProof={hash:REVIEWED_REJECTION,binding:`qa-holder-h1.${QA_ROOT}`,permission:"FullAccess",nonce:10n,originalNonce:11n,unknownTransactionHash:REVIEWED_REJECTION,petNFTAbsent:true,petAccountAbsent:true,originalHash:"original",returnedOriginalHash:"original",finalHash:"final",accessBlockHash:"final",accountBlockHash:"final",finalHeight:1000,accessHeight:1000,originalHeight:100,validity:86400};
  expect(()=>assertResumeProof(p)).not.toThrow();
  for(const changed of [{hash:"other"},{binding:maker},{permission:"FunctionCall"},{nonce:11n},{nonce:9n},{unknownTransactionHash:"RPC outage"},{petNFTAbsent:false},{petAccountAbsent:false},{returnedOriginalHash:"other"},{accessBlockHash:"other"},{accountBlockHash:"other"},{accessHeight:999},{finalHeight:86501,accessHeight:86501},{originalHeight:1001},{validity:0},{validity:1.5}])expect(()=>assertResumeProof({...p,...changed})).toThrow();
  expect(()=>assertResumeProof({...p,finalHeight:86500,accessHeight:86500})).not.toThrow();
  expect(reviewedTopup(150000000000000000000000n)).toBe(100000000000000000000000n);
  expect(reviewedTopup(240000000000000000000000n)).toBe(10000000000000000000000n);
  expect(reviewedTopup(250000000000000000000000n)).toBe(0n);
  expect(()=>reviewedTopup(149999999999999999999999n)).toThrow();
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
