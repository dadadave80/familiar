import { afterAll, beforeAll, expect, test } from "bun:test";
import { actions, base64Encode, baseEncode, createTransaction, encodeTransaction, KeyPair, KeyPairSigner, type JsonRpcProvider, type Transaction } from "near-api-js";
import type { NearAuthAccountAdapter } from "../account/adapter";
import type { PlayerBinding } from "./domain";
import { claimInput, parseJourney, TideboundClient, type CraftItem, type Journey } from "./client";

const lockQueues = new Map<string, Promise<void>>();
const priorLocks = Object.getOwnPropertyDescriptor(globalThis.navigator, "locks");
beforeAll(() => {
  Object.defineProperty(globalThis.navigator, "locks", { configurable: true, value: {
    async request<T>(name: string, work: () => Promise<T>): Promise<T> {
      const previous = lockQueues.get(name) ?? Promise.resolve();
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      const completion = previous.then(() => gate);
      lockQueues.set(name, completion);
      await previous;
      try { return await work(); }
      finally { release(); if (lockQueues.get(name) === completion) lockQueues.delete(name); }
    },
  } });
});
afterAll(() => {
  if (priorLocks) Object.defineProperty(globalThis.navigator, "locks", priorLocks);
  else Reflect.deleteProperty(globalThis.navigator, "locks");
});

const root = "tidebound.testnet", itemContract = `items.${root}`;
const key = KeyPair.fromRandom("ed25519");
const binding: PlayerBinding = { playerId: "one", network: "testnet", nearAccountId: `p-1.${root}`, signerPublicKey: key.getPublicKey().toString(), signerBindingId: "google:one" };
const blankJourney = (): Journey => ({ revision: 0, banked: [], lit: false, signaled: false, lens_claim: null, moth_claim: null, credit: "unclaimed", workshop_salvage: 0, bram_budget: 0, shells: 0, burned_shells: 0, commission_fulfilled: false, craft: null, polish: null, placement: null });
const item = (): CraftItem => ({ mint: { id: "a".repeat(64), token_id: `lantern:${"b".repeat(64)}`, maker: binding.nearAccountId, origin_claim_id: "c".repeat(64), motif: "crest", input_hash: "d".repeat(64), rules_version: "tidebound_h1_v1", content_version: "first_light_v1" }, finish: "original", appearance_version: 0, finish_used: false });
const runtimeFees={min_gas_purchase_price:"1000000000",storage_amount_per_byte:"10000000000000000000",transaction_costs:{action_receipt_creation_config:{send_sir:108059500000,send_not_sir:108059500000,execution:108059500000},action_creation_config:{function_call_cost:{send_sir:200000000000,send_not_sir:200000000000,execution:780000000000},function_call_cost_per_byte:{send_sir:2235934,send_not_sir:47683715,execution:2235934}}}};

