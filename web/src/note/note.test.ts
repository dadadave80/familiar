import {expect,test} from "bun:test";
import {ed25519,edwardsToMontgomeryPriv,edwardsToMontgomeryPub,x25519} from "@noble/curves/ed25519";
import {hkdf} from "@noble/hashes/hkdf";
import {sha256} from "@noble/hashes/sha256";
import {xchacha20poly1305} from "@noble/ciphers/chacha";
import * as sdk from "@nearai/inference-sdk";
import {decideSeal,NOTE_MODEL,sha256Hex} from "./seal";
import {HARBOR_NAME,NOTE_INSTRUCTIONS,noteFacts,noteMessages} from "./prompt";
import {readNote,writeSealedNote} from "./write";
import type {ReturnRecord} from "../expedition/return-record";

const hex=(b:Uint8Array)=>Buffer.from(b).toString("hex"),unhex=(s:string)=>new Uint8Array(Buffer.from(s,"hex"));
const utf8=(s:string)=>new TextEncoder().encode(s);
const concat=(...parts:Uint8Array[])=>{const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let i=0;for(const p of parts){out.set(p,i);i+=p.length;}return out;};
const kdf=(shared:Uint8Array)=>hkdf(sha256,shared,undefined,utf8("ed25519_encryption"),32);
const requestAad=(replyEd25519:Uint8Array,field:string)=>concat(utf8("nearai-e2ee-request-v3"),new Uint8Array([2]),replyEd25519,new Uint8Array([0]),utf8(field));
function open(envelope:string,modelSeed:Uint8Array,aad:Uint8Array) {
  const bytes=unhex(envelope),shared=x25519.getSharedSecret(edwardsToMontgomeryPriv(modelSeed),bytes.slice(0,32));
  return new TextDecoder().decode(xchacha20poly1305(kdf(shared),bytes.slice(32,56),aad).decrypt(bytes.slice(56)));
}
function sealTo(plaintext:string,recipientEd25519:Uint8Array,aad=new Uint8Array(),ephemeral=x25519.utils.randomPrivateKey(),nonce=crypto.getRandomValues(new Uint8Array(24))) {
  const shared=x25519.getSharedSecret(ephemeral,edwardsToMontgomeryPub(recipientEd25519));
  return hex(concat(x25519.getPublicKey(ephemeral),nonce,xchacha20poly1305(kdf(shared),nonce,aad).encrypt(utf8(plaintext))));
}

// Public Ed25519 vector from nearai/inference-proxy tests/fixtures/e2ee-v3.json (commit 724cf65, 2026-11-13).
const vector={
  model_secret:"9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",model_public:"d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  reply_public:"66be7e332c7a453332bd9d0a7f7db055f5c5ef1a06ada66d98b39fb6810c473a",ephemeral_secret:"0303030303030303030303030303030303030303030303030303030303030303",
  nonce:"000102030405060708090a0b0c0d0e0f1011121314151617",
  aad:"6e65617261692d653265652d726571756573742d76330266be7e332c7a453332bd9d0a7f7db055f5c5ef1a06ada66d98b39fb6810c473a006d657373616765735b5d2e636f6e74656e74",
  plaintext:"E2EE v3: private prompt",
  ciphertext:"5dfedd3b6bd47f6fa28ee15d969d5bb0ea53774d488bdaf9df1c6e0124b3ef22000102030405060708090a0b0c0d0e0f1011121314151617952f1029d9facf0669005cd32fc9f3682f65e17b55d57abc02aeccf35eaabf4b8efe9979121175",
};
test("the test TEE reproduces NEAR AI's official E2EE v3 Ed25519 vector",()=>{
  expect(hex(ed25519.getPublicKey(unhex(vector.model_secret)))).toBe(vector.model_public);
  const aad=requestAad(unhex(vector.reply_public),"messages[].content");
  expect(hex(aad)).toBe(vector.aad);
  expect(open(vector.ciphertext,unhex(vector.model_secret),aad)).toBe(vector.plaintext);
  expect(sealTo(vector.plaintext,unhex(vector.model_public),aad,unhex(vector.ephemeral_secret),unhex(vector.nonce))).toBe(vector.ciphertext);
  expect(()=>open(vector.ciphertext,unhex(vector.model_secret),requestAad(unhex(vector.reply_public),"messages[].name"))).toThrow();
});

