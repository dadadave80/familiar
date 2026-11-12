import { expect, test } from "bun:test";
import { createApp } from "./app";
import { KeyPair } from "near-api-js";
import { PrivyBridgeError, type PrivyService } from "./auth/privy";
test("factory funding and daily caps return sanitized stamps copy and 429", async () => {
  for (const code of ["ERR_STAMPS", "ERR_DAILY_BUDGET", "ERR_QUOTA"]) {
    const app = createApp(
      { origins: [], root: "familiar.testnet" },
      {
        guest: async () => {
          throw new Error(
            `RPC execution failed: ${code}; internal details must stay private`,
          );
        },
        relay: async () => ({ hash: "", receiptSentenceKey: "" }),
      },
    );
    const response = await app.request("/v1/guest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        publicKey: KeyPair.fromRandom("ed25519").getPublicKey().toString(),
      }),
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      code: "QUOTA",
      error: "The Post Office is out of stamps; back in a minute.",
    });
  }
});

test("configured credentials alone never report live readiness", async () => {
  const app = createApp(
    { origins: [], root: "familiar.testnet" },
    {
      ready: async () => false,
      guest: async () => "",
      relay: async () => ({ hash: "", receiptSentenceKey: "" }),
    },
  );
  expect((await app.request("/health")).status).toBe(503);
});

test("unconfigured post office pauses honestly and accepts no guest", async () => {
  const app = createApp({ origins: ["http://localhost:5173"], root: "" });
  expect((await app.request("/health")).status).toBe(503);
  const response = await app.request("/v1/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  expect(response.status).toBe(503);
  expect(await response.text()).toContain("Post Office");
});
test("rejects unapproved origins and malformed public keys before provisioning", async () => {
  let creates = 0;
  const backend = {
    guest: async () => {
      creates++;
      return "p-1.familiar.testnet";
    },
    relay: async () => ({ hash: "unused", receiptSentenceKey: "feed" }),
  };
  const app = createApp(
    { origins: ["https://play.example"], root: "familiar.testnet" },
    backend,
  );
  const denied = await app.request("/v1/guest", {
    method: "POST",
    headers: {
      origin: "https://wrong.example",
      "content-type": "application/json",
    },
    body: "{}",
  });
  expect(denied.status).toBe(403);
  const invalid = await app.request("/v1/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"publicKey":"fake"}',
  });
  expect(invalid.status).toBe(400);
  expect(creates).toBe(0);
});

test("native Auth signing requires the configured browser origin and fails closed when disabled", async () => {
  let calls = 0;
  const backend = {
    guest:async()=>"", relay:async()=>({hash:"",receiptSentenceKey:""}),
    authSign:async (_body:unknown,origin:string)=>{ calls++; return {signature:[1], origin}; },
  };
  const app = createApp({origins:["https://play.example"],root:"familiar.testnet"},backend);
  const request = (origin?:string) => app.request("/v1/auth/sign", {method:"POST",headers:{"content-type":"application/json",...(origin ? {origin}: {})},body:"{}"});
  expect((await request()).status).toBe(403);
  expect((await request("https://wrong.example")).status).toBe(403);
  const accepted = await request("https://play.example");
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({signature:[1],origin:"https://play.example"});
  expect(calls).toBe(1);
  const disabled = createApp({origins:["https://play.example"],root:"familiar.testnet"},{guest:backend.guest,relay:backend.relay});
  expect((await disabled.request("/v1/auth/sign",{method:"POST",headers:{origin:"https://play.example"},body:"{}"})).status).toBe(503);
});

test("Tidebound mode cannot silently start with legacy principal sponsorship when Auth is missing",()=>{
 const result=Bun.spawnSync({cmd:[process.execPath,"--no-env-file","services/relayer/src/index.ts"],cwd:process.cwd(),env:{...process.env,TIDEBOUND_ENABLED:"true",ACCOUNT_PROVIDER:"near-auth",NEAR_AUTH_CLIENT_ID:"",PRIVY_APP_ID:"",PRIVY_APP_SECRET:""},stdout:"pipe",stderr:"pipe"});
 expect(result.exitCode).not.toBe(0);expect(result.stderr.toString()).toContain("refusing a silent legacy sponsorship fallback");
});