function fixture() {
  const data = new Map<string, string>();
  const events: string[] = [];
  const authorizedOperations: string[] = [];
  let failMark = false;
  let network = "testnet", registry = root, actual = binding;
  let journey: unknown = blankJourney(), inventory: unknown = { items: [], next_index: null };
  let ownedBalance = "1", authorizationCalls = 0, broadcasts = 0, statusCalls = 0;
  let observedTransaction: Transaction | null = null;
  let status: any;
  let authorization: (() => Promise<void>) | undefined;
  let finalHeight=100, originalHeight=100, validity:unknown=86_400, accessNonce=20n, rpcUnavailable=false;
  let returnedBlockHash="11111111111111111111111111111111", protocolNetwork="testnet";
  let rawNonce:unknown=undefined,keyPermission="FullAccess",nonceBlockMismatch=false;
  let accountAmount=250000000000000000000000n,gasPrice="100000000",purchaseFloor:unknown="1000000000";
  let rootProtocolOverride:{value:unknown}|null=null,itemProtocolOverride:{value:unknown}|null=null;
  const storage = { getItem: (k: string) => data.get(k) ?? null, setItem(k: string, v: string) { data.set(k, v); events.push(`store:${JSON.parse(v).state}`); }, removeItem(k: string) { data.delete(k); events.push("clear"); } };
  const provider = {
    async getNetworkId() { return network; },
    async callFunction(input: { method: string; args: Record<string, unknown> }) {
      switch (input.method) {
        case "tidebound_protocol": return rootProtocolOverride ? rootProtocolOverride.value : { registry, items: itemContract, network: "testnet", rules_version: "tidebound_h1_v1", content_version: "first_light_v1" };
        case "craft_protocol": return itemProtocolOverride ? itemProtocolOverride.value : { registry, network: "testnet", rules_version: "tidebound_h1_v1", content_version: "first_light_v1" };
        case "get_player": return binding.nearAccountId;
        case "tidebound_journey": events.push("snapshot"); return journey;
        case "tidebound_checkpoint_hash": return "e".repeat(64);
        case "nft_tokens_for_owner": return [{ token_id: `mochi.${root}` }];
        case "craft_inventory": return inventory;
        case "mt_balance_of": return ownedBalance;
        default: throw new Error(`Unexpected fixture method ${input.method}`);
      }
    },
    async viewAccessKey(input:{finalityQuery:{blockId?:string}}) { if(rpcUnavailable)throw Error("RPC unavailable");return { nonce: accessNonce, permission: "FullAccess",block_hash:input.finalityQuery.blockId??"11111111111111111111111111111111",block_height:finalHeight }; },
    async viewBlock(input:{blockId?:string}) { if(rpcUnavailable)throw Error("RPC unavailable");return { header: { hash: input.blockId ? returnedBlockHash : "11111111111111111111111111111111", height: input.blockId ? originalHeight : finalHeight } }; },
    async viewAccount() {if(rpcUnavailable)throw Error("RPC unavailable");return {amount:accountAmount,storage_usage:182};},
    async viewGasPrice() {if(rpcUnavailable)throw Error("RPC unavailable");return {gas_price:gasPrice};},
    async experimental_protocolConfig() { if(rpcUnavailable)throw Error("RPC unavailable");return { chain_id:protocolNetwork,transaction_validity_period:validity,protocol_version:88,runtime_config:{...runtimeFees,min_gas_purchase_price:purchaseFloor} }; },
    async query(input:{request_type:string;block_id:string;account_id:string;public_key:string}) {
      if(rpcUnavailable)throw Error("RPC unavailable");
      expect(input.request_type).toBe("view_access_key");expect(input.account_id).toBe(binding.nearAccountId);expect(input.public_key).toBe(binding.signerPublicKey);
      return {nonce:rawNonce===undefined?Number(accessNonce):rawNonce,permission:keyPermission,block_hash:nonceBlockMismatch?"wrong":input.block_id,block_height:finalHeight};
    },
    async sendTransactionUntil(signed: { transaction: Transaction }) {
      broadcasts++; events.push("broadcast"); observedTransaction = signed.transaction;
      const hash = baseEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(encodeTransaction(signed.transaction)))));
      status ??= { final_execution_status: "FINAL", status: { SuccessValue: "" }, transaction: { hash, signer_id: signed.transaction.signerId, receiver_id: signed.transaction.receiverId }, receipts_outcome: [] };
      return { ...status, transaction: { ...status.transaction, hash } };
    },
    async viewTransactionStatusWithReceipts() { statusCalls++; return status; },
  } as unknown as JsonRpcProvider;
  const adapter = {
    async resolveBinding() { return actual; },
    async authorizeNative(tx: Transaction, operationId: string) {
      authorizedOperations.push(operationId);
      authorizationCalls++; events.push("authorize");
      if (authorization) await authorization();
      return (await new KeyPairSigner(key).signTransaction(tx)).signedTransaction;
    },
    markSubmitted() { if (failMark) throw new Error("quota while marking"); events.push("submitted"); },
  } as unknown as NearAuthAccountAdapter;
  const client = new TideboundClient(root, itemContract, provider, adapter, storage);
  return {
    client, data, events, authorizedOperations,
    set failMark(value: boolean) { failMark = value; },
    get statusCalls() { return statusCalls; }, get broadcasts() { return broadcasts; }, get authorizationCalls() { return authorizationCalls; }, get transaction() { return observedTransaction; },
    set network(value: string) { network = value; }, set registry(value: string) { registry = value; }, set actual(value: PlayerBinding) { actual = value; },
    set rootProtocol(value:unknown) {rootProtocolOverride={value};},set itemProtocol(value:unknown){itemProtocolOverride={value};},
    set accountAmount(value:bigint){accountAmount=value;},set gasPrice(value:string){gasPrice=value;},set purchaseFloor(value:unknown){purchaseFloor=value;},
    set journey(value: unknown) { journey = value; }, set inventory(value: unknown) { inventory = value; }, set ownedBalance(value: string) { ownedBalance = value; },
    set status(value: any) { status = value; }, set authorization(value: () => Promise<void>) { authorization = value; },
    set finalHeight(value:number) {finalHeight=value;},set originalHeight(value:number){originalHeight=value;},set validity(value:unknown){validity=value;},set accessNonce(value:bigint){accessNonce=value;},set rpcUnavailable(value:boolean){rpcUnavailable=value;},set returnedBlockHash(value:string){returnedBlockHash=value;},set protocolNetwork(value:string){protocolNetwork=value;},set rawNonce(value:unknown){rawNonce=value;},set keyPermission(value:string){keyPermission=value;},set nonceBlockMismatch(value:boolean){nonceBlockMismatch=value;},
  };
}

