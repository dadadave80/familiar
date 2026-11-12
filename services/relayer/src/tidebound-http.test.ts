import { expect, test } from "bun:test";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { createTideboundHttpHandler, type TideboundHttpEnvironment } from "./tidebound-http";
import type { Backend } from "./app";
import { PrivyBridgeError, type PrivyService } from "./auth/privy";

const origin="https://familiar-two.vercel.app",root="familiar-game.testnet";
const enabled:TideboundHttpEnvironment={TIDEBOUND_HTTP_ENABLED:"true",ACCOUNT_PROVIDER:"privy",NEAR_NETWORK:"testnet",NEAR_ROOT:root,RELAYER_ID:`relayer.${root}`,RELAYER_PRIVATE_KEY:"synthetic-not-a-key",PRIVY_APP_ID:"synthetic-app",PRIVY_APP_SECRET:"synthetic-not-a-credential"};
function fixture(){
  const calls:{kind:string;key?:string;username?:string;create?:boolean}[]=[];
  let ready=true;
  const wallet={walletId:"synthetic-wallet",implicitAddress:"1".repeat(64),publicKey:"ed25519:synthetic-public-key"};
  const backend:Backend={accountProvider:"privy",ready:async()=>ready,
    usernameAvailable:async username=>{calls.push({kind:"name",username});return {username,accountId:`${username}.${root}`,root,network:"testnet",available:true}},
    guest:async(key,username)=>{calls.push({kind:"player",key,username});return `existing.${root}`},
    relay:async()=>{calls.push({kind:"FORBIDDEN_RELAY"});throw Error("unreachable")},
  };
  const privy:PrivyService={wallet:async(token,create)=>{expect(token).toBe("header.payload.signature");calls.push({kind:"wallet",create});return wallet}};
  return {calls,wallet,backend,privy,set ready(value:boolean){ready=value}};
}
async function serve(environment:TideboundHttpEnvironment,f:ReturnType<typeof fixture>,work:(url:string)=>Promise<void>){
  const server=createServer(createTideboundHttpHandler({environment,backend:f.backend,privy:f.privy}));
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve)});
  try{await work(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
}
const headers={origin,"content-type":"application/json",authorization:"Bearer header.payload.signature"};
test("H1 HTTP entry is separately default-off and rejects wrong network, root, signer or provider without service calls",async()=>{
  const invalid:TideboundHttpEnvironment[]=[{},...[
    {TIDEBOUND_HTTP_ENABLED:"false"},{ACCOUNT_PROVIDER:"near-auth"},{NEAR_NETWORK:"mainnet"},{NEAR_ROOT:"legacy.testnet"},
    {RELAYER_ID:"relayer.legacy.testnet"},{RELAYER_ID:root},{RELAYER_PRIVATE_KEY:""},{PRIVY_APP_ID:""},{PRIVY_APP_SECRET:""},
  ].map(value=>({...enabled,...value}))];
  for(const environment of invalid){
    const f=fixture();await serve(environment,f,async url=>{
      for(const [path,init] of [["/api/health",{}],["/api/v1/privy/player",{method:"POST",headers,body:'{"username":"mochi"}'}]] as const){
        const response=await fetch(url+path,init);expect(response.status).toBe(503);expect(response.headers.get("cache-control")).toBe("no-store");expect(await response.text()).not.toMatch(/synthetic-not-a-key|synthetic-not-a-credential/);
      }
    });expect(f.calls).toEqual([]);
  }
  for(const wrong of ["near-auth","missing","server-signing"]){
    const f=fixture();if(wrong==="missing")delete f.backend.accountProvider;else if(wrong==="near-auth")f.backend.accountProvider="near-auth";else f.backend.authSign=async()=>({});
    await serve(enabled,f,async url=>{expect((await fetch(url+"/api/health")).status).toBe(503)});expect(f.calls).toEqual([]);
  }
});
test("H1 HTTP only exposes exact-path health, wallets and explicit Privy players",async()=>{
  const f=fixture();await serve(enabled,f,async url=>{
    for(const path of ["/health","/api/v1/guest","/api/v1/auth/sign","/api/v1/relay","/api/v1/market","/api/v1/privy/export","/api/v1/privy/raw_sign","/api/v1/privy/broadcast","/api/v1/privy/wallet/","/api/v1/privy/player?username=mochi","/api/v1/player-name/mochi","/api/v1/player-name/mochi/extra"]){expect((await fetch(url+path,{method:"POST",headers,body:"{}"})).status).toBe(404)}
    expect((await fetch(url+"/api/v1/player-name/mochi",{headers:{origin}})).status).toBe(404);
    expect((await fetch(url+"/api/v1/privy/player")).status).toBe(405);
    expect((await fetch(url+"/api/health",{method:"POST",headers,body:"{}"})).status).toBe(405);
    const health=await fetch(url+"/api/health");expect(health.status).toBe(200);expect(await health.json()).toEqual({ready:true,network:"testnet",root});
    f.ready=false;expect((await fetch(url+"/api/health")).status).toBe(503);f.ready=true;
    const restored=await fetch(url+"/api/v1/privy/wallet",{method:"POST",headers,body:'{"create":false}'});expect(await restored.json()).toEqual({wallet:f.wallet});
    const created=await fetch(url+"/api/v1/privy/wallet",{method:"POST",headers,body:'{"create":true}'});expect(created.status).toBe(200);
    const player=await fetch(url+"/api/v1/privy/player",{method:"POST",headers,body:'{"username":"mochi"}'});expect(await player.json()).toEqual({accountId:`existing.${root}`,root,network:"testnet"});expect(player.headers.get("cache-control")).toBe("no-store");
    const preflight=await fetch(url+"/api/v1/privy/player",{method:"OPTIONS",headers:{origin,"access-control-request-method":"POST","access-control-request-headers":"authorization,content-type"}});expect(preflight.status).toBe(204);expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
  });expect(f.calls).toEqual([{kind:"wallet",create:false},{kind:"wallet",create:true},{kind:"wallet",create:false},{kind:"player",key:f.wallet.publicKey,username:"mochi"}]);
});
test("H1 HTTP preserves exact-origin, session, strict-body and chunked size guards before provisioning",async()=>{
  const f=fixture();await serve(enabled,f,async url=>{
    const post=(path:string,body:string,extra:Record<string,string>={})=>fetch(url+path,{method:"POST",headers:{...headers,...extra},body});
    for(const path of ["/api/v1/privy/wallet","/api/v1/privy/player"]){
      const body=path.endsWith("wallet")?'{"create":false}':'{"username":"mochi"}';
      for(const origin of ["","https://wrong.example"])expect((await post(path,body,{origin})).status).toBe(403);
      for(const authorization of ["","Bearer invalid","Basic synthetic"])expect((await post(path,body,{authorization})).status).toBe(401);
      expect((await post(path,"{")).status).toBe(400);
      expect((await post(path,JSON.stringify({padding:"x".repeat(16_384)}))).status).toBe(413);
    }
    for(const username of ["items","Ava","p-1","nested.name"])expect((await post("/api/v1/privy/player",JSON.stringify({username}))).status).toBe(400);
    expect((await post("/api/v1/privy/player",'{"username":"mochi","publicKey":"attacker"}')).status).toBe(400);
    expect((await fetch(url+"/api/health",{headers:{origin:"https://wrong.example"}})).status).toBe(403);
    const chunked=await new Promise<number>((resolve,reject)=>{const req=httpRequest(url+"/api/v1/privy/player",{method:"POST",headers:{...headers,"transfer-encoding":"chunked"}},res=>{res.resume();res.on("end",()=>resolve(res.statusCode!))});req.on("error",reject);req.write('{"username":"');req.write("x".repeat(16_384));req.end('"}');});expect(chunked).toBe(413);
  });expect(f.calls).toEqual([]);
});
test("H1 HTTP never reads root admin credentials and sanitizes provider or readiness failures",async()=>{
  const environment={...enabled};Object.defineProperty(environment,"ROOT_PRIVATE_KEY",{get(){throw Error("Root credentials must never be read")}});
  const f=fixture();f.privy.wallet=async()=>{throw new PrivyBridgeError("ERR_PRIVY_OWNER")};f.backend.ready=async()=>{throw Error("sensitive readiness details")};
  await serve(environment,f,async url=>{
    expect((await fetch(url+"/api/health")).status).toBe(503);
    const response=await fetch(url+"/api/v1/privy/player",{method:"POST",headers,body:'{"username":"mochi"}'});expect(response.status).toBe(403);expect(await response.text()).not.toMatch(/sensitive|synthetic-not-a-key|synthetic-not-a-credential|header.payload.signature/);
  });expect(f.calls).toEqual([]);
});
