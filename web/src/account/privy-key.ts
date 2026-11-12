import { KeyType, PublicKey } from "near-api-js";

/** Normalize only raw Ed25519 bytes or NEAR's exact 0x00 + 32-byte tagged encoding. */
export function normalizePrivyNearKey(value:unknown):{publicKey:string;implicitAddress:string} {
  if(typeof value!=="string"||value.length>80)throw Error("Unsupported Privy NEAR public key.");
  let key:PublicKey;
  if(value.startsWith("ed25519:"))key=PublicKey.fromString(value);
  else {
    const hex=value.replace(/^0x/,"");
    const raw=/^[a-fA-F0-9]{64}$/.test(hex)?hex:/^00[a-fA-F0-9]{64}$/.test(hex)?hex.slice(2):null;
    if(raw===null)throw Error("Unsupported Privy NEAR public key.");
    key=new PublicKey({keyType:KeyType.ED25519,data:new Uint8Array(raw.match(/../g)!.map(byte=>Number.parseInt(byte,16)))});
  }
  if(key.keyType!==KeyType.ED25519||key.data.length!==32)throw Error("Unsupported Privy NEAR public key.");
  return {publicKey:key.toString(),implicitAddress:[...key.data].map(byte=>byte.toString(16).padStart(2,"0")).join("")};
}
