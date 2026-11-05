import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Account, JsonRpcProvider, KeyPair, actions, baseEncode, getTransactionLastResult, nearToYocto, teraToGas, type KeyPairString } from 'near-api-js';

const rpcUrl = process.env.SANDBOX_RPC!;
assert.match(rpcUrl, /^http:\/\/(127\.0\.0\.1|localhost):\d+/);
const provider = new JsonRpcProvider({ url: rpcUrl });
const sponsor = new Account(process.env.SANDBOX_ROOT!, provider, process.env.SANDBOX_SECRET as KeyPairString);
const wasm = async (name: string) => new Uint8Array(await Bun.file(`contracts/target/deploy/familiar_${name}.wasm`).arrayBuffer());
async function create(parent: Account, prefix: string, funds: `${number}` = '50') {
  const key = KeyPair.fromRandom('ed25519');
  const id = `${prefix}.${parent.accountId}`;
  await parent.createAccount({newAccountId:id,publicKey:key.getPublicKey(),nearToTransfer:nearToYocto(funds)});
  return new Account(id,provider,key.toString());
}
async function change(account: Account, contractId: string, methodName: string, args = {}, deposit = 0n) {
  return account.callFunction({contractId,methodName,args,deposit,gas:teraToGas(280),waitUntil:'FINAL'});
}
const view = (contractId: string, method: string, args = {}):Promise<any> => provider.callFunction({contractId,method,args});
async function rpc(method: string, params: object) {
  const response = await fetch(rpcUrl,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30_000)});
  const body = await response.json();
  assert(!body.error, JSON.stringify(body.error));return body.result;
}
async function advance() { await rpc('sandbox_fast_forward',{delta_height:400}); }
async function relay(player: Account, receiverId: string, method: string, args = {}, deposit = 0n, gas = 250) {
  const {signedDelegate}=await player.createSignedMetaTransaction({receiverId,actions:[actions.functionCall(method,args,teraToGas(gas),deposit)],blockHeightTtl:120});
  const result=await sponsor.signAndSendTransaction({receiverId:signedDelegate.delegateAction.senderId,actions:[actions.signedDelegate(signedDelegate)],waitUntil:"FINAL"});
  const receipts=result.receipts_outcome??[];
  let terminal=receipts.find((receipt:any)=>receipt.outcome.executor_id===receiverId);
  const seen=new Set<string>();
  while(terminal && typeof terminal.outcome.status==='object' && 'SuccessReceiptId' in terminal.outcome.status){
    assert(!seen.has(terminal.id),'receipt chain must not cycle');seen.add(terminal.id);
    const next=terminal.outcome.status.SuccessReceiptId;
    terminal=receipts.find((receipt:any)=>receipt.id===next);
  }
  assert(terminal,'returned inner receipt must exist');
  if(typeof terminal.outcome.status==='object' && 'Failure' in terminal.outcome.status)throw new Error(JSON.stringify(terminal.outcome.status.Failure));
  const value=getTransactionLastResult({status:terminal.outcome.status} as any);
  return {result,value};
}
function confirmed(value: unknown, context: string) { assert.equal(value,true,context); }