test("Privy and unknown provider startup never fall back to legacy sponsorship when configuration is missing",()=>{
 for(const extra of [{ACCOUNT_PROVIDER:"privy",PRIVY_APP_ID:"fixture-app",PRIVY_APP_SECRET:""},{ACCOUNT_PROVIDER:"unknown",PRIVY_APP_ID:"",PRIVY_APP_SECRET:""}]){
  const result=Bun.spawnSync({cmd:[process.execPath,"--no-env-file","services/relayer/src/index.ts"],cwd:process.cwd(),env:{...process.env,TIDEBOUND_ENABLED:"true",NEAR_AUTH_CLIENT_ID:"",...extra},stdout:"pipe",stderr:"pipe"});
  expect(result.exitCode).not.toBe(0);expect(result.stderr.toString()).toContain("refusing a silent legacy sponsorship fallback");
 }
});

test("username availability is readonly, configured and validates before backend calls",async()=>{
 let reads=0;
 const backend={guest:async()=>"",relay:async()=>({hash:"",receiptSentenceKey:""}),usernameAvailable:async(username:string)=>{reads++;return {username,accountId:`${username}.familiar-game.testnet`,available:username!=="taken",root:"familiar-game.testnet",network:"testnet" as const}}};
 const app=createApp({origins:["https://play.example"],root:"familiar-game.testnet"},backend);
 const found=await app.request("/v1/player-name/mochi",{headers:{origin:"https://play.example"}});
 expect(found.status).toBe(200);expect(await found.json()).toMatchObject({accountId:"mochi.familiar-game.testnet",available:true});
 for(const name of ["items","p-1","one.two","Ava","x"]){expect((await app.request(`/v1/player-name/${name}`)).status).toBe(400)}
 expect(reads).toBe(1);
 const disabled=createApp({origins:[],root:"familiar-game.testnet"},{guest:backend.guest,relay:backend.relay});
 expect((await disabled.request("/v1/player-name/mochi")).status).toBe(503);
});

test("guest username is optional for legacy callers, exact for new signup, and race errors are safe",async()=>{
 const calls:{publicKey:string;username?:string}[]=[];
 const publicKey=KeyPair.fromRandom("ed25519").getPublicKey().toString();
 const app=createApp({origins:["https://play.example"],root:"familiar-game.testnet"},{guest:async(publicKey:string,username?:string)=>{calls.push({publicKey,username});if(username==="taken")throw Error("ERR_USERNAME_TAKEN private RPC details");if(username==="chain-taken")throw Error("ERR_NAME_TAKEN private receipt details");return username?`${username}.familiar-game.testnet`:"p-1.familiar-game.testnet"},relay:async()=>({hash:"",receiptSentenceKey:""})});
 const post=(username?:unknown)=>app.request("/v1/guest",{method:"POST",headers:{origin:"https://play.example","content-type":"application/json"},body:JSON.stringify({publicKey,...(username!==undefined?{username}:{})})});
 expect((await post()).status).toBe(200);
 const named=await post("mochi");expect(named.status).toBe(200);expect(await named.json()).toMatchObject({accountId:"mochi.familiar-game.testnet"});
 for(const invalid of ["items","mochi.other",null,4])expect((await post(invalid)).status).toBe(400);
 expect(calls).toHaveLength(2);
 const race=await post("taken");expect(race.status).toBe(400);expect(await race.json()).toEqual({code:"ERR_USERNAME_TAKEN",error:"That username is no longer available. Choose another name and check again."});
 const chainRace=await post("chain-taken");expect(chainRace.status).toBe(400);expect(await chainRace.json()).toEqual({code:"ERR_NAME_TAKEN",error:"That username is no longer available. Choose another name and check again."});
});

