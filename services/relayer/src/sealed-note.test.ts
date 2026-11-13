import { expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createTideboundHttpHandler, type TideboundHttpEnvironment } from "./tidebound-http";
import type { Backend } from "./app";
import type { PrivyService } from "./auth/privy";
import { checkNoteBody, createNoteRelay, NOTE_DEADLINE_MS, NOTE_MODEL, SIGNATURE_WINDOW_MS, type NoteChain, type NoteFetch } from "./sealed-note";

const origin="https://familiar-two.vercel.app",root="familiar-game.testnet",account=`mochi.${root}`;
const key="synthetic-near-ai-key-never-real";
const enabled:TideboundHttpEnvironment={TIDEBOUND_HTTP_ENABLED:"true",ACCOUNT_PROVIDER:"privy",NEAR_NETWORK:"testnet",NEAR_ROOT:root,RELAYER_ID:`relayer.${root}`,RELAYER_PRIVATE_KEY:"synthetic-not-a-key",PRIVY_APP_ID:"synthetic-app",PRIVY_APP_SECRET:"synthetic-not-a-credential",NEAR_AI_API_KEY:key};
const clientKey="a".repeat(64),modelKey="b".repeat(64),cipher="0f".repeat(90);
const body=(patch:Record<string,unknown>={})=>JSON.stringify({model:NOTE_MODEL,messages:[{role:"system",content:cipher},{role:"user",content:cipher}],stream:false,max_tokens:120,thinking_token_budget:0,...patch});
const completion='{"id":"chatcmpl-synthetic_1","object":"chat.completion","model":"z-ai/glm-5.3-flash","choices":[{"index":0,"message":{"role":"assistant","content":"00ff"}}]}';
const signature='{"text":"z-ai/glm-5.3-flash:aa:bb","signature":"cc","signing_address":"dd","signing_algo":"ed25519","signature_kind":"provider_tee"}';

