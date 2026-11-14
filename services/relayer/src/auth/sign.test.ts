import { describe, expect, test } from "bun:test";
import { KeyPair, actions, base64Encode, createTransaction, encodeTransaction } from "near-api-js";
import { SEASON_STORAGE_DEPOSIT, validateNativeIntent, validateSigningRequest } from "./sign";
const key=KeyPair.fromRandom("ed25519").getPublicKey();
const root="tidebound.testnet"; const sender=`p-1.${root}`;
const context={root,items:`items.${root}`,clientId:"configured-client",origin:"https://harbor.example",origins:["https://harbor.example"]};
test("native policy accepts the SDK's constructed Action enum and still rejects mixed actions",()=>{
 const tx=createTransaction(sender,key,root,21n,[actions.functionCall("tidebound_commission",{},100000000000000n,0n)],new Uint8Array(32));
 expect(()=>validateNativeIntent(tx,context)).not.toThrow();
 Object.assign(tx.actions[0]!,{deleteAccount:{beneficiaryId:sender}});
 expect(()=>validateNativeIntent(tx,context)).toThrow();
 const disguised=actions.deleteAccount("beneficiary.testnet");Object.assign(disguised,{transfer:{deposit:0n}});
 expect(()=>validateNativeIntent(createTransaction(sender,key,sender,21n,[disguised],new Uint8Array(32)),context)).toThrow();
});
function body(receiver=root,action=actions.functionCall("tidebound_commission",{},100000000000000n,0n),signer=sender) {
 const bytes=encodeTransaction(createTransaction(signer,key,receiver,21n,[action],new Uint8Array(32)));
 const enc=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString("base64url");
 const now=Math.floor(Date.now()/1000); const userId="google-oauth2|fixture";
 return {transaction:base64Encode(bytes),response:{user:{userId},publicKey:key.toString(),signatureRequest:{guardId:"jwt#https://login.testnet.fast-auth.com/",signPayload:[...bytes],verifyPayload:`${enc({alg:"RS256",kid:"fixture"})}.${enc({iss:"https://login.testnet.fast-auth.com/",sub:userId,azp:context.clientId,aud:"auth0.jwt.fast-auth.testnet",iat:now,exp:now+60,scope:"transaction:sign",fatxn:[...bytes]})}.fixture`}}};
}
test("sponsorship accepts only exact configured native testnet intentions",()=>{
 expect(validateSigningRequest(body(),context).transaction.signerId).toBe(sender);
 expect(validateSigningRequest(body(sender,actions.transfer(0n)),context).request.algorithm).toBe("eddsa");
 for(const invalid of [body("elsewhere.testnet"),body(root,actions.addFullAccessKey(key)),body(root,actions.functionCall("tidebound_commission",{},100000000000000n,1n)),body(root,actions.functionCall("tidebound_commission",{price:"100"},100000000000000n,0n))]) expect(()=>validateSigningRequest(invalid,context)).toThrow();
 expect(()=>validateSigningRequest(body(),{...context,origin:"https://evil.example"})).toThrow();
 const changed=body(); changed.response.signatureRequest.signPayload[0]=255;
 expect(()=>validateSigningRequest(changed,context)).toThrow();
});
test("registration and actual item-storage credit use only bounded player-funded deposits",()=>{
 const request=body(context.items,actions.functionCall("storage_deposit",{account_id:"recipient.testnet",registration_only:true},30000000000000n,80000000000000000000000n));
 expect(validateSigningRequest(request,context).transaction.receiverId).toBe(context.items);
 const credit=body(context.items,actions.functionCall("storage_deposit",{account_id:"recipient.testnet",registration_only:false},30000000000000n,20000000000000000000000n));
 expect(validateSigningRequest(credit,context).transaction.receiverId).toBe(context.items);
 for(const [registration,deposit] of [[false,0n],[true,0n],[false,80000000000000000000001n],["false",20000000000000000000000n]] as const)expect(()=>validateSigningRequest(body(context.items,actions.functionCall("storage_deposit",{account_id:"recipient.testnet",registration_only:registration},30000000000000n,deposit)),context)).toThrow();
 expect(()=>validateSigningRequest(body(root,actions.functionCall("storage_deposit",{account_id:"recipient.testnet",registration_only:false},30000000000000n,20000000000000000000000n)),context)).toThrow();
 expect(()=>validateSigningRequest(body(context.items,actions.functionCall("storage_deposit",{account_id:"recipient.testnet",registration_only:false,receiver_id:"elsewhere.testnet"},30000000000000n,20000000000000000000000n)),context)).toThrow();
 expect(()=>validateSigningRequest(body(context.items,actions.functionCall("storage_deposit",{account_id:"recipient.testnet",registration_only:true},30000000000000n,80000000000000000000001n)),context)).toThrow();
 expect(()=>validateSigningRequest(body(),{...context,clientId:"np8paqIpMWmNbzT4xAvOOapZBjsOpptl"})).toThrow();
});