test("fixed protocol and canonical signer are checked before any native authorization", async () => {
  const f = fixture(); f.registry = "legacy.testnet";
  await expect(f.client.send(binding, "tidebound_commission", {})).rejects.toThrow("compatible");
  f.registry = root; f.network = "mainnet";
  await expect(f.client.send(binding, "tidebound_commission", {})).rejects.toThrow("testnet");
  f.network = "testnet"; f.actual = { ...binding, signerPublicKey: KeyPair.fromRandom("ed25519").getPublicKey().toString() };
  await expect(f.client.send(binding, "tidebound_commission", {})).rejects.toThrow("identity changed");
  expect(f.authorizationCalls).toBe(0); expect(f.broadcasts).toBe(0);
});

test("insufficient native purchase prepayment fails before signing or pending creation; no account is replaced",async()=>{
 const f=fixture();f.accountAmount=150000000000000000000000n;
 await expect(f.client.send(binding,"adopt",{name:"mochi"})).rejects.toThrow("gas prepayment");
 expect(f.data.size).toBe(0);expect(f.authorizationCalls).toBe(0);expect(f.broadcasts).toBe(0);
 f.accountAmount=250000000000000000000000n;
 await f.client.send(binding,"adopt",{name:"mochi"});expect(f.authorizationCalls).toBe(1);expect(f.broadcasts).toBe(1);expect(f.transaction?.signerId).toBe(binding.nearAccountId);
});

test("underfunded original requests retain their exact pending bytes and submitted receipts remain checkable",async()=>{
 const f=fixture();f.authorization=async()=>{throw Error("popup canceled")};
 await expect(f.client.send(binding,"adopt",{name:"mochi"})).rejects.toThrow("popup canceled");
 const original=JSON.stringify(f.client.pending(binding));f.accountAmount=150000000000000000000000n;
 await expect(f.client.resumeNative(binding)).rejects.toThrow("gas prepayment");
 expect(JSON.stringify(f.client.pending(binding))).toBe(original);expect(f.authorizationCalls).toBe(1);expect(f.broadcasts).toBe(0);
 const submitted=fixture();submitted.status={final_execution_status:"EXECUTED_OPTIMISTIC",status:"Unknown",transaction:{},receipts_outcome:[]};
 await expect(submitted.client.send(binding,"adopt",{name:"mochi"})).rejects.toThrow();
 const pending=submitted.client.pending(binding)!;submitted.accountAmount=0n;
 submitted.status={final_execution_status:"FINAL",status:{SuccessValue:""},transaction:{hash:pending.hash,signer_id:binding.nearAccountId,receiver_id:root},receipts_outcome:[]};
 expect(await submitted.client.resumeNative(binding)).toContain("finalized");expect(submitted.broadcasts).toBe(1);
});

