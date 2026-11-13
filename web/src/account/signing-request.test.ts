import { expect, test } from "bun:test";
import { KeyPair, actions, createTransaction, encodeTransaction } from "near-api-js";
import { recoverableOriginAvailable } from "./adapter";
import { validateAuthRequest } from "./signing-request";

const publicKey = KeyPair.fromRandom("ed25519").getPublicKey();
const clientId = "np8paqIpMWmNbzT4xAvOOapZBjsOpptl";
const identity = { userId: "google-oauth2|test-person", publicKey: publicKey.toString(), clientId };

test("the Google SDK and account adapter encode the same native commission transaction", async () => {
  const { transactions } = await import("near-api-js-legacy");
  const root = "tidebound.testnet";
  const owner = `p-1.${root}`;
  const tx = createTransaction(
    owner,
    publicKey,
    root,
    941n,
    [actions.functionCall("tidebound_commission", {}, 100000000000000n, 0n)],
    Uint8Array.from({ length: 32 }, (_, i) => i),
  );
  const bytes = encodeTransaction(tx);
  const legacy = transactions.Transaction.decode(bytes);
  expect([...transactions.encodeTransaction(legacy)]).toEqual([...bytes]);
  expect(legacy.signerId).toBe(owner);
  expect(legacy.receiverId).toBe(root);
  expect(legacy.nonce).toBe(941n);
  expect(legacy.actions[0]?.functionCall?.methodName).toBe("tidebound_commission");
  expect([...legacy.blockHash]).toEqual([...tx.blockHash]);
});

test("the shared Google client is limited to its registered localhost origin", () => {
  for (const [origin, allowed] of [
    ["http://localhost:3000", true],
    ["http://localhost:5173", false],
    ["https://familiar.example", false],
  ] as const) {
    expect(recoverableOriginAvailable({ origin, approvedOrigin: origin, clientId })).toBe(allowed);
  }
});

test("JWT claims and canonical payload must match the approved transaction and Google session", () => {
  const now = Math.floor(Date.now() / 1000);
  const bytes = Uint8Array.of(1, 2, 3);
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  function request(changes: Record<string, unknown> = {}) {
    const claims = {
      iss: "https://login.testnet.fast-auth.com/",
      aud: "auth0.jwt.fast-auth.testnet",
      sub: identity.userId,
      azp: clientId,
      scope: "openid transaction:sign",
      exp: now + 60,
      iat: now,
      fatxn: [...bytes],
      ...changes,
    };
    return {
      user: { userId: identity.userId },
      publicKey: identity.publicKey,
      signatureRequest: {
        guardId: "jwt#https://login.testnet.fast-auth.com/",
        signPayload: [...bytes],
        verifyPayload: `${encode({ alg: "RS256", typ: "JWT", kid: "test" })}.${encode(claims)}.test-signature`,
      },
    };
  }
  expect(() => validateAuthRequest(request(), bytes, identity)).not.toThrow();
  for (const changes of [
    { sub: "google-oauth2|somebody-else" },
    { iss: "https://attacker/" },
    { aud: "fast-auth.near" },
    { exp: now - 1 },
    { fatxn: [1, 2, 4] },
    { azp: "other-client" },
    { scope: "openid" },
  ]) {
    expect(() => validateAuthRequest(request(changes), bytes, identity)).toThrow();
  }
  const switched = request();
  switched.publicKey = KeyPair.fromRandom("ed25519").getPublicKey().toString();
  expect(() => validateAuthRequest(switched, bytes, identity)).toThrow();
});
