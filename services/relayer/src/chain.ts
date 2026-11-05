import {
  Account,
  actions,
  JsonRpcProvider,
  KeyPair,
  type KeyPairString,
  type SerializedReturnValue,
} from "near-api-js";
import type { Backend, RelayResult } from "./app";
import { accountId, Quota, validateDelegate } from "./relay";
import { confirmedValue } from "./outcome";

export function createBackend(
  root: string,
  relayerId: string,
  privateKey: KeyPairString,
  rpcUrl: string,
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
  return {
    async ready() {
      await network();
      await stamps();
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
    async relay(encoded) {
      await network();
      const block = await provider.viewBlock({ finality: "final" });
      const checked = await validateDelegate(
        encoded,
        root,
        BigInt(block.header.height),
      );
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