test("both contracts must provide the full compatible protocol before signing or persisting",async()=>{
  const rootProtocol={registry:root,items:itemContract,network:"testnet",rules_version:"tidebound_h1_v1",content_version:"first_light_v1"};
  const itemsProtocol={registry:root,network:"testnet",rules_version:"tidebound_h1_v1",content_version:"first_light_v1"};
  for(const side of ["root","items"] as const){
    const valid=side==="root"?rootProtocol:itemsProtocol;
    const invalid:unknown[]=[null,undefined,[],false,"testnet",{}];
    for(const field of Object.keys(valid)){
      const missing:Record<string,unknown>={...valid};delete missing[field];
      invalid.push(missing,{...valid,[field]:field==="network"?"mainnet":"incompatible"});
    }
    for(const value of invalid){
      const f=fixture();if(side==="root")f.rootProtocol=value;else f.itemProtocol=value;
      await expect(f.client.send(binding,"tidebound_commission",{})).rejects.toThrow();
      expect(f.data.size).toBe(0);expect(f.authorizationCalls).toBe(0);expect(f.broadcasts).toBe(0);
    }
  }
});

test("unsupported native methods and payments fail before pending persistence or signing",async()=>{
  for(const request of [
    {method:"buy_pet",args:{token_id:`mochi.${root}`},options:{}},
    {method:"tidebound_commission",args:{},options:{deposit:1n}},
    {method:"tidebound_commission",args:{extra:true},options:{}},
    {method:"storage_deposit",args:{account_id:"recipient.testnet",registration_only:true},options:{receiver:itemContract,deposit:8n*10n**22n+1n}},
    {method:"mt_transfer",args:{receiver_id:"recipient.testnet",token_id:item().mint.token_id,amount:"1",approval:null,memo:null},options:{receiver:itemContract,deposit:0n}},
  ]){
    const f=fixture();
    await expect(f.client.send(binding,request.method,request.args,request.options)).rejects.toThrow();
    expect(f.data.size).toBe(0);expect(f.authorizationCalls).toBe(0);expect(f.broadcasts).toBe(0);
    expect(f.events.some(event=>event.startsWith("store:"))).toBe(false);
  }
});

test("saved unsupported actions, methods, deposits and gas never sign or broadcast and preserve their exact record",async()=>{
  for(const state of ["prepared","signed","submitted"] as const){
    for(const action of [
      actions.transfer(1n),
      actions.addFullAccessKey(KeyPair.fromRandom("ed25519").getPublicKey()),
      actions.functionCall("buy_pet",{token_id:`mochi.${root}`},50_000_000_000_000n,0n),
      actions.functionCall("tidebound_commission",{},50_000_000_000_000n,1n),
      actions.functionCall("tidebound_commission",{},280_000_000_000_001n,0n),
      actions.functionCall("tidebound_commission",{},0n,0n),
    ]){
      const f=fixture(),tx=createTransaction(binding.nearAccountId,key.getPublicKey(),root,21n,[action],new Uint8Array(32));
      const signed=(await new KeyPairSigner(key).signTransaction(tx)).signedTransaction;
      const hash=baseEncode(new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(encodeTransaction(tx)))));
      const storageKey=`familiar.tidebound.pending.v1:${root}:${binding.nearAccountId}`;
      const original=JSON.stringify({operationId:"native:unsupported",hash,method:action.functionCall?.methodName??"unsupported-action",receiver:root,transaction:base64Encode(encodeTransaction(tx)),state,...(state!=="prepared"?{signedTransaction:base64Encode(signed.encode())}:{})});
      f.data.set(storageKey,original);
      await expect(state==="submitted"?f.client.reconcileNative(binding):f.client.resumeNative(binding)).rejects.toThrow();
      expect(f.data.get(storageKey)).toBe(original);expect(f.authorizationCalls).toBe(0);expect(f.broadcasts).toBe(0);expect(f.statusCalls).toBe(0);expect(f.events).toEqual([]);
    }
  }
});

