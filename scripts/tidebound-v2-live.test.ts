import {expect,test} from "bun:test";
import {actions,createTransaction,decodeTransaction,encodeTransaction,KeyPair,nearToYocto,teraToGas} from "near-api-js";
import {V2_QA,parseV2QAArguments,v2Route,v2Mint,assertV2QAIntent,assertV2Craft,submitV2Once,type V2Step} from "./tidebound-v2-live";
import {replayCourt} from "../web/src/expedition/engine";
import {expectedMint} from "./tidebound-live";
test("v2 operator acceptance is local-only unless the sole explicit live flag is supplied",()=>{
 expect(parseV2QAArguments([])).toBe(false);expect(parseV2QAArguments(["--live"])).toBe(true);
 for(const args of [["--live","--live"],["--resume"],["--root=legacy.testnet"],["--fund"],["--mainnet"]])expect(()=>parseV2QAArguments(args)).toThrow();
 expect(V2_QA.rootAllocationCap).toBe(nearToYocto("1").toString());
});
test("the exact frozen v2 routes earn both first finds and require the Wind wheel before returning",()=>{
 const beacon=v2Route("beacon",[]),wind=v2Route("wind",["lens","moth"]);
 expect(beacon.commands).toHaveLength(17);expect(beacon.cargo).toEqual(["lens","moth"]);expect(beacon.resolve).toBe(3);
 expect(wind.commands).toHaveLength(14);expect(wind.commands).toContain("turn:vane");expect(wind.cargo).toEqual(["vane"]);expect(wind.resolve).toBe(3);
 expect(replayCourt({area:"beacon",tool:"rope",banked:[]},["move:left","return"])).toBeNull();
});
test("the live policy fixes actors, functions, destinations, gas and each bounded principal",()=>{
 const key=KeyPair.fromRandom("ed25519").getPublicKey(),tx=(actor:string,receiver:string,method:string,args:Record<string,unknown>,gas=teraToGas(50),deposit=0n)=>createTransaction(actor,key,receiver,1n,[actions.functionCall(method,args,gas,deposit)],new Uint8Array(32));
 const adopt=tx(V2_QA.maker,V2_QA.root,"adopt",{name:V2_QA.pet.split(".")[0]},teraToGas(180));expect(()=>assertV2QAIntent(adopt,"adopt",key.toString())).not.toThrow();expect(()=>assertV2QAIntent(decodeTransaction(encodeTransaction(adopt)),"adopt",key.toString())).not.toThrow();
 const storage=tx(V2_QA.maker,V2_QA.items,"storage_deposit",{account_id:V2_QA.holder,registration_only:false},teraToGas(50),nearToYocto("0.00176"));expect(()=>assertV2QAIntent(storage,"recipient-storage",key.toString())).not.toThrow();
 const token=v2Mint("a".repeat(64)).token_id;expect(()=>assertV2QAIntent(tx(V2_QA.maker,V2_QA.root,"tidebound_polish",{item_id:token,expected_appearance:0},teraToGas(100)),"polish",key.toString())).not.toThrow();expect(()=>assertV2QAIntent(tx(V2_QA.maker,V2_QA.root,"tidebound_polish",{item_id:token,expected_appearance:1},teraToGas(100)),"polish",key.toString())).toThrow();
 for(const bad of [tx(V2_QA.maker,V2_QA.root,"buy_pet",{}),tx(V2_QA.holder,V2_QA.root,"adopt",{name:"other"},teraToGas(180)),tx(V2_QA.maker,V2_QA.items,"storage_deposit",{account_id:V2_QA.holder,registration_only:false},teraToGas(50),nearToYocto("0.00201")),tx(V2_QA.maker,V2_QA.root,"adopt",{name:V2_QA.pet.split(".")[0]},teraToGas(180),1n),tx(V2_QA.maker,V2_QA.root,"adopt",{name:"other"},teraToGas(180))])expect(()=>assertV2QAIntent(bad,bad.actions[0]!.functionCall!.methodName==="storage_deposit"?"recipient-storage":"adopt",key.toString())).toThrow();
});
test("v2 provenance comes from the actual accepted maker event while its entitlement stays content independent",()=>{
 const origin="a".repeat(64),mint=v2Mint(origin),j={revision:7,banked:["lens","moth","vane"],lit:true,signaled:true,lens_claim:origin,moth_claim:origin,credit:"consumed",workshop_salvage:0,bram_budget:0,shells:12,burned_shells:0,commission_fulfilled:true,craft:{state:"confirmed",attempt:1,pet_id:V2_QA.pet,evidence:mint},polish:null,placement:null,claims:[{id:origin,content_version:"first_light_v2",moth:true,lens:true}]},item={mint,finish:"original",appearance_version:0,finish_used:false};
 expect(()=>assertV2Craft(j,item,"1")).not.toThrow();
 expect(mint.id).toBe(expectedMint(V2_QA.maker,origin).id);expect(mint.token_id).toBe(expectedMint(V2_QA.maker,origin).token_id);
 expect(()=>assertV2Craft({...j,shells:0,burned_shells:12,polish:{state:"confirmed",attempt:1}},{...item,finish:"harbor_polish",appearance_version:1,finish_used:true},"1")).not.toThrow();
 for(const changed of [{...item,mint:{...mint,maker:V2_QA.holder}},{...item,mint:{...mint,content_version:"first_light_v1"}},{...item,mint:{...mint,origin_claim_id:"b".repeat(64)}}])expect(()=>assertV2Craft(j,changed,"1")).toThrow();
 expect(()=>assertV2Craft({...j,claims:[]},item,"1")).toThrow();expect(()=>assertV2Craft(j,item,"2")).toThrow();expect(()=>assertV2Craft({...j,credit:"available"},item,"1")).toThrow();
});
test("one uncertain v2 submission preserves its exact original envelope and blocks the next action",async()=>{
 const step={state:"prepared",signedTransaction:"EXACT_SAME_BYTES"} as V2Step,states:string[]=[];let sends=0,next=0;
 await expect((async()=>{await submitV2Once(step,async()=>{sends++;expect(states.at(-1)).toBe("submitted");throw Error("unknown");},async()=>{states.push(step.state);});next++;})()).rejects.toThrow("unknown");expect(sends).toBe(1);expect(next).toBe(0);expect(step.state).toBe("uncertain");expect(step.signedTransaction).toBe("EXACT_SAME_BYTES");await expect(submitV2Once(step,async()=>{sends++;},async()=>{})).rejects.toThrow();expect(sends).toBe(1);
});
