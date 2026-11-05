import {
  Account,
  actions,
  base64Encode,
  encodeSignedDelegate,
  JsonRpcProvider,
  KeyPair,
  nearToYocto,
  teraToGas,
  type KeyPairString,
  type SerializedReturnValue,
} from "near-api-js";

export type PetAction =
  | { kind: "feed" | "craft" | "wake" | "withdraw" | "claim_market" }
  | { kind: "forage"; spot: "mill" | "well" | "orchard" }
  | { kind: "sleep"; amount: string }
  | { kind: "join_den"; den: number }
  | { kind: "sell_to_npc"; item: string; quantity: string }
  | { kind: "buy_from_npc"; item: string; quantity: string; amount: string };
export type PetState = {
  registry: string;
  items: string;
  bakery: string;
  market: string;
  pool: string;
  mood: number;
  energy: number;
  xp: number;
  level: number;
  streak: number;
  freeze_available: boolean;
  sleeping: boolean;
  staked: string;
  unstaking_epoch: string | null;
  unstaking_amount: string;
  den: number | null;
  pending: PetAction | null;
  balance: string;
  spendable: string;
  recent: { event: string; timestamp: number; data: string }[];
};
export type Quote = {
  item: string;
  bid: string;
  ask: string;
  max_qty: string;
  stock?: string;
  last_price?: string;
};
export type Listing = {
  token_id: string;
  seller: string;
  price: string;
  approval_id: number;
};
export type Delivery = {
  hash: string;
  receiptSentenceKey: string;
  value?: unknown;
};
type Guest = { secret: KeyPairString; accountId?: string; root?: string };
const storageKey = "familiar.guest.v1";
export class DeliveryError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function guestIdentity(
  storage: Pick<Storage, "getItem" | "setItem">,
): Guest {
  const stored = storage.getItem(storageKey);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Guest;
      KeyPair.fromString(parsed.secret);
      return parsed;
    } catch {
      throw new Error(
        "Your saved guest pass could not be read. Keep this browser data and contact the builder; it has not been replaced.",
      );
    }
  }
  const identity: Guest = { secret: KeyPair.fromRandom("ed25519").toString() };
  storage.setItem(storageKey, JSON.stringify(identity));
  return identity;
}
export function commitRecoveredGuest(
  storage: Pick<Storage, "getItem" | "setItem">,
  current: Required<Guest>,
  recovered: Required<Guest>,
) {
  const old = storage.getItem(storageKey);
  const saved = old ? (JSON.parse(old) as Guest) : null;
  if (
    !saved ||
    saved.secret !== current.secret ||
    saved.accountId !== current.accountId ||
    saved.root !== current.root ||
    recovered.secret !== current.secret ||
    recovered.root !== current.root ||
    !current.root.endsWith(".testnet") ||
    !/^p-[0-9]+$/.test(
      recovered.accountId.slice(0, -(current.root.length + 1)),
    ) ||
    !recovered.accountId.endsWith(`.${current.root}`)
  )
    throw new Error(
      "Your guest pass changed during recovery. It has not been replaced.",
    );
  const backupKey = `familiar.guest.backup.v1:${current.root}:${current.accountId}`;
  const backup = storage.getItem(backupKey);
  if (backup && backup !== old)
    throw new Error(
      "A different guest pass is already saved. Keep this browser data and contact the builder.",
    );
  // Save the funded sponsor pass before changing the active player; never delete either key.
  storage.setItem(backupKey, old!);
  storage.setItem(storageKey, JSON.stringify(recovered));
  return recovered;
}
export function savings(value: string) {
  const amount = BigInt(value || "0");
  const whole = amount / 10n ** 24n;
  const fraction = ((amount % 10n ** 24n) / 10n ** 20n)
    .toString()
    .padStart(4, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
export function inputAmount(value: string): bigint {
  function valid(value: string): value is `${number}` {
    return /^(0|[1-9][0-9]{0,2})(\.[0-9]{1,24})?$/.test(value);
  }
  if (!valid(value))
    throw new Error("Use a positive amount with at most 24 decimal places.");
  const amount = nearToYocto(value);
  if (amount <= 0n) throw new Error("Choose an amount above zero.");
  return amount;
}

export class FamiliarClient {
  readonly rpcUrl =
    import.meta.env.VITE_NEAR_RPC_URL ?? "https://rpc.testnet.near.org";
  readonly provider = new JsonRpcProvider({
    url: this.rpcUrl,
  });
  readonly relayerUrl = (import.meta.env.VITE_RELAYER_URL ?? "/api").replace(
    /\/$/,
    "",
  );
  root = import.meta.env.VITE_NEAR_ROOT ?? "";
  guest: Guest | undefined;
  async health() {
    const response = await fetch(`${this.relayerUrl}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const state = (await response.json()) as {
      ready: boolean;
      root: string;
      network: string;
    };
    if (state.network !== "testnet")
      throw new Error("This town must run on testnet.");
    if (state.root) this.root = state.root;
    return state.ready && response.ok;
  }
  async view<T extends SerializedReturnValue>(
    contractId: string,
    method: string,
    args: Record<string, unknown> = {},
  ) {
    return this.provider.callFunction<T>({
      contractId,
      method,
      args,
      blockQuery: { finality: "final" },
    });
  }
  private async post<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.relayerUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(45_000),
      });
    } catch {
      throw new DeliveryError(
        "DELIVERY_UNKNOWN",
        "Delivery is taking longer than expected. Check your pet before trying again.",
      );
    }
    const data = await response.json();
    if (!response.ok)
      throw new DeliveryError(
        data.code ?? "OFFLINE",
        data.error ?? "The Post Office is resting. Try again shortly.",
      );
    return data as T;
  }
  restore() {
    this.guest = guestIdentity(localStorage);
    return this.guest;
  }
  async ensureGuest() {
    const guest = this.guest ?? this.restore();
    if (
      !this.root.endsWith(".testnet") ||
      (await this.provider.getNetworkId()) !== "testnet"
    )
      throw new Error("The town is awaiting testnet configuration.");
    if (guest.accountId && guest.root === this.root) return guest;
    const { accountId, root } = await this.post<{
      accountId: string;
      root: string;
    }>("/v1/guest", {
      publicKey: KeyPair.fromString(guest.secret).getPublicKey().toString(),
    });
    if (root !== this.root || !accountId.endsWith(`.${root}`))
      throw new Error("The guest pass belongs to a different town.");
    this.guest = { ...guest, accountId, root };
    localStorage.setItem(storageKey, JSON.stringify(this.guest));
    return this.guest;
  }
  async call(
    receiver: string,
    method: string,
    args: Record<string, unknown>,
    deposit = 0n,
  ): Promise<Delivery> {
    const guest = await this.ensureGuest();
    const account = new Account(guest.accountId!, this.provider, guest.secret);
    const { signedDelegate } = await account.createSignedMetaTransaction({
      receiverId: receiver,
      actions: [actions.functionCall(method, args, teraToGas(280), deposit)],
      blockHeightTtl: 120,
    });
    return this.post("/v1/relay", {
      signedDelegate: base64Encode(encodeSignedDelegate(signedDelegate)),
    });
  }
  adopt(name: string) {
    return this.call(this.root, "adopt", { name });
  }
  act(token_id: string, action: PetAction) {
    return this.call(this.root, "act", { token_id, action });
  }
  list(token_id: string, price: string) {
    return this.call(
      this.root,
      "nft_approve",
      {
        token_id,
        account_id: `market.${this.root}`,
        msg: JSON.stringify({ price: inputAmount(price).toString() }),
      },
      nearToYocto("0.01"),
    );
  }
  buyPet(token_id: string, price: string) {
    return this.call(
      `market.${this.root}`,
      "buy_pet",
      { token_id },
      BigInt(price),
    );
  }
  async owned() {
    return this.guest?.accountId
      ? ((await this.view<{ token_id: string }[]>(
          this.root,
          "nft_tokens_for_owner",
          { account_id: this.guest.accountId, from_index: "0", limit: 50 },
        )) ?? [])
      : [];
  }
}