test("pending intent is durable before Auth0 opens and a second action cannot replace it", async () => {
  const f = fixture();
  let leaveAuthorization!: () => void;
  const wait = new Promise<void>(resolve => { leaveAuthorization = resolve; });
  let enteredAuthorization!: () => void;
  const entered = new Promise<void>(resolve => { enteredAuthorization = resolve; });
  let durable = false;
  f.authorization = async () => { durable = f.client.pending(binding) !== null; enteredAuthorization(); await wait; };
  f.status = { final_execution_status: "EXECUTED_OPTIMISTIC", status: "Unknown", transaction: {}, receipts_outcome: [] };
  const first = f.client.send(binding, "tidebound_commission", {}).catch(error => error);
  await entered;
  const second = f.client.send(binding, "tidebound_craft", { motif: "moth" }).catch(error => error);
  try {
    expect(durable).toBe(true);
    expect(f.authorizationCalls).toBe(1);
  } finally { leaveAuthorization(); }
  expect(await first).toBeInstanceOf(Error);
  expect(String(await second)).toContain("earlier action");
  expect(f.authorizationCalls).toBe(1);

});

test("native item deposits debit the player; submitted marker precedes broadcasting", async () => {
  const f = fixture();
  await f.client.send(binding, "mt_transfer", { receiver_id: "recipient.testnet", token_id: item().mint.token_id, amount: "1", approval: null, memo: null }, { receiver: itemContract, deposit: 1n });
  expect(f.transaction?.signerId).toBe(binding.nearAccountId);
  expect(f.transaction?.receiverId).toBe(itemContract);
  expect(f.transaction?.actions[0]?.functionCall?.deposit).toBe(1n);
  expect(f.events.indexOf("submitted")).toBeLessThan(f.events.indexOf("broadcast"));
  expect(f.client.pending(binding)).toBe(null);
  expect(f.broadcasts).toBe(1);
});

test("unknown or wrong-context final status retains the original pending action", async () => {
  for (const wrong of ["unknown", "sender", "receiver"]) {
    const f = fixture();
    f.authorization = async () => {};
    // Leave one uncertain broadcast, then alter only the status returned by the fixture node.
    f.status = { final_execution_status: "EXECUTED_OPTIMISTIC", status: "Unknown", transaction: {}, receipts_outcome: [] };
    await expect(f.client.send(binding, "tidebound_commission", {})).rejects.toThrow("may still be executing");
    const original = f.client.pending(binding)!;
    f.status = { final_execution_status: "FINAL", status: wrong === "unknown" ? "Unknown" : { SuccessValue: "" }, transaction: { hash: original.hash, signer_id: wrong === "sender" ? `p-2.${root}` : binding.nearAccountId, receiver_id: wrong === "receiver" ? "another.testnet" : root }, receipts_outcome: [] };
    await expect(f.client.reconcileNative(binding)).rejects.toThrow();
    expect(f.client.pending(binding)?.hash).toBe(original.hash);
    await expect(f.client.send(binding, "tidebound_commission", {})).rejects.toThrow("earlier action");
    expect(f.broadcasts).toBe(1);
  }
});

test("a known failed receipt clears only its native envelope, never authorizes another payment", async () => {
  const f = fixture();
  f.status = { final_execution_status: "EXECUTED_OPTIMISTIC", status: "Unknown", transaction: {}, receipts_outcome: [] };
  await expect(f.client.send(binding, "tidebound_commission", {})).rejects.toThrow();
  const original = f.client.pending(binding)!;
  f.status = { final_execution_status: "FINAL", status: { Failure: { ActionError: "ERR_FINISH_OWNER" } }, transaction: { hash: original.hash, signer_id: binding.nearAccountId, receiver_id: root }, receipts_outcome: [] };
  expect(await f.client.reconcileNative(binding)).toContain("failed");
  expect(f.client.pending(binding)).toBe(null);
  expect(f.broadcasts).toBe(1);
});

