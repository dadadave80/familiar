import { expect, test } from "bun:test";
import { KeyPair } from "near-api-js";
import { normalizePrivyNearKey } from "./privy-key";

test("Privy NEAR keys normalize raw and exact tagged Ed25519 encodings to the same implicit address",()=>{
  const key=KeyPair.fromRandom("ed25519").getPublicKey(),hex=Buffer.from(key.data).toString("hex");
  for(const encoded of [key.toString(),hex,`0x${hex}`,`00${hex}`,`0x00${hex}`,`00${hex.toUpperCase()}`])
    expect(normalizePrivyNearKey(encoded)).toEqual({publicKey:key.toString(),implicitAddress:hex});
});
test("Privy NEAR key normalization rejects non-Ed25519 tags, incorrect lengths and unsupported formats",()=>{
  const hex="ab".repeat(32);
  for(const encoded of [null,undefined,0,[],{},"",`01${hex}`,`0x01${hex}`,`02${hex}`,`00${hex.slice(4)}`,`00${hex}ab`,`0x00${hex}ab`,`0000${hex}`,` ${hex}`,`00${hex.slice(0,-1)}z`,"ed25519:invalid",`secp256k1:${hex}`])
    expect(()=>normalizePrivyNearKey(encoded)).toThrow();
});
