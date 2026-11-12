import { baseDecode, KeyPair, KeyType, type KeyPairString } from "near-api-js";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import legacy from "../docs/TESTNET-DEPLOYMENT.json";

const keyNames=["ROOT_PRIVATE_KEY","RELAYER_PRIVATE_KEY","NPC_ADMIN_PRIVATE_KEY","NPC_PRIVATE_KEY"] as const;
export type ProjectKeys=Record<typeof keyNames[number],string>;
type SetupArguments={mode:"legacy"}|{mode:"tidebound";root:string};

function assertFreshRoot(root:string) {
  if(root===legacy.root||root.length>39||!/^[a-z0-9]+(?:-[a-z0-9]+)*\.testnet$/.test(root))
    throw Error("Choose a separate valid testnet root of at most 39 characters. The legacy root is forbidden.");
}
export function parseSetupArguments(args:readonly string[]):SetupArguments {
  if(args.length===0)return {mode:"legacy"};
  const roots=args.filter(value=>value.startsWith("--root="));
  if(args.length!==3||!args.includes("--tidebound")||!args.includes("--prepare-only")||roots.length!==1)
    throw Error("Isolated preparation requires --tidebound --root=<new-name>.testnet --prepare-only. Account creation is a separate action.");
  const root=roots[0]!.slice(7);assertFreshRoot(root);return {mode:"tidebound",root};
}
function newProjectKeys():ProjectKeys {
  return Object.fromEntries(keyNames.map(name=>[name,KeyPair.fromRandom("ed25519").toString()])) as ProjectKeys;
}
function assertKeys(keys:ProjectKeys) {
  const publicKeys=new Set<string>();
  const challenge=new TextEncoder().encode("familiar:testnet-project-key-preparation:v1");
  for(const name of keyNames){
    try{
      const value=keys[name];
      if(typeof value!=="string"||!/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,88}$/.test(value))throw Error();
      const secret=baseDecode(value.slice("ed25519:".length)),pair=KeyPair.fromString(value as KeyPairString),publicKey=pair.getPublicKey();
      if(publicKey.keyType!==KeyType.ED25519||publicKeys.has(publicKey.toString()))throw Error();
      // The SDK derives from the seed; other consumers also use the serialized public half.
      if(secret.length!==64||!publicKey.data.every((byte,index)=>secret[index+32]===byte))throw Error();
      // This fixed text is not a NEAR transaction or an authorization to spend.
      if(!publicKey.verify(challenge,pair.sign(challenge).signature))throw Error();
      publicKeys.add(publicKey.toString());
    }catch{throw Error("Preserve the existing file: four distinct valid Ed25519 project keys are required; no replacement was created.");}
  }
}
function tideboundValues(root:string,keys:ProjectKeys):Record<string,string> {
  assertFreshRoot(root);assertKeys(keys);
  return {
    NEAR_NETWORK:"testnet",NEAR_RPC_URL:"https://test.rpc.fastnear.com",NEAR_ROOT:root,
    ROOT_PRIVATE_KEY:keys.ROOT_PRIVATE_KEY,RELAYER_ID:`relayer.${root}`,RELAYER_PRIVATE_KEY:keys.RELAYER_PRIVATE_KEY,
    NPC_ID:`bram.${root}`,NPC_ADMIN_PRIVATE_KEY:keys.NPC_ADMIN_PRIVATE_KEY,NPC_PRIVATE_KEY:keys.NPC_PRIVATE_KEY,
    // Reverify this public pool against current validators before any deployment.
    STAKING_POOL:"kiln.pool.f863973.m0",RELAYER_PORT:"3037",NPC_PORT:"3038",WEB_ORIGINS:"https://familiar-two.vercel.app",
    VITE_NEAR_ROOT:root,VITE_NEAR_RPC_URL:"https://test.rpc.fastnear.com",VITE_RELAYER_URL:"/api",VITE_NPC_URL:"/npc-api",
    ACCOUNT_PROVIDER:"privy",VITE_ACCOUNT_PROVIDER:"privy",TIDEBOUND_ENABLED:"false",VITE_TIDEBOUND_ENABLED:"false",
  };
}
/** A private project configuration only. Privy credentials remain in their separate file. */
export function renderTideboundEnvironment(root:string,keys:ProjectKeys):string {
  return "# Isolated testnet preparation; no account creation, funding or deployment.\n"+
    "# Load the separate Privy configuration explicitly when an authorized runtime needs it.\n"+
    Object.entries(tideboundValues(root,keys)).map(([name,value])=>`${name}=${value}`).join("\n")+"\n";
}
/** Pure validation: a retry may reuse these exact keys, never replace or merge them. */
export function verifyTideboundEnvironment(content:string,root:string):void {
  const values:Record<string,string>=Object.create(null);
  for(const line of content.split(/\r?\n/)){
    if(!line||line.startsWith("#"))continue;
    const match=/^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line);
    if(!match||Object.hasOwn(values,match[1]!))throw Error("Preserve the existing configuration: a setting is malformed or duplicated.");
    values[match[1]!]=match[2]!;
  }
  const keys=Object.fromEntries(keyNames.map(name=>[name,values[name]])) as ProjectKeys;
  const expected=tideboundValues(root,keys);
  if(Object.keys(values).length!==Object.keys(expected).length||Object.entries(expected).some(([name,value])=>values[name]!==value))
    throw Error("Preserve the existing configuration: it does not match this isolated, disabled testnet tuple.");
}
/** No network client or faucet capability exists on this preparation path. */
export async function prepareTideboundEnvironment(root:string,directory=process.cwd(),createKeys:()=>ProjectKeys=newProjectKeys) {
  assertFreshRoot(root);
  const path=join(directory,".env.tidebound");
  async function existing():Promise<boolean> {
    let info;
    try{info=await lstat(path);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return false;throw error;}
    if(!info.isFile()||info.isSymbolicLink())throw Error("Preserve the existing path: .env.tidebound must be a regular file.");
    if((info.mode&0o777)!==0o600)throw Error("Preserve the existing file: .env.tidebound must have mode 0600 before it can be reused.");
    verifyTideboundEnvironment(await readFile(path,"utf8"),root);return true;
  }
  if(await existing())return {root,path,reused:true};
  const content=renderTideboundEnvironment(root,createKeys());
  try{await writeFile(path,content,{flag:"wx",mode:0o600});}
  catch(error){
    if((error as NodeJS.ErrnoException).code!=="EEXIST")throw error;
    if(!await existing())throw Error("The private preparation file changed. Preserve the original request.");
    return {root,path,reused:true};
  }
  return {root,path,reused:false};
}