test("claim context uses the exact canonical checkpoint and a recomputed legal return", async () => {
  const f = fixture(); const snapshot = await f.client.snapshot(binding);
  const transcript = { tool: "rope" as const, banked: [], actions: ["move:left", "wait", "move:center", "reel:lens", "return"] as const, area: "beacon" as const };
  const valid = { ...transcript, actions: [...transcript.actions] };
  expect(claimInput(snapshot, valid, "one")).toMatchObject({ token_id: `mochi.${root}`, expected_revision: 0, initial_checkpoint_hash: "e".repeat(64), rules_version: "tidebound_h1_v1" });
  expect(() => claimInput(snapshot, { ...valid, banked: ["lens"] }, "two")).toThrow("different checkpoint");
  expect(() => claimInput(snapshot, { ...valid, actions: ["take:lens", "return"] }, "bad")).toThrow("legal returned");
  expect(f.authorizationCalls).toBe(0);
});

test("malformed ledger combinations are rejected instead of showing a confirmed harbor", () => {
  const invalid: unknown[] = [
    { ...blankJourney(), credit: "consumed" },
    { ...blankJourney(), lit: true },
    { ...blankJourney(), workshop_salvage: 12 },
    { ...blankJourney(), banked: ["moth"], moth_claim: null },
    { ...blankJourney(), placement: { item_id: item().mint.token_id, socket: "roof" } },
    { ...blankJourney(), craft: { state: "confirmed", evidence: {} } },
    { ...blankJourney(), polish: { state: "invented" } },
  ];
  for (const value of invalid) expect(() => parseJourney(value)).toThrow();
});

test("inventory validates mint provenance, finish and pagination; transferred entries are removed", async () => {
  const f = fixture(); f.inventory = { items: [item()], next_index: null };
  expect((await f.client.snapshot(binding)).items).toHaveLength(1);
  f.ownedBalance = "0"; expect((await f.client.snapshot(binding)).items).toEqual([]);
  f.ownedBalance = "1";
  for (const invalid of [
    { items: [{ ...item(), appearance_version: -1 }], next_index: null },
    { items: [{ ...item(), finish: "free_remint" }], next_index: null },
    { items: [{ ...item(), mint: { ...item().mint, maker: "" } }], next_index: null },
    { items: [item()], next_index: "all" },
  ]) {
    f.inventory = invalid;
    await expect(f.client.snapshot(binding)).rejects.toThrow();
  }
});

test("interrupted approval resumes the original persisted transaction and operation", async () => {
  const f = fixture(); f.authorization = async () => { throw new Error("popup canceled"); };
  await expect(f.client.send(binding, "tidebound_commission", {})).rejects.toThrow("popup canceled");
  const original = f.client.pending(binding)!;
  expect(original.state).toBe("prepared"); expect(f.broadcasts).toBe(0);
  f.authorization = async () => {};
  await f.client.resumeNative(binding);
  expect(f.authorizedOperations).toEqual([original.operationId, original.operationId]);
  expect(f.broadcasts).toBe(1); expect(f.client.pending(binding)).toBe(null);
});

test("failed submitted-marker persistence resumes signed bytes without another authorization", async () => {
  const f = fixture(); f.failMark = true;
  await expect(f.client.send(binding, "tidebound_commission", {})).rejects.toThrow("quota while marking");
  expect(f.client.pending(binding)?.state).toBe("signed"); expect(f.broadcasts).toBe(0);
  f.failMark = false;
  await f.client.resumeNative(binding);
  expect(f.authorizationCalls).toBe(1); expect(f.broadcasts).toBe(1);
});

test("reconciliation refuses a changed network before querying native status", async () => {
  const f = fixture();
  f.status = { final_execution_status: "EXECUTED_OPTIMISTIC", status: "Unknown", transaction: {}, receipts_outcome: [] };
  await expect(f.client.send(binding, "tidebound_commission", {})).rejects.toThrow();
  const before = f.statusCalls, original = f.client.pending(binding)!;
  f.network = "mainnet";
  await expect(f.client.reconcileNative(binding)).rejects.toThrow("testnet");
  expect(f.statusCalls).toBe(before); expect(f.client.pending(binding)?.hash).toBe(original.hash);
});