const root=await create(sponsor,'familiar','180');
const [items,bakery,market,pool,bram,...dens]=await Promise.all(['items','bakery','market','pool','bram','den-1','den-2','den-3','den-4'].map(name=>create(root,name,'12')));
const petWasm=await wasm('pet');
await sponsor.signAndSendTransaction({receiverId:sponsor.accountId,actions:[actions.deployGlobalContract(petWasm,'codeHash')],waitUntil:'FINAL'});
const petHash=baseEncode(createHash('sha256').update(petWasm).digest());
for (const [account,name] of [[root,'root'],[items,'items'],[bakery,'bakery'],[market,'market'],[pool,'mock_pool']] as const) {
  await account.deployContract(await wasm(name));
}
await change(items,items.accountId,'new',{registry:root.accountId,bakery:bakery.accountId,market:market.accountId});
await change(bakery,bakery.accountId,'new',{items:items.accountId});
await change(market,market.accountId,'new',{registry:root.accountId,items:items.accountId,npc:bram.accountId,dens:dens.map(d=>d.accountId)});
await change(pool,pool.accountId,'new',{owner:pool.accountId});
await change(root,root.accountId,'new',{relayer:sponsor.accountId,pet_code_hash:petHash,items:items.accountId,bakery:bakery.accountId,market:market.accountId,pool:pool.accountId});
const playerKey=KeyPair.fromRandom('ed25519');
const playerId=await change(sponsor,root.accountId,'create_player',{public_key:playerKey.getPublicKey().toString()});
assert.equal(await view(root.accountId,'get_player',{public_key:playerKey.getPublicKey().toString()}),playerId);
const player=new Account(String(playerId),provider,playerKey.toString());
await assert.rejects(relay(player,root.accountId,'adopt',{name:'mochi'},0n,40),/ERR_GAS/);
assert.equal(await view(root.accountId,'nft_token',{token_id:`mochi.${root.accountId}`}),null);
const adopted=await relay(player,root.accountId,'adopt',{name:'mochi'});
const pet=String(adopted.value);
assert.equal(pet,`mochi.${root.accountId}`);
assert.equal((await provider.viewAccessKeyList({accountId:pet})).keys.length,0,'pet has no access keys');
assert.equal((await rpc('query',{request_type:'view_account',account_id:pet,finality:'final'})).global_contract_hash,petHash,'immutable global reference matches optimized pet artifact');
assert.equal((await view(root.accountId,'nft_token',{token_id:pet})).owner_id,player.accountId);
const context=await relay(player,root.accountId,'auth_context');
assert.equal((context.value as any).predecessor,player.accountId);
assert.equal((context.value as any).signer,sponsor.accountId);
await assert.rejects(relay(player,root.accountId,'act',{token_id:pet,action:{kind:'feed'}},0n,40),/ERR_GAS/);
await assert.rejects(relay(player,root.accountId,'nft_transfer_call',{receiver_id:pool.accountId,token_id:pet,approval_id:null,memo:null,msg:'reject'},1n,40),/ERR_GAS/);
assert.equal(await view(root.accountId,'is_busy',{token_id:pet}),false);
assert.equal((await view(pet,'get_state')).pending,null);
console.log('PASS keyless global pet adoption; delegate predecessor/signer semantics; low-gas commands rejected before locks');
const act = async (action: object, account = player) => {
 const outcome=await relay(account,root.accountId,'act',{token_id:pet,action});
 confirmed(outcome.value,JSON.stringify(action)); return outcome;
};
await act({kind:'feed'});
await act({kind:'forage',spot:'mill'});
await act({kind:'forage',spot:'well'});
assert.deepEqual(await view(items.accountId,'mt_batch_balance_of',{account_id:pet,token_ids:['flour','water']}),['2','2']);
for(let n=0;n<4;n++){await advance();await act({kind:'feed'});}
assert((await view(pet,'get_state')).level>=4);
await act({kind:'craft'});
assert.equal(await view(items.accountId,'mt_balance_of',{account_id:pet,token_id:'bread'}),'1');
console.log('PASS feed, deterministic forage, progression, atomic bread recipe');
const broke=await relay(player,root.accountId,'act',{token_id:pet,action:{kind:'sell_to_npc',item:'bread',quantity:'1'}});
assert.equal(broke.value,false,'broke Bram does not accept stock');
assert.equal(await view(items.accountId,'mt_balance_of',{account_id:pet,token_id:'bread'}),'1');
await change(bram,market.accountId,'npc_deposit',{},nearToYocto('1'));
const restricted=KeyPair.fromRandom('ed25519');
await bram.addFunctionCallAccessKey({publicKey:restricted.getPublicKey(),contractId:market.accountId,methodNames:['set_quotes'],allowance:nearToYocto('1')});
const restrictedBram=new Account(bram.accountId,provider,restricted.toString());
const quoteRows=(await view(market.accountId,'get_npc')).quotes.map(({item,bid,ask,max_qty}:any)=>({item,bid,ask,max_qty}));
confirmed(await change(restrictedBram,market.accountId,'set_quotes',{quotes:quoteRows}),'quote + stock sync');
await assert.rejects(change(restrictedBram,market.accountId,'npc_deposit'),/MethodNotAllowed|MethodNameMismatch|does not allow method|not allowed|not permitted/i);
await change(root,items.accountId,'register_building',{account:root.accountId});
await change(root,items.accountId,'storage_deposit',{account_id:root.accountId,registration_only:false},nearToYocto('0.02'));
await change(root,items.accountId,'game_mint',{to:root.accountId,ids:['water'],amounts:['3']});
await change(root,items.accountId,'mt_transfer',{receiver_id:market.accountId,token_id:'water',amount:'3',approval:null,memo:null},1n);
const refreshQuotes=(await view(market.accountId,'get_npc')).quotes.map(({item,bid,ask,max_qty}:any)=>({item,bid,ask,max_qty}));
confirmed(await change(restrictedBram,market.accountId,'set_quotes',{quotes:refreshQuotes}),'stock reconciliation');
assert.equal((await view(market.accountId,'get_npc')).quotes.find((q:any)=>q.item==='water').stock,'3');
await act({kind:'sell_to_npc',item:'bread',quantity:'1'});
assert.equal(await view(items.accountId,'mt_balance_of',{account_id:pet,token_id:'bread'}),'0');
assert.equal((await view(market.accountId,'get_npc')).quotes.find((q:any)=>q.item==='bread').stock,'1');
console.log('PASS Bram-broke rollback, scoped function-call key, NPC sale and fee');
while((await view(pet,'get_state')).xp<16){await advance();await act({kind:'feed'});}
await act({kind:'join_den',den:2});
const breadQuote=(await view(market.accountId,'get_npc')).quotes.find((q:any)=>q.item==='bread');
await act({kind:'buy_from_npc',item:'bread',quantity:'1',amount:breadQuote.ask});
assert.equal(await view(items.accountId,'mt_balance_of',{account_id:pet,token_id:'bread'}),'1');
await act({kind:'sleep',amount:nearToYocto('0.01').toString()});
assert.equal(await view(pool.accountId,'get_account_staked_balance',{account_id:pet}),nearToYocto('0.01').toString());
await act({kind:'wake'});
assert.equal((await view(pet,'get_state')).sleeping,false);
await advance();await advance();
const state=await view(pet,'get_state');
// Sandbox epochs are real; fast-forward until the contract's unlock epoch is reached.
for(let n=0;n<20;n++){
 const epoch=await view(root.accountId,'get_epoch');
 if(BigInt(epoch)>=BigInt(state.unstaking_epoch))break;
 await advance();
}
await act({kind:'withdraw'});
assert.equal((await view(pet,'get_state')).unstaking_epoch,null);
console.log('PASS den join, NPC purchase, stake, unbond and withdrawal');
const returned=(await relay(player,root.accountId,'nft_transfer_call',{receiver_id:pool.accountId,token_id:pet,approval_id:null,memo:null,msg:'reject'},1n)).value;
assert.equal(returned,false);
assert.equal((await view(root.accountId,'nft_token',{token_id:pet})).owner_id,player.accountId);
assert.equal(await view(root.accountId,'is_busy',{token_id:pet}),false);
const forged=await player.createSignedMetaTransaction({receiverId:root.accountId,actions:[actions.functionCall('act',{token_id:pet,action:{kind:'feed'}},teraToGas(250),0n)]});
forged.signedDelegate.signature.data[0]^=1;
await assert.rejects(sponsor.signAndSendTransaction({receiverId:player.accountId,actions:[actions.signedDelegate(forged.signedDelegate)],waitUntil:'FINAL'}),/signature/i);
const buyerKey=KeyPair.fromRandom('ed25519');
const buyerId=await change(sponsor,root.accountId,'create_player',{public_key:buyerKey.getPublicKey().toString()});
const buyer=new Account(String(buyerId),provider,buyerKey.toString());
const oldInventory=await view(items.accountId,'mt_batch_balance_of',{account_id:pet,token_ids:['flour','water','bread']});
const oldSavings=(await provider.viewAccount({accountId:pet})).amount;
await relay(player,root.accountId,'nft_approve',{token_id:pet,account_id:market.accountId,msg:JSON.stringify({price:nearToYocto('0.04').toString(),den:4})},nearToYocto('0.01'));
const listings=await view(market.accountId,'get_listings');assert.equal(listings[0].token_id,pet);
const feesBefore=(await view(market.accountId,'get_npc')).den_fees;
const sale=await relay(buyer,market.accountId,'buy_pet',{token_id:pet},nearToYocto('0.04'));
confirmed(sale.value,'resale');
const feesAfter=(await view(market.accountId,'get_npc')).den_fees;
assert.equal(BigInt(feesAfter[1])-BigInt(feesBefore[1]),nearToYocto('0.0008'),'2% follows actual den');
assert.equal((await provider.viewAccount({accountId:pet})).amount,oldSavings);
assert.equal((await view(root.accountId,'nft_token',{token_id:pet})).owner_id,buyer.accountId);
await assert.rejects(relay(player,root.accountId,'act',{token_id:pet,action:{kind:'feed'}}),/ERR_NOT_OWNER/);
await advance();await act({kind:'feed'},buyer);
assert.deepEqual(await view(items.accountId,'mt_batch_balance_of',{account_id:pet,token_ids:['flour','water','bread']}),oldInventory);
assert.equal((await provider.viewAccessKeyList({accountId:pet})).keys.length,0);
console.log('PASS resale moves authority; inventory, savings and keylessness stay with pet');
console.log('SANDBOX CORE LOOP PASSED');
