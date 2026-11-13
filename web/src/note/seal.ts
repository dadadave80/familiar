export const NOTE_MODEL="z-ai/glm-5.3-flash";
export type SealDecision={state:"sealed"}|{state:"plain";reason:string};

const hex=(bytes:Uint8Array)=>[...bytes].map(n=>n.toString(16).padStart(2,"0")).join("");
const bytesOf=(value:string)=>new Uint8Array(value.match(/../g)!.map(n=>Number.parseInt(n,16)));
const strip=(value:unknown)=>typeof value==="string"?value.replace(/^0x/,"").toLowerCase():"";
export async function sha256Hex(bytes:Uint8Array){return hex(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes as Uint8Array<ArrayBuffer>)));}

/**
 * Seal only a model-TEE signature over `<model>:sha256(request):sha256(response)` by the attested key.
 * Every other outcome is a readable note that is labelled not sealed.
 */
export async function decideSeal(input:{modelId:string;requestBytes:Uint8Array;responseBytes:Uint8Array;signatureBytes:Uint8Array|null;modelKey:string}):Promise<SealDecision> {
  if(!input.signatureBytes)return {state:"plain",reason:"NEAR AI had not recorded a signature for this note."};
  let signature:Record<string,unknown>;
  try{const value:unknown=JSON.parse(new TextDecoder().decode(input.signatureBytes));if(!value||typeof value!=="object"||Array.isArray(value))throw Error();signature=value as Record<string,unknown>;}
  catch{return {state:"plain",reason:"The signature record could not be read."};}
  if(signature.signature_kind!=="provider_tee")return {state:"plain",reason:"The signature came from the gateway, not the model's sealed room."};
  if(signature.signing_algo!=="ed25519")return {state:"plain",reason:"The signature used an unexpected algorithm."};
  const key=strip(input.modelKey);
  if(!/^[0-9a-f]{64}$/.test(key)||strip(signature.signing_address)!==key)return {state:"plain",reason:"The signature is not from the attested model key."};
  const expected=`${input.modelId}:${await sha256Hex(input.requestBytes)}:${await sha256Hex(input.responseBytes)}`;
  if(signature.text!==expected)return {state:"plain",reason:"The signed text does not match this exact request and reply."};
  const signed=strip(signature.signature);
  if(!/^[0-9a-f]{128}$/.test(signed))return {state:"plain",reason:"The signature is malformed."};
  let valid=false;
  try{
    const publicKey=await crypto.subtle.importKey("raw",bytesOf(key),{name:"Ed25519"},false,["verify"]);
    valid=await crypto.subtle.verify({name:"Ed25519"},publicKey,bytesOf(signed),new TextEncoder().encode(expected));
  }catch{valid=false;}
  return valid?{state:"sealed"}:{state:"plain",reason:"The signature does not verify against the attested model key."};
}
