import { expect, test } from "bun:test";
import { baseDecode, baseEncode } from "near-api-js";
import { createPrivateKey, createPublicKey } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSetupArguments, prepareTideboundEnvironment, renderTideboundEnvironment, verifyTideboundEnvironment, type ProjectKeys } from "./setup-testnet";

const root="familiar-game.testnet";
// Public deterministic test seeds, never project credentials or on-chain signers.
function fixtureSecret(byte:number) {
  const seed=Buffer.alloc(32,byte);
  const privateKey=createPrivateKey({key:Buffer.concat([Buffer.from("302e020100300506032b657004220420","hex"),seed]),format:"der",type:"pkcs8"});
  const publicKey=createPublicKey(privateKey).export({format:"der",type:"spki"}).subarray(-32);
  return `ed25519:${baseEncode(Buffer.concat([seed,publicKey]))}`;
}
const fixtureKeys:ProjectKeys={
  ROOT_PRIVATE_KEY:fixtureSecret(1),RELAYER_PRIVATE_KEY:fixtureSecret(2),NPC_ADMIN_PRIVATE_KEY:fixtureSecret(3),NPC_PRIVATE_KEY:fixtureSecret(4),
};

test("Tidebound preparation requires the explicit isolated root and prepare-only cutline",()=>{
  expect(parseSetupArguments([])).toEqual({mode:"legacy"});
  expect(parseSetupArguments(["--tidebound",`--root=${root}`,"--prepare-only"])).toEqual({mode:"tidebound",root});
  for(const args of [
    ["--prepare-only"],["--tidebound"],["--tidebound",`--root=${root}`],
    ["--tidebound",`--root=${root}`,"--prepare-only","--create"],
    ["--tidebound",`--root=${root}`,`--root=${root}`,"--prepare-only"],
    ["--tidebound","--root=familiar-1105-28522e.testnet","--prepare-only"],
    ["--tidebound","--root=player.nested.testnet","--prepare-only"],
    ["--tidebound","--root=familiar.near","--prepare-only"],
    ["--tidebound",`--root=${"r".repeat(40)}.testnet`,"--prepare-only"],
  ])expect(()=>parseSetupArguments(args)).toThrow();
});

test("prepared configuration is one exact testnet tuple, default-off and omits separate Privy credentials",()=>{
  const content=renderTideboundEnvironment(root,fixtureKeys);
  expect(()=>verifyTideboundEnvironment(content,root)).not.toThrow();
  for(const line of [
    "NEAR_NETWORK=testnet",`NEAR_ROOT=${root}`,`RELAYER_ID=relayer.${root}`,`NPC_ID=bram.${root}`,
    "STAKING_POOL=kiln.pool.f863973.m0","WEB_ORIGINS=https://familiar-two.vercel.app",
    "ACCOUNT_PROVIDER=privy","VITE_ACCOUNT_PROVIDER=privy","TIDEBOUND_ENABLED=false","VITE_TIDEBOUND_ENABLED=false",
  ])expect(content.split("\n")).toContain(line);
  expect(content).not.toMatch(/^(?:PRIVY_APP_ID|PRIVY_APP_SECRET|VITE_PRIVY_APP_ID|VITE_PRIVY_CLIENT_ID|NEAR_AUTH_CLIENT_ID|VITE_NEAR_AUTH_CLIENT_ID)=/m);
  expect(content.split("\n").filter(line=>line&&!line.startsWith("#")).some(line=>line.endsWith("="))).toBe(false);
});

test("new setup omits the retired quote worker while an intact earlier setup still verifies",()=>{
  const current=renderTideboundEnvironment(root,fixtureKeys);
  expect(current).not.toMatch(/^(NPC_PORT|VITE_NPC_URL)=/m);
  const previous=current+"NPC_PORT=3038\nVITE_NPC_URL=/npc-api\n";
  expect(()=>verifyTideboundEnvironment(previous,root)).not.toThrow();
  expect(()=>verifyTideboundEnvironment(previous.replace("3038","9999"),root)).toThrow();
  expect(()=>verifyTideboundEnvironment(current+"NPC_PORT=3038\n",root)).toThrow();
});