const record=(patch:Partial<ReturnRecord>):ReturnRecord=>({schemaVersion:1,id:"r",operationId:"return:r",contentVersion:"first_light_v1",context:{authority:"local-preview",banked:[],lit:false,signaled:false},area:"beacon",tool:"rope",banked:[],commands:[],outcome:"returned",cargo:["lens"],disposition:"accepted",acceptedClaimId:"a".repeat(64),...patch} as ReturnRecord);
test("the model sees only the fixed harbor name and accepted return facts",()=>{
  const facts=noteFacts([record({id:"staged",disposition:"staged",cargo:["moth"]}),record({area:"wind",tool:"lantern",cargo:["vane"]}),record({}),record({outcome:"rescued",cargo:[]})]);
  expect(facts).toBe(`Harbor: ${HARBOR_NAME}.\nRecent accepted returns, newest first:\n- Beacon Court, carrying the rope. Bram brought me home safely.\n- Beacon Court, carrying the rope. I brought home the Beacon Lens.\n- Wind Gate, carrying the lantern. I brought home the Signal Vane.`);
  expect(facts).not.toContain("wind-moth");
  expect(noteMessages([record({})]).map(m=>m.role)).toEqual(["system","user"]);
  expect(NOTE_INSTRUCTIONS).toContain("she and her");
});