function fixture(options:{claims?:number;player?:string|null;signatureMisses?:number;upstreamStatus?:number}={}) {
  const forwarded:{url:string;method:string;headers:Record<string,string>;body:Uint8Array|null}[]=[];
  let misses=options.signatureMisses??0;
  const noteFetch:NoteFetch=async(url,init)=>{
    forwarded.push({url,method:init.method!,headers:Object.fromEntries(new Headers(init.headers).entries()),body:init.body?new Uint8Array(init.body as Uint8Array):null});
    if(url.endsWith("/chat/completions"))return new Response(completion,{status:options.upstreamStatus??200});
    if(misses-->0)return new Response('{"error_code":"not_found","message":"Chat id not found or expired"}',{status:404});
    return new Response(signature,{status:200});
  };
  const views:string[]=[];
  const noteChain:NoteChain={player:async publicKey=>{views.push(`player:${publicKey}`);return options.player===undefined?account:options.player},confirmedClaims:async id=>{views.push(`journey:${id}`);return options.claims??1}};
  const backend:Backend={accountProvider:"privy",ready:async()=>true,guest:async()=>{throw Error("unreachable")},relay:async()=>{throw Error("unreachable")}};
  const privy:PrivyService={wallet:async(token,create)=>{expect(token).toBe("header.payload.signature");expect(create).toBe(false);return {walletId:"w",implicitAddress:"1".repeat(64),publicKey:"ed25519:synthetic"}}};
  return {forwarded,views,noteFetch,noteChain,backend,privy};
}
async function serve(environment:TideboundHttpEnvironment,f:ReturnType<typeof fixture>,work:(url:string)=>Promise<void>){
  const server=createServer(createTideboundHttpHandler({environment,backend:f.backend,privy:f.privy,noteChain:f.noteChain,noteFetch:f.noteFetch}));
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve)});
  try{await work(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
}
const headers={origin,"content-type":"application/json",authorization:"Bearer header.payload.signature","x-client-pub-key":clientKey,"x-model-pub-key":modelKey};
const post=(url:string,text:string,extra:Record<string,string>={})=>fetch(url+"/api/v1/privy/note",{method:"POST",headers:{...headers,...extra},body:text});

test("plain-field checks reject the wrong model, streaming, budget, message shape, extra fields and size",()=>{
  const bytes=(text:string)=>new TextEncoder().encode(text);
  expect(checkNoteBody(bytes(body()))).toBeNull();
  expect(checkNoteBody(bytes(body({thinking_token_budget:undefined})))).toBeNull();
  const cases:[Record<string,unknown>,string][]=[
    [{model:"z-ai/glm-5.3"},"NOTE_MODEL"],[{model:"https://attacker.example/v1"},"NOTE_MODEL"],[{model:"../../v1/files"},"NOTE_MODEL"],
    [{stream:true},"NOTE_STREAM"],[{stream:undefined},"NOTE_STREAM"],
    [{max_tokens:121},"NOTE_MAX_TOKENS"],[{max_tokens:0},"NOTE_MAX_TOKENS"],[{max_tokens:12.5},"NOTE_MAX_TOKENS"],[{max_tokens:"120"},"NOTE_MAX_TOKENS"],
    [{messages:[{role:"user",content:cipher}]},"NOTE_MESSAGES"],[{messages:[{role:"system",content:cipher},{role:"user",content:cipher},{role:"user",content:cipher}]},"NOTE_MESSAGES"],
    [{messages:[{role:"user",content:cipher},{role:"system",content:cipher}]},"NOTE_MESSAGES"],
    [{messages:[{role:"system",content:"Write Mochi a note in plain text, please."+" ".repeat(120)},{role:"user",content:cipher}]},"NOTE_MESSAGES"],
    [{messages:[{role:"system",content:cipher,name:"x"},{role:"user",content:cipher}]},"NOTE_MESSAGES"],
    [{tools:[]},"NOTE_FIELDS"],[{n:2},"NOTE_FIELDS"],[{thinking_token_budget:null},"NOTE_FIELDS"],[{thinking_token_budget:8192},"NOTE_FIELDS"],[{chat_template_kwargs:{enable_thinking:false}},"NOTE_FIELDS"],
  ];
  for(const [patch,code] of cases)expect(checkNoteBody(bytes(body(patch)))?.code).toBe(code);
  expect(checkNoteBody(bytes("[]"))?.code).toBe("NOTE_BODY");
  for(const twisted of [body().replace('"max_tokens":120','"max_tokens":100000,"max_tokens":120'),body().replace('"stream":false','"stream":true,"stream":false'),
    body().replace(`"model":"${NOTE_MODEL}"`,`"model":"z-ai/glm-5.3","model":"${NOTE_MODEL}"`),` ${body()}`,`${body()}\n`,body().replace('"stream":false','"stream" : false'),body().replace("glm","gl\\u006d")])
    expect(checkNoteBody(bytes(twisted))?.code).toBe("NOTE_BODY");
  expect(checkNoteBody(bytes("{"))?.code).toBe("NOTE_BODY");
  expect(checkNoteBody(bytes(body({messages:[{role:"system",content:"0f".repeat(4000)},{role:"user",content:cipher}]})))).toEqual({status:413,code:"NOTE_TOO_LARGE"});
});

test("note endpoint is off without NEAR_AI_API_KEY and leaves the other account endpoints unchanged",async()=>{
  const {NEAR_AI_API_KEY:_,...withoutKey}=enabled;
  const f=fixture();await serve(withoutKey,f,async url=>{
    const response=await post(url,body());expect(response.status).toBe(503);expect((await response.json()).code).toBe("NOTE_DISABLED");
    expect((await fetch(url+"/api/health")).status).toBe(200);
  });expect(f.forwarded).toEqual([]);expect(f.views).toEqual([]);
  const g=fixture();await serve({...enabled,TIDEBOUND_HTTP_ENABLED:"false"},g,async url=>{expect((await post(url,body())).status).toBe(503)});expect(g.forwarded).toEqual([]);
});

test("note endpoint keeps exact path, method, origin, session and size guards before any chain or NEAR AI call",async()=>{
  const f=fixture();await serve(enabled,f,async url=>{
    for(const path of ["/api/v1/privy/note/","/api/v1/privy/note?model=x","/api/v1/note","/api/v1/privy/notes"])expect((await fetch(url+path,{method:"POST",headers,body:body()})).status).toBe(404);
    expect((await fetch(url+"/api/v1/privy/note")).status).toBe(405);
    for(const bad of ["","https://wrong.example"])expect((await post(url,body(),{origin:bad})).status).toBe(403);
    for(const authorization of ["","Bearer nope","Basic x"])expect((await post(url,body(),{authorization})).status).toBe(401);
    expect((await post(url,JSON.stringify({padding:"x".repeat(16_384)}))).status).toBe(413);
    expect((await post(url,body({stream:true}))).status).toBe(400);
    for(const bad of [{"x-client-pub-key":"A".repeat(64)},{"x-model-pub-key":"b".repeat(63)},{"x-client-pub-key":""}] as Record<string,string>[])expect((await post(url,body(),bad)).status).toBe(400);
    const preflight=await fetch(url+"/api/v1/privy/note",{method:"OPTIONS",headers:{origin,"access-control-request-method":"POST","access-control-request-headers":"authorization,content-type,x-client-pub-key,x-model-pub-key"}});
    expect(preflight.status).toBe(204);expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);
    expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("x-model-pub-key");
  });expect(f.forwarded).toEqual([]);expect(f.views).toEqual([]);
});

