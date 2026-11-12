import { expect, test } from "bun:test";
import { KeyPair, actions, createTransaction, base64Encode } from "near-api-js";
import { NearAuthAccountAdapter, type AccountSession } from "./adapter";
const root="tidebound.testnet",account=`p-1.${root}`;const key=KeyPair.fromRandom("ed25519");
function fixture() {
 let provisions=0,requests=0;let registered=true;let network="testnet";let payload:Uint8Array|undefined;
 const data=new Map<string,string>();
 const session:AccountSession={userId:"google-oauth2|fixture",publicKey:key.getPublicKey().toString(),clientId:"configured",async endSession(){},async requestSignature(bytes){requests++;payload=bytes;const enc=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString("base64url"),now=Math.floor(Date.now()/1000);return {user:{userId:this.userId},publicKey:this.publicKey,signatureRequest:{guardId:"jwt#https://login.testnet.fast-auth.com/",signPayload:[...bytes],verifyPayload:`${enc({alg:"RS256",kid:"fixture"})}.${enc({iss:"https://login.testnet.fast-auth.com/",sub:this.userId,azp:this.clientId,aud:"auth0.jwt.fast-auth.testnet",iat:now,exp:now+60,scope:"transaction:sign",fatxn:[...bytes]})}.fixture`}}},signatureBytes(v){return Uint8Array.from((v as {signature:number[]}).signature)}};
 const provider={async getNetworkId(){return network},async callFunction(){return registered?account:null},async viewAccessKey(){return {permission:"FullAccess",nonce:20n}}};
 const options={root,items:`items.${root}`,clientId:"configured",origin:"https://harbor.example",approvedOrigin:"https://harbor.example",provider:provider as any,storage:{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)}},async openSession(){return session},async provision(){provisions++;registered=true;return {accountId:account,root,network:"testnet"}},async sponsor(){const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(payload!)));return {signature:[...key.sign(hash).signature]}}};
 return {options,data,get provisions(){return provisions},get requests(){return requests},set registered(v:boolean){registered=v},set network(v:string){network=v}};
}
test("restore and repeat Google login resolve one chain binding and never provision implicitly",async()=>{
 const f=fixture();const first=new NearAuthAccountAdapter(f.options),second=new NearAuthAccountAdapter(f.options);
 expect(await first.restoreSession()).toEqual(await second.authenticate());
 expect(await first.resolveBinding()).toMatchObject({nearAccountId:account,network:"testnet",signerPublicKey:key.getPublicKey().toString()});
 expect(f.provisions).toBe(0);
 f.registered=false;expect(await first.authenticate()).toBe(null);expect(f.provisions).toBe(0);
 await Promise.all([first.provisionAccount(),first.provisionAccount()]);expect(f.provisions).toBe(1);
});
test("native authorization verifies exact bytes and retries reuse signed operation",async()=>{
 const f=fixture(),adapter=new NearAuthAccountAdapter(f.options);await adapter.authenticate();
 const tx=createTransaction(account,key.getPublicKey(),root,21n,[actions.functionCall("tidebound_commission",{},100000000000000n,0n)],new Uint8Array(32));
 const signed=await adapter.authorizeNative(tx,"commission");
 expect(signed.transaction.signerId).toBe(account);expect(f.requests).toBe(1);
 expect(base64Encode((await adapter.authorizeNative(tx,"commission")).encode())).toBe(base64Encode(signed.encode()));expect(f.requests).toBe(1);
 adapter.markSubmitted("commission",(await adapter.resolveBinding())!);await expect(adapter.authorizeNative(tx,"commission")).rejects.toThrow("reconcile");
});
test("wrong network/key/operation bytes cannot gain authorization",async()=>{
 const f=fixture(),adapter=new NearAuthAccountAdapter(f.options);await adapter.authenticate();
 const tx=createTransaction(account,key.getPublicKey(),root,21n,[actions.functionCall("tidebound_commission",{},100000000000000n,0n)],new Uint8Array(32));
 await adapter.authorizeNative(tx,"one");
 await expect(adapter.authorizeNative({...tx,nonce:22n} as typeof tx,"one")).rejects.toThrow();
 f.network="mainnet";await expect(adapter.authorizeNative(tx,"new")).rejects.toThrow();
 expect(f.requests).toBe(1);
});
test("wrong MPC signature and failed durable storage cannot become a signed action",async()=>{
 const f=fixture(),adapter=new NearAuthAccountAdapter({...f.options,async sponsor(){return {signature:Array(64).fill(0)}}});await adapter.authenticate();
 const tx=createTransaction(account,key.getPublicKey(),root,21n,[actions.functionCall("tidebound_commission",{},100000000000000n,0n)],new Uint8Array(32));
 await expect(adapter.authorizeNative(tx,"wrong-signature")).rejects.toThrow();
 const blocked=new NearAuthAccountAdapter({...f.options,storage:{getItem:()=>null,setItem(){throw new Error("quota")}}});await blocked.authenticate();
 const before=f.requests;await expect(blocked.authorizeNative(tx,"not-saved")).rejects.toThrow("quota");expect(f.requests).toBe(before);
});
test("unapproved origin and signed-out restore do not start provisioning",async()=>{
 const f=fixture();const blocked=new NearAuthAccountAdapter({...f.options,origin:"https://elsewhere.example"});
 await expect(blocked.authenticate()).rejects.toThrow("not configured");
 const signedOut=new NearAuthAccountAdapter({...f.options,async openSession(){return null}});
 expect(await signedOut.restoreSession()).toBe(null);expect(f.provisions).toBe(0);
});