function teeKeys(){const seed=ed25519.utils.randomPrivateKey();return {seed,publicKey:ed25519.getPublicKey(seed),hex:hex(ed25519.getPublicKey(seed))};}
/** A local stand-in for the model TEE: decrypts v3 request fields, encrypts the reply to the client and signs both hashes. */
async function mockTee(model:ReturnType<typeof teeKeys>,requestBytes:Uint8Array,clientKeyHex:string,reply="The lens is home and the light is steady.",kind="provider_tee") {
  const body=JSON.parse(new TextDecoder().decode(requestBytes));const client=unhex(clientKeyHex);
  const plaintexts=body.messages.map((m:{content:string})=>open(m.content,model.seed,requestAad(client,"messages[].content")));
  const completion=utf8(JSON.stringify({id:"chatcmpl-local_1",object:"chat.completion",model:NOTE_MODEL,choices:[{index:0,message:{role:"assistant",content:sealTo(reply,client)},finish_reason:"stop"}]}));
  const text=`${NOTE_MODEL}:${await sha256Hex(requestBytes)}:${await sha256Hex(completion)}`;
  const signature=utf8(JSON.stringify({text,signature:hex(ed25519.sign(utf8(text),model.seed)),signing_address:model.hex,signing_algo:"ed25519",signature_kind:kind}));
  return {plaintexts,completion,signature,text};
}
test("SDK v3 encryption round-trips through a locally generated model key pair",async()=>{
  const model=teeKeys(),messages=noteMessages([record({})]);
  const prepared=await sdk.prepareE2eeChatRequest({request:new Request("https://note.invalid/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({model:NOTE_MODEL,messages,stream:false,max_tokens:120})}),modelKey:{signingAlgo:"ed25519",publicKey:model.hex}});
  const headers=prepared.request.headers,bytes=new Uint8Array(await prepared.request.clone().arrayBuffer());
  expect(headers.get("x-encryption-version")).toBe("3");expect(headers.get("x-signing-algo")).toBe("ed25519");expect(headers.get("x-model-pub-key")).toBe(model.hex);
  expect(headers.get("x-client-pub-key")).toMatch(/^[0-9a-f]{64}$/);
  const text=new TextDecoder().decode(bytes);expect(text).not.toContain("Pocket Harbor");expect(text).not.toContain("Mochi");
  const sent=JSON.parse(text);expect(Object.keys(sent).sort()).toEqual(["max_tokens","messages","model","stream"]);
  expect(JSON.stringify(sent)).toBe(text);
  const tee=await mockTee(model,bytes,headers.get("x-client-pub-key")!);
  expect(tee.plaintexts).toEqual(messages.map(m=>m.content));
  const decrypted=await (await prepared.decryptResponse(new Response(tee.completion,{headers:{"content-type":"application/json"}}))).json();
  expect(decrypted.choices[0].message.content).toBe("The lens is home and the light is steady.");
  // A second preparation uses a different one-use reply key.
  const again=await sdk.prepareE2eeChatRequest({request:new Request("https://note.invalid/v1/chat/completions",{method:"POST",body:JSON.stringify({model:NOTE_MODEL,messages})}),modelKey:{signingAlgo:"ed25519",publicKey:model.hex}});
  expect(again.request.headers.get("x-client-pub-key")).not.toBe(headers.get("x-client-pub-key"));
});

test("seal decision: sealed only for a provider_tee signature over the exact bytes by the attested key",async()=>{
  const model=teeKeys(),requestBytes=utf8('{"model":"z-ai/glm-5.3-flash"}'),client=hex(ed25519.getPublicKey(ed25519.utils.randomPrivateKey()));
  const request=utf8(JSON.stringify({model:NOTE_MODEL,messages:[{role:"user",content:sealTo("hi",model.publicKey,requestAad(unhex(client),"messages[].content"))}]}));
  const tee=await mockTee(model,request,client);
  const decide=(signatureBytes:Uint8Array|null,patch:Partial<Parameters<typeof decideSeal>[0]>={})=>decideSeal({modelId:NOTE_MODEL,requestBytes:request,responseBytes:tee.completion,signatureBytes,modelKey:model.hex,...patch});
  expect(await decide(tee.signature)).toEqual({state:"sealed"});
  const edit=(patch:Record<string,unknown>)=>utf8(JSON.stringify({...JSON.parse(new TextDecoder().decode(tee.signature)),...patch}));
  const original=JSON.parse(new TextDecoder().decode(tee.signature)).signature as string;
  const flipped=(original[0]==="0"?"1":"0")+original.slice(1);
  for(const [label,decision] of [
    ["tampered signature",await decide(edit({signature:flipped}))],
    ["wrong signed text",await decide(edit({text:`${NOTE_MODEL}:${"0".repeat(64)}:${"0".repeat(64)}`}))],
    ["gateway signature",await decide(edit({signature_kind:"gateway"}))],
    ["legacy unlabeled signature",await decide(edit({signature_kind:undefined}))],
    ["ecdsa signature",await decide(edit({signing_algo:"ecdsa"}))],
    ["other signer",await decide(tee.signature,{modelKey:teeKeys().hex})],
    ["changed request",await decide(tee.signature,{requestBytes:utf8(new TextDecoder().decode(request)+" ")})],
    ["changed response",await decide(tee.signature,{responseBytes:utf8(new TextDecoder().decode(tee.completion)+" ")})],
    ["no signature",await decide(null)],["unreadable signature",await decide(utf8("{"))],
  ] as const)expect({label,state:decision.state}).toEqual({label,state:"plain"});
  const wrongText=await decide(edit({text:"z-ai/glm-5.3:aa:bb"}));expect(wrongText.state==="plain"&&wrongText.reason).toContain("signed text");
});

/** Stubs only attestation fetch/verification; encryption, decryption and the seal decision are real. */
function flow(options:{model:ReturnType<typeof teeKeys>;relay:(bytes:Uint8Array,headers:Headers)=>Promise<Response>;keys?:string[]}) {
  const fake={
    ...sdk,
    AttestationClient:class{fetchModelMetadata=async()=>({providerType:"vllm",attestationSupported:true});fetchModelAttestations=async()=>({attestations:(options.keys??[options.model.hex,options.model.hex]).map(()=>({})),clientBinding:{nonce:"0".repeat(64)}});},
    verifyModelAttestation:(()=>{let i=0;return async()=>{const k=(options.keys??[options.model.hex,options.model.hex])[i++]!;return {signer:{signingAlgo:"ed25519",signingAddress:k},signingPublicKey:k,tcbStatus:"UpToDate"};};})(),
  } as unknown as typeof sdk;
  const calls:{url:string;headers:Headers;bytes:Uint8Array}[]=[];
  const send=(async(url:string,init:RequestInit)=>{const bytes=new Uint8Array(init.body as Uint8Array),headers=new Headers(init.headers);calls.push({url,headers,bytes});return options.relay(bytes,headers);}) as typeof fetch;
  return {calls,run:()=>writeSealedNote({returns:[record({})],token:"header.payload.signature",relayUrl:"/api",fetch:send,sdk:fake})};
}
const envelope=(completion:Uint8Array,signature:Uint8Array|null)=>Response.json({completion:Buffer.from(completion).toString("base64"),signature:signature?Buffer.from(signature).toString("base64"):null});
test("the browser flow returns sealed, plain and broken notes",async()=>{
  const model=teeKeys();
  const sealed=flow({model,relay:async(bytes,headers)=>{const tee=await mockTee(model,bytes,headers.get("x-client-pub-key")!);return envelope(tee.completion,tee.signature);}});
  const note=await sealed.run();
  expect(note).toMatchObject({state:"sealed",text:"The lens is home and the light is steady.",back:{model:NOTE_MODEL,modelKey:model.hex,instances:2,chatId:"chatcmpl-local_1"}});
  const [call]=sealed.calls;expect(call!.url).toBe("/api/v1/privy/note");expect(call!.headers.get("authorization")).toBe("Bearer header.payload.signature");
  expect(call!.headers.get("x-model-pub-key")).toBe(model.hex);expect(new TextDecoder().decode(call!.bytes)).not.toContain("Pocket Harbor");

  const tampered=flow({model,relay:async(bytes,headers)=>{const tee=await mockTee(model,bytes,headers.get("x-client-pub-key")!);return envelope(tee.completion,utf8(new TextDecoder().decode(tee.signature).replace(/"signature":"(.)/,(_,c)=>`"signature":"${c==="0"?"1":"0"}`)));}});
  expect(await tampered.run()).toMatchObject({state:"plain",text:"The lens is home and the light is steady.",back:{reason:"The signature does not verify against the attested model key."}});
  const gateway=flow({model,relay:async(bytes,headers)=>{const tee=await mockTee(model,bytes,headers.get("x-client-pub-key")!,undefined,"gateway");return envelope(tee.completion,tee.signature);}});
  expect((await gateway.run()).state).toBe("plain");
  const unsigned=flow({model,relay:async(bytes,headers)=>envelope((await mockTee(model,bytes,headers.get("x-client-pub-key")!)).completion,null)});
  expect((await unsigned.run()).state).toBe("plain");

  const refused=flow({model,relay:async()=>Response.json({code:"QUOTA",error:"Mochi is resting the pen. Try again tomorrow."},{status:429})});
  expect(await refused.run()).toMatchObject({state:"broken",back:{reason:"Mochi is resting the pen. Try again tomorrow.",code:"QUOTA"}});
  const wrongKey=flow({model,relay:async(bytes,headers)=>{const other=teeKeys(),tee=await mockTee(model,bytes,headers.get("x-client-pub-key")!);void other;const forged=utf8(new TextDecoder().decode(tee.completion).replace(/"content":"[0-9a-f]+"/,`"content":"${sealTo("forged",other.publicKey)}"`));return envelope(forged,tee.signature);}});
  expect((await wrongKey.run()).state).toBe("broken");
  const split=flow({model,keys:[model.hex,teeKeys().hex],relay:async()=>{throw Error("unreachable");}});
  expect((await split.run()).state).toBe("broken");expect(split.calls).toEqual([]);
});

test("stored notes are read only in their known shapes",()=>{
  const store=(value:string|null)=>({getItem:()=>value});
  expect(readNote(store(null),"k")).toBeNull();expect(readNote(store("{"),"k")).toBeNull();
  expect(readNote(store(JSON.stringify({state:"broken",back:{model:NOTE_MODEL}})),"k")).toBeNull();
  expect(readNote(store(JSON.stringify({state:"sealed",text:"hi",back:{model:NOTE_MODEL}})),"k")?.state).toBe("sealed");
});
