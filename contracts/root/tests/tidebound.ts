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
const petWasm=await wasm("pet");
await sponsor.signAndSendTransaction({receiverId:sponsor.accountId,actions:[actions.deployGlobalContract(petWasm,"codeHash")],waitUntil:"FINAL"});
const petHash=baseEncode(createHash("sha256").update(petWasm).digest());
for(const [account,name] of [[root,"root"],[items,"items"],[bakery,"bakery"],[market,"market"],[pool,"mock_pool"]] as const) await account.deployContract(await wasm(name));
await change(items,items.accountId,"new",{registry:root.accountId,bakery:bakery.accountId,market:market.accountId});
await change(bakery,bakery.accountId,"new",{items:items.accountId});
await change(market,market.accountId,"new",{registry:root.accountId,items:items.accountId,npc:bram.accountId,dens:dens.map(d=>d.accountId)});
await change(pool,pool.accountId,"new",{owner:pool.accountId});
await change(root,root.accountId,"new",{relayer:sponsor.accountId,pet_code_hash:petHash,items:items.accountId,bakery:bakery.accountId,market:market.accountId,pool:pool.accountId});
const protocol=await view(root.accountId,"tidebound_protocol");
assert.deepEqual(protocol,{network:"testnet",rules_version:"tidebound_h1_v1",content_version:"first_light_v1",items:items.accountId,registry:root.accountId});
async function player(name:string) {
  const key=KeyPair.fromRandom("ed25519");
  const id=await change(sponsor,root.accountId,"create_player",{public_key:key.getPublicKey().toString()});
  const account=new Account(String(id),provider,key.toString());
  await sponsor.transfer({receiverId:account.accountId,amount:nearToYocto("1")}); // Disposable fixture funds for ordinary native gas/storage tests.
  const pet=await relay(account,root.accountId,"adopt",{name});
  assert.equal(pet,`${name}.${root.accountId}`);
  return {account,pet};
}
const alice=await player("mochi"), bob=await player("bramble");
const journey=(a=alice.account)=>view(root.accountId,"tidebound_journey",{account_id:a.accountId});
async function claim(account:Account,pet:string,operation_id:string,commands:string[]) {
  const before=await journey(account);
  const args={token_id:pet,operation_id,expected_revision:before.revision,initial_checkpoint_hash:await view(root.accountId,"tidebound_checkpoint_hash",{account_id:account.accountId}),rules_version:protocol.rules_version,content_version:protocol.content_version,tool:"rope",commands,area:"beacon"};
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
