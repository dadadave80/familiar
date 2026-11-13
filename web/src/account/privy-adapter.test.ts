import {expect,test} from "bun:test";
import {actions,base64Encode,baseDecode,baseEncode,createTransaction,encodeTransaction,KeyPair} from "near-api-js";
import {PrivyAccountAdapter,createPrivyConnection,nearSigningDigest,privyWalletKey,signPrivyRecoveryProof,verifyPrivyWalletOwner,type PrivyAccountOptions,type PrivyIdentity,type PrivyWalletBinding} from "./privy-adapter";
import {AccountDoesNotExistError} from "near-api-js/rpc-errors";

const root="familiar-game.testnet",account=`player1.${root}`,key=KeyPair.fromRandom("ed25519"),publicKey=key.getPublicKey().toString();
const implicitAddress=[...baseDecode(publicKey.slice("ed25519:".length))].map(n=>n.toString(16).padStart(2,"0")).join("");
const wallet:PrivyWalletBinding={walletId:"canonical-near-wallet",implicitAddress,publicKey};
function owner():PrivyIdentity {return {id:"did:privy:private-user",wallets:[{id:wallet.walletId,address:implicitAddress,chainType:"near",walletClientType:"privy",userCanSign:true,imported:false,recoveryMethod:"privy-v2",publicKey}]};}
const transaction=(nonce=1n,receiver=root)=>createTransaction(account,key.getPublicKey(),receiver,nonce,[actions.functionCall("tidebound_commission",{},100000000000000n,0n)],new Uint8Array(32));
function fixture() {
  const data=new Map<string,string>(),events:string[]=[],creates:boolean[]=[],signed:{address:string;hash:string}[]=[];
  let identity:PrivyIdentity|null=owner(),registered=true,available=true,network="testnet",nonce=0n,badSignature=false,cancel=false,storageFails=false,changedDuringSigning=false;
  let provisions=0,logins=0,broadcasts=0;
  let itemProtocol:unknown={registry:root,network:"testnet",rules_version:"tidebound_h1_v1",content_version:"first_light_v1"};
  const options:PrivyAccountOptions={appId:"public-app",root,items:`items.${root}`,
    storage:{getItem:k=>data.get(k)??null,setItem(k,v){if(storageFails)throw Error("storage full");data.set(k,v);events.push(JSON.parse(v).state);}},
    session:{async waitUntilReady(){},identity:()=>identity,async login(){logins++;identity=owner();},async logout(){identity=null;},async refreshUser(){if(!identity)throw Error("signed out");return identity;},async accessToken(){return identity?"private-access-token":null;},async signHash(address,hash){
      events.push("sign");signed.push({address,hash});if(cancel)throw Error("canceled");if(changedDuringSigning)identity={...owner(),id:"did:privy:different"};
      return `0x${[...(badSignature?new Uint8Array(64):key.sign(new Uint8Array(hash.slice(2).match(/../g)!.map(v=>parseInt(v,16)))).signature)].map(n=>n.toString(16).padStart(2,"0")).join("")}`;
    }},
    provider:{async getNetworkId(){return network;},async callFunction({method}:any){if(method==="get_player")return registered?account:null;if(method==="tidebound_protocol")return {registry:root,items:`items.${root}`,network:"testnet",rules_version:"tidebound_h1_v1",content_version:"first_light_v1"};if(method==="craft_protocol")return itemProtocol;throw Error("unexpected RPC");},async viewAccessKey(){return {permission:"FullAccess",nonce};}} as unknown as PrivyAccountOptions["provider"],
    async wallet(create,token){expect(token).toBe("private-access-token");creates.push(create);if(create)available=true;return {wallet:available?wallet:null};},
    async player(username,token){expect(token).toBe("private-access-token");provisions++;registered=true;return {accountId:`${username}.${root}`,root,network:"testnet"};},
    async availability(username){return {username,accountId:`${username}.${root}`,root,network:"testnet",available:true};},
  };
  const proofProvider={async getNetworkId(){return network;},async viewBlock(){return {header:{hash:baseEncode(new Uint8Array(32)),height:100}};},async sendTransactionUntil(){broadcasts++;throw Error("must never broadcast");}};
  return {options,data,events,creates,signed,proofProvider,set itemProtocol(value:unknown){itemProtocol=value},get provisions(){return provisions},get logins(){return logins},get broadcasts(){return broadcasts},set identity(value:PrivyIdentity|null){identity=value},set registered(value:boolean){registered=value},set available(value:boolean){available=value},set network(value:string){network=value},set nonce(value:bigint){nonce=value},set badSignature(value:boolean){badSignature=value},set cancel(value:boolean){cancel=value},set storageFails(value:boolean){storageFails=value},set changedDuringSigning(value:boolean){changedDuringSigning=value}};
}

