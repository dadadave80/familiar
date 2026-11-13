import type {ReturnRecord} from "../expedition/return-record";
import {decideSeal,NOTE_MODEL} from "./seal";
import {noteMessages} from "./prompt";

type Sdk=typeof import("@nearai/inference-sdk");
type ModelVerifiers=NonNullable<Parameters<Sdk["verifyModelAttestation"]>[0]["verifiers"]>;
export const NOTE_MAX_TOKENS=120;

/** What the back of the note can truthfully say about how it was made. */
export interface NoteBack {
  model:string;modelKey?:string;instances?:number;tcbStatus?:string;
  attestation:string;verifiedIn:string;chatId?:string;reason?:string;code?:string;
}
export type SealedNote=
  |{state:"sealed";text:string;back:NoteBack}
  |{state:"plain";text:string;back:NoteBack}
  |{state:"broken";back:NoteBack};

const base=(model=NOTE_MODEL):NoteBack=>({model,attestation:"Fetched directly from NEAR AI, without a key, using a fresh one-time nonce.",verifiedIn:"Verified in this browser with NEAR AI's inference SDK."});
const fromBase64=(value:string)=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
function check(value:unknown,message:string):asserts value {if(!value)throw Error(message);}

/**
 * One note: verify every attested instance, encrypt both messages to the shared model key with a
 * one-use reply key, send the exact bytes through the relay, decrypt, then decide the seal.
 */
export async function writeSealedNote(options:{
  returns:readonly ReturnRecord[];token:string;relayUrl:string;
  fetch?:typeof globalThis.fetch;sdk?:Sdk;verifiers?:ModelVerifiers;
}):Promise<SealedNote> {
  const back=base(),send=options.fetch??globalThis.fetch.bind(globalThis);
  let key:string,prepared:Awaited<ReturnType<Sdk["prepareE2eeChatRequest"]>>,requestBytes:Uint8Array<ArrayBuffer>;
  try{
    const sdk=options.sdk??await import("@nearai/inference-sdk");
    const client=new sdk.AttestationClient({fetch:send});
    const metadata=await client.fetchModelMetadata(NOTE_MODEL);
    check(metadata.providerType==="vllm"&&metadata.attestationSupported,"This model does not offer NEAR model attestation.");
    const fetched=await client.fetchModelAttestations({model:NOTE_MODEL,signingAlgo:"ed25519"});
    check(fetched.attestations.length>0,"NEAR AI returned no attested model instance.");
    const verified=await Promise.all(fetched.attestations.map(attestation=>sdk.verifyModelAttestation({attestation,clientBinding:fetched.clientBinding,policy:{gpuEvidence:"required"},verifiers:options.verifiers})));
    const keys=new Set(verified.map(v=>v.signingPublicKey?.toLowerCase()));
    check(keys.size===1&&verified.every(v=>v.signer.signingAlgo==="ed25519"&&v.signer.signingAddress.toLowerCase()===v.signingPublicKey?.toLowerCase()),"The attested instances do not share one Ed25519 model key.");
    key=[...keys][0]!;check(/^[0-9a-f]{64}$/.test(key),"The attested model key is malformed.");
    Object.assign(back,{modelKey:key,instances:verified.length,tcbStatus:verified[0]!.tcbStatus});
    const body=JSON.stringify({model:NOTE_MODEL,messages:noteMessages(options.returns),stream:false,max_tokens:NOTE_MAX_TOKENS,thinking_token_budget:0});
    // The URL is never contacted; the SDK only encrypts this request and keeps the matching reply key.
    prepared=await sdk.prepareE2eeChatRequest({request:new Request("https://note.invalid/v1/chat/completions",{method:"POST",headers:{"content-type":"application/json"},body}),modelKey:{signingAlgo:"ed25519",publicKey:key}});
    requestBytes=new Uint8Array(await prepared.request.clone().arrayBuffer());
  }catch(error){
    return {state:"broken",back:{...back,reason:error instanceof Error&&error.message?`The seal could not be prepared: ${error.message}`:"The seal could not be prepared."}};
  }
  let completion:Uint8Array<ArrayBuffer>,signature:Uint8Array|null,text:string;
  try{
    const response=await send(`${options.relayUrl.replace(/\/$/,"")}/v1/privy/note`,{method:"POST",body:requestBytes,headers:{
      authorization:`Bearer ${options.token}`,"content-type":"application/json",
      "x-client-pub-key":prepared.request.headers.get("x-client-pub-key")??"","x-model-pub-key":key,
    }});
    const envelope:unknown=await response.json().catch(()=>null);
    if(!response.ok){
      const error=envelope&&typeof envelope==="object"&&"error" in envelope&&typeof envelope.error==="string"?envelope.error:"The harbor could not deliver the note.";
      const code=envelope&&typeof envelope==="object"&&"code" in envelope&&typeof envelope.code==="string"?envelope.code:undefined;
      return {state:"broken",back:{...back,reason:error,...code?{code}:{}}};
    }
    check(envelope&&typeof envelope==="object"&&"completion" in envelope&&typeof envelope.completion==="string","The harbor's reply was malformed.");
    completion=fromBase64(envelope.completion);
    signature="signature" in envelope&&typeof envelope.signature==="string"?fromBase64(envelope.signature):null;
    const decrypted=await prepared.decryptResponse(new Response(completion,{status:200,headers:{"content-type":"application/json"}}));
    const reply=await decrypted.json() as {id?:unknown;choices?:{message?:{content?:unknown}}[]};
    if(typeof reply.id==="string")back.chatId=reply.id;
    const content=reply.choices?.[0]?.message?.content;
    check(typeof content==="string"&&content.trim(),"The note came back empty.");
    text=content.trim().slice(0,600);
  }catch(error){
    return {state:"broken",back:{...back,reason:error instanceof Error&&error.message?error.message:"The note could not be opened."}};
  }
  const decision=await decideSeal({modelId:NOTE_MODEL,requestBytes,responseBytes:completion,signatureBytes:signature,modelKey:key});
  return decision.state==="sealed"?{state:"sealed",text,back}:{state:"plain",text,back:{...back,reason:decision.reason}};
}

export function noteKey(root:string,accountId:string,claimId:string){return `familiar.sealed-note.v1:testnet:${root}:${accountId}:${claimId}`;}
export function readNote(store:Pick<Storage,"getItem">,key:string):SealedNote|null {
  try{
    const value=JSON.parse(store.getItem(key)??"null") as SealedNote|null;
    return value&&["sealed","plain"].includes(value.state)&&"text" in value&&typeof value.text==="string"&&value.back&&typeof value.back.model==="string"?value:null;
  }catch{return null;}
}
