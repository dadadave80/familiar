import { expect, test } from "bun:test";
import { KeyPair, actions, base64Encode, createTransaction, encodeTransaction } from "near-api-js";
import { validateNativeIntent, validateSigningRequest } from "./sign";
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
test("registration uses only bounded player-funded storage deposits",()=>{
 const request=body(context.items,actions.functionCall("storage_deposit",{account_id:"recipient.testnet",registration_only:true},30000000000000n,80000000000000000000000n));
 expect(validateSigningRequest(request,context).transaction.receiverId).toBe(context.items);
 expect(()=>validateSigningRequest(body(context.items,actions.functionCall("storage_deposit",{account_id:"recipient.testnet",registration_only:true},30000000000000n,80000000000000000000001n)),context)).toThrow();
 expect(()=>validateSigningRequest(body(),{...context,clientId:"np8paqIpMWmNbzT4xAvOOapZBjsOpptl"})).toThrow();
});

test("native signing accepts exact named players and rejects nested, foreign or reserved aliases",()=>{
 for(const name of ["mochi","tide_cat","my-harbor"])expect(validateSigningRequest(body(root,undefined,`${name}.${root}`),context).transaction.signerId).toBe(`${name}.${root}`);
 for(const wrong of [`mochi.nested.${root}`,"mochi.other.testnet",`items.${root}`,`p-no.${root}`])expect(()=>validateSigningRequest(body(root,undefined,wrong),context)).toThrow();
});
