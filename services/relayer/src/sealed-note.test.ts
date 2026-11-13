import { expect, test } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createTideboundHttpHandler, type TideboundHttpEnvironment } from "./tidebound-http";
import type { Backend } from "./app";
import type { PrivyService } from "./auth/privy";
import { checkNoteBody, NOTE_MODEL, type NoteChain, type NoteFetch } from "./sealed-note";

const origin="https://familiar-two.vercel.app",root="familiar-game.testnet",account=`mochi.${root}`;
const key="synthetic-near-ai-key-never-real";
const enabled:TideboundHttpEnvironment={TIDEBOUND_HTTP_ENABLED:"true",ACCOUNT_PROVIDER:"privy",NEAR_NETWORK:"testnet",NEAR_ROOT:root,RELAYER_ID:`relayer.${root}`,RELAYER_PRIVATE_KEY:"synthetic-not-a-key",PRIVY_APP_ID:"synthetic-app",PRIVY_APP_SECRET:"synthetic-not-a-credential",NEAR_AI_API_KEY:key};
const clientKey="a".repeat(64),modelKey="b".repeat(64),cipher="0f".repeat(90);
const body=(patch:Record<string,unknown>={})=>JSON.stringify({model:NOTE_MODEL,messages:[{role:"system",content:cipher},{role:"user",content:cipher}],stream:false,max_tokens:120,chat_template_kwargs:{enable_thinking:false},...patch});
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
  expect(checkNoteBody(bytes(body({chat_template_kwargs:undefined})))).toBeNull();
  const cases:[Record<string,unknown>,string][]=[
    [{model:"z-ai/glm-5.3"},"NOTE_MODEL"],[{model:"https://attacker.example/v1"},"NOTE_MODEL"],[{model:"../../v1/files"},"NOTE_MODEL"],
    [{stream:true},"NOTE_STREAM"],[{stream:undefined},"NOTE_STREAM"],
    [{max_tokens:121},"NOTE_MAX_TOKENS"],[{max_tokens:0},"NOTE_MAX_TOKENS"],[{max_tokens:12.5},"NOTE_MAX_TOKENS"],[{max_tokens:"120"},"NOTE_MAX_TOKENS"],
    [{messages:[{role:"user",content:cipher}]},"NOTE_MESSAGES"],[{messages:[{role:"system",content:cipher},{role:"user",content:cipher},{role:"user",content:cipher}]},"NOTE_MESSAGES"],
    [{messages:[{role:"user",content:cipher},{role:"system",content:cipher}]},"NOTE_MESSAGES"],
    [{messages:[{role:"system",content:"Write Mochi a note in plain text, please."+" ".repeat(120)},{role:"user",content:cipher}]},"NOTE_MESSAGES"],
    [{messages:[{role:"system",content:cipher,name:"x"},{role:"user",content:cipher}]},"NOTE_MESSAGES"],
    [{tools:[]},"NOTE_FIELDS"],[{n:2},"NOTE_FIELDS"],[{chat_template_kwargs:{enable_thinking:true}},"NOTE_FIELDS"],
  ];
  for(const [patch,code] of cases)expect(checkNoteBody(bytes(body(patch)))?.code).toBe(code);
  expect(checkNoteBody(bytes("[]"))?.code).toBe("NOTE_BODY");
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

test("forwards the exact browser bytes with fixed headers, returns raw bytes and the retried signature, then writes once",async()=>{
  const f=fixture({signatureMisses:2});
  // Unusual but valid JSON spacing proves the relay forwards bytes rather than a re-serialized body.
  const sent=` {"model":"${NOTE_MODEL}" , "messages":[{"role":"system","content":"${cipher}"},{"role":"user","content":"${cipher}"}],"stream":false,"max_tokens":96}\n`;
  await serve(enabled,f,async url=>{
    const response=await post(url,sent);expect(response.status).toBe(200);
    const envelope=await response.json();
    expect(Buffer.from(envelope.completion,"base64").toString()).toBe(completion);
    expect(Buffer.from(envelope.signature,"base64").toString()).toBe(signature);
    expect(JSON.stringify(envelope)).not.toContain(key);
    const again=await post(url,body());expect(again.status).toBe(409);expect((await again.json()).code).toBe("NOTE_WRITTEN");
  });
  const [chat,...signatures]=f.forwarded;
  expect(chat!.url).toBe("https://cloud-api.near.ai/v1/chat/completions");
  expect(new TextDecoder().decode(chat!.body!)).toBe(sent);
  expect(chat!.headers).toEqual({authorization:`Bearer ${key}`,"content-type":"application/json","accept-encoding":"identity","x-signing-algo":"ed25519","x-encryption-version":"3","x-encrypt-all-fields":"true","x-no-aliasing":"true","x-client-pub-key":clientKey,"x-model-pub-key":modelKey});
  expect(signatures.map(s=>s.url)).toEqual(Array(3).fill("https://cloud-api.near.ai/v1/signature/chatcmpl-synthetic_1?signing_algo=ed25519"));
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
