import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {lstat,open,readFile,realpath,rename} from "node:fs/promises";
import {isAbsolute,join,relative,resolve} from "node:path";
import {actions,base64Decode,base64Encode,baseDecode,baseEncode,createTransaction,decodeSignedTransaction,decodeTransaction,encodeTransaction,JsonRpcProvider,KeyPair,KeyPairSigner,nearToYocto,type AccessKeyViewRaw,type KeyPairString} from "near-api-js";
import {assertCodeOnlyUpgrade,verifyFinalOutcome} from "./tidebound-live";

const ROOT="familiar-game.testnet",ITEMS=`items.${ROOT}`,RPC="https://test.rpc.fastnear.com";
const SPECS="/Users/dadadave/.codex/specs/familiar-tidebound-2026-11-12";
export const UPGRADE={
 root:ROOT,items:ITEMS,network:"testnet",grossExistingAuthorization:"41 testNEAR; no new funding authorized by this driver",
 old:{root:"3eeoimzgrF1M9amhaRHs9jpSrPuSw1QYJFhoPAsFLyH3",items:"2s2KfRFCBhe8sgX2S7H9rC8eJcgkZSMhCoCizu6A9HXJ"},
 // Explicit allowlist and execution order. Never include Pet, Bakery or Market build outputs.
 candidates:{items:{account:ITEMS,bytes:317448,oldBytes:316960,codeHash:"8wXoHBcJwoX9fUkz83uG5bmnM18hNWGJBceXx5dvGNa2"},root:{account:ROOT,bytes:433139,oldBytes:426382,codeHash:"4xtG29913j2BNpJaX16YQwMrP7WEE6mQp5UaBWFqb8xt"}},
 unchanged:{pet:"CQQ63d8dNsM8oVCeEsU57USX212396zFmhtnqjgeXi1J",bakery:"EHJca21W6P2CiwJ68BpHDT2cf6YV6ByTvGwHENeC2DDv",market:"4RLBp67B5ZWJ9H8BztLfthTYMjyGR7VWmtj5k3MwxAVr"},
 config:{relayer:`relayer.${ROOT}`,pet_code_hash:"CQQ63d8dNsM8oVCeEsU57USX212396zFmhtnqjgeXi1J",items:ITEMS,bakery:`bakery.${ROOT}`,market:`market.${ROOT}`,pool:"kiln.pool.f863973.m0"},
 additionalCostCapYocto:nearToYocto("0.25").toString(),
} as const;
type Name=keyof typeof UPGRADE.candidates;
type Artifact={account:string;codeHash:string;bytes:number};
type Safety={codes:Record<string,string>;config:unknown;rootProtocol:unknown;itemProtocol:unknown;state:unknown;protected:unknown};
type RawAccount={amount:string;locked:string;storage_usage:number;code_hash:string;global_contract_hash?:string;block_hash:string;block_height:number};
export type Snapshot=Safety&{block:{hash:string;height:number};accounts:Record<string,RawAccount>;protocol:unknown;gasPrice:string;observedPets:unknown[];itemAvailableCredit:string};
type PinnedRequest={request_type:"view_account";account_id:string}|{request_type:"view_access_key_list";account_id:string}|{request_type:"view_state";account_id:string;prefix_base64:string;include_proof:false};
type Quote={protocolUnlocked:bigint;reservedStorage:bigint;contractReserve:bigint;available:bigint;required:bigint;storageGrowth:bigint;gasPrepayment:bigint;purchaseGasPrice:bigint;operatingFloor:bigint};
export type Review={version:1;kind:"read-only-two-contract-v2-review";createdAt:string;policy:typeof UPGRADE;baseline:Snapshot;quotes:Record<Name,Record<keyof Quote,string>>;additionalCostCapYocto:string;limits:string[]};
export type UpgradeStep={name:Name;account:string;hash:string;transaction:string;signedTransaction:string;state:"prepared"|"submitted"|"final"|"uncertain";outcome?:unknown;after?:Snapshot;prepayment?:unknown};
export type Journal={version:1;kind:"private-two-contract-v2-execution";reviewSha256:string;network:"testnet";root:typeof ROOT;startedAt:string;status:string;steps:UpgradeStep[];observations:unknown[];continuations?:Record<string,unknown>[]};
const sha=(bytes:string|Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const codeHash=(bytes:Uint8Array)=>baseEncode(createHash("sha256").update(bytes).digest());
const json=(value:unknown)=>JSON.stringify(value,(_key,v)=>typeof v==="bigint"?v.toString():v,2)+"\n";
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==="object"&&!Array.isArray(value);
function amount(value:unknown):bigint {
 assert(typeof value==="bigint"||typeof value==="number"&&Number.isSafeInteger(value)||typeof value==="string"&&/^(0|[1-9][0-9]{0,38})$/.test(value),"Unverified protocol/account amount.");
 const n=BigInt(value as string|number|bigint);assert(n>=0n&&n<2n**128n);return n;
}
export function parseUpgradeArguments(args:readonly string[]):{live:boolean;directory?:string;approval?:string} {
 const allowed=args.every(a=>a==="--live"||a.startsWith("--review-dir=")||/^--approve=[a-f0-9]{64}$/.test(a));
 assert(allowed&&new Set(args.map(a=>a.split("=")[0])).size===args.length,"Only --review-dir, --live and an exact --approve SHA256 are supported. No reset or resume exists.");
 const directory=args.find(a=>a.startsWith("--review-dir="))?.slice(13),approval=args.find(a=>a.startsWith("--approve="))?.slice(10),live=args.includes("--live");
 assert(args.length===0||directory&&isAbsolute(directory),"Use an absolute existing --review-dir outside Git.");assert(live===!!approval,"Live execution requires both --live and the reviewed file's exact SHA256; preparation never signs.");
 return {live,...(directory?{directory}:{}),...(approval?{approval}:{})};
}
export function assertUpgradeArtifact(name:Name,bytes:Uint8Array) {
 const expected=UPGRADE.candidates[name];assert.equal(bytes.length,expected.bytes,"Candidate byte length changed. Freeze and review a new candidate.");assert.equal(codeHash(bytes),expected.codeHash,"Candidate hash changed. No action was signed.");
}
export function assertDeployEnvelope(step:UpgradeStep,artifact:Artifact,bytes:Uint8Array) {
 assert([ROOT,ITEMS].includes(artifact.account));assert.equal(step.account,artifact.account);assert.equal(bytes.length,artifact.bytes);assert.equal(codeHash(bytes),artifact.codeHash);
 const tx=decodeTransaction(base64Decode(step.transaction));assert.equal(base64Encode(encodeTransaction(tx)),step.transaction);assert.equal(tx.signerId,artifact.account);assert.equal(tx.receiverId,artifact.account);assert(tx.nonce>0n);
 const exact=createTransaction(artifact.account,tx.publicKey,artifact.account,tx.nonce,[actions.deployContract(bytes)],new Uint8Array(tx.blockHash));
 assert.equal(base64Encode(encodeTransaction(exact)),step.transaction,"Only one exact self-account DeployContract is allowed. No init, migration, transfer or key action.");assert.equal(codeHash(encodeTransaction(tx)),step.hash);
 const signed=decodeSignedTransaction(base64Decode(step.signedTransaction));assert.equal(base64Encode(signed.encode()),step.signedTransaction);assert.equal(base64Encode(encodeTransaction(signed.transaction)),step.transaction);
 assert(signed.signature.ed25519Signature&&tx.publicKey.verify(createHash("sha256").update(encodeTransaction(tx)).digest(),new Uint8Array(signed.signature.ed25519Signature.data)),"Deployment signature does not match the canonical bytes.");
 return signed;
}
export function assertUpgradePhase(s:Safety,phase:0|1|2) {
 assert.deepEqual(s.config,UPGRADE.config,"The existing mutually configured stack must remain exact.");
 assert.deepEqual(s.codes,{[ROOT]:phase===2?UPGRADE.candidates.root.codeHash:UPGRADE.old.root,[ITEMS]:phase>=1?UPGRADE.candidates.items.codeHash:UPGRADE.old.items,[UPGRADE.config.bakery]:UPGRADE.unchanged.bakery,[UPGRADE.config.market]:UPGRADE.unchanged.market},"Wrong code tuple or an unrelated building changed.");
 const primary={network:"testnet",rules_version:"tidebound_h1_v1",content_version:"first_light_v1",registry:ROOT};
 assert.deepEqual(s.rootProtocol,{...primary,...(phase===2?{supported_content_versions:["first_light_v1","first_light_v2"]}:{}),items:ITEMS});
 assert.deepEqual(s.itemProtocol,{...primary,...(phase>=1?{supported_content_versions:["first_light_v1","first_light_v2"]}:{})});
}
export function assertPreserved(before:Pick<Safety,"state"|"protected">,after:Pick<Safety,"state"|"protected">) {
 // Other players can legitimately change canonical state during an upgrade. Stop for human review;
 // never restore old bytes, overwrite a ledger, or label concurrent gameplay as corruption.
 assert.deepEqual(after.state,before.state,"STATE changed, possibly from concurrent gameplay. Stop for review; never restore the old state.");
 assert.deepEqual(after.protected,before.protected,"Selected ownership/progress changed, possibly from concurrent gameplay. Stop for review; never overwrite it.");
}
/** Exact complete Borsh layout for the pinned 3eeo Root and its layout-identical v2 candidate.
 * NFT core uses near-contract-standards5.30 TreeMap/legacy prefixes; Root uses store LookupMap/Set.
 * No tail searching or guessed offset: every length/prefix/config/option and end-of-input is checked.
 */
export function decodeRootReservedStorage(bytes:Uint8Array,hash:string):bigint {
 assert(hash===UPGRADE.old.root||hash===UPGRADE.candidates.root.codeHash,"Unknown Root layout; reserved balance cannot be proved.");assert(bytes.length<=4096);
 let offset=0;const take=(count:number)=>{assert(Number.isSafeInteger(count)&&count>=0&&offset+count<=bytes.length,"Truncated frozen Root STATE.");const part=bytes.slice(offset,offset+count);offset+=count;return part;};
 const number=(count:number)=>{const part=take(count);let n=0n;for(let i=part.length-1;i>=0;i--)n=(n<<8n)|BigInt(part[i]!);return n;};
 const prefix=(expected:string)=>{const length=Number(number(4));assert.equal(length,new TextEncoder().encode(expected).length);assert.deepEqual(take(length),new TextEncoder().encode(expected),"Unexpected frozen Root field or prefix.");};
 prefix(ROOT);number(8);number(8);prefix("tv");number(8);prefix("tn"); // NFT owner, per-token bytes, TreeMap root/value/vector.
 for(const p of ["m","e","a","an"]){assert.equal(number(1),1n,"All frozen NFT extensions must be present.");prefix(p);}
 prefix(UPGRADE.config.relayer);assert.equal(baseEncode(take(32)),UPGRADE.unchanged.pet);
 for(const p of [UPGRADE.config.items,UPGRADE.config.bakery,UPGRADE.config.market,UPGRADE.config.pool])prefix(p);
 for(const p of ["players","pendingplayers","pending-player-names","playerids","adopted"])prefix(p);
 number(8);for(const p of ["adoptions","busy","dens"])prefix(p);
 take(4*16);number(8);take(4*16);number(8);number(2);number(2);number(2);
 const reservedStorage=number(16);prefix("tb-journeys");number(2);assert.equal(offset,bytes.length,"Unknown trailing Root fields; do not infer spendable balance.");return reservedStorage;
}
/** contract-tools4.0.0 NEP145 slot_account: raw enum Account=1 + Borsh AccountId;
 * StorageBalance is two u128LE NearTokens. This exact slot is cross-checked with the public view.
 */
export function decodeItemStorageCredit(keyBase64:string,valueBase64:string,hash:string) {
 assert(hash===UPGRADE.old.items||hash===UPGRADE.candidates.items.codeHash,"Unknown Items storage-credit layout.");
 const key=base64Decode(keyBase64),value=base64Decode(valueBase64);assert.equal(base64Encode(key),keyBase64);assert.equal(base64Encode(value),valueBase64);assert(key.length>=7&&key[0]===1&&value.length===32,"Malformed complete storage-credit row.");
 const length=new DataView(key.buffer,key.byteOffset,key.byteLength).getUint32(1,true);assert(length>=2&&length<=64&&key.length===5+length);const accountId=new TextDecoder("utf-8",{fatal:true}).decode(key.slice(5));assert(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(accountId)&&new TextEncoder().encode(accountId).length===length);
 const read128=(offset:number)=>{let n=0n;for(let i=15;i>=0;i--)n=(n<<8n)|BigInt(value[offset+i]!);return n;};
 const total=read128(0),available=read128(16);assert(available<=total,"Storage-credit liability exceeds its total.");return {accountId,total,available};
}
export function decodeItemCredits(rows:unknown,hash:string) {
 assert(Array.isArray(rows)&&rows.length<=512,"Storage-credit scan exceeded its complete bounded proof.");const accounts=new Set<string>();let available=0n;
 const entries=rows.map((row:unknown)=>{assert(object(row)&&typeof row.key==="string"&&typeof row.value==="string");const credit=decodeItemStorageCredit(row.key,row.value,hash);assert(!accounts.has(credit.accountId),"Duplicate storage-credit row.");accounts.add(credit.accountId);available+=credit.available;assert(available<2n**128n);return {...credit,keyBase64:row.key,valueBase64:row.value};}).sort((a,b)=>a.accountId.localeCompare(b.accountId));
 return {entries,available};
}
export function quoteUpgrade(name:Name,account:unknown,protocol:unknown,gasPrice:unknown,rootState?:{value:string;codeHash:string},itemAvailableCredit?:bigint):Quote {
 assert(object(account)&&object(protocol)&&protocol.chain_id==="testnet"&&Number.isSafeInteger(protocol.protocol_version)&&Number(protocol.protocol_version)>=85);
 const runtime=protocol.runtime_config;assert(object(runtime)&&object(runtime.transaction_costs));const costs=runtime.transaction_costs,creation=costs.action_creation_config;assert(object(creation));
 const fee=(value:unknown)=>{assert(object(value));const sir=amount(value.send_sir),other=amount(value.send_not_sir);return (sir>other?sir:other)+amount(value.execution);};
 const price=amount(gasPrice),floor=amount(runtime.min_gas_purchase_price),storagePrice=amount(runtime.storage_amount_per_byte);assert(price>0n&&floor>0n&&storagePrice>0n);
 const purchaseGasPrice=price>floor?price:floor,c=UPGRADE.candidates[name];
 // Conservative bound: every send/execution fee is priced at the larger purchase price.
 const gasPrepayment=(fee(costs.action_receipt_creation_config)+fee(creation.deploy_contract_cost)+fee(creation.deploy_contract_cost_per_byte)*BigInt(c.bytes))*purchaseGasPrice;
 const storageGrowth=BigInt(Math.max(0,c.bytes-c.oldBytes))*storagePrice,required=gasPrepayment+storageGrowth,protocolUnlocked=amount(account.amount)-amount(account.storage_usage)*storagePrice,operatingFloor=nearToYocto(name==="root"?"2.25":"0.10");
 let reservedStorage=0n;const contractReserve=name==="root"?nearToYocto("0.10"):0n;
 if(name==="root"){assert(rootState&&typeof rootState.value==="string","Exact Root STATE reservation proof is required before quoting.");const bytes=base64Decode(rootState.value);assert.equal(base64Encode(bytes),rootState.value);reservedStorage=decodeRootReservedStorage(bytes,rootState.codeHash);}
 else {assert(typeof itemAvailableCredit==="bigint","Complete refundable Items credit proof is required before quoting.");reservedStorage=amount(itemAvailableCredit);}
 const available=protocolUnlocked-reservedStorage-contractReserve;
 assert(required>0n&&required<=BigInt(UPGRADE.additionalCostCapYocto),"Current deployment cost exceeds the bounded existing allocation.");assert(available>=required+operatingFloor,"Insufficient existing balance after preserving the operating reserve; no top-up is performed.");
 return {protocolUnlocked,reservedStorage,contractReserve,available,required,storageGrowth,gasPrepayment,purchaseGasPrice,operatingFloor};
}
export async function submitUpgradeOnce(step:UpgradeStep,submit:()=>Promise<unknown>,persist:()=>Promise<void>) {
 assert.equal(step.state,"prepared","This deployment has already attempted submission. Preserve its exact envelope; no automatic retry or new nonce.");
 await persist();step.state="submitted";await persist();
 try{return await submit();}catch(error){step.state="uncertain";await persist();throw error;}
}
export async function requireNoExecutionJournal(path:string) {
 try{await lstat(path);}catch(error){if((error as NodeJS.ErrnoException).code==="ENOENT")return;throw error;}
 throw Error("An execution journal already exists. Preserve it for read-only review; no rerun, retry or new signing is permitted.");
}
async function reviewDirectory(directory:string) {
 assert(isAbsolute(directory)&&resolve(directory)===directory,"Use a canonical absolute review directory.");
 const root=await realpath(SPECS),actual=await realpath(directory);assert(actual===directory&&!relative(root,actual).startsWith("..")&&!isAbsolute(relative(root,actual)),"Reviews and signed journals belong under the external Familiar specifications directory.");
 const stat=await lstat(directory);assert(stat.isDirectory()&&!stat.isSymbolicLink());
 const git=Bun.spawnSync({cmd:["git","-C",directory,"rev-parse","--is-inside-work-tree"],stdout:"pipe",stderr:"pipe"});assert(git.exitCode===128&&git.stderr.toString().includes("not a git repository"),"The review destination must be outside every Git worktree.");
 return directory;
}
async function writePrivate(path:string,value:unknown,exclusive=false) {
 await reviewDirectory(resolve(path,".."));const temporary=exclusive?path:`${path}.${crypto.randomUUID()}.tmp`,file=await open(temporary,"wx",0o600);
 try{await file.writeFile(json(value));await file.sync();}finally{await file.close();}
 if(!exclusive)await rename(temporary,path);
 const directory=await open(resolve(path,".."),"r");try{await directory.sync();}finally{await directory.close();}
}
async function privateJSON(path:string) {const stat=await lstat(path);assert(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o777)===0o600,"Review files and signed journals must be regular mode-0600 files.");const bytes=await readFile(path);assert(bytes.length<10_000_000);return {value:JSON.parse(bytes.toString("utf8")) as unknown,sha256:sha(bytes)};}
async function capture(provider:JsonRpcProvider):Promise<Snapshot> {
 assert.equal(await provider.getNetworkId(),"testnet");const final=await provider.viewBlock({finality:"final"}),block={hash:final.header.hash,height:final.header.height};assert(Number.isSafeInteger(block.height)&&block.height>0);
 const pinned=async<T>(request:PinnedRequest)=>await provider.query({...request,block_id:block.hash}) as unknown as T;
 const view=async<T=unknown>(contractId:string,method:string,args:Record<string,unknown>={}):Promise<T>=>provider.callFunction({contractId,method,args,blockQuery:{blockId:block.hash}}) as Promise<T>;
 const account=async(account_id:string)=>{const value=await pinned<RawAccount>({request_type:"view_account",account_id});assert.equal(value.block_hash,block.hash);assert.equal(value.block_height,block.height);amount(value.amount);amount(value.locked);amount(value.storage_usage);return value;};
 const keys=async(account_id:string)=>{const value=await pinned<{block_hash:string;block_height:number;keys:{public_key:string;access_key:{permission:unknown}}[]}>({request_type:"view_access_key_list",account_id});assert.equal(value.block_hash,block.hash);assert.equal(value.block_height,block.height);assert(Array.isArray(value.keys)&&value.keys.length<=32);return value.keys.map(k=>({publicKey:k.public_key,permission:k.access_key.permission})).sort((a,b)=>a.publicKey.localeCompare(b.publicKey));};
 const accounts:Record<string,RawAccount>={},codes:Record<string,string>={},adminKeys:Record<string,unknown>={};
 for(const id of [ROOT,ITEMS,UPGRADE.config.bakery,UPGRADE.config.market]){accounts[id]=await account(id);codes[id]=accounts[id]!.code_hash;assert(!accounts[id]!.global_contract_hash);adminKeys[id]=await keys(id);}
 const stored=async(id:string)=>{
  const raw=await pinned<{block_hash:string;block_height:number;values:{key:string;value:string}[]}>({request_type:"view_state",account_id:id,prefix_base64:base64Encode(new TextEncoder().encode("STATE")),include_proof:false});
  assert.equal(raw.block_hash,block.hash);assert.equal(raw.block_height,block.height);assert(raw.values.length===1&&raw.values[0]!.key==="U1RBVEU=");const value=raw.values[0]!.value,bytes=base64Decode(value);assert(base64Encode(bytes)===value&&bytes.length>0);return {sha256:sha(bytes),value};
 };
 const state={root:await stored(ROOT),items:await stored(ITEMS)};
 const selected=[`dadadave80.${ROOT}`,`qa-maker-h1.${ROOT}`,`qa-holder-h1.${ROOT}`],players:unknown[]=[],petSnapshots:unknown[]=[],observedPets:unknown[]=[],tokenIds=new Set<string>(),polishIds=new Set<string>();
 for(const id of selected){
  const a=await account(id),access=await keys(id),bindings=await Promise.all(access.map(async k=>({publicKey:k.publicKey,player:await view(ROOT,"get_player",{public_key:k.publicKey})})));
  assert(bindings.some(b=>b.player===id),"The original selected player binding is missing.");
  const journey=await view<Record<string,unknown>>(ROOT,"tidebound_journey",{account_id:id}),checkpoint=await view(ROOT,"tidebound_checkpoint_hash",{account_id:id}),supply=await view<string>(ROOT,"nft_supply_for_owner",{account_id:id});assert(/^(0|[1-9][0-9]*)$/.test(supply)&&BigInt(supply)>0n&&BigInt(supply)<=20n);
  const nfts=await view<{token_id:string;owner_id:string}[]>(ROOT,"nft_tokens_for_owner",{account_id:id,from_index:"0",limit:20});assert(nfts.length===Number(supply)&&nfts.every(n=>n.owner_id===id));
  for(const nft of nfts){const pet=await account(nft.token_id),petKeys=await keys(nft.token_id);assert.equal(pet.global_contract_hash,UPGRADE.unchanged.pet);assert.deepEqual(petKeys,[]);petSnapshots.push({tokenId:nft.token_id,owner:id,codeHash:pet.code_hash,globalHash:pet.global_contract_hash,locked:pet.locked,keys:petKeys,state:await stored(nft.token_id)});observedPets.push({tokenId:nft.token_id,block,derivedView:await view(nft.token_id,"get_state")});}
  const inventories:unknown[]=[],seen=new Set<number>();let index=0;
  for(let page=0;;page++){
   assert(page<8&&!seen.has(index),"Inventory proof exceeded its bounded scan. Stop for review rather than omit holdings.");seen.add(index);
   const inventory=await view<{items:{mint:{token_id:string}}[];next_index:number|null}>(ITEMS,"craft_inventory",{account_id:id,from_index:index,limit:32});assert(Array.isArray(inventory.items)&&inventory.items.length<=32);inventories.push(inventory);
   for(const item of inventory.items){assert(/^lantern:[a-f0-9]{64}$/.test(item.mint.token_id));tokenIds.add(item.mint.token_id);}
   if(inventory.next_index===null)break;assert(Number.isSafeInteger(inventory.next_index)&&inventory.next_index>index);index=inventory.next_index;
  }
  if(object(journey.craft)&&object(journey.craft.evidence)){assert(typeof journey.craft.evidence.token_id==="string");tokenIds.add(journey.craft.evidence.token_id);}
  if(object(journey.polish)&&object(journey.polish.evidence)){assert(typeof journey.polish.evidence.id==="string");polishIds.add(journey.polish.evidence.id);}
  players.push({account:id,codeHash:a.code_hash,locked:a.locked,keys:access,bindings,journey,checkpoint,nftSupply:supply,nfts,inventories});
 }
 // Complete bounded NEP145-prefix scan, including recipients without a Familiar player or pet.
 // Available credit is refundable and cannot be treated as administrative deployment float.
 const creditRows=await pinned<{block_hash:string;block_height:number;values:{key:string;value:string}[]}>({request_type:"view_state",account_id:ITEMS,prefix_base64:"AQ==",include_proof:false});
 assert.equal(creditRows.block_hash,block.hash);assert.equal(creditRows.block_height,block.height);const decodedCredits=decodeItemCredits(creditRows.values,codes[ITEMS]!),itemAvailableCredit=decodedCredits.available,storageCredits=[];
 for(const credit of decodedCredits.entries){const fromView=await view(ITEMS,"storage_balance_of",{account_id:credit.accountId});assert.deepEqual(fromView,{total:credit.total.toString(),available:credit.available.toString()},"Raw credit row and public view disagree.");storageCredits.push({...credit,total:credit.total.toString(),available:credit.available.toString()});}
 const itemSnapshots=[];
 for(const token_id of [...tokenIds].sort()){
  const item=await view<{mint:{id:string}}>(ITEMS,"craft_item",{token_id});assert(item&&object(item.mint));
  const supply=await view<string>(ITEMS,"mt_supply",{token_id});assert.equal(supply,"1");
  itemSnapshots.push({tokenId:token_id,item,supply,mintReceipt:await view(ITEMS,"craft_mint_operation",{operation_id:item.mint.id}),balances:await Promise.all(selected.map(async id=>({account:id,balance:await view(ITEMS,"mt_balance_of",{account_id:id,token_id})})))});
 }
 const polishReceipts=await Promise.all([...polishIds].sort().map(async operation_id=>({operationId:operation_id,evidence:await view(ITEMS,"craft_polish_operation",{operation_id})})));
 const [config,rootProtocol,itemProtocol,protocol,gas]=await Promise.all([view(ROOT,"get_config"),view(ROOT,"tidebound_protocol"),view(ITEMS,"craft_protocol"),provider.experimental_protocolConfig({blockId:block.hash}),provider.viewGasPrice(block.hash)]);
 return {block,codes,config,rootProtocol,itemProtocol,state,accounts,protocol,gasPrice:gas.gas_price,observedPets,itemAvailableCredit:itemAvailableCredit.toString(),protected:{adminKeys,players,pets:petSnapshots,storageCredits,items:itemSnapshots,polishReceipts,nftTotalSupply:await view(ROOT,"nft_total_supply")}};
}
function quotes(snapshot:Snapshot){const state=snapshot.state as {root:{value:string}};const result={items:quoteUpgrade("items",snapshot.accounts[ITEMS],snapshot.protocol,snapshot.gasPrice,undefined,amount(snapshot.itemAvailableCredit)),root:quoteUpgrade("root",snapshot.accounts[ROOT],snapshot.protocol,snapshot.gasPrice,{value:state.root.value,codeHash:snapshot.codes[ROOT]!})};assert(result.items.required+result.root.required<=BigInt(UPGRADE.additionalCostCapYocto),"Combined storage and conservative deployment prepayment exceed 0.25 existing testNEAR.");return result;}
async function loadCandidates(){const codes={} as Record<Name,Uint8Array>;for(const name of ["items","root"] as const){codes[name]=new Uint8Array(await Bun.file(`contracts/target/deploy/familiar_${name}.wasm`).arrayBuffer());assertUpgradeArtifact(name,codes[name]);}return codes;}
function checkedKey():KeyPair {
 assert.equal(process.env.NEAR_NETWORK,"testnet");assert.equal(process.env.NEAR_ROOT,ROOT);const value=process.env.ROOT_PRIVATE_KEY;assert(typeof value==="string"&&value.startsWith("ed25519:"),"Load only the isolated reviewed project key for future explicit live execution.");
 const bytes=baseDecode(value.slice(8)),key=KeyPair.fromString(value as KeyPairString),pub=key.getPublicKey(),challenge=new TextEncoder().encode("familiar:two-contract-v2-upgrade-key-check:v1");assert(bytes.length===64&&pub.verify(challenge,key.sign(challenge).signature),"Administrative seed/public-key mismatch.");return key;
}
async function main(){
 const options=parseUpgradeArguments(process.argv.slice(2));if(!options.directory){console.info(json({mode:"LOCAL_POLICY_ONLY",...UPGRADE,rpcCalls:0,signatures:0,mutations:0,note:"No preflight has run. Pass --review-dir=<existing external specs directory> for a read-only pinned review. Future --live additionally requires its exact --approve SHA256 and separate authorization."}));return;}
 const directory=await reviewDirectory(options.directory),reviewPath=join(directory,"v2-upgrade-review.json"),journalPath=join(directory,"v2-upgrade-execution.json"),stackFence=join(SPECS,"v2-upgrade-execution-lock.json");
 if(options.live){await requireNoExecutionJournal(journalPath);await requireNoExecutionJournal(stackFence);}
 const codes=await loadCandidates(),provider=new JsonRpcProvider({url:RPC},{retries:1});
 if(!options.live){
  const baseline=await capture(provider);assertUpgradePhase(baseline,0);const costs=quotes(baseline);
  const review:Review={version:1,kind:"read-only-two-contract-v2-review",createdAt:new Date().toISOString(),policy:UPGRADE,baseline,quotes:JSON.parse(json(costs)),additionalCostCapYocto:UPGRADE.additionalCostCapYocto,limits:["Read-only preparation is not signing/deployment authorization.","Only Items then Root code-only updates; primary v1, finite economy and all stored layouts remain.","Concurrent legitimate gameplay can change frozen state. Stop for review; never restore old bytes.","No new funding, transfers, initialization, migration, Pet publication, legacy-registry use or user-wallet signing.","41 testNEAR is the existing gross authorization, not a measured remaining balance; current account balances and this additional capped quote are measured separately."]};
  await writePrivate(reviewPath,review,true);console.info(json({mode:"READ_ONLY_PREPARED",reviewPath,reviewSha256:sha(json(review)),additionalConservativeCostYocto:(costs.items.required+costs.root.required).toString(),mutations:0,signatures:0}));return;
 }
 const saved=await privateJSON(reviewPath);assert.equal(saved.sha256,options.approval,"Review digest changed.");const review=saved.value as Review;assert(review.version===1&&review.kind==="read-only-two-contract-v2-review");assert.deepEqual(review.policy,UPGRADE);assert.equal(review.additionalCostCapYocto,UPGRADE.additionalCostCapYocto);assertUpgradePhase(review.baseline,0);
 const initial=await capture(provider);assertUpgradePhase(initial,0);assertPreserved(review.baseline,initial);const initialCosts=quotes(initial);for(const name of ["items","root"] as const)assert(initialCosts[name].required<=amount(review.quotes[name].required),"Current quote increased. Prepare a separately reviewed candidate; no action was signed.");
 const key=checkedKey(),journal:Journal={version:1,kind:"private-two-contract-v2-execution",reviewSha256:saved.sha256,network:"testnet",root:ROOT,startedAt:new Date().toISOString(),status:"in-progress",steps:[],observations:[{label:"fresh-preflight",snapshot:initial,quotes:initialCosts}]};
 // Exclusive creation is the cross-process no-rerun fence. Never delete/replace an old journal.
 await writePrivate(stackFence,{kind:"permanent-v2-upgrade-execution-fence",reviewPath,reviewSha256:saved.sha256,journalPath,startedAt:journal.startedAt},true);
 await writePrivate(journalPath,journal,true);const persist=()=>writePrivate(journalPath,journal);
 try{
  for(const [index,name] of (["items","root"] as const).entries()){
   const before=await capture(provider);assertUpgradePhase(before,index as 0|1);assertPreserved(review.baseline,before);const costs=quotes(before),artifact=UPGRADE.candidates[name];assert(costs[name].required<=amount(review.quotes[name].required));
   const access=await provider.query<AccessKeyViewRaw>({request_type:"view_access_key",account_id:artifact.account,public_key:key.getPublicKey().toString(),block_id:before.block.hash});assert(access.permission==="FullAccess"&&access.block_hash===before.block.hash&&access.block_height===before.block.height&&Number.isSafeInteger(access.nonce)&&access.nonce>=0);
   const tx=createTransaction(artifact.account,key.getPublicKey(),artifact.account,BigInt(access.nonce)+1n,[actions.deployContract(codes[name])],baseDecode(before.block.hash)),signed=(await new KeyPairSigner(key).signTransaction(tx)).signedTransaction;
   const step:UpgradeStep={name,account:artifact.account,hash:codeHash(encodeTransaction(tx)),transaction:base64Encode(encodeTransaction(tx)),signedTransaction:base64Encode(signed.encode()),state:"prepared",prepayment:costs[name]};assertDeployEnvelope(step,artifact,codes[name]);journal.steps.push(step);await persist();
   // A fresh pinned proof after durable signing catches activity during the signing gap.
   const fresh=await capture(provider);assertUpgradePhase(fresh,index as 0|1);assertPreserved(review.baseline,fresh);assert(quotes(fresh)[name].required<=amount(review.quotes[name].required));
   const nonce=await provider.query<AccessKeyViewRaw>({request_type:"view_access_key",account_id:artifact.account,public_key:key.getPublicKey().toString(),block_id:fresh.block.hash});assert(nonce.permission==="FullAccess"&&nonce.block_hash===fresh.block.hash&&nonce.block_height===fresh.block.height&&nonce.nonce===access.nonce,"Administrative nonce changed. Preserve the original signed bytes without submitting.");
   const validity=(fresh.protocol as {transaction_validity_period:number}).transaction_validity_period;assert(Number.isSafeInteger(validity)&&validity>0&&fresh.block.height-before.block.height<=validity);
   const durable=(await privateJSON(journalPath)).value as Journal;assert.equal(durable.steps.at(-1)?.signedTransaction,step.signedTransaction);assert.equal(durable.steps.at(-1)?.hash,step.hash);
   const outcome=await submitUpgradeOnce(step,()=>provider.sendTransactionUntil(assertDeployEnvelope(step,artifact,codes[name]),"FINAL"),persist);step.outcome=outcome;await persist();verifyFinalOutcome(outcome,{hash:step.hash,signer:artifact.account,receiver:artifact.account});assertCodeOnlyUpgrade(outcome.transaction.actions,artifact.codeHash);step.state="final";await persist();
   const after=await capture(provider);step.after=after;await persist();assertUpgradePhase(after,(index+1) as 1|2);assertPreserved(review.baseline,after);console.info(json({step:name,hash:step.hash,status:"FINAL_CODE_AND_SELECTED_STATE_VERIFIED",block:after.block}));
  }
  journal.status="complete";await persist();console.info(json({status:"complete",journalPath,transactions:journal.steps.map(s=>({account:s.account,hash:s.hash})),limitations:"Code/state compatibility only. No player retention, physical-device recovery or v2 human-playtest claim."}));
 }catch(error){journal.status="stopped-review-required";journal.observations.push({label:"stop",error:error instanceof Error?{name:error.name,message:error.message.slice(0,500)}:{name:"UnknownError"},at:new Date().toISOString()});await persist();throw Error("Upgrade stopped for review. Keep the private journal and every original signed envelope. No retry, new nonce, funding, restore or reset was performed.",{cause:error});}
}
if(import.meta.main)await main();
// Shared only by the separately reviewed exact-prepared-envelope continuation. Importing never runs main.
export {capture,quotes,loadCandidates,reviewDirectory,writePrivate,privateJSON,checkedKey};