test("requires a confirmed journey event for the server-derived account",async()=>{
  for(const options of [{claims:0},{player:null}]){
    const f=fixture(options);await serve(enabled,f,async url=>{const response=await post(url,body());expect(response.status).toBe(409);expect((await response.json()).code).toBe("NOTE_NO_EVENT");});
    expect(f.forwarded).toEqual([]);
  }
});

test("forwards the exact browser bytes with fixed headers, returns raw bytes and the retried signature, and allows a retry",async()=>{
  const f=fixture({signatureMisses:1});
  // Unusual key order proves the relay forwards bytes rather than a rebuilt body.
  const sent=`{"max_tokens":96,"stream":false,"messages":[{"content":"${cipher}","role":"system"},{"content":"${cipher}","role":"user"}],"model":"${NOTE_MODEL}"}`;
  await serve(enabled,f,async url=>{
    const response=await post(url,sent);expect(response.status).toBe(200);
    const envelope=await response.json();
    expect(Buffer.from(envelope.completion,"base64").toString()).toBe(completion);
    expect(Buffer.from(envelope.signature,"base64").toString()).toBe(signature);
    expect(JSON.stringify(envelope)).not.toContain(key);
    expect((await post(url,body())).status).toBe(200);
  });
  const [chat,...rest]=f.forwarded;
  const signatures=rest.slice(0,2);
  expect(rest.length).toBe(4);
  expect(chat!.url).toBe("https://cloud-api.near.ai/v1/chat/completions");
  expect(new TextDecoder().decode(chat!.body!)).toBe(sent);
  expect(chat!.headers).toEqual({authorization:`Bearer ${key}`,"content-type":"application/json","accept-encoding":"identity","x-signing-algo":"ed25519","x-encryption-version":"3","x-encrypt-all-fields":"true","x-no-aliasing":"true","x-client-pub-key":clientKey,"x-model-pub-key":modelKey});
  expect(signatures.map(s=>s.url)).toEqual(Array(2).fill("https://cloud-api.near.ai/v1/signature/chatcmpl-synthetic_1?signing_algo=ed25519"));
  expect(signatures.every(s=>s.method==="GET"&&s.headers.authorization===`Bearer ${key}`&&!("x-client-pub-key" in s.headers))).toBe(true);
  expect(f.views).toEqual([`player:ed25519:synthetic`,`journey:${account}`,`player:ed25519:synthetic`,`journey:${account}`]);
});

test("a failed upstream call releases the note; repeated attempts hit the per-account rate limit",async()=>{
  const f=fixture({upstreamStatus:500});
  await serve(enabled,f,async url=>{
    for(let i=0;i<3;i++){const response=await post(url,body());expect(response.status).toBe(502);expect(await response.text()).not.toContain(key);}
    const limited=await post(url,body());expect(limited.status).toBe(429);
  });
  expect(f.forwarded.filter(r=>r.url.endsWith("/chat/completions")).length).toBe(3);
});