test("the production Privy connection checks names through public RPC without a dynamic HTTP endpoint",async()=>{
  const f=fixture(),connection=createPrivyConnection({appId:"public-app",root,rpcUrl:"https://test.rpc.fastnear.com",relayerUrl:"https://unused.invalid"},f.options.session);
  const reads:string[]=[];
  connection.provider.getNetworkId=async()=>"testnet";
  connection.provider.callFunction=(async({method}:any)=>{reads.push(method);return true}) as typeof connection.provider.callFunction;
  connection.provider.viewAccount=async({accountId})=>{reads.push(accountId);throw new AccountDoesNotExistError(accountId,"11111111111111111111111111111111",100)};
  expect(await connection.adapter.checkUsername("player2")).toMatchObject({accountId:`player2.${root}`,available:true});
  expect(reads).toEqual(["player_name_available",`player2.${root}`]);expect(f.creates).toEqual([]);expect(f.provisions).toBe(0);
});

test("Privy creation rejects every incompatible Items protocol before wallet creation",async()=>{
  const valid={registry:root,network:"testnet",rules_version:"tidebound_h1_v1",content_version:"first_light_v1"};
  for(const field of Object.keys(valid))for(const value of [undefined,"wrong"]){
    const f=fixture();f.registered=false;f.available=false;f.itemProtocol={...valid,[field]:value};
    await expect(new PrivyAccountAdapter(f.options).provisionAccount("player1")).rejects.toThrow("compatible");
    expect(f.creates.filter(Boolean)).toHaveLength(0);expect(f.provisions).toBe(0);
  }
});

test("Privy native policy rejects access changes, sale principal, unknown methods and excess gas before saving or signing",async()=>{
  const invalid=[
    createTransaction(account,key.getPublicKey(),account,1n,[actions.deleteAccount("beneficiary.testnet")],new Uint8Array(32)),
    createTransaction(account,key.getPublicKey(),account,1n,[actions.transfer(1n)],new Uint8Array(32)),
    ...[
      actions.functionCall("buy_pet",{token_id:`mochi.${root}`},100000000000000n,10n**24n),
      actions.functionCall("tidebound_unknown",{},100000000000000n,0n),
      actions.functionCall("tidebound_commission",{},280000000000001n,0n),
    ].map(action=>createTransaction(account,key.getPublicKey(),root,1n,[action],new Uint8Array(32))),
  ];
  for(const tx of invalid){const f=fixture();await expect(new PrivyAccountAdapter(f.options).authorizeNative(tx,"blocked")).rejects.toThrow();expect(f.data.size).toBe(0);expect(f.signed).toHaveLength(0);}
});

