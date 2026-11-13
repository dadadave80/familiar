import assert from "node:assert/strict";
import { nativeGas } from "../../../web/src/tidebound/client";
import { createHash } from "node:crypto";
import { Account, JsonRpcProvider, KeyPair, actions, baseEncode, getTransactionLastResult, nearToYocto, teraToGas, type KeyPairString } from "near-api-js";
const rpcUrl = process.env.SANDBOX_RPC!;
assert.match(rpcUrl, /^http:\/\/(127\.0\.0\.1|localhost):\d+/);
const provider = new JsonRpcProvider({ url: rpcUrl });
const sponsor = new Account(process.env.SANDBOX_ROOT!, provider, process.env.SANDBOX_SECRET as KeyPairString);
assert.equal(sponsor.accountId,"testnet");
const wasm = async (name:string) => new Uint8Array(await Bun.file(`contracts/target/deploy/familiar_${name}.wasm`).arrayBuffer());
const oldRoot=process.env.SANDBOX_V1_ROOT_WASM,oldItems=process.env.SANDBOX_V1_ITEMS_WASM;
const baseline:Record<string,string|undefined>={root:oldRoot,items:oldItems,pet:process.env.SANDBOX_V1_PET_WASM,bakery:process.env.SANDBOX_V1_BAKERY_WASM,market:process.env.SANDBOX_V1_MARKET_WASM};
assert([0,5].includes(Object.values(baseline).filter(Boolean).length),"All five frozen v1 artifacts are required for the actual deployed-stack upgrade test.");
const baselineHashes:Record<string,string>={root:"3eeoimzgrF1M9amhaRHs9jpSrPuSw1QYJFhoPAsFLyH3",items:"2s2KfRFCBhe8sgX2S7H9rC8eJcgkZSMhCoCizu6A9HXJ",pet:"CQQ63d8dNsM8oVCeEsU57USX212396zFmhtnqjgeXi1J",bakery:"EHJca21W6P2CiwJ68BpHDT2cf6YV6ByTvGwHENeC2DDv",market:"4RLBp67B5ZWJ9H8BztLfthTYMjyGR7VWmtj5k3MwxAVr"};
const originalWasm=async(name:string)=>{
  const path=baseline[name];if(!path)return wasm(name);
  const bytes=new Uint8Array(await Bun.file(path).arrayBuffer());
  assert.equal(baseEncode(createHash("sha256").update(bytes).digest()),baselineHashes[name]);return bytes;
};
async function create(parent:Account,prefix:string,funds:`${number}`="12") {
  const key=KeyPair.fromRandom("ed25519"), id=`${prefix}.${parent.accountId}`;
  await parent.createAccount({newAccountId:id,publicKey:key.getPublicKey(),nearToTransfer:nearToYocto(funds)});
  return new Account(id,provider,key.toString());
}
const change=(account:Account,contractId:string,methodName:string,args:Record<string,unknown>={},deposit=0n)=>account.callFunction({contractId,methodName,args,deposit,gas:nativeGas(methodName),waitUntil:"FINAL"});
const view=(contractId:string,method:string,args:Record<string,unknown>={}):Promise<any>=>provider.callFunction({contractId,method,args,blockQuery:{finality:"final"}});
async function relay(player:Account,receiverId:string,method:string,args:Record<string,unknown>={}) {
  const {signedDelegate}=await player.createSignedMetaTransaction({receiverId,actions:[actions.functionCall(method,args,nativeGas(method),0n)],blockHeightTtl:120});
  const result=await sponsor.signAndSendTransaction({receiverId:player.accountId,actions:[actions.signedDelegate(signedDelegate)],waitUntil:"FINAL"});
  const receipts=result.receipts_outcome??[];
  let terminal=receipts.find((receipt:any)=>receipt.outcome.executor_id===receiverId);
  const seen=new Set<string>();
  while(terminal && typeof terminal.outcome.status==="object" && "SuccessReceiptId" in terminal.outcome.status) {
    assert(!seen.has(terminal.id));seen.add(terminal.id);
    terminal=receipts.find((receipt:any)=>receipt.id===(terminal!.outcome.status as any).SuccessReceiptId);
  }
  assert(terminal,"terminal receipt required");
  if(typeof terminal.outcome.status==="object" && "Failure" in terminal.outcome.status) throw new Error(JSON.stringify(terminal.outcome.status.Failure));
  return getTransactionLastResult({status:terminal.outcome.status} as any) as any;
}
const root=await create(sponsor,"familiar","180");
const [items,bakery,market,pool,bram,...dens]=await Promise.all(["items","bakery","market","pool","bram","den-1","den-2","den-3","den-4"].map(name=>create(root,name)));
const petWasm=await originalWasm("pet");
await sponsor.signAndSendTransaction({receiverId:sponsor.accountId,actions:[actions.deployGlobalContract(petWasm,"codeHash")],waitUntil:"FINAL"});
const petHash=baseEncode(createHash("sha256").update(petWasm).digest());
for(const [account,name] of [[root,"root"],[items,"items"],[bakery,"bakery"],[market,"market"],[pool,"mock_pool"]] as const) await account.deployContract(await originalWasm(name));
await change(items,items.accountId,"new",{registry:root.accountId,bakery:bakery.accountId,market:market.accountId});
await change(bakery,bakery.accountId,"new",{items:items.accountId});
await change(market,market.accountId,"new",{registry:root.accountId,items:items.accountId,npc:bram.accountId,dens:dens.map(d=>d.accountId)});
await change(pool,pool.accountId,"new",{owner:pool.accountId});
await change(root,root.accountId,"new",{relayer:sponsor.accountId,pet_code_hash:petHash,items:items.accountId,bakery:bakery.accountId,market:market.accountId,pool:pool.accountId});
const protocol=await view(root.accountId,"tidebound_protocol");
assert.deepEqual(protocol,{network:"testnet",rules_version:"tidebound_h1_v1",content_version:"first_light_v1",...(!oldRoot?{supported_content_versions:["first_light_v1","first_light_v2"]}:{}),items:items.accountId,registry:root.accountId});
async function player(username:string,name:string) {
  const key=KeyPair.fromRandom("ed25519");
  assert.equal(await view(root.accountId,"player_name_available",{username}),true);
  const id=await change(sponsor,root.accountId,"create_named_player",{public_key:key.getPublicKey().toString(),username});
  assert.equal(id,`${username}.${root.accountId}`);
  assert.equal(await view(root.accountId,"player_name_available",{username}),false);
  assert.equal(await change(sponsor,root.accountId,"create_named_player",{public_key:key.getPublicKey().toString(),username:`other-${username}`}),id);
  assert.equal(await view(root.accountId,"player_name_available",{username:`other-${username}`}),true);
  const account=new Account(String(id),provider,key.toString());
  await sponsor.transfer({receiverId:account.accountId,amount:nearToYocto("1")}); // Disposable fixture funds for ordinary native gas/storage tests.
  const pet=await relay(account,root.accountId,"adopt",{name});
  assert.equal(pet,`${name}.${root.accountId}`);
  return {account,pet,publicKey:key.getPublicKey().toString()};
}
const alice=await player("alice","mochi"), bob=await player("bob","bramble");
const journey=(a=alice.account)=>view(root.accountId,"tidebound_journey",{account_id:a.accountId});
async function claim(account:Account,pet:string,operation_id:string,commands:string[],content_version="first_light_v1",area="beacon",tool="rope") {
  const before=await journey(account);
  const args={token_id:pet,operation_id,expected_revision:before.revision,initial_checkpoint_hash:await view(root.accountId,"tidebound_checkpoint_hash",{account_id:account.accountId}),rules_version:protocol.rules_version,content_version,tool,commands,area};
  return {args,result:await relay(account,root.accountId,"tidebound_claim",args)};
}
const first=await claim(alice.account,alice.pet,"first-device",["move:left","wait","move:center","reel:lens","return"]);
assert.equal(first.result.credit,"available");
assert.equal(first.result.workshop_salvage,1);
assert.equal(first.result.bram_budget,12);
assert.deepEqual(await relay(alice.account,root.accountId,"tidebound_claim",first.args),first.result);
assert.equal((await relay(alice.account,root.accountId,"tidebound_commission")).shells,12);
assert.equal((await relay(alice.account,root.accountId,"tidebound_commission")).shells,12);
assert.equal((await journey()).credit,"available","commission preserves protected craft credit");
const requests={token_id:alice.pet,motif:"crest",origin_claim_id:first.result.lens_claim};
const deviceKey=KeyPair.fromRandom("ed25519");
await alice.account.addFullAccessKey(deviceKey.getPublicKey());
const secondDevice=new Account(alice.account.accountId,provider,deviceKey.toString());
const [a,b]=await Promise.all([relay(alice.account,root.accountId,"tidebound_craft",requests),relay(secondDevice,root.accountId,"tidebound_craft",requests)]);
const made=await journey();
assert.equal(made.credit,"consumed");
const token=made.craft.evidence.token_id;
assert.equal(a.craft.evidence.id,b.craft.evidence.id);
assert.equal(await view(items.accountId,"mt_supply",{token_id:token}),"1");
await assert.rejects(change(alice.account,items.accountId,"mt_transfer",{receiver_id:alice.account.accountId,token_id:token,amount:"1",approval:null,memo:null},1n),/ERR_SELF_TRANSFER/);
assert.equal(await view(items.accountId,"mt_balance_of",{account_id:alice.account.accountId,token_id:token}),"1");
assert.deepEqual(await view(items.accountId,"craft_mint_operation",{operation_id:made.craft.evidence.id}),made.craft.evidence);
assert.equal((await relay(alice.account,root.accountId,"tidebound_polish",{item_id:token,expected_appearance:0})).burned_shells,12);
const polished=await view(items.accountId,"craft_item",{token_id:token});
assert.equal(polished.finish,"harbor_polish");assert.equal(polished.finish_used,true);assert.equal(polished.mint.motif,"crest");
await relay(alice.account,root.accountId,"tidebound_restore",{restoration:"beacon"});
const revision=(await journey()).revision;
await relay(alice.account,root.accountId,"tidebound_place",{item_id:token,socket:"porch",expected_revision:revision});
assert.equal((await journey()).placement.socket,"porch");
await change(bob.account,items.accountId,"storage_deposit",{account_id:bob.account.accountId,registration_only:false},nearToYocto("0.02"));
await change(alice.account,items.accountId,"mt_transfer",{receiver_id:bob.account.accountId,token_id:token,amount:"1",approval:null,memo:null},1n);
assert.equal(await view(items.accountId,"mt_balance_of",{account_id:alice.account.accountId,token_id:token}),"0");
assert.equal(await view(items.accountId,"mt_balance_of",{account_id:bob.account.accountId,token_id:token}),"1");
assert.equal((await view(items.accountId,"craft_inventory",{account_id:bob.account.accountId,from_index:0,limit:32})).items[0].mint.token_id,token);
assert.equal((await view(items.accountId,"craft_inventory",{account_id:alice.account.accountId,from_index:0,limit:32})).items.length,0);
assert.equal((await journey(bob.account)).lens_claim,null,"transfer never awards maker achievement");
await relay(bob.account,root.accountId,"tidebound_place",{item_id:token,socket:"dock",expected_revision:0});
assert.equal((await journey(bob.account)).placement.socket,"dock");
assert.equal((await journey(bob.account)).lens_claim,null);
assert.equal((await journey()).lit,true,"transfer never darkens the restored beacon");
await assert.rejects(change(alice.account,items.accountId,"mt_transfer",{receiver_id:bob.account.accountId,token_id:token,amount:"1",approval:null,memo:null},1n));
await relay(alice.account,root.accountId,"tidebound_craft",requests);
assert.equal(await view(items.accountId,"mt_supply",{token_id:token}),"1","transferred craft never remints");
const bobFirst=await claim(bob.account,bob.pet,"bob-first",["move:left","wait","move:center","reel:lens","return"]);
assert.equal(bobFirst.result.bram_budget,12,"personal budget is not shared");
assert.equal((await journey()).shells,0);
console.log("PASS isolated sandbox: canonical replay and finite reward; personal atomic commission; two concurrent crafts -> one item; finish same token once; direct standards gift; recipient inventory/placement without maker achievement; no remint; beacon persists.");
// Two calls in one action receipt reserve then request a fence before either remote receipt runs.
await relay(bob.account,root.accountId,"tidebound_commission");
const {signedDelegate:cancelDelegate}=await bob.account.createSignedMetaTransaction({receiverId:root.accountId,actions:[
  actions.functionCall("tidebound_polish",{item_id:token,expected_appearance:0},teraToGas(100),0n),
  actions.functionCall("tidebound_cancel_polish",{},teraToGas(90),0n),
],blockHeightTtl:120});
await sponsor.signAndSendTransaction({receiverId:bob.account.accountId,actions:[actions.signedDelegate(cancelDelegate)],waitUntil:"FINAL"});
const cancelled=await journey(bob.account);
assert.equal(cancelled.shells,12,"authenticated fence recovers reserved Shells after failed mutation");
assert.equal(cancelled.polish.state,"failed-safe");
assert.equal(cancelled.burned_shells,0);
assert.equal(await view(items.accountId,"craft_polish_operation",{operation_id:cancelled.polish.evidence.id}),null);
await assert.rejects(change(root,items.accountId,"craft_polish",{operation:cancelled.polish.evidence}),/ERR_FINISH_CANCELLED/);
assert.equal((await view(items.accountId,"craft_item",{token_id:token})).appearance_version,1);
console.log("PASS isolated sandbox: authenticated finish cancellation fence returns Shells once, supersedes old callbacks, and rejects the late cancelled mutation.");

