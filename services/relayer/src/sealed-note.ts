import { JsonRpcProvider } from "near-api-js";
import { isPlayerAccount } from "../../../web/src/account/names";
import { Quota } from "./relay";

/** Mochi's sealed note. The relay checks plain fields only and forwards the browser's exact encrypted bytes. */
export const NOTE_MODEL="z-ai/glm-5.3-flash";
export const NOTE_MAX_TOKENS=120;
export const NOTE_BODY_LIMIT=8_192;
const upstream="https://cloud-api.near.ai/v1";
const hexKey=/^[0-9a-f]{64}$/;
const ciphertext=/^(?:[0-9a-f]{2}){72,4000}$/;
const chatId=/^[A-Za-z0-9_-]{1,128}$/;
const topLevel=new Set(["model","messages","stream","max_tokens","thinking_token_budget"]);

export interface NoteChain {
  /** Root `get_player` for the server-verified wallet key. */
  player(publicKey:string):Promise<string|null>;
  /** Number of accepted claims in root `tidebound_journey`. */
  confirmedClaims(accountId:string):Promise<number>;
}
/** Finalized root views only: the verified wallet's registered player, then its accepted claims. */
export function rpcNoteChain(root:string,rpcUrl:string):NoteChain {
  const provider=new JsonRpcProvider({url:rpcUrl});
  return {
    async player(publicKey){const account=await provider.callFunction<string>({contractId:root,method:"get_player",args:{public_key:publicKey},blockQuery:{finality:"final"}});return typeof account==="string"&&isPlayerAccount(account,root)?account:null;},
    async confirmedClaims(accountId){const journey=await provider.callFunction<{claims:unknown[]}>({contractId:root,method:"tidebound_journey",args:{account_id:accountId},blockQuery:{finality:"final"}});return Array.isArray(journey?.claims)?journey.claims.length:0;},
  };
}
export type NoteRefusal={status:400|409|413|429;code:string};
export type NoteFetch=(url:string,init:RequestInit)=>Promise<Response>;

/** Reads only routing and budget fields. Message contents must already be ciphertext hex and are never decoded. */
export function checkNoteBody(bytes:Uint8Array):NoteRefusal|null {
  if(bytes.byteLength>NOTE_BODY_LIMIT)return {status:413,code:"NOTE_TOO_LARGE"};
  let body:unknown;
  let text:string;
  try{text=new TextDecoder("utf-8",{fatal:true}).decode(bytes);body=JSON.parse(text);}catch{return {status:400,code:"NOTE_BODY"};}
  // Compact canonical JSON only: duplicate keys or alternate spellings could otherwise be read differently upstream.
  if(JSON.stringify(body)!==text)return {status:400,code:"NOTE_BODY"};
  if(!body||typeof body!=="object"||Array.isArray(body))return {status:400,code:"NOTE_BODY"};
  const value=body as Record<string,unknown>;
  if(Object.keys(value).some(key=>!topLevel.has(key)))return {status:400,code:"NOTE_FIELDS"};
  if(value.model!==NOTE_MODEL)return {status:400,code:"NOTE_MODEL"};
  if(value.stream!==false)return {status:400,code:"NOTE_STREAM"};
  if(!Number.isSafeInteger(value.max_tokens)||(value.max_tokens as number)<1||(value.max_tokens as number)>NOTE_MAX_TOKENS)return {status:400,code:"NOTE_MAX_TOKENS"};
  // GLM-5.3 Flash spends max_tokens on reasoning unless its documented reasoning budget is zero.
  if("thinking_token_budget" in value&&value.thinking_token_budget!==0)return {status:400,code:"NOTE_FIELDS"};
  const messages=value.messages;
  if(!Array.isArray(messages)||messages.length!==2)return {status:400,code:"NOTE_MESSAGES"};
  const roles=["system","user"];
  for(const [index,message] of messages.entries()){
    if(!message||typeof message!=="object"||Array.isArray(message))return {status:400,code:"NOTE_MESSAGES"};
    const keys=Object.keys(message);
    if(keys.length!==2||(message as {role?:unknown}).role!==roles[index]||typeof (message as {content?:unknown}).content!=="string"||!ciphertext.test((message as {content:string}).content))
      return {status:400,code:"NOTE_MESSAGES"};
  }
  return null;
}

