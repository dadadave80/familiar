import { describe, expect, test } from "bun:test";
import {
  KeyPair,
  actions,
  base64Encode,
  encodeTransaction,
  createTransaction,
  type KeyPairString,
} from "near-api-js";
import {
  keepWithGoogle,
  recoverWithGoogle,
  validateAuthRequest,
  googleRecoveryAvailable,
  signInGoogle,
  type GoogleSession,
  type RecoveryProvider,
} from "./auth";

const root = "familiar.testnet";
const owner = `p-1.${root}`;
const old = KeyPair.fromRandom("ed25519");
const fresh = KeyPair.fromRandom("ed25519");
const recovery = KeyPair.fromRandom("ed25519");
const key = (k: typeof old) => k.getPublicKey().toString();
const userId = "google-oauth2|test-person";
const clientId = "np8paqIpMWmNbzT4xAvOOapZBjsOpptl";
const now = Math.floor(Date.now() / 1000);
function request(bytes: Uint8Array, claims: Record<string, unknown> = {}) {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return {
    user: { userId },
    publicKey: key(recovery),
    signatureRequest: {
      guardId: "jwt#https://login.testnet.fast-auth.com/",
      signPayload: [...bytes],
      verifyPayload: `${encode({ alg: "RS256", typ: "JWT", kid: "test" })}.${encode({ iss: "https://login.testnet.fast-auth.com/", aud: "auth0.jwt.fast-auth.testnet", sub: userId, azp: clientId, scope: "openid transaction:sign", exp: now + 60, iat: now, fatxn: [...bytes], ...claims })}.test-signature`,
    },
  };
}
function fixture() {
  let nftOwner = owner;
  let requested: Uint8Array | undefined;
  let wrongSignature = false;
  let nonceChanged = false;
  let missingReadback = false;
  let ownerChanges = false;
  const permissions = new Map([
    [`${owner}:${key(old)}`, "FullAccess"],
    [`${owner}:${key(recovery)}`, "FullAccess"],
    [`p-2.${root}:${key(fresh)}`, "FullAccess"],
  ]);
  const nonces = new Map([...permissions.keys()].map((id) => [id, 20n]));
  const sent: any[] = [];
  const session: GoogleSession = {
    userId,
    publicKey: key(recovery),
    clientId,
    async requestSignature(bytes) {
      requested = bytes;
      return request(bytes);
    },
    signatureBytes(value) {
      return Uint8Array.from((value as { signature: number[] }).signature);
    },
  };
  const provider = {
    async getNetworkId() {
      return "testnet";
    },
    async viewAccessKey({
      accountId,
      publicKey,
    }: {
      accountId: string;
      publicKey: { toString(): string };
    }) {
      const permission = permissions.get(
        `${accountId}:${publicKey.toString()}`,
      );
      if (
        !permission ||
        (missingReadback &&
          sent.length > 1 &&
          publicKey.toString() === key(fresh))
      )
        throw new Error("unknown key");
      return {
        nonce:
          nonceChanged && requested && accountId === owner
            ? 21n
            : (nonces.get(`${accountId}:${publicKey.toString()}`) ?? 0n),
        permission,
        block_hash: "11111111111111111111111111111111",
        block_height: 100,
      };
    },
    async callFunction() {
      return { token_id: `mochi.${root}`, owner_id: nftOwner };
    },
    async viewAccessKeyList({ accountId }: { accountId: string }) {
      return {
        keys: [...permissions]
          .filter(([id]) => id.startsWith(`${accountId}:`))
          .map(([id, permission]) => ({
            public_key: id.slice(accountId.length + 1),
            access_key: { nonce: nonces.get(id) ?? 0n, permission },
          })),
      };
    },
    async sendTransactionUntil(signed: any) {
      const tx = signed.transaction;
      sent.push(tx);
      nonces.set(`${tx.signerId}:${tx.publicKey.toString()}`, tx.nonce);
      let value = "";
      if (tx.receiverId === "fast-auth.testnet") {
        if (!requested) throw new Error("no request");
        const digest = new Uint8Array(
          await crypto.subtle.digest("SHA-256", new Uint8Array(requested)),
        );
        const signature = (wrongSignature ? old : recovery).sign(
          digest,
        ).signature;
        value = base64Encode(
          new TextEncoder().encode(
            JSON.stringify({ scheme: "eddsa", signature: [...signature] }),
          ),
        );
      } else {
        const added = tx.actions[0].addKey;
        if (added)
          permissions.set(
            `${tx.receiverId}:${added.publicKey.toString()}`,
            "FullAccess",
          );
        if (ownerChanges) nftOwner = `p-3.${root}`;
      }
      return {
        status: { SuccessValue: value },
        transaction: { hash: `confirmed-${sent.length}` },
        receipts_outcome: [],
      };
    },
  } as unknown as RecoveryProvider;
  return {
    provider,
    session,
    permissions,
    sent,
    get requested() {
      return requested;
    },
    set wrongSignature(v: boolean) {
      wrongSignature = v;
    },
    set nonceChanged(v: boolean) {
      nonceChanged = v;
    },
    set missingReadback(v: boolean) {
      missingReadback = v;
    },
    set ownerChanges(v: boolean) {
      ownerChanges = v;
    },
  };
}
const guest = {
  accountId: owner,
  secret: old.toString() as KeyPairString,
  root,
};
const sponsor = {
  accountId: `p-2.${root}`,
  secret: fresh.toString() as KeyPairString,
  root,
};