// Exercise a code-only additive upgrade without reinitializing Root/Items or touching Pet.
const storedState=async(accountId:string)=>{
  const state=await provider.query<{values:{key:string;value:string}[]}>({request_type:"view_state",account_id:accountId,prefix_base64:"U1RBVEU=",finality:"final"});
  assert.equal(state.values.length,1);assert.equal(state.values[0]!.key,"U1RBVEU=");return state.values[0]!.value;
};
const snapshot=async()=>({rootState:await storedState(root.accountId),itemState:await storedState(items.accountId),config:await view(root.accountId,"get_config"),alice:await journey(),bob:await journey(bob.account),aliceBinding:await view(root.accountId,"get_player",{public_key:alice.publicKey}),bobBinding:await view(root.accountId,"get_player",{public_key:bob.publicKey}),aliceNfts:await view(root.accountId,"nft_tokens_for_owner",{account_id:alice.account.accountId,from_index:"0",limit:20}),bobNfts:await view(root.accountId,"nft_tokens_for_owner",{account_id:bob.account.accountId,from_index:"0",limit:20}),petGlobalHash:(await provider.viewAccount({accountId:alice.pet,blockQuery:{finality:"final"}})).global_contract_hash,petKeyCount:(await provider.viewAccessKeyList({accountId:alice.pet})).keys.length,bakeryCode:(await provider.viewAccount({accountId:bakery.accountId,blockQuery:{finality:"final"}})).code_hash,marketCode:(await provider.viewAccount({accountId:market.accountId,blockQuery:{finality:"final"}})).code_hash,item:await view(items.accountId,"craft_item",{token_id:token}),supply:await view(items.accountId,"mt_supply",{token_id:token})});
const beforeUpgrade=await snapshot();
assert.equal(beforeUpgrade.petKeyCount,0);assert.equal(beforeUpgrade.petGlobalHash,petHash);if(oldRoot){assert.equal(beforeUpgrade.petGlobalHash,baselineHashes.pet);assert.equal(beforeUpgrade.bakeryCode,baselineHashes.bakery);assert.equal(beforeUpgrade.marketCode,baselineHashes.market);}
for(const [account,name] of [[root,"root"],[items,"items"]] as const)await account.signAndSendTransaction({receiverId:account.accountId,actions:[actions.deployContract(await wasm(name))],waitUntil:"FINAL"});
assert.deepEqual(await snapshot(),beforeUpgrade,"A code-only upgrade preserves exact STATE bytes, old bindings, NFT, progress and immutable item receipt.");
for(const [contractId,method] of [[root.accountId,"tidebound_protocol"],[items.accountId,"craft_protocol"]]){
  const value=await view(contractId!,method!);assert.equal(value.content_version,"first_light_v1");assert.deepEqual(value.supported_content_versions,["first_light_v1","first_light_v2"]);
}
assert.deepEqual(await relay(alice.account,root.accountId,"tidebound_craft",requests),beforeUpgrade.alice);
assert.deepEqual(await view(items.accountId,"craft_item",{token_id:token}),polished);assert.equal(await view(items.accountId,"mt_supply",{token_id:token}),"1");
console.log(`PASS isolated sandbox: ${oldRoot?"actual frozen v1→v2":"same-layout"} code-only Root/Items upgrade retains exact STATE, existing identity, owner, progress, finish and v1 retry.`);

