import {
  Account,
  actions,
  baseEncode,
  teraToGas,
  JsonRpcProvider,
  KeyPair,
  type KeyPairString,
  type SerializedReturnValue,
} from "near-api-js";
import type { Backend, RelayResult } from "./app";
import { AccountDoesNotExistError } from "near-api-js/rpc-errors";
import { isPlayerAccount, usernameAccountId, UsernameError, type UsernameAvailability } from "../../../web/src/account/names";
import { accountId, Quota, validateDelegate } from "./relay";
import { confirmedValue } from "./outcome";
import { validateSigningRequest, type AuthSigningContext } from "./auth/sign";
import { assertTideboundProtocol } from "../../../web/src/tidebound/protocol";

export type AccountBackendConfig =
  | (Omit<AuthSigningContext,"root"|"origin"> & {provider?:"near-auth"})
  | {provider:"privy";items:string;origins:readonly string[]};

export function createBackend(
  root: string,
  relayerId: string,
  privateKey: KeyPairString,
  rpcUrl: string,
  auth?: AccountBackendConfig,
): Backend {
  if (
    !accountId(root) ||
    !root.endsWith(".testnet") ||
    !accountId(relayerId) ||
    !relayerId.endsWith(".testnet")
  )
    throw new Error("Testnet account IDs are required.");
  if(auth&&auth.items!==`items.${root}`)throw new Error("ERR_AUTH_STACK");
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const relayer = new Account(relayerId, provider, privateKey);
  const playerQuota = new Quota(30, 60_000);
  const daily = new Quota(5000, 86_400_000, 1);
  const authDaily = new Quota(100, 86_400_000, 1);
  const signatures = new Map<string, {until:number;result:Promise<unknown>}>();
  const pendingGuests = new Map<string, {username?:string;result:Promise<string>}>();
  const deliveries = new Map<
    string,
    { until: number; result: Promise<RelayResult> }
  >();
  async function network() {
    if ((await provider.getNetworkId()) !== "testnet")
      throw new Error("Refusing a non-testnet RPC.");
  }
  async function stamps() {
    const balance = await provider.viewAccount({ accountId: relayerId });
    if (
      balance.amount - BigInt(balance.storage_usage) * 10n ** 19n <
      2n * 10n ** 23n
    )
      throw new Error("ERR_QUOTA");
  }
  async function view<T extends SerializedReturnValue>(
    method: string,
    args: Record<string, unknown>,
  ) {
    return provider.callFunction<T>({
      contractId: root,
      method,
      args,
      blockQuery: { finality: "final" },
    });
  }
  async function compatibleStack() {
    if (!auth) return;
    const protocol = await view<{network:string;registry:string;items:string;rules_version:string;content_version:string}>("tidebound_protocol",{});
    const items = await provider.callFunction<Record<string,string>>({contractId:auth.items,method:"craft_protocol",args:{},blockQuery:{finality:"final"}});
    assertTideboundProtocol(root,protocol,items,"ERR_AUTH_STACK");
  }
  async function availability(username:string):Promise<UsernameAvailability> {
    const accountId=usernameAccountId(username,root);
    const ledgerAvailable=await view<boolean>("player_name_available",{username});
    if(typeof ledgerAvailable!=="boolean")throw new Error("ERR_AUTH_STACK");
    let exists=true;
    try{await provider.viewAccount({accountId,blockQuery:{finality:"final"}});}
    catch(error){
      if(error instanceof AccountDoesNotExistError && error.accountId===accountId)exists=false;
      else throw error;
    }
    return {username,accountId,available:ledgerAvailable&&!exists,root,network:"testnet"};
  }
  return {
    accountProvider:auth ? auth.provider??"near-auth":undefined,
    async ready() {
      await network();
      await stamps();
      await compatibleStack();
      const config = await view<{ relayer: string }>("get_config", {});
      if (config?.relayer !== relayerId) return false;
      await provider.viewAccessKey({
        accountId: relayerId,
        publicKey: KeyPair.fromString(privateKey).getPublicKey(),
        finalityQuery: { finality: "final" },
      });
      return true;
    },
    usernameAvailable:auth ? async username=>{
      usernameAccountId(username,root);
      await network();await compatibleStack();
      return availability(username);
    }:undefined,
    async guest(publicKey,username) {
      const existing = pendingGuests.get(publicKey);
      if(existing){
        if(auth && existing.username!==username)throw new UsernameError("ERR_USERNAME_PENDING");
        return existing.result;
      }
      const work = (async () => {
        await network();
        await compatibleStack();
        const registered = await view<string>("get_player", {
          public_key: publicKey,
        });
        if(registered){
          if(!isPlayerAccount(registered,root))throw new Error("ERR_AUTH_BINDING");
          return registered;
        }
        if(auth){
          if(username===undefined)throw new UsernameError("ERR_USERNAME_REQUIRED");
          if(!(await availability(username)).available)throw new UsernameError("ERR_USERNAME_TAKEN");
        }
        await stamps();
        const created = await relayer.callFunction<string>({
          contractId: root,
          methodName: auth ? "create_named_player":"create_player",
          args: auth ? {public_key:publicKey,username}:{public_key:publicKey},
          gas: 100_000_000_000_000n,
          waitUntil: "FINAL",
        });
        if (!created || !isPlayerAccount(created,root)) throw new Error("ERR_CREATE_PLAYER");
        return created;
      })();
      pendingGuests.set(publicKey, {username,result:work});
      try {
        return await work;
      } finally {
        pendingGuests.delete(publicKey);
      }
    },
    authSign: auth && auth.provider!=="privy" ? async (value, origin) => {
      const checked = validateSigningRequest(value,{...auth,root,origin});
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(checked.transaction.encode())))).map(b=>b.toString(16).padStart(2,"0")).join("");
      for (const [id,entry] of signatures) if (entry.until < Date.now()) signatures.delete(id);
      const signatureId = `${checked.userId}:${auth.clientId}:${digest}`;
      const previous = signatures.get(signatureId);
      if (previous) return previous.result;
      if (signatures.size >= 1000) throw new Error("ERR_QUOTA");
      const work = (async () => {
      await network();
      await compatibleStack();
      const derived = await provider.callFunction<string>({
        contractId:"v1.signer-prod.testnet",method:"derived_public_key",
        args:{path:`jwt#https://login.testnet.fast-auth.com/#${checked.userId}`,predecessor:"fast-auth.testnet",domain_id:1},
        blockQuery:{finality:"final"},
      });
      const binding = await view<string>("get_player",{public_key:checked.publicKey});
      if (derived !== checked.publicKey || binding !== checked.transaction.signerId) throw new Error("ERR_AUTH_BINDING");
      const access = await provider.viewAccessKey({accountId:checked.transaction.signerId,publicKey:checked.transaction.publicKey,finalityQuery:{finality:"final"}});
      if (access.permission !== "FullAccess" || access.nonce >= checked.transaction.nonce) throw new Error("ERR_NONCE");
      // A stale or fabricated block hash must not spend the sponsor's MPC budget.
      const originalHash=baseEncode(new Uint8Array(checked.transaction.blockHash));
      const [block,final]=await Promise.all([provider.viewBlock({blockId:originalHash}),provider.viewBlock({finality:"final"})]);
      if(block.header.hash!==originalHash || !Number.isSafeInteger(block.header.height) || block.header.height<0 ||
        !Number.isSafeInteger(final.header.height) || final.header.height<block.header.height || typeof final.header.hash!=="string")throw new Error("ERR_AUTH_BLOCK");
      const protocol=await provider.experimental_protocolConfig({blockId:final.header.hash});
      const validity=protocol.transaction_validity_period;
      if(protocol.chain_id!=="testnet" || typeof validity!=="number" || !Number.isSafeInteger(validity) || validity<=0)throw new Error("ERR_AUTH_PROTOCOL");
      if(BigInt(final.header.height)-BigInt(block.header.height)>BigInt(validity))throw new Error("ERR_AUTH_BLOCK");
      await stamps();
      if (!playerQuota.take(binding) || !authDaily.take("all")) throw new Error("ERR_QUOTA");
      return relayer.callFunction({contractId:"fast-auth.testnet",methodName:"sign",args:checked.request,gas:teraToGas(300),deposit:10n**22n,waitUntil:"FINAL"});
      })();
      signatures.set(signatureId,{until:Date.now()+180_000,result:work});
      return work;
    } : undefined,
    async relay(encoded) {
      await network();
      const block = await provider.viewBlock({ finality: "final" });
      const checked = await validateDelegate(
        encoded,
        root,
        BigInt(block.header.height),
      );
      if (auth && checked.method === "buy_pet") throw new Error("ERR_PLAYER_FUNDED_PURCHASE_REQUIRED");
      const id = Array.from(
        new Uint8Array(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(encoded),
          ),
        ),
      )
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      for (const [key, entry] of deliveries)
        if (entry.until < Date.now()) deliveries.delete(key);
      const existing = deliveries.get(id);
      if (existing) return existing.result;
      if (deliveries.size >= 10_000) throw new Error("ERR_QUOTA");
      const work = (async () => {
        const access = await provider.viewAccessKey({
          accountId: checked.senderId,
          publicKey: checked.publicKey,
          finalityQuery: { finality: "final" },
        });
        if (access.nonce >= checked.nonce || access.permission !== "FullAccess")
          throw new Error("ERR_NONCE");
        await stamps();
        if (!playerQuota.take(checked.senderId) || !daily.take("all"))
          throw new Error("ERR_QUOTA");
        const outcome = await relayer.signAndSendTransaction({
          receiverId: checked.senderId,
          actions: [actions.signedDelegate(checked.signed)],
          waitUntil: "FINAL",
        });
        const value = confirmedValue(
          outcome,
          checked.signed.delegateAction.receiverId,
          checked.method,
        );
        return {
          hash: outcome.transaction.hash,
          receiptSentenceKey: checked.receiptSentenceKey,
          value,
        };
      })();
      deliveries.set(id, { until: Date.now() + 180_000, result: work });
      return work;
    },
  };
}