const wait=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
const base64=(bytes:Uint8Array)=>Buffer.from(bytes).toString("base64");

export function createNoteRelay(options:{apiKey:string;chain:NoteChain;fetch?:NoteFetch;signatureAttempts?:number;signatureDelayMs?:number}) {
  const send=options.fetch??((url,init)=>fetch(url,init));
  const attempts=options.signatureAttempts??6,delay=options.signatureDelayMs??500;
  const perAccount=new Quota(3,3_600_000),all=new Quota(120,3_600_000,1);
  // Process-local, like the existing account quotas. A restart or another instance allows another note.
  const written=new Set<string>();
  async function signature(id:string):Promise<Uint8Array|null> {
    for(let attempt=0;attempt<attempts;attempt++){
      if(attempt)await wait(delay);
      const response=await send(`${upstream}/signature/${encodeURIComponent(id)}?signing_algo=ed25519`,{
        method:"GET",headers:{authorization:`Bearer ${options.apiKey}`,"accept-encoding":"identity"},redirect:"error",
      }).catch(()=>null);
      if(!response)continue;
      const bytes=new Uint8Array(await response.arrayBuffer().catch(()=>new ArrayBuffer(0)));
      if(response.ok&&bytes.byteLength>0&&bytes.byteLength<=8_192){
        try{const value=JSON.parse(new TextDecoder().decode(bytes));if(value&&typeof value==="object"&&typeof value.signature==="string")return bytes;}catch{ /* retry */ }
      }
    }
    return null;
  }
  return {
    async write(input:{walletPublicKey:string;bytes:Uint8Array<ArrayBuffer>;clientPublicKey:string|undefined;modelPublicKey:string|undefined}):Promise<{status:number;body:unknown}> {
      const refused=checkNoteBody(input.bytes);
      if(refused)return {status:refused.status,body:{code:refused.code,error:"Mochi's note could not be sent in that form."}};
      if(!input.clientPublicKey||!hexKey.test(input.clientPublicKey)||!input.modelPublicKey||!hexKey.test(input.modelPublicKey))
        return {status:400,body:{code:"NOTE_KEYS",error:"Mochi's note needs both sealing keys."}};
      const account=await options.chain.player(input.walletPublicKey);
      if(!account||await options.chain.confirmedClaims(account)<1)return {status:409,body:{code:"NOTE_NO_EVENT",error:"Mochi writes after an accepted return."}};
      if(written.has(account))return {status:409,body:{code:"NOTE_WRITTEN",error:"Mochi has already written this harbor's note."}};
      if(!perAccount.take(account)||!all.take("all"))return {status:429,body:{code:"QUOTA",error:"Mochi is resting the pen. Try again later."}};
      written.add(account);
      let completion:Uint8Array;
      try{
        const response=await send(`${upstream}/chat/completions`,{method:"POST",redirect:"error",body:input.bytes,headers:{
          authorization:`Bearer ${options.apiKey}`,"content-type":"application/json","accept-encoding":"identity",
          "x-signing-algo":"ed25519","x-encryption-version":"3","x-encrypt-all-fields":"true","x-no-aliasing":"true",
          "x-client-pub-key":input.clientPublicKey,"x-model-pub-key":input.modelPublicKey,
        }});
        completion=new Uint8Array(await response.arrayBuffer());
        if(!response.ok||completion.byteLength>65_536)throw Error("upstream");
      }catch{
        written.delete(account);
        return {status:502,body:{code:"NOTE_UPSTREAM",error:"The note could not reach Mochi. Nothing was written."}};
      }
      let id:unknown;
      try{id=JSON.parse(new TextDecoder().decode(completion)).id;}catch{id=null;}
      const signed=typeof id==="string"&&chatId.test(id)?await signature(id):null;
      return {status:200,body:{completion:base64(completion),signature:signed?base64(signed):null}};
    },
  };
}
export type NoteRelay=ReturnType<typeof createNoteRelay>;