test("isolated Privy wallet spike requires exact origin, Bearer session and strict restore/create body",async()=>{
 const calls:{token:string;create:boolean}[]=[];
 const privy:PrivyService={wallet:async(token,create)=>{calls.push({token,create});return null;}};
 const app=createApp({origins:["https://play.example"],root:""},undefined,privy);
 const post=(body:unknown,origin:string|undefined="https://play.example",authorization:string|undefined="Bearer header.payload.signature")=>app.request("/v1/privy/wallet",{method:"POST",headers:{"content-type":"application/json",...(origin?{origin}:{}),...(authorization?{authorization}:{})},body:JSON.stringify(body)});
 expect((await post({create:false},"")).status).toBe(403);
 expect((await post({create:false},"https://evil.example")).status).toBe(403);
 for(const token of ["", "Basic secret", "Bearer invalid", `Bearer ${"a".repeat(17_000)}.b.c`])expect((await post({create:false},"https://play.example",token)).status).toBe(401);
 for(const invalid of [{},[],{create:"false"},{create:true,userId:"did:privy:attacker"},{create:true,owner:{user_id:"attacker"}},{create:false,publicKey:"key"}])expect((await post(invalid)).status).toBe(400);
 const restored=await post({create:false});expect(restored.status).toBe(200);expect(await restored.json()).toEqual({wallet:null});
 expect((await post({create:true})).status).toBe(200);
 expect(calls).toEqual([{token:"header.payload.signature",create:false},{token:"header.payload.signature",create:true}]);
 expect((await app.request("/health")).status).toBe(503);
 const preflight=await app.request("/v1/privy/wallet",{method:"OPTIONS",headers:{origin:"https://play.example","access-control-request-method":"POST","access-control-request-headers":"authorization,content-type"}});
 expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
});

test("Privy player provisioning uses only verified existing wallet key, requires compatible provider and preserves stable binding",async()=>{
 const root="familiar-game.testnet",publicKey=KeyPair.fromRandom("ed25519").getPublicKey().toString();let walletPresent=true;
 const restores:boolean[]=[],creates:{key:string;username?:string}[]=[];
 const privy:PrivyService={wallet:async(_token,create)=>{restores.push(create);return walletPresent?{walletId:"wallet-fixture",implicitAddress:"1".repeat(64),publicKey}:null}};
 const backend={accountProvider:"privy" as const,guest:async(key:string,username?:string)=>{creates.push({key,username});return `existing.${root}`},relay:async()=>({hash:"",receiptSentenceKey:""})};
 const app=createApp({origins:["https://play.example"],root},backend,privy);
 const post=(target=app,body:unknown={username:"mochi"})=>target.request("/v1/privy/player",{method:"POST",headers:{origin:"https://play.example",authorization:"Bearer header.payload.signature","content-type":"application/json"},body:JSON.stringify(body)});
 expect((await post()).status).toBe(200);const returning=await post(app,{username:"different"});expect(await returning.json()).toEqual({accountId:`existing.${root}`,root,network:"testnet"});
 expect(creates).toEqual([{key:publicKey,username:"mochi"},{key:publicKey,username:"different"}]);expect(restores).toEqual([false,false]);
 for(const body of [{username:"items"},{username:"mochi",publicKey},{username:"mochi",walletId:"another"}])expect((await post(app,body)).status).toBe(400);
 walletPresent=false;expect((await post()).status).toBe(409);expect(creates).toHaveLength(2);
 const offline=createApp({origins:["https://play.example"],root},undefined,privy);expect((await post(offline)).status).toBe(503);
 const legacy=createApp({origins:["https://play.example"],root},{guest:backend.guest,relay:backend.relay},privy);expect((await post(legacy)).status).toBe(503);
 const bypass=await app.request("/v1/guest",{method:"POST",headers:{origin:"https://play.example","content-type":"application/json"},body:JSON.stringify({publicKey,username:"bypass"})});expect(bypass.status).toBe(401);expect(creates).toHaveLength(2);
});

test("Privy bridge errors never expose bearer tokens, owner details or raw SDK failures",async()=>{
 for(const code of ["ERR_PRIVY_SESSION","ERR_PRIVY_OWNER","ERR_PRIVY_WALLET","ERR_PRIVY_UNAVAILABLE","ERR_PRIVY_CREATE_UNKNOWN"] as const){
  const app=createApp({origins:["https://play.example"],root:""},undefined,{wallet:async()=>{throw new PrivyBridgeError(code)}});
  const response=await app.request("/v1/privy/wallet",{method:"POST",headers:{origin:"https://play.example",authorization:"Bearer secret.payload.signature","content-type":"application/json"},body:'{"create":false}'});
  expect(response.status).toBe(code==="ERR_PRIVY_SESSION"?401:code==="ERR_PRIVY_OWNER"?403:503);
  const text=await response.text();expect(text).toContain(code);expect(text).not.toContain("secret.payload.signature");
 }
});
