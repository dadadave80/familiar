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
import { accountId, Quota, validateDelegate } from "./relay";
import { confirmedValue } from "./outcome";
import { validateSigningRequest, type AuthSigningContext } from "./auth/sign";

export function createBackend(
  root: string,
  relayerId: string,
  privateKey: KeyPairString,
  rpcUrl: string,
  auth?: Omit<AuthSigningContext,"root" | "origin">,
): Backend {
  if (
    !accountId(root) ||
    !root.endsWith(".testnet") ||
    !accountId(relayerId) ||
    !relayerId.endsWith(".testnet")
  )
    throw new Error("Testnet account IDs are required.");
  const provider = new JsonRpcProvider({ url: rpcUrl });
  const relayer = new Account(relayerId, provider, privateKey);
  const playerQuota = new Quota(30, 60_000);
  const daily = new Quota(5000, 86_400_000, 1);
  const authDaily = new Quota(100, 86_400_000, 1);
  const signatures = new Map<string, {until:number;result:Promise<unknown>}>();
  const pendingGuests = new Map<string, Promise<string>>();
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
    const items = await provider.callFunction<{registry:string}>({contractId:auth.items,method:"craft_protocol",args:{},blockQuery:{finality:"final"}});
    if (!protocol || protocol.network !== "testnet" || protocol.registry !== root || protocol.items !== auth.items || items?.registry !== root ||
      protocol.rules_version !== "tidebound_h1_v1" || protocol.content_version !== "first_light_v1") throw new Error("ERR_AUTH_STACK");
  }
  return {
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
    async guest(publicKey) {
      const existing = pendingGuests.get(publicKey);
      if (existing) return existing;
      const work = (async () => {
        await network();
        await compatibleStack();
        const registered = await view<string>("get_player", {
          public_key: publicKey,
        });
        if (registered) return registered;
        await stamps();
        const created = await relayer.callFunction<string>({
          contractId: root,
          methodName: "create_player",
          args: { public_key: publicKey },
          gas: 100_000_000_000_000n,
          waitUntil: "FINAL",
        });
        if (!created) throw new Error("ERR_CREATE_PLAYER");
        return created;
      })();
      pendingGuests.set(publicKey, work);
      try {
        return await work;
      } finally {
        pendingGuests.delete(publicKey);
      }
    },
    authSign: auth ? async (value, origin) => {
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
