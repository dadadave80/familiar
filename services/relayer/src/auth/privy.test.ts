import { expect, spyOn, test } from "bun:test";
import { KeyPair } from "near-api-js";
import { PrivyClient } from "@privy-io/node";
import { createPrivyBridge, createPrivyService, privyExternalId, type PrivyBoundary } from "./privy";

// Synthetic SDK-boundary fixtures: these tests do not contact Privy or demonstrate device recovery.
function fixture(){
  const appId="fixture-app",userId="did:privy:fixture-user",externalId=privyExternalId(appId,userId);
  const key=KeyPair.fromRandom("ed25519").getPublicKey(),hex=Buffer.from(key.data).toString("hex");
  let stored:unknown=null,creates=0,gets=0,userReads=0,outage=false,createFailure=false,commitBeforeFailure=false;
  const inputs:unknown[]=[];
  const wallet={id:"wallet-fixture",owner_id:"quorum-user",chain_type:"near",external_id:externalId,public_key:`0x${hex}`,address:hex};
  const link={id:wallet.id,type:"wallet",chain_type:"near",wallet_client_type:"privy",connector_type:"embedded",user_can_sign:true,public_key:`0x${hex}`,address:hex};
  const user:{id:string;linked_accounts:unknown[]}={id:userId,linked_accounts:[]};
  const claims={app_id:appId,user_id:userId,issuer:"privy.io",issued_at:Math.floor(Date.now()/1000)-1,expiration:Math.floor(Date.now()/1000)+60,session_id:"session-fixture"};
  const boundary:PrivyBoundary={
    async verifyAccessToken(token){expect(token).toBe("verified-fixture-token");return claims;},
    async getWallet(id){gets++;expect(id).toBe(externalId);if(outage)throw Error("private outage");return stored;},
    async createWallet(input){creates++;inputs.push(input);await Bun.sleep(5);if(commitBeforeFailure){stored=wallet;user.linked_accounts=[link];}if(createFailure)throw Error("private HTTP conflict or timeout");stored=wallet;user.linked_accounts=[link];return wallet;},
    async getUser(id){expect(id).toBe(userId);userReads++;return user;},
  };
  return {appId,userId,externalId,key,hex,wallet,link,user,claims,inputs,boundary,service:createPrivyService(appId,boundary),
    store:(value:unknown)=>{stored=value;if(value)user.linked_accounts=[link]},failRead:()=>{outage=true},failCreate:(committed:boolean)=>{createFailure=true;commitBeforeFailure=committed},
    counts:()=>({creates,gets,userReads})};
}
test("Privy restore never creates; explicit concurrent creates converge to one stable user-owned key",async()=>{
  const f=fixture();
  expect(await f.service.wallet("verified-fixture-token",false)).toBeNull();expect(f.counts()).toEqual({creates:0,gets:1,userReads:0});
  const [a,b]=await Promise.all([f.service.wallet("verified-fixture-token",true),f.service.wallet("verified-fixture-token",true)]);
  expect(a).toEqual(b);expect(a).toEqual({walletId:f.wallet.id,implicitAddress:f.hex,publicKey:f.key.toString()});expect(f.counts().creates).toBe(1);
  expect(f.inputs).toEqual([{chain_type:"near",owner:{user_id:f.userId},external_id:f.externalId,idempotency_key:f.externalId}]);
  expect(await f.service.wallet("verified-fixture-token",false)).toEqual(a);expect(f.counts().creates).toBe(1);
});
test("Privy external identity is app/user/chain stable and independent of game root/network",()=>{
  const f=fixture();expect(f.externalId).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
  expect(privyExternalId(f.appId,f.userId)).toBe(f.externalId);
  expect(privyExternalId("another-app",f.userId)).not.toBe(f.externalId);
  expect(privyExternalId(f.appId,"did:privy:another-user")).not.toBe(f.externalId);
});
test("Privy restores the actual NEAR tagged Ed25519 encoding while preserving address and owner verification",async()=>{
  for(const prefix of ["","0x"]){
    const f=fixture();f.wallet.public_key=`${prefix}00${f.hex}`;f.link.public_key=`${prefix}00${f.hex}`;f.store(f.wallet);
    expect(await f.service.wallet("verified-fixture-token",false)).toEqual({walletId:f.wallet.id,implicitAddress:f.hex,publicKey:f.key.toString()});expect(f.counts().creates).toBe(0);
  }
  for(const wrong of ["01","short","long","address","owner"]){
    const f=fixture();f.wallet.public_key=`00${f.hex}`;f.link.public_key=`00${f.hex}`;
    if(wrong==="01")f.wallet.public_key=`01${f.hex}`;
    if(wrong==="short")f.wallet.public_key=`00${f.hex.slice(4)}`;
    if(wrong==="long")f.wallet.public_key=`00${f.hex}00`;
    if(wrong==="address")f.wallet.address="0".repeat(64);
    if(wrong==="owner")f.link.user_can_sign=false;
    f.store(f.wallet);await expect(f.service.wallet("verified-fixture-token",false)).rejects.toThrow("ERR_PRIVY_");expect(f.counts().creates).toBe(0);
  }
});
test("Privy token claims and wrong user records fail before exposing a key",async()=>{
  for(const wrong of ["app","issuer","expired","future","did","record"]){
    const f=fixture();f.store(f.wallet);
    if(wrong==="app")f.claims.app_id="other-app";
    if(wrong==="issuer")f.claims.issuer="untrusted.example";
    if(wrong==="expired")f.claims.expiration=0;
    if(wrong==="future")f.claims.issued_at=Math.floor(Date.now()/1000)+1000;
    if(wrong==="did")f.claims.user_id="email@example.com";
    if(wrong==="record")f.user.id="did:privy:other-user";
    await expect(f.service.wallet("verified-fixture-token",false)).rejects.toThrow(wrong==="record"?"ERR_PRIVY_OWNER":"ERR_PRIVY_SESSION");
    expect(f.counts().creates).toBe(0);
  }
  const f=fixture();f.boundary.verifyAccessToken=async()=>{throw Error("unverified jwt details")};
  await expect(f.service.wallet("invalid",true)).rejects.toThrow("ERR_PRIVY_SESSION");expect(f.counts().gets).toBe(0);
});
test("Privy requires unilateral user signing ownership; entity attribution and another linked wallet never suffice",async()=>{
  for(const wrong of ["entity-only","owner-null","wrong-link","external","chain","key","address","linked-key","linked-address","client","archived"]){
    const f=fixture();const wallet:Record<string,unknown>={...f.wallet};f.store(wallet);
    if(wrong==="entity-only"){f.link.user_can_sign=false;wallet.entity={type:"user",id:f.userId};}
    if(wrong==="owner-null")wallet.owner_id=null;
    if(wrong==="wrong-link")f.link.id="another-wallet";
    if(wrong==="external")wallet.external_id="another-external-id";
    if(wrong==="chain")wallet.chain_type="solana";
    if(wrong==="key")wallet.public_key="0x01";
    if(wrong==="address")wallet.address="0".repeat(64);
    if(wrong==="linked-key")f.link.public_key=`0x${"01".repeat(32)}`;
    if(wrong==="linked-address")f.link.address="0".repeat(64);
    if(wrong==="client")f.link.wallet_client_type="another-provider";
    if(wrong==="archived")wallet.archived_at=1;
    await expect(f.service.wallet("verified-fixture-token",false)).rejects.toThrow("ERR_PRIVY_");expect(f.counts().creates).toBe(0);
  }
});
test("Privy indeterminate creation recovers only its original external ID; outages never become missing wallets",async()=>{
  const recovered=fixture();recovered.failCreate(true);
  expect(await recovered.service.wallet("verified-fixture-token",true)).toMatchObject({walletId:recovered.wallet.id});expect(recovered.counts().creates).toBe(1);
  const unknown=fixture();unknown.failCreate(false);
  await expect(unknown.service.wallet("verified-fixture-token",true)).rejects.toThrow("ERR_PRIVY_CREATE_UNKNOWN");
  expect(await unknown.service.wallet("verified-fixture-token",false)).toBeNull();expect(unknown.counts().creates).toBe(1);
  const offline=fixture();offline.failRead();
  await expect(offline.service.wallet("verified-fixture-token",true)).rejects.toThrow("ERR_PRIVY_UNAVAILABLE");expect(offline.counts().creates).toBe(0);
});
test("Privy preserves an existing noncanonical NEAR wallet and never interprets malformed lookup data as absence",async()=>{
  const existing=fixture();existing.user.linked_accounts=[{...existing.link,id:"earlier-wallet"}];
  expect(await existing.service.wallet("verified-fixture-token",false)).toBeNull();
  await expect(existing.service.wallet("verified-fixture-token",true)).rejects.toThrow("ERR_PRIVY_WALLET");expect(existing.counts().creates).toBe(0);
  for(const malformed of [false,undefined,0,[],{}]){
    const f=fixture();f.store(malformed);await expect(f.service.wallet("verified-fixture-token",true)).rejects.toThrow("ERR_PRIVY_WALLET");expect(f.counts().creates).toBe(0);
  }
  const otherChains=fixture();otherChains.user.linked_accounts=[{...otherChains.link,chain_type:"ethereum"},{...otherChains.link,chain_type:"solana"}];
  expect(await otherChains.service.wallet("verified-fixture-token",true)).toMatchObject({publicKey:otherChains.key.toString()});expect(otherChains.counts().creates).toBe(1);
});
test("production bridge uses official token verification and exact external-ID lookup without a server signing capability",async()=>{
  const f=fixture(),calls:string[]=[];let stored:unknown=null;
  // These SDK service stubs intentionally have no rawSign, rpc, export, transfer or update methods.
  const mocks=[
    spyOn(PrivyClient.prototype,"utils").mockReturnValue({auth:()=>({verifyAccessToken:async(token:string)=>{calls.push("verify");expect(token).toBe("owner-access-token");return f.claims}})} as ReturnType<PrivyClient["utils"]>),
    spyOn(PrivyClient.prototype,"wallets").mockReturnValue({
      get:async(id:string)=>{calls.push("lookup");expect(id).toBe(`ext_wal_${f.externalId}`);return stored;},
      create:async(input:unknown)=>{calls.push("create");expect(input).toEqual({chain_type:"near",owner:{user_id:f.userId},external_id:f.externalId,idempotency_key:f.externalId});stored=f.wallet;f.user.linked_accounts=[f.link];return stored;},
    } as unknown as ReturnType<PrivyClient["wallets"]>),
    spyOn(PrivyClient.prototype,"users").mockReturnValue({_get:async(id:string)=>{calls.push("user");expect(id).toBe(f.userId);return f.user;}} as unknown as ReturnType<PrivyClient["users"]>),
  ];
  try{
    const service=createPrivyBridge({appId:f.appId,appSecret:"synthetic-not-a-credential"});
    expect(await service.wallet("owner-access-token",false)).toBeNull();
    expect(await service.wallet("owner-access-token",true)).toMatchObject({publicKey:f.key.toString()});
    expect(calls).toEqual(["verify","lookup","verify","lookup","user","create","user"]);
  }finally{for(const mock of mocks)mock.mockRestore();}
});
test("actual Privy SDK sends the stable idempotency key as a header and excludes it from the wallet JSON",async()=>{
  const f=fixture();let created=false;const requests:{method:string;path:string;body:unknown;idempotency:string|null}[]=[];
  const verifier=spyOn(PrivyClient.prototype,"utils").mockReturnValue({auth:()=>({verifyAccessToken:async()=>f.claims})} as unknown as ReturnType<PrivyClient["utils"]>);
  try {
    const service=createPrivyBridge({appId:f.appId,appSecret:"synthetic-not-a-credential"},{fetch:async(input,init)=>{
      const request=new Request(input,init),path=new URL(request.url).pathname;
      const body=request.method==="POST"?await request.json():null;
      requests.push({method:request.method,path,body,idempotency:request.headers.get("privy-idempotency-key")});
      if(request.method==="GET"&&path===`/v1/wallets/ext_wal_${f.externalId}`)return Response.json(created?f.wallet:{error:"not found"},{status:created?200:404});
      if(request.method==="GET"&&decodeURIComponent(path)===`/v1/users/${f.userId}`)return Response.json({...f.user,linked_accounts:created?[f.link]:[]});
      if(request.method==="POST"&&path==="/v1/wallets"){created=true;return Response.json(f.wallet);}
      throw Error("Unexpected synthetic HTTP request");
    }});
    expect(await service.wallet("synthetic.owner.jwt",true)).toMatchObject({walletId:f.wallet.id});
    const create=requests.filter(request=>request.method==="POST");
    expect(create).toEqual([{method:"POST",path:"/v1/wallets",idempotency:f.externalId,body:{chain_type:"near",owner:{user_id:f.userId},external_id:f.externalId}}]);
    expect(requests).toHaveLength(4);
  }finally{verifier.mockRestore();}
});