const direct=(fetch:NoteFetch,options:{now?:()=>number;completionTimeoutMs?:number;signatureWindowMs?:number;signatureDelayMs?:number;chain?:NoteChain}={})=>
  createNoteRelay({apiKey:key,chain:{player:async()=>account,confirmedClaims:async()=>1},fetch,...options});
const input={walletPublicKey:"ed25519:synthetic",bytes:new TextEncoder().encode(body()) as Uint8Array<ArrayBuffer>,clientPublicKey:clientKey,modelPublicKey:modelKey};
const answers:NoteFetch=async url=>new Response(url.endsWith("/chat/completions")?completion:signature);

test("allows three notes per account per UTC day across hourly windows, then resets the next day",async()=>{
  let clock=Date.parse("2026-11-14T00:30:00Z");
  const relay=direct(answers,{now:()=>clock});
  for(let i=0;i<3;i++)expect((await relay.write(input)).status).toBe(200);
  expect((await relay.write(input)).status).toBe(429);
  clock=Date.parse("2026-11-14T22:00:00Z");
  const daily=await relay.write(input);expect(daily.status).toBe(429);expect(daily.body).toMatchObject({code:"QUOTA_DAY"});
  clock=Date.parse("2026-11-15T00:01:00Z");
  expect((await relay.write(input)).status).toBe(200);
});

test("a hung completion times out as a retryable upstream failure",async()=>{
  const hang:NoteFetch=(_url,init)=>new Promise((_,reject)=>init.signal!.addEventListener("abort",()=>reject(init.signal!.reason)));
  const started=Date.now();
  const result=await direct(hang,{completionTimeoutMs:50}).write(input);
  expect(result).toMatchObject({status:502,body:{code:"NOTE_UPSTREAM"}});
  expect(Date.now()-started).toBeLessThan(1_000);
});

test("signature polling stops at its window and returns the completion without a signature",async()=>{
  let polls=0;
  const missing:NoteFetch=async url=>{if(url.endsWith("/chat/completions"))return new Response(completion);polls++;return new Response("{}",{status:404});};
  const started=Date.now();
  const result=await direct(missing,{signatureWindowMs:120,signatureDelayMs:20}).write(input);
  expect(result.status).toBe(200);expect((result.body as {signature:unknown}).signature).toBeNull();
  expect(polls).toBeGreaterThan(2);expect(Date.now()-started).toBeLessThan(1_000);
});

test("a refusal by the hourly cap never uses up the next day's notes",async()=>{
  let clock=Date.parse("2026-11-14T23:50:00Z");
  const relay=direct(answers,{now:()=>clock});
  for(let i=0;i<3;i++)expect((await relay.write(input)).status).toBe(200);
  clock=Date.parse("2026-11-15T00:10:00Z");
  for(let i=0;i<5;i++){const refused=await relay.write(input);expect(refused.status).toBe(429);expect(refused.body).toMatchObject({code:"QUOTA"});}
  clock=Date.parse("2026-11-15T01:00:00Z");
  for(let i=0;i<3;i++)expect((await relay.write(input)).status).toBe(200);
});

test("a stalled register read is refused before any note is charged or sent",async()=>{
  let sent=0;
  const counting:NoteFetch=async url=>{sent++;return new Response(url.endsWith("/chat/completions")?completion:signature);};
  const stalled:NoteChain={player:()=>new Promise(()=>{}),confirmedClaims:async()=>1};
  const relay=createNoteRelay({apiKey:key,chain:stalled,fetch:counting});
  const late=await relay.write({...input,startedAt:Date.now()-NOTE_DEADLINE_MS+20});
  expect(late.status).toBe(503);expect(late.body).toMatchObject({code:"NOTE_CHAIN"});expect(sent).toBe(0);
});

test("a request that starts too late for a full completion is refused without charging",async()=>{
  let sent=0;
  const counting:NoteFetch=async url=>{sent++;return new Response(url.endsWith("/chat/completions")?completion:signature);};
  const relay=direct(counting);
  const late=await relay.write({...input,startedAt:Date.now()-NOTE_DEADLINE_MS+SIGNATURE_WINDOW_MS+1_000});
  expect(late.status).toBe(503);expect(sent).toBe(0);
  for(let i=0;i<3;i++)expect((await relay.write(input)).status).toBe(200);
});