test("corrupted stored payload cannot be resumed or replaced with a fresh operation", async () => {
  const f = fixture(); f.authorization = async () => { throw new Error("popup canceled"); };
  await expect(f.client.send(binding, "tidebound_commission", {})).rejects.toThrow();
  const pending = f.client.pending(binding)!;
  const k = `familiar.tidebound.pending.v1:${root}:${binding.nearAccountId}`;
  f.data.set(k, JSON.stringify({ ...pending, hash: baseEncode(new Uint8Array(32)) }));
  await expect(f.client.resumeNative(binding)).rejects.toThrow("original hash");
  await expect(f.client.send(binding, "tidebound_commission", {})).rejects.toThrow("earlier action");
  expect(f.authorizationCalls).toBe(1); expect(f.broadcasts).toBe(0);
});

test("native gas covers every contract's minimum before asynchronous work",async()=>{
 const {nativeGas}=await import("./client");
 expect(nativeGas("tidebound_cancel_polish")).toBeGreaterThanOrEqual(85_000_000_000_000n);
 expect(nativeGas("tidebound_craft")).toBeGreaterThanOrEqual(100_000_000_000_000n);
 expect(nativeGas("adopt")).toBeGreaterThanOrEqual(150_000_000_000_000n);
 expect(nativeGas("tidebound_polish")).toBeGreaterThanOrEqual(80_000_000_000_000n);
});


test("cancelled approval resumes the same bytes across more than 100 blocks within protocol validity",async()=>{
 const f=fixture();f.authorization=async()=>{throw Error("popup canceled");};
 await expect(f.client.send(binding,"tidebound_commission",{})).rejects.toThrow("popup canceled");
 const original=f.client.pending(binding)!;
 f.finalHeight=250;f.validity=1000;
 expect(await f.client.resolveExpiredNative(binding)).toContain("still valid");
 expect(f.client.pending(binding)?.transaction).toBe(original.transaction);
 f.authorization=async()=>{};
 await f.client.resumeNative(binding);
 expect(f.authorizedOperations).toEqual([original.operationId,original.operationId]);
 expect(f.broadcasts).toBe(1);
});

test("permanently expired untouched nonce clears only its local envelope after a canonical snapshot",async()=>{
 const f=fixture();f.authorization=async()=>{throw Error("popup canceled");};
 await expect(f.client.send(binding,"tidebound_commission",{})).rejects.toThrow();
 const original=f.client.pending(binding)!;
 f.validity=1000;f.finalHeight=1101;
 expect(await f.client.resolveExpiredNative(binding)).toContain("without execution");
 expect(f.client.pending(binding)).toBeNull();
 expect(f.events.indexOf("snapshot")).toBeLessThan(f.events.indexOf("clear"));
 expect(f.authorizationCalls).toBe(1);expect(f.broadcasts).toBe(0);
 expect(f.authorizedOperations).toEqual([original.operationId]);
 expect((await f.client.snapshot(binding)).journey).toEqual(blankJourney());
});

test("an unknown submitted transaction with a consumed nonce is never cleared by expiry",async()=>{
 const f=fixture();f.status={final_execution_status:"EXECUTED_OPTIMISTIC",status:"Unknown",transaction:{},receipts_outcome:[]};
 await expect(f.client.send(binding,"tidebound_commission",{})).rejects.toThrow();
 const original=f.client.pending(binding)!;
 f.accessNonce=f.transaction!.nonce;f.validity=1000;f.finalHeight=1101;
 await expect(f.client.resolveExpiredNative(binding)).rejects.toThrow();
 expect(f.client.pending(binding)?.hash).toBe(original.hash);
 expect(f.broadcasts).toBe(1);
});

