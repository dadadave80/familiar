import { deserialize } from "borsh";
import {
  base64Decode,
  base64Encode,
  encodeDelegateAction,
  encodeSignedDelegate,
  KeyType,
  PublicKey,
  SCHEMA,
  type SignedDelegate,
} from "near-api-js";

export const STAMPS = "The Post Office is out of stamps; back in a minute.";
const kinds = new Set([
  "feed",
  "forage",
  "craft",
  "sleep",
  "wake",
  "withdraw",
  "sell_to_npc",
  "buy_from_npc",
  "join_den",
  "claim_market",
]);
const items = new Set([
  "flour",
  "water",
  "berries",
  "bread",
  "hat",
  "scarf",
  "lantern",
]);
export const accountId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length <= 64 &&
  /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(value);
const decimal = (value: unknown) =>
  typeof value === "string" && /^(0|[1-9][0-9]{0,37})$/.test(value);
function check(ok: unknown, code: string): asserts ok {
  if (!ok) throw new Error(code);
}

export async function validateDelegate(
  encoded: unknown,
  root: string,
  blockHeight: bigint,
) {
  check(
    typeof encoded === "string" &&
      encoded.length <= 12_000 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(encoded),
    "ERR_ENCODING",
  );
  const bytes = base64Decode(encoded);
  let signed: SignedDelegate;
  try {
    signed = deserialize(
      SCHEMA.SignedDelegate,
      bytes,
    ) as unknown as SignedDelegate;
  } catch {
    throw new Error("ERR_ENCODING");
  }
  check(base64Encode(encodeSignedDelegate(signed)) === encoded, "ERR_ENCODING");
  const d = signed.delegateAction;
  check(
    accountId(d.senderId) &&
      (d.senderId.endsWith(".testnet") || /^[a-f0-9]{64}$/.test(d.senderId)),
    "ERR_SENDER",
  );
  check(
    d.receiverId === root || d.receiverId === `market.${root}`,
    "ERR_RECEIVER",
  );
  check(
    d.maxBlockHeight > blockHeight && d.maxBlockHeight <= blockHeight + 150n,
    "ERR_EXPIRED",
  );
  check(d.actions.length === 1, "ERR_ACTION");
  const call = d.actions[0].functionCall;
  check(call && Object.keys(d.actions[0]).length === 1, "ERR_ACTION");
  check(call.gas > 0n && call.gas <= 300_000_000_000_000n, "ERR_GAS");
  const allowed =
    d.receiverId === root
      ? ["adopt", "act", "nft_approve", "nft_revoke", "nft_transfer"]
      : ["buy_pet", "claim", "cancel_listing"];
  check(allowed.includes(call.methodName), "ERR_METHOD");
  let args: Record<string, unknown>;
  try {
    args = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(call.args),
      ),
    );
  } catch {
    throw new Error("ERR_ARGS");
  }
  check(args && typeof args === "object" && !Array.isArray(args), "ERR_ARGS");
  const token = args.token_id;
  const validToken =
    accountId(token) &&
    token.endsWith(`.${root}`) &&
    token.split(".").length === root.split(".").length + 1;
  let receiptSentenceKey = call.methodName;
  if (call.methodName === "adopt") {
    check(
      typeof args.name === "string" &&
        args.name.length >= 2 &&
        args.name.length <= 24 &&
        /^[a-z0-9]+([-_][a-z0-9]+)*$/.test(args.name),
      "ERR_ARGS",
    );
    check(call.deposit === 0n, "ERR_DEPOSIT");
  } else if (call.methodName === "act") {
    const a = args.action as Record<string, unknown> | undefined;
    check(validToken && a && kinds.has(String(a.kind)), "ERR_ARGS");
    if (a.kind === "forage")
      check(["mill", "well", "orchard"].includes(String(a.spot)), "ERR_ARGS");
    if (a.kind === "sleep")
      check(decimal(a.amount) && BigInt(String(a.amount)) > 0n, "ERR_ARGS");
    if (a.kind === "sell_to_npc" || a.kind === "buy_from_npc")
      check(
        items.has(String(a.item)) &&
          decimal(a.quantity) &&
          BigInt(String(a.quantity)) > 0n &&
          BigInt(String(a.quantity)) <= 100n,
        "ERR_ARGS",
      );
    if (a.kind === "buy_from_npc")
      check(decimal(a.amount) && BigInt(String(a.amount)) > 0n, "ERR_ARGS");
    if (a.kind === "join_den")
      check(
        Number.isInteger(a.den) && Number(a.den) >= 1 && Number(a.den) <= 4,
        "ERR_ARGS",
      );
    check(call.deposit === 0n, "ERR_DEPOSIT");
    receiptSentenceKey = String(a.kind);
  } else if (call.methodName === "nft_approve") {
    check(
      validToken &&
        args.account_id === `market.${root}` &&
        typeof args.msg === "string" &&
        args.msg.length <= 200,
      "ERR_ARGS",
    );
    const msg = JSON.parse(args.msg);
    check(decimal(msg.price) && BigInt(msg.price) > 0n, "ERR_ARGS");
    check(call.deposit > 0n && call.deposit <= 10n ** 22n, "ERR_DEPOSIT");
    receiptSentenceKey = "list";
  } else if (call.methodName === "nft_transfer") {
    check(validToken && accountId(args.receiver_id), "ERR_ARGS");
    check(call.deposit === 1n, "ERR_DEPOSIT");
  } else if (call.methodName === "nft_revoke") {
    check(validToken && args.account_id === `market.${root}`, "ERR_ARGS");
    check(call.deposit === 1n, "ERR_DEPOSIT");
  } else if (call.methodName === "buy_pet") {
    check(validToken, "ERR_ARGS");
    check(call.deposit > 0n && call.deposit <= 10n ** 25n, "ERR_DEPOSIT");
  } else if (call.methodName === "cancel_listing") {
    check(validToken, "ERR_ARGS");
    check(call.deposit === 0n, "ERR_DEPOSIT");
  } else check(call.deposit === 0n, "ERR_DEPOSIT");
  const keyData = d.publicKey.ed25519Key?.data;
  const sig = signed.signature.ed25519Signature?.data;
  check(keyData && sig, "ERR_SIGNATURE");
  const publicKey = new PublicKey({
    keyType: KeyType.ED25519,
    data: Uint8Array.from(keyData),
  });
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", encodeDelegateAction(d)),
  );
  check(publicKey.verify(digest, Uint8Array.from(sig)), "ERR_SIGNATURE");
  return {
    signed,
    publicKey,
    method: call.methodName,
    receiptSentenceKey,
    senderId: d.senderId,
    nonce: d.nonce,
  };
}

export class Quota {
  // shortcut: counters reset with the process; use durable quotas before running multiple relayers.
  private counts = new Map<string, { count: number; until: number }>();
  constructor(
    private limit: number,
    private windowMs: number,
    private maxKeys = 10_000,
  ) {}
  take(key: string, now = Date.now()): boolean {
    for (const [id, entry] of this.counts)
      if (entry.until <= now) this.counts.delete(id);
    const current = this.counts.get(key);
    if (current && current.count >= this.limit) return false;
    if (!current && this.counts.size >= this.maxKeys) return false;
    this.counts.set(key, {
      count: (current?.count ?? 0) + 1,
      until: current?.until ?? now + this.windowMs,
    });
    return true;
  }
}