describe("Google retention and recovery trust boundary", () => {
  test("SDK 5 and SDK 7 preserve the exact self-AddKey transaction bytes", async () => {
    const { transactions } = await import("near-api-js-legacy");
    const tx = createTransaction(
      owner,
      recovery.getPublicKey(),
      owner,
      941n,
      [actions.addFullAccessKey(fresh.getPublicKey())],
      Uint8Array.from({ length: 32 }, (_, i) => i),
    );
    const bytes = encodeTransaction(tx);
    const legacy = transactions.Transaction.decode(bytes);
    expect([...transactions.encodeTransaction(legacy)]).toEqual([...bytes]);
    expect(legacy.signerId).toBe(owner);
    expect(legacy.receiverId).toBe(owner);
    expect(legacy.nonce).toBe(941n);
    expect(legacy.actions[0].addKey).toBeDefined();
    expect([...legacy.blockHash]).toEqual([...tx.blockHash]);
  });
  test("shared OAuth client is limited to its verified localhost origin and refuses a mainnet RPC", async () => {
    expect(googleRecoveryAvailable("http://localhost:3000")).toBe(true);
    expect(googleRecoveryAvailable("http://localhost:5173")).toBe(false);
    expect(googleRecoveryAvailable("https://familiar.example")).toBe(false);
    await expect(
      signInGoogle("https://rpc.testnet.near.org", "http://localhost:5173"),
    ).rejects.toThrow("not connected for this address");
    await expect(
      signInGoogle("https://rpc.mainnet.near.org", "http://localhost:3000"),
    ).rejects.toThrow("verified public testnet");
  });
  test("adds only a recovery key, retaining the original guest key", async () => {
    const f = fixture();
    f.permissions.delete(`${owner}:${key(recovery)}`);
    const result = await keepWithGoogle(guest, f.provider, f.session);
    expect(result.hash).toBe("confirmed-2");
    expect(result.installationHash).toBe("confirmed-2");
    expect(f.sent[0].receiverId).toBe("fast-auth.testnet");
    expect(f.sent[0].nonce).toBe(21n);
    expect(f.sent[1].receiverId).toBe(owner);
    expect(f.sent[1].actions.length).toBe(1);
    expect(f.sent[1].nonce).toBe(22n);
    expect(f.sent[1].actions[0].addKey.publicKey.toString()).toBe(
      key(recovery),
    );
    expect(f.permissions.get(`${owner}:${key(old)}`)).toBe("FullAccess");
    expect(guest.secret).toBe(old.toString());
  });
  test("recovery sponsors Auth only, proves the MPC signature and reads back the installed local key", async () => {
    const f = fixture();
    const result = await recoverWithGoogle(
      "mochi",
      sponsor,
      f.provider,
      f.session,
    );
    expect(result.guest.accountId).toBe(owner);
    expect(result.guest.secret).toBe(sponsor.secret);
    expect(sponsor.accountId).toBe(`p-2.${root}`);
    expect(result.hash).toBe("confirmed-2");
    expect(f.sent[0].signerId).toBe(sponsor.accountId);
    expect(f.sent[0].receiverId).toBe("fast-auth.testnet");
    expect(f.sent[0].actions[0].functionCall.methodName).toBe("sign");
    expect(f.sent[1].signerId).toBe(owner);
    expect(f.sent[1].receiverId).toBe(owner);
    expect([...encodeTransaction(f.sent[1])]).toEqual([...f.requested!]);
    expect(f.permissions.get(`${owner}:${key(old)}`)).toBe("FullAccess");
  });
  test("failed Google proof never claims retention and leaves the original guest key working", async () => {
    const f = fixture();
    f.permissions.delete(`${owner}:${key(recovery)}`);
    f.wrongSignature = true;
    await expect(
      keepWithGoogle(guest, f.provider, f.session),
    ).rejects.toThrow();
    expect(f.permissions.get(`${owner}:${key(old)}`)).toBe("FullAccess");
    expect(f.permissions.has(`${owner}:${key(recovery)}`)).toBe(false);
    expect(guest.accountId).toBe(owner);
    expect(f.sent.length).toBe(1);
  });
  test("wrong pet owner, insufficient recovery permission, wrong key and rejected auth never change identities", async () => {
    for (const setup of [
      (f: ReturnType<typeof fixture>) => {
        f.permissions.delete(`${owner}:${key(recovery)}`);
      },
      (f: ReturnType<typeof fixture>) => {
        f.permissions.set(`${owner}:${key(recovery)}`, "FunctionCall");
      },
      (f: ReturnType<typeof fixture>) => {
        f.session.publicKey = key(old);
      },
      (f: ReturnType<typeof fixture>) => {
        f.session.requestSignature = async () => {
          throw new Error("private token must not escape");
        };
      },
    ]) {
      const f = fixture();
      setup(f);
      await expect(
        recoverWithGoogle("mochi", sponsor, f.provider, f.session),
      ).rejects.toThrow();
      expect(f.sent.length).toBe(0);
      expect(sponsor.accountId).toBe(`p-2.${root}`);
      expect(guest.accountId).toBe(owner);
    }
    const f = fixture();
    await expect(
      recoverWithGoogle("../mochi", sponsor, f.provider, f.session),
    ).rejects.toThrow();
  });
  test("signature mismatch, nonce consumed during auth, missing readback and a pet sale prevent recovery success", async () => {
    for (const mode of [
      "wrongSignature",
      "nonceChanged",
      "missingReadback",
      "ownerChanges",
    ] as const) {
      const f = fixture();
      f[mode] = true;
      await expect(
        recoverWithGoogle("mochi", sponsor, f.provider, f.session),
      ).rejects.toThrow();
      expect(sponsor.accountId).toBe(`p-2.${root}`);
      expect(f.permissions.get(`${owner}:${key(old)}`)).toBe("FullAccess");
      expect(f.sent.length).toBe(
        mode === "wrongSignature" || mode === "nonceChanged" ? 1 : 2,
      );
    }
  });
  test("retry after successful key installation and failed read-back proves the already-installed local key", async () => {
    const f = fixture();
    f.missingReadback = true;
    await expect(
      recoverWithGoogle("mochi", sponsor, f.provider, f.session),
    ).rejects.toThrow();
    f.missingReadback = false;
    const result = await recoverWithGoogle(
      "mochi",
      sponsor,
      f.provider,
      f.session,
    );
    expect(result.guest.accountId).toBe(owner);
    expect(result.hash).toBe("confirmed-3");
    expect(f.sent[2].actions[0].transfer.deposit).toBe(0n);
    expect(f.sent[2].publicKey.toString()).toBe(key(fresh));
    expect(sponsor.accountId).toBe(`p-2.${root}`);
  });
  test("JWT claims and canonical payload must match the exact approved transaction and Google session", () => {
    const bytes = Uint8Array.of(1, 2, 3);
    expect(() =>
      validateAuthRequest(request(bytes), bytes, {
        userId,
        publicKey: key(recovery),
        clientId,
      }),
    ).not.toThrow();
    for (const claims of [
      { sub: "google-oauth2|somebody-else" },
      { iss: "https://attacker/" },
      { aud: "fast-auth.near" },
      { exp: now - 1 },
      { fatxn: [1, 2, 4] },
      { azp: "other-client" },
      { scope: "openid" },
    ])
      expect(() =>
        validateAuthRequest(request(bytes, claims), bytes, {
          userId,
          publicKey: key(recovery),
          clientId,
        }),
      ).toThrow();
    const switched = request(bytes);
    switched.publicKey = key(fresh);
    expect(() =>
      validateAuthRequest(switched, bytes, {
        userId,
        publicKey: key(recovery),
        clientId,
      }),
    ).toThrow();
  });
});
