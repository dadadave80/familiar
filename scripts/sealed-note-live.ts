// One live sealed note: real attestation, SDK E2EE, the relay's exact forwarding code and the browser seal decision.
// Spends one NEAR AI chat completion. Pass only the key: `bun --env-file=<private env> scripts/sealed-note-live.ts`.
// The player identity and journey eligibility are local stand-ins; no Privy, NEAR RPC or signing is used.
import { createNoteRelay } from "../services/relayer/src/sealed-note";
import { writeSealedNote } from "../web/src/note/write";
import type { ReturnRecord } from "../web/src/expedition/return-record";

const apiKey=process.env.NEAR_AI_API_KEY;
if(!apiKey)throw Error("Set NEAR_AI_API_KEY in the process environment.");
const root="familiar-game.testnet",account=`live-check.${root}`;
// Records only upstream paths, statuses and error codes; never headers or bodies that could carry credentials.
const upstream:{path:string;status:number;error?:unknown}[]=[];
const relay=createNoteRelay({apiKey,chain:{player:async()=>account,confirmedClaims:async()=>1},fetch:async(url,init)=>{
  const response=await fetch(url,init),path=new URL(url).pathname,entry:{path:string;status:number;error?:unknown;encryptionVersion?:string|null}={path,status:response.status,encryptionVersion:new Headers(init.headers).get("x-encryption-version")};upstream.push(entry);
  if(!response.ok){const body=await response.clone().json().catch(()=>null) as {error?:{code?:unknown;type?:unknown};error_code?:unknown}|null;entry.error=body?.error?.code??body?.error?.type??body?.error_code??null;}
  return response;
}});
const seen:{shape?:unknown;signatureKind?:unknown;signedText?:unknown;status?:number}={};
const send=(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=typeof input==="string"?input:input instanceof URL?input.href:input.url;
  if(!url.startsWith("/api/"))return fetch(input,init);
  const headers=new Headers(init!.headers);
  const result=await relay.write({walletPublicKey:"ed25519:local-check",bytes:new Uint8Array(init!.body as Uint8Array<ArrayBuffer>),clientPublicKey:headers.get("x-client-pub-key")??undefined,modelPublicKey:headers.get("x-model-pub-key")??undefined});
  seen.status=result.status;
  const body=result.body as {signature?:string|null;completion?:string};
  // Plain response fields only: encrypted message values are reported by name and length, never decrypted here.
  if(typeof body.completion==="string"){const c=JSON.parse(Buffer.from(body.completion,"base64").toString());const choice=c.choices?.[0];seen.shape={finish_reason:choice?.finish_reason,usage:c.usage,message:Object.fromEntries(Object.entries(choice?.message??{}).map(([k,v])=>[k,typeof v==="string"?`${k==="role"?v:"string:"+v.length}`:v===null?null:typeof v]))};}
  if(typeof body.signature==="string"){const s=JSON.parse(Buffer.from(body.signature,"base64").toString());seen.signatureKind=s.signature_kind;seen.signedText=s.text;}
  return Response.json(result.body,{status:result.status});
}) as typeof fetch;
const returns=[{schemaVersion:1,id:"live",operationId:"return:live",contentVersion:"first_light_v2",context:{authority:"near-testnet",network:"testnet",root,accountId:account,publicKey:"ed25519:local",companionId:`mochi.${root}`,revision:0,checkpointHash:"0".repeat(64),banked:[],lit:false,signaled:false},area:"beacon",tool:"rope",banked:[],commands:[],outcome:"returned",cargo:["lens"],disposition:"accepted",acceptedClaimId:"0".repeat(64)}] as unknown as ReturnRecord[];
// SDK default quote/GPU verifiers for this runtime.
const note=await writeSealedNote({returns,token:"local-check",relayUrl:"/api",fetch:send});
console.info(JSON.stringify({state:note.state,text:"text" in note?note.text:null,back:note.back,relayStatus:seen.status,signatureKind:seen.signatureKind,signedText:seen.signedText,shape:seen.shape,upstream},null,2));