test("configuration verification rejects altered authority, flags, key reuse, duplicates and injected settings",()=>{
  const content=renderTideboundEnvironment(root,fixtureKeys);
  for(const altered of [
    content.replace(`NEAR_ROOT=${root}`,"NEAR_ROOT=other.testnet"),
    content.replace("NEAR_NETWORK=testnet","NEAR_NETWORK=mainnet"),
    content.replace("STAKING_POOL=kiln.pool.f863973.m0","STAKING_POOL=unverified.testnet"),
    content.replace("TIDEBOUND_ENABLED=false","TIDEBOUND_ENABLED=true"),
    content.replace("ACCOUNT_PROVIDER=privy","ACCOUNT_PROVIDER=near-auth"),
    content.replace(fixtureKeys.NPC_PRIVATE_KEY,fixtureKeys.ROOT_PRIVATE_KEY),
    content.replace(fixtureKeys.ROOT_PRIVATE_KEY,"not-a-key"),
    content.replace(`ROOT_PRIVATE_KEY=${fixtureKeys.ROOT_PRIVATE_KEY}\n`,""),
    `${content}NEAR_ROOT=${root}\n`,`${content}PRIVY_APP_SECRET=synthetic-do-not-override\n`,
  ])expect(()=>verifyTideboundEnvironment(altered,root)).toThrow();
  expect(()=>renderTideboundEnvironment(root,{...fixtureKeys,NPC_PRIVATE_KEY:"bad\nPRIVY_APP_SECRET=injected"})).toThrow();
});

test("a well-encoded secret with a corrupted public half cannot become a prepared root authority",()=>{
  const bytes=new Uint8Array(baseDecode(fixtureKeys.ROOT_PRIVATE_KEY.slice("ed25519:".length)));
  bytes[63]=bytes[63]!^1;
  const inconsistent=`ed25519:${baseEncode(bytes)}`;
  expect(()=>renderTideboundEnvironment(root,{...fixtureKeys,ROOT_PRIVATE_KEY:inconsistent})).toThrow("valid Ed25519");
  const original=renderTideboundEnvironment(root,fixtureKeys);
  expect(()=>verifyTideboundEnvironment(original.replace(fixtureKeys.ROOT_PRIVATE_KEY,inconsistent),root)).toThrow("valid Ed25519");
});

test("preparation preserves legacy and Privy files and reuses the same private project keys",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"familiar-tidebound-setup-test-"));
  try{
    await writeFile(join(folder,".env"),"LEGACY=preserve-fixture\n");
    await writeFile(join(folder,".env.privy.local"),"PRIVY_APP_SECRET=synthetic-separate-fixture\n");
    let keyRequests=0;
    const prepared=await prepareTideboundEnvironment(root,folder,()=>{keyRequests++;return fixtureKeys;});
    const original=await readFile(join(folder,".env.tidebound"),"utf8");
    expect(prepared).toEqual({root,path:join(folder,".env.tidebound"),reused:false});
    expect((await stat(prepared.path)).mode&0o777).toBe(0o600);
    expect(await prepareTideboundEnvironment(root,folder,()=>{throw Error("must reuse original fixture keys");})).toEqual({...prepared,reused:true});
    expect(keyRequests).toBe(1);expect(await readFile(prepared.path,"utf8")).toBe(original);
    expect(await readFile(join(folder,".env"),"utf8")).toBe("LEGACY=preserve-fixture\n");
    expect(await readFile(join(folder,".env.privy.local"),"utf8")).toBe("PRIVY_APP_SECRET=synthetic-separate-fixture\n");
  }finally{await rm(folder,{recursive:true,force:true});}
});

test("mismatched or overly exposed existing configuration is preserved without requesting replacement keys",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"familiar-tidebound-preserve-test-"));
  try{
    const path=join(folder,".env.tidebound"),original=renderTideboundEnvironment("another-fresh.testnet",fixtureKeys);
    await writeFile(path,original,{mode:0o600});
    let keyRequests=0;
    const factory=()=>{keyRequests++;return fixtureKeys;};
    await expect(prepareTideboundEnvironment(root,folder,factory)).rejects.toThrow();
    expect(await readFile(path,"utf8")).toBe(original);expect(keyRequests).toBe(0);
    await writeFile(path,renderTideboundEnvironment(root,fixtureKeys));await chmod(path,0o644);
    await expect(prepareTideboundEnvironment(root,folder,factory)).rejects.toThrow("0600");
    expect((await stat(path)).mode&0o777).toBe(0o644);expect(keyRequests).toBe(0);
  }finally{await rm(folder,{recursive:true,force:true});}
});

test("preparation rejects a symlink instead of following it or replacing existing state",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"familiar-tidebound-symlink-test-"));
  try{
    const target=join(folder,"preserve-fixture");await writeFile(target,"untouched\n");
    await symlink(target,join(folder,".env.tidebound"));let keyRequests=0;
    await expect(prepareTideboundEnvironment(root,folder,()=>{keyRequests++;return fixtureKeys;})).rejects.toThrow("regular");
    expect(await readFile(target,"utf8")).toBe("untouched\n");expect(keyRequests).toBe(0);
  }finally{await rm(folder,{recursive:true,force:true});}
});