test("native signing accepts exact named players and rejects nested, foreign or reserved aliases",()=>{
 for(const name of ["mochi","tide_cat","my-harbor"])expect(validateSigningRequest(body(root,undefined,`${name}.${root}`),context).transaction.signerId).toBe(`${name}.${root}`);
 for(const wrong of [`mochi.nested.${root}`,"mochi.other.testnet",`items.${root}`,`p-no.${root}`])expect(()=>validateSigningRequest(body(root,undefined,wrong),context)).toThrow();
});
test("content versions retain their own command language and decision cap",()=>{
 const args={token_id:`mochi.${root}`,operation_id:"return:stable",expected_revision:0,initial_checkpoint_hash:"a".repeat(64),rules_version:"tidebound_h1_v1",content_version:"first_light_v2",tool:"rope",area:"beacon",commands:Array(24).fill("step:north")};
 expect(()=>validateSigningRequest(body(root,actions.functionCall("tidebound_claim",args,50000000000000n,0n)),context)).not.toThrow();
 for(const changed of [{commands:Array(25).fill("wait")},{commands:["move:left"]},{commands:["take:salvage"]},{content_version:"first_light_v3"},{content_version:"first_light_v1",commands:["step:north"]},{content_version:"first_light_v1",commands:Array(16).fill("wait")}])expect(()=>validateSigningRequest(body(root,actions.functionCall("tidebound_claim",{...args,...changed},50000000000000n,0n)),context)).toThrow();
 expect(()=>validateSigningRequest(body(root,actions.functionCall("tidebound_claim",{...args,content_version:"first_light_v1",commands:["move:left","wait","return"]},50000000000000n,0n)),context)).not.toThrow();
});
describe("season allowlist",()=>{
 const season=`season.${root}`,pet=`mochi-1.${root}`,gas=100000000000000n;
 const tx=(method:string,args:Record<string,unknown>,deposit=0n,receiver=season,extra=false)=>createTransaction(sender,key,receiver,21n,[actions.functionCall(method,args,gas,deposit),...(extra?[actions.functionCall(method,args,gas,deposit)]:[])],new Uint8Array(32));
 const claim={rules_version:"tidebound_h1_v1",content_version:"first_light_v2",tool:"rope",area:"beacon",commands:["step:north","return"]};
 const cases:[string,Record<string,unknown>,bigint][]=[
  ["claim_daily",claim,0n],
  ["claim_daily",{...claim,content_version:"first_light_v1",commands:["move:left","take:lens","return"]},0n],
  ["buy",{good:"glass",qty:1,max_price:8},0n],
  ["sell",{good:"reed",qty:2,min_price:3},0n],
  ["set_wish",{pet,good:"glass",limit:12,qty:2},0n],
  ["cancel_wish",{pet},0n],
  ["storage_deposit",{},SEASON_STORAGE_DEPOSIT],
 ];
 for(const [method,args,deposit] of cases) test(`${method} accepts the exact call and refuses variants`,()=>{
  expect(()=>validateNativeIntent(tx(method,args,deposit),context)).not.toThrow();
  expect(()=>validateSigningRequest(body(season,actions.functionCall(method,args,gas,deposit)),context)).not.toThrow();
  for(const receiver of [root,context.items,"season.elsewhere.testnet",`season.${root}.evil.testnet`,sender]) expect(()=>validateNativeIntent(tx(method,args,deposit,receiver),context)).toThrow();
  expect(()=>validateNativeIntent(tx(method,args,deposit,season,true),context)).toThrow();
  for(const wrong of deposit===0n?[1n,10n**24n]:[0n,1n,deposit-1n,deposit+1n]) expect(()=>validateNativeIntent(tx(method,args,wrong),context)).toThrow();
  expect(()=>validateNativeIntent(tx(method,{...args,extra:1},deposit),context)).toThrow();
 });
 test("season arguments are bounded",()=>{
  const bad:[string,Record<string,unknown>][]=[
   ["claim_daily",{...claim,area:"wind"}],["claim_daily",{...claim,tool:"net"}],["claim_daily",{...claim,rules_version:"tidebound_h2"}],
   ["claim_daily",{...claim,content_version:"first_light_v3"}],["claim_daily",{...claim,commands:["move:left"]}],["claim_daily",{...claim,commands:[]}],
   ["claim_daily",{...claim,commands:Array(25).fill("wait")}],["claim_daily",{...claim,content_version:"first_light_v1",commands:Array(16).fill("wait")}],
   ["buy",{good:"bread",qty:1,max_price:8}],["buy",{good:"glass",qty:0,max_price:8}],["buy",{good:"glass",qty:21,max_price:8}],["buy",{good:"glass",qty:1,max_price:"8"}],["buy",{good:"glass",qty:1.5,max_price:8}],["buy",{good:"glass",qty:1,min_price:8}],
   ["sell",{good:"glass",qty:1,min_price:0}],["sell",{good:"glass",qty:1,max_price:6}],
   ["set_wish",{pet,good:"glass",limit:13,qty:2}],["set_wish",{pet,good:"glass",limit:1,qty:3}],["set_wish",{pet,good:"glass",limit:0,qty:1}],["set_wish",{pet:"mochi.elsewhere.testnet",good:"glass",limit:1,qty:1}],
   ["cancel_wish",{pet:"elsewhere.testnet"}],["storage_withdraw",{}],["get_shelf",{}],["new",{root}],["on_wish_owner",{owner:sender,pet,good:"glass",limit:1,qty:1}],
  ];
  for(const [method,args] of bad) expect(()=>validateNativeIntent(tx(method,args),context)).toThrow();
  expect(()=>validateNativeIntent(tx("storage_deposit",{account_id:sender},SEASON_STORAGE_DEPOSIT),context)).toThrow();
  expect(()=>validateNativeIntent(tx("claim_daily",claim,0n,context.items),context)).toThrow();
  expect(()=>validateNativeIntent(tx("storage_deposit",{},SEASON_STORAGE_DEPOSIT,root),context)).toThrow();
 });
});