test("expiry proof fails closed on RPC, protocol, block, identity or snapshot disagreement",async()=>{
 for(const wrong of ["rpc","missing-period","zero-period","fraction-period","unsafe-period","string-period","protocol-network","hash","future-block","network","key","snapshot","unsafe-nonce","nonce-permission","nonce-block"]){
  const f=fixture();f.authorization=async()=>{throw Error("popup canceled");};
  await expect(f.client.send(binding,"tidebound_commission",{})).rejects.toThrow();
  const original=f.client.pending(binding)!;f.finalHeight=1101;f.validity=1000;
  if(wrong==="rpc")f.rpcUnavailable=true;
  if(wrong==="missing-period")f.validity=undefined;
  if(wrong==="zero-period")f.validity=0;
  if(wrong==="fraction-period")f.validity=1.1;
  if(wrong==="unsafe-period")f.validity=Number.MAX_SAFE_INTEGER+1;
  if(wrong==="string-period")f.validity="1000";
  if(wrong==="protocol-network")f.protocolNetwork="mainnet";
  if(wrong==="hash")f.returnedBlockHash=baseEncode(new Uint8Array(32).fill(1));
  if(wrong==="future-block")f.originalHeight=1200;
  if(wrong==="network")f.network="mainnet";
  if(wrong==="key")f.actual={...binding,signerPublicKey:KeyPair.fromRandom("ed25519").getPublicKey().toString()};
  if(wrong==="snapshot")f.journey={...blankJourney(),credit:"consumed"};
  if(wrong==="unsafe-nonce")f.rawNonce=Number.MAX_SAFE_INTEGER+1;
  if(wrong==="nonce-permission")f.keyPermission="FunctionCall";
  if(wrong==="nonce-block")f.nonceBlockMismatch=true;
  await expect(f.client.resolveExpiredNative(binding)).rejects.toThrow();
  expect(f.client.pending(binding)?.hash).toBe(original.hash);
  expect(f.events).not.toContain("clear");expect(f.broadcasts).toBe(0);
 }
});

test("expired request at the validity boundary stays pending and corrupt bytes cannot be cleared",async()=>{
 const f=fixture();f.authorization=async()=>{throw Error("popup canceled");};
 await expect(f.client.send(binding,"tidebound_commission",{})).rejects.toThrow();
 f.validity=1000;f.finalHeight=1100;
 expect(await f.client.resolveExpiredNative(binding)).toContain("still valid");
 const original=f.client.pending(binding)!;
 const storageKey=`familiar.tidebound.pending.v1:${root}:${binding.nearAccountId}`;
 f.data.set(storageKey,JSON.stringify({...original,hash:baseEncode(new Uint8Array(32).fill(2))}));
 f.finalHeight=1101;
 await expect(f.client.resolveExpiredNative(binding)).rejects.toThrow("original hash");
 expect(f.events).not.toContain("clear");
});


test("an unknown submitted envelope clears only after permanent expiry and an untouched finalized nonce",async()=>{
 const f=fixture();f.status={final_execution_status:"EXECUTED_OPTIMISTIC",status:"Unknown",transaction:{},receipts_outcome:[]};
 await expect(f.client.send(binding,"tidebound_commission",{})).rejects.toThrow();
 expect(f.client.pending(binding)?.state).toBe("submitted");
 f.validity=1000;f.finalHeight=1101;
 expect(await f.client.resolveExpiredNative(binding)).toContain("without execution");
 expect(f.client.pending(binding)).toBeNull();expect(f.broadcasts).toBe(1);expect(f.authorizationCalls).toBe(1);
 expect(f.events.indexOf("snapshot")).toBeLessThan(f.events.indexOf("clear"));
});

test("a configured direct-child username can sign while nested account snapshots fail closed",async()=>{
 const f=fixture();const named={...binding,nearAccountId:`tide_cat.${root}`};f.actual=named;
 await f.client.send(named,"tidebound_commission",{});expect(f.transaction?.signerId).toBe(named.nearAccountId);
 await expect(f.client.snapshot({...binding,nearAccountId:`cat.nested.${root}`})).rejects.toThrow("different harbor");
});