async function main() {
  if(process.env.NEAR_NETWORK&&process.env.NEAR_NETWORK!=="testnet")throw Error("Refusing non-testnet setup.");
  const options=parseSetupArguments(process.argv.slice(2));
  if(options.mode==="tidebound"){
    const result=await prepareTideboundEnvironment(options.root);
    console.info(`${result.reused?"Verified existing":"Prepared"} private .env.tidebound for ${result.root}; mode 0600. No key was printed.`);
    console.info("No account was created, funded or deployed. Game flags remain false; separate Privy credentials were not read or changed.");
    return;
  }
  if(await Bun.file(".env").exists())throw Error(".env already exists. Keep the existing dev keys; setup never overwrites them.");
  const root=`familiar-1105-${crypto.randomUUID().slice(0,6)}.testnet`,keys=newProjectKeys();
  const sample=await Bun.file(".env.example").text();
  const values:Record<string,string>={...keys,NEAR_ROOT:root,RELAYER_ID:`relayer.${root}`,NPC_ID:`bram.${root}`,VITE_NEAR_ROOT:root};
  const content=sample.split("\n").map(line=>{const name=line.split("=",1)[0]!;return name in values?`${name}=${values[name]}`:line;}).join("\n");
  await writeFile(".env",content,{flag:"wx",mode:0o600});
  console.info(`Project dev keys saved privately in .env for ${root}. No key was printed.`);
  const processResult=Bun.spawn([
    "near","account","create-account","sponsor-by-faucet-service",root,"use-manually-provided-public-key",
    KeyPair.fromString(keys.ROOT_PRIVATE_KEY as KeyPairString).getPublicKey().toString(),"network-config","testnet","create",
  ],{stdout:"inherit",stderr:"inherit"});
  const exit=await processResult.exited;
  if(exit!==0){
    console.error("The faucet did not create the account. The generated keys are retained; retry the faucet with scripts/faucet.sh.");
    process.exit(exit);
  }
  console.info(`Created ${root}. Verify funding before deploying global code.`);
}
if(import.meta.main)await main();