test("restore and login resolve the same canonical wallet and named account without creation",async()=>{
  const f=fixture(),one=new PrivyAccountAdapter(f.options),two=new PrivyAccountAdapter(f.options);
  expect(await one.restoreSession()).toEqual(await two.authenticate());expect(f.creates.every(c=>!c)).toBe(true);expect(f.provisions).toBe(0);
  f.identity=null;expect(await one.restoreSession()).toBeNull();expect(f.provisions).toBe(0);
  await one.authenticate();expect(f.logins).toBe(1);expect((await one.resolveBinding())?.nearAccountId).toBe(account);
  expect(JSON.stringify([...f.data])).not.toContain("private-access-token");
});
test("an existing SDK-linked owner reuses the authoritative canonical wallet without redundant refresh requests",async()=>{
  const f=fixture(),adapter=new PrivyAccountAdapter(f.options),tx=transaction();let refreshes=0;
  f.options.session.refreshUser=async()=>{refreshes++;throw Error("synthetic SDK users/me request failed");};
  const original=JSON.stringify({operationId:"native:original-adopt",transaction:base64Encode(encodeTransaction(tx)),state:"prepared"});
  const pendingKey=`familiar.privy.authorization.v1:public-app:${root}:${account}:native:original-adopt`;
  f.data.set(pendingKey,original);
  expect((await adapter.resolveBinding())?.nearAccountId).toBe(account);
  const signed=await adapter.authorizeNative(tx,"native:original-adopt");
  expect(base64Encode(encodeTransaction(signed.transaction))).toBe(JSON.parse(original).transaction);
  expect(refreshes).toBe(0);expect(f.signed).toHaveLength(1);expect(f.provisions).toBe(0);expect(f.creates.every(c=>c===false)).toBe(true);
});
test("a missing SDK wallet link still requires a successful same-owner refresh and preserves original pending bytes on failure",async()=>{
  const f=fixture(),adapter=new PrivyAccountAdapter(f.options);f.identity={...owner(),wallets:[]};let refreshes=0;
  f.options.session.refreshUser=async()=>{refreshes++;throw Error("synthetic SDK refresh failed");};
  const original=JSON.stringify({operationId:"native:original",transaction:base64Encode(encodeTransaction(transaction())),state:"prepared"});f.data.set("original-native-envelope",original);
  await expect(adapter.authorizeNative(transaction(),"native:original")).rejects.toThrow("refresh failed");
  expect(refreshes).toBe(1);expect(f.data.get("original-native-envelope")).toBe(original);expect(f.signed).toHaveLength(0);expect(f.provisions).toBe(0);expect(f.creates).toEqual([false]);
  f.options.session.refreshUser=async()=>{refreshes++;f.identity=owner();return owner();};
  expect(await adapter.canonicalWallet(false)).toEqual(wallet);expect(refreshes).toBe(2);
});
test("a late required link refresh cannot revive the owner after sign out or alter a prepared action",async()=>{
  const f=fixture(),adapter=new PrivyAccountAdapter(f.options);f.identity={...owner(),wallets:[]};
  let release!:(value:PrivyIdentity)=>void,started!:()=>void;const began=new Promise<void>(resolve=>started=resolve);
  f.options.session.refreshUser=()=>{started();return new Promise(resolve=>release=resolve);};
  const original=JSON.stringify({operationId:"native:original",transaction:base64Encode(encodeTransaction(transaction())),state:"prepared"});f.data.set("original-native-envelope",original);
  const approval=adapter.authorizeNative(transaction(),"native:original");await began;await adapter.endSession();release(owner());
  await expect(approval).rejects.toThrow("sign-in changed");expect(await adapter.restoreSession()).toBeNull();
  expect(f.data.get("original-native-envelope")).toBe(original);expect(f.signed).toHaveLength(0);expect(f.provisions).toBe(0);
});
test("the existing-link fast path reads the current SDK links after the canonical lookup, even for the same DID",async()=>{
  const f=fixture();let refreshes=0;const lookup=f.options.wallet;
  f.options.wallet=async(...args)=>{const result=await lookup(...args);f.identity={...owner(),wallets:[]};return result;};
  f.options.session.refreshUser=async()=>{refreshes++;throw Error("current wallet link needs refresh");};
  await expect(new PrivyAccountAdapter(f.options).canonicalWallet(false)).rejects.toThrow("needs refresh");
  expect(refreshes).toBe(1);expect(f.signed).toHaveLength(0);expect(f.provisions).toBe(0);
});
test("wallet setup works without a deployed root but never creates on a restore",async()=>{
  const f=fixture();f.available=false;f.registered=false;
  const adapter=new PrivyAccountAdapter({...f.options,root:"",items:"",provider:{...f.options.provider,async getNetworkId(){throw Error("no root is needed for wallet setup");}}});
  expect(await adapter.canonicalWallet(false)).toBeNull();expect(f.creates).toEqual([false]);
  expect(await adapter.canonicalWallet(true)).toEqual(wallet);expect(f.creates).toEqual([false,true]);expect(f.provisions).toBe(0);
});
test("named creation is explicit, serialized and reuses the canonical wallet",async()=>{
  const f=fixture();f.registered=false;f.available=false;const adapter=new PrivyAccountAdapter(f.options);
  expect(await adapter.authenticate()).toBeNull();expect(f.provisions).toBe(0);expect(f.creates.every(c=>!c)).toBe(true);
  const first=adapter.provisionAccount("player1"),second=adapter.provisionAccount("player1");
  await expect(adapter.provisionAccount("different-name")).rejects.toThrow("earlier username");
  expect(await first).toEqual(await second);expect(f.provisions).toBe(1);expect(f.creates.filter(Boolean)).toHaveLength(1);
  expect(await adapter.checkUsername("player2")).toMatchObject({accountId:`player2.${root}`,available:true});
});
test("player creation stays bound to its original identity across a delayed compatibility check",async()=>{
  const f=fixture();f.registered=false;f.available=false;
  const original=f.options.provider.callFunction.bind(f.options.provider);
  let release!:()=>void,entered!:()=>void;
  const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
  f.options.provider.callFunction=(async(input:any)=>{if(input.method==="tidebound_protocol"){entered();await gate;}return original(input);}) as typeof original;
  const adapter=new PrivyAccountAdapter(f.options),creating=adapter.provisionAccount("player1").then(value=>value,error=>error);
  await started;await adapter.endSession();f.identity={...owner(),id:"did:privy:another-user"};await adapter.authenticateWallet();release();
  const result=await creating;
  expect(result).toBeInstanceOf(Error);expect(String(result)).toContain("sign-in changed");
  expect(f.creates.filter(Boolean)).toHaveLength(0);expect(f.provisions).toBe(0);expect(f.signed).toHaveLength(0);expect(f.data.size).toBe(0);
});
test("a stale setup promise cannot be shared with a different signed-in identity",async()=>{
  const f=fixture();f.registered=false;f.available=false;
  const original=f.options.provider.callFunction.bind(f.options.provider);let release!:()=>void,entered!:()=>void;
  const started=new Promise<void>(resolve=>entered=resolve),gate=new Promise<void>(resolve=>release=resolve);
  f.options.provider.callFunction=(async(input:any)=>{if(input.method==="tidebound_protocol"){entered();await gate;}return original(input);}) as typeof original;
  const adapter=new PrivyAccountAdapter(f.options),first=adapter.provisionAccount("player1").catch(error=>error);
  await started;await adapter.endSession();f.identity={...owner(),id:"did:privy:another-user"};await adapter.authenticateWallet();
  await expect(adapter.provisionAccount("player1")).rejects.toThrow("sign-in changed");release();expect(await first).toBeInstanceOf(Error);
  expect(f.provisions).toBe(0);expect(f.creates.filter(Boolean)).toHaveLength(0);
});
test("wallet creation cannot cross sign-out and sign-in while an access token is delayed",async()=>{
  const f=fixture();f.available=false;let release!:(token:string)=>void,entered!:()=>void,held=true;
  const started=new Promise<void>(resolve=>entered=resolve);
  f.options.session.accessToken=async()=>{if(held){held=false;entered();return new Promise<string>(resolve=>release=resolve);}return "private-access-token";};
  const adapter=new PrivyAccountAdapter(f.options),first=adapter.canonicalWallet(true).catch(error=>error);
  await started;await adapter.endSession();f.identity={...owner(),id:"did:privy:another-user"};await adapter.authenticateWallet();release("private-access-token");
  expect(await first).toBeInstanceOf(Error);expect(f.creates.filter(Boolean)).toHaveLength(0);expect(f.provisions).toBe(0);expect(f.signed).toHaveLength(0);
});
test("canonical ownership checks never select a first EVM wallet or accept entity-only access",()=>{
  const user=owner();user.wallets=[{...user.wallets[0]!,id:"evm-wallet",address:"0x123",chainType:"ethereum"},...user.wallets];
  expect(verifyPrivyWalletOwner(user,wallet).toString()).toBe(publicKey);
  expect(verifyPrivyWalletOwner({...owner(),wallets:[{...owner().wallets[0]!,publicKey:`00${implicitAddress}`}]},wallet).toString()).toBe(publicKey);
  for(const changed of [{userCanSign:false},{id:"other-wallet"},{imported:true},{chainType:"ethereum"},{recoveryMethod:"privy"},{publicKey:KeyPair.fromRandom("ed25519").getPublicKey().toString()}])
    expect(()=>verifyPrivyWalletOwner({...owner(),wallets:[{...owner().wallets[0]!,...changed}]},wallet)).toThrow();
  expect(()=>privyWalletKey({...wallet,implicitAddress:"0".repeat(64)})).toThrow();
});
test("native signing uses the exact SHA256 once, implicit Privy address and named NEAR signer",async()=>{
  const f=fixture(),adapter=new PrivyAccountAdapter(f.options),tx=transaction();const signed=await adapter.authorizeNative(tx,"native:one");
  expect(signed.transaction.signerId).toBe(account);expect(f.signed[0]!.address).toBe(implicitAddress);
  const digest=await nearSigningDigest(tx);expect(f.signed[0]!.hash).toBe(`0x${[...digest].map(n=>n.toString(16).padStart(2,"0")).join("")}`);
  expect(f.events.indexOf("prepared")).toBeLessThan(f.events.indexOf("sign"));
  expect((await adapter.authorizeNative(tx,"native:one")).encode()).toEqual(signed.encode());expect(f.signed).toHaveLength(1);
  await expect(adapter.authorizeNative(transaction(2n),"native:one")).rejects.toThrow("different transaction");
  adapter.markSubmitted("native:one",(await adapter.resolveBinding())!);
  await expect(adapter.authorizeNative(tx,"native:one")).rejects.toThrow("original receipt");
  expect(JSON.stringify([...f.data])).not.toMatch(/private-access-token|did:privy/);
});
test("wrong network, owner key, receiver or signature cannot authorize a native action",async()=>{
  const f=fixture(),adapter=new PrivyAccountAdapter(f.options);f.network="mainnet";
  await expect(adapter.authorizeNative(transaction(),"wrong-network")).rejects.toThrow("testnet");expect(f.signed).toHaveLength(0);
  f.network="testnet";await expect(adapter.authorizeNative(transaction(1n,"elsewhere.testnet"),"wrong-receiver")).rejects.toThrow("different account");
  f.badSignature=true;await expect(adapter.authorizeNative(transaction(),"wrong-signature")).rejects.toThrow("does not match");
  expect([...f.data.values()].every(v=>JSON.parse(v).state==="prepared")).toBe(true);
});
test("canceled approval preserves the exact original operation and storage failure prevents signing",async()=>{
  const f=fixture(),adapter=new PrivyAccountAdapter(f.options);f.cancel=true;
  await expect(adapter.authorizeNative(transaction(),"recover")).rejects.toThrow("canceled");const before=[...f.data.values()][0]!;
  f.cancel=false;await expect(adapter.authorizeNative(transaction(2n),"recover")).rejects.toThrow("different transaction");expect([...f.data.values()][0]).toBe(before);
  await adapter.authorizeNative(transaction(),"recover");expect(f.signed[0]).toEqual(f.signed[1]);
  const blocked=fixture();blocked.storageFails=true;await expect(new PrivyAccountAdapter(blocked.options).authorizeNative(transaction(),"no-durability")).rejects.toThrow("storage full");expect(blocked.signed).toHaveLength(0);
});
test("identity changes during a signature cannot become a signed or submitted action",async()=>{
  const f=fixture(),adapter=new PrivyAccountAdapter(f.options);f.changedDuringSigning=true;
  await expect(adapter.authorizeNative(transaction(),"old-owner")).rejects.toThrow("sign-in changed");expect([...f.data.values()].every(v=>JSON.parse(v).state==="prepared")).toBe(true);
  const other=fixture(),a=new PrivyAccountAdapter(other.options);await a.authorizeNative(transaction(),"signed");const binding=(await a.resolveBinding())!;await a.endSession();
  expect(await a.restoreSession()).toBeNull();expect(()=>a.markSubmitted("signed",binding)).toThrow("Sign-in ended");
});
test("sign out during the final key readback preserves the prepared envelope",async()=>{
  const f=fixture(),original=f.options.provider.viewAccessKey.bind(f.options.provider);
  f.options.provider.viewAccessKey=async(...args)=>{const access=await original(...args);if(f.signed.length)f.identity=null;return access;};
  await expect(new PrivyAccountAdapter(f.options).authorizeNative(transaction(),"readback-signout")).rejects.toThrow("sign-in changed");
  expect(f.signed).toHaveLength(1);expect([...f.data.values()].every(v=>JSON.parse(v).state==="prepared")).toBe(true);
});
test("sign-only proof verifies real Ed25519 bytes, persists before signing and has no broadcast path",async()=>{
  const f=fixture(),proof=await signPrivyRecoveryProof(wallet,f.options.session,f.proofProvider as any,f.options.storage);
  const prepared=f.events.indexOf("prepared"),signed=f.events.indexOf("sign");expect(prepared).toBeLessThan(signed);
  expect(proof).toMatchObject({kind:"signature-only",network:"testnet",walletId:wallet.walletId,verified:true,broadcast:false});
  expect(f.broadcasts).toBe(0);expect(f.signed[0]!.address).toBe(implicitAddress);
  expect(JSON.stringify(proof)).not.toMatch(/private-access-token|did:privy|@|secret|credential/);
  const digest=Uint8Array.from(proof.digestHex.slice(2).match(/../g)!.map(n=>parseInt(n,16)));
  const bytes=Uint8Array.from(proof.signatureHex.slice(2).match(/../g)!.map(n=>parseInt(n,16)));
  expect(key.getPublicKey().verify(digest,bytes)).toBe(true);
  expect(proof.transactionHash).toBe(baseEncode(digest));
});
test("sign-only proof fails closed on a non-testnet RPC or invalid owner signature",async()=>{
  const f=fixture();f.network="mainnet";await expect(signPrivyRecoveryProof(wallet,f.options.session,f.proofProvider as any,f.options.storage)).rejects.toThrow("testnet");expect(f.signed).toHaveLength(0);
  f.network="testnet";f.badSignature=true;await expect(signPrivyRecoveryProof(wallet,f.options.session,f.proofProvider as any,f.options.storage)).rejects.toThrow("does not verify");expect(f.broadcasts).toBe(0);
});