const fixtures=await Bun.file("contracts/common/fixtures/court.json").json();
const spatial=fixtures.cases.find((c:any)=>c.id==="beacon-rope-rescue");assert(spatial&&spatial.commands.length>15);
const clara=await player("clara","willow"),newClaim=await claim(clara.account,clara.pet,"spatial-first",spatial.commands,"first_light_v2");
assert.equal(newClaim.result.claims[0].content_version,"first_light_v2");assert.equal(newClaim.result.lens_claim,newClaim.result.moth_claim);assert.equal(newClaim.result.credit,"available");assert.equal(newClaim.result.workshop_salvage,1);assert.equal(newClaim.result.bram_budget,12);
assert.deepEqual(await relay(clara.account,root.accountId,"tidebound_claim",newClaim.args),newClaim.result);
await relay(clara.account,root.accountId,"tidebound_restore",{restoration:"beacon"});
const wind=fixtures.cases.find((c:any)=>c.id==="wind-rope-objective");assert(wind&&wind.commands.includes("turn:vane"));
const windClaim=await claim(clara.account,clara.pet,"spatial-wind",wind.commands,"first_light_v2","wind");assert(windClaim.result.banked.includes("vane"));
await relay(clara.account,root.accountId,"tidebound_restore",{restoration:"signal"});assert.equal((await journey(clara.account)).signaled,true);
await relay(clara.account,root.accountId,"tidebound_commission");
const spatialRequests={token_id:clara.pet,motif:"moth",origin_claim_id:newClaim.result.moth_claim},otherKey=KeyPair.fromRandom("ed25519");await clara.account.addFullAccessKey(otherKey.getPublicKey());
const [one,two]=await Promise.all([relay(clara.account,root.accountId,"tidebound_craft",spatialRequests),relay(new Account(clara.account.accountId,provider,otherKey.toString()),root.accountId,"tidebound_craft",spatialRequests)]);
const spatialMade=await journey(clara.account),spatialToken=spatialMade.craft.evidence.token_id;
assert.equal(one.craft.evidence.id,two.craft.evidence.id);assert.equal(spatialMade.craft.evidence.content_version,"first_light_v2");assert.equal(spatialMade.craft.evidence.origin_claim_id,newClaim.result.moth_claim);assert.equal(await view(items.accountId,"mt_supply",{token_id:spatialToken}),"1");
assert.deepEqual(await view(items.accountId,"craft_mint_operation",{operation_id:spatialMade.craft.evidence.id}),spatialMade.craft.evidence);
await relay(clara.account,root.accountId,"tidebound_polish",{item_id:spatialToken,expected_appearance:0});const spatialItem=await view(items.accountId,"craft_item",{token_id:spatialToken});assert.equal(spatialItem.finish_used,true);assert.equal(spatialItem.mint.content_version,"first_light_v2");assert.equal((await journey(clara.account)).burned_shells,12);
const beforeGift=await journey(bob.account);await change(clara.account,items.accountId,"mt_transfer",{receiver_id:bob.account.accountId,token_id:spatialToken,amount:"1",approval:null,memo:null},1n);
assert.deepEqual(await journey(bob.account),beforeGift,"Receiving a v2 craft cannot inherit its maker's v2 achievement.");assert.equal(beforeGift.moth_claim,null);
assert.equal(await view(items.accountId,"mt_balance_of",{account_id:bob.account.accountId,token_id:spatialToken}),"1");
await assert.rejects(change(clara.account,items.accountId,"mt_transfer",{receiver_id:bob.account.accountId,token_id:spatialToken,amount:"1",approval:null,memo:null},1n),/Balance of the sender is insufficient/);
await relay(clara.account,root.accountId,"tidebound_craft",spatialRequests);assert.equal(await view(items.accountId,"mt_supply",{token_id:spatialToken}),"1");
const rejected=await relay(bob.account,root.accountId,"tidebound_polish",{item_id:spatialToken,expected_appearance:0});assert.equal(rejected.shells,12);assert.equal(rejected.burned_shells,0);assert.equal(rejected.polish.state,"failed-safe");assert.deepEqual(await view(items.accountId,"craft_item",{token_id:spatialToken}),spatialItem);
const postUpgradeV1=await claim(bob.account,bob.pet,"later-v1-moth",["wait","move:right","move:center","move:right","take:moth","move:center","return"]);assert.equal(postUpgradeV1.result.claims.at(-1).content_version,"first_light_v1");assert.equal(postUpgradeV1.result.shells,12);assert.equal(postUpgradeV1.result.credit,"available");
assert.equal((await view(items.accountId,"craft_item",{token_id:token})).mint.content_version,"first_light_v1");
console.log("PASS isolated sandbox: v1 and spatial v2 coexist; accepted actual v2 maker origin; both goals/wheel; one personal budget; concurrent craft convergence; immutable content through finish/gift; old holder rejection/no remint/once-per-token; v1 new claims still work.");
