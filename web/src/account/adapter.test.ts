import { expect, test } from "bun:test";
import { KeyPair, actions, createTransaction, base64Encode } from "near-api-js";
import { NearAuthAccountAdapter, type AccountSession } from "./adapter";
const root="tidebound.testnet",account=`p-1.${root}`;const key=KeyPair.fromRandom("ed25519");
function fixture() {
 let provisions=0,requests=0;let registered=true;let network="testnet";let payload:Uint8Array|undefined;
 const data=new Map<string,string>();
 const session:AccountSession={userId:"google-oauth2|fixture",publicKey:key.getPublicKey().toString(),clientId:"configured",async endSession(){},async requestSignature(bytes){requests++;payload=bytes;const enc=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString("base64url"),now=Math.floor(Date.now()/1000);return {user:{userId:this.userId},publicKey:this.publicKey,signatureRequest:{guardId:"jwt#https://login.testnet.fast-auth.com/",signPayload:[...bytes],verifyPayload:`${enc({alg:"RS256",kid:"fixture"})}.${enc({iss:"https://login.testnet.fast-auth.com/",sub:this.userId,azp:this.clientId,aud:"auth0.jwt.fast-auth.testnet",iat:now,exp:now+60,scope:"transaction:sign",fatxn:[...bytes]})}.fixture`}}},signatureBytes(v){return Uint8Array.from((v as {signature:number[]}).signature)}};
 const provider={async getNetworkId(){return network},async callFunction(){return registered?account:null},async viewAccessKey(){return {permission:"FullAccess",nonce:20n}}};
 const options={root,items:`items.${root}`,clientId:"configured",origin:"https://harbor.example",approvedOrigin:"https://harbor.example",provider:provider as any,storage:{getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)}},async openSession(){return session},async provision(_publicKey:string,_username:string){provisions++;registered=true;return {accountId:account,root,network:"testnet"}},async availability(username:string){return {username,accountId:`${username}.${root}`,available:true,root,network:"testnet" as const}},async sponsor(){const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(payload!)));return {signature:[...key.sign(hash).signature]}}};
 return {options,data,get provisions(){return provisions},get requests(){return requests},set registered(v:boolean){registered=v},set network(v:string){network=v}};
}
test("restore and repeat Google login resolve one chain binding and never provision implicitly",async()=>{
 const f=fixture();const first=new NearAuthAccountAdapter(f.options),second=new NearAuthAccountAdapter(f.options);
 expect(await first.restoreSession()).toEqual(await second.authenticate());
 expect(await first.resolveBinding()).toMatchObject({nearAccountId:account,network:"testnet",signerPublicKey:key.getPublicKey().toString()});
 expect(f.provisions).toBe(0);
 f.registered=false;expect(await first.authenticate()).toBe(null);expect(f.provisions).toBe(0);
 await Promise.all([first.provisionAccount("mochi"),first.provisionAccount("mochi")]);expect(f.provisions).toBe(1);
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

test("named signup checks exact availability and repeated login restores its account",async()=>{
 const f=fixture();let nameAccount:string|null=null,creates=0;
 const options={...f.options,
  provider:{...f.options.provider,async callFunction(){return nameAccount}},
  async availability(username:string){return {username,accountId:`${username}.${root}`,available:username!=="taken",root,network:"testnet" as const}},
  async provision(_publicKey:string,username:string){creates++;nameAccount=`${username}.${root}`;return {accountId:nameAccount,root,network:"testnet"}},
 };
 const first=new NearAuthAccountAdapter(options);
 expect(first.accountRoot).toBe(root);
 expect(await first.authenticate()).toBe(null);
 expect(await first.checkUsername("mochi")).toMatchObject({accountId:`mochi.${root}`,available:true});
 expect(await first.checkUsername("taken")).toMatchObject({available:false});
 await expect(first.checkUsername("items")).rejects.toThrow();
 const created=await first.provisionAccount("mochi");
 expect(created.nearAccountId).toBe(`mochi.${root}`);
 const second=new NearAuthAccountAdapter(options);
 expect(await second.authenticate()).toEqual(created);
 expect(await second.provisionAccount("another-name")).toEqual(created);
 expect(creates).toBe(1);
});

test("different pending usernames cannot silently join the first signup",async()=>{
 const f=fixture();f.registered=false;let release!:()=>void;
 const wait=new Promise<void>(resolve=>{release=resolve});let entered!:()=>void;const active=new Promise<void>(resolve=>{entered=resolve});
 const adapter=new NearAuthAccountAdapter({...f.options,async availability(username:string){return {username,accountId:`${username}.${root}`,available:true,root,network:"testnet" as const}},async provision(publicKey:string,username:string){entered();await wait;return f.options.provision(publicKey,username)}});
 await adapter.authenticate();const first=adapter.provisionAccount("mochi");await active;
 const releaseOnFailure=setTimeout(release,50);
 try{await expect(adapter.provisionAccount("another-name")).rejects.toThrow("pending");}
 finally{clearTimeout(releaseOnFailure);release();await first;}expect(f.provisions).toBe(1);
});

test("availability and bindings reject foreign or nested account names",async()=>{
 const f=fixture();const adapter=new NearAuthAccountAdapter({...f.options,async availability(username:string){return {username,accountId:`${username}.other.testnet`,available:true,root:"other.testnet",network:"testnet" as const}}});
 await adapter.authenticate();await expect(adapter.checkUsername("mochi")).rejects.toThrow();
 for(const wrong of [`mochi.nested.${root}`,"mochi.other.testnet",`items.${root}`]){
  const other=new NearAuthAccountAdapter({...f.options,provider:{...f.options.provider,async callFunction(){return wrong}}});
  await expect(other.authenticate()).rejects.toThrow();
 }
});

test("an old approval blocked on final key read cannot persist or mark submitted after another login",async()=>{
 const f=fixture(),newKey=KeyPair.fromRandom("ed25519"),newAccount=`p-2.${root}`;
 let nextSession:AccountSession|null=await f.options.openSession(),reads=0,release!:()=>void,entered!:()=>void;
 const wait=new Promise<void>(resolve=>{release=resolve}),active=new Promise<void>(resolve=>{entered=resolve});
 const adapter=new NearAuthAccountAdapter({...f.options,
  async openSession(){return nextSession},
  provider:{...f.options.provider,async callFunction(input:unknown){const value=input as {args:{public_key:string}};return value.args.public_key===newKey.getPublicKey().toString()?newAccount:account;},async viewAccessKey(){reads++;if(reads===4){entered();await wait;}return {permission:"FullAccess" as const,nonce:20n};}} as typeof f.options.provider,
 });
 const oldBinding=(await adapter.authenticate())!;
 const tx=createTransaction(account,key.getPublicKey(),root,21n,[actions.functionCall("tidebound_commission",{},100000000000000n,0n)],new Uint8Array(32));
 const signing=adapter.authorizeNative(tx,"old-session");
 const reached=await Promise.race([active.then(()=>"final-read"),signing.then(()=>"signed",error=>String(error)),Bun.sleep(200).then(()=>`waiting after ${reads} reads`)]);
 expect(reached).toBe("final-read");
 const raw=[...f.data.values()][0]!;expect(JSON.parse(raw).state).toBe("prepared");
 await adapter.endSession();
 nextSession={...nextSession!,userId:"google-oauth2|another-user",publicKey:newKey.getPublicKey().toString()};
 const current=(await adapter.authenticate())!;expect(current.nearAccountId).toBe(newAccount);
 expect(()=>adapter.markSubmitted("old-session",oldBinding)).toThrow("sign-in changed");
 release();await expect(signing).rejects.toThrow("sign-in changed");
 expect([...f.data.values()]).toEqual([raw]);expect(JSON.parse(raw).signedTransaction).toBeUndefined();expect(f.requests).toBe(1);expect(f.provisions).toBe(0);
});

test("submitted markers require the current full account and credential binding",async()=>{
 const f=fixture(),adapter=new NearAuthAccountAdapter(f.options),binding=(await adapter.authenticate())!;
 const tx=createTransaction(account,key.getPublicKey(),root,21n,[actions.functionCall("tidebound_commission",{},100000000000000n,0n)],new Uint8Array(32));
 await adapter.authorizeNative(tx,"bound");const raw=[...f.data.values()][0];
 for(const wrong of [{...binding,network:"mainnet" as const},{...binding,nearAccountId:`p-2.${root}`},{...binding,playerId:"foreign"},{...binding,signerBindingId:"jwt#wrong#identity"},{...binding,signerPublicKey:KeyPair.fromRandom("ed25519").getPublicKey().toString()}]){
  expect(()=>adapter.markSubmitted("bound",wrong)).toThrow();expect([...f.data.values()][0]).toBe(raw);
 }
 adapter.markSubmitted("bound",binding);expect(JSON.parse([...f.data.values()][0]!).state).toBe("submitted");
});
