import {
  actions,
  base64Decode,
  baseDecode,
  createTransaction,
  encodeTransaction,
  KeyPair,
  KeyPairSigner,
  KeyType,
  PublicKey,
  Signature,
  SignedTransaction,
  teraToGas,
  type JsonRpcProvider,
  type KeyPairString,
  type Transaction,
} from "near-api-js";
import { validName } from "./rules";

export const TESTNET_AUTH_CLIENT_ID = "np8paqIpMWmNbzT4xAvOOapZBjsOpptl";
export type RecoveryGuest = {
  accountId: string;
  secret: KeyPairString;
  root: string;
};
export type RecoveryProvider = Pick<
  JsonRpcProvider,
  | "getNetworkId"
  | "viewAccessKey"
  | "viewAccessKeyList"
  | "callFunction"
  | "sendTransactionUntil"
>;
export type GoogleSession = {
  publicKey: string;
  userId: string;
  clientId: string;
  requestSignature(bytes: Uint8Array): Promise<unknown>;
  signatureBytes(value: unknown): Uint8Array;
};
export class RecoveryError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
function check(
  ok: unknown,
  message = "Google recovery could not be verified. Your existing guest pass is unchanged.",
): asserts ok {
  if (!ok) throw new RecoveryError("RECOVERY_CHECK", message);
}
function safeFailure(error: unknown): never {
  if (error instanceof RecoveryError) throw error;
  throw new RecoveryError(
    "RECOVERY_FAILED",
    "Google recovery did not finish. Your original guest pass still works; try again.",
  );
}
function ed25519(value: string) {
  const key = PublicKey.fromString(value);
  check(key.keyType === KeyType.ED25519);
  return key;
}
function player(accountId: string, root: string) {
  return (
    /^p-[0-9]+$/.test(accountId.slice(0, -(root.length + 1))) &&
    accountId.endsWith(`.${root}`)
  );
}
async function network(guest: RecoveryGuest, provider: RecoveryProvider) {
  check(
    guest.root.endsWith(".testnet") &&
      player(guest.accountId, guest.root) &&
      (await provider.getNetworkId()) === "testnet",
    "Recovery is available in this testnet town only.",
  );
}
async function fullKey(
  provider: RecoveryProvider,
  accountId: string,
  publicKey: PublicKey,
) {
  const access = await provider.viewAccessKey({
    accountId,
    publicKey,
    finalityQuery: { finality: "final" },
  });
  check(
    access.permission === "FullAccess",
    "That Google account does not have a recovery pass for this player.",
  );
  return access;
}
async function transaction(
  provider: RecoveryProvider,
  signerId: string,
  publicKey: PublicKey,
  receiverId: string,
  action: ReturnType<typeof actions.addFullAccessKey>,
) {
  const access = await fullKey(provider, signerId, publicKey);
  return createTransaction(
    signerId,
    publicKey,
    receiverId,
    access.nonce + 1n,
    [action],
    baseDecode(access.block_hash),
  );
}
function confirmed(
  outcome: Awaited<ReturnType<RecoveryProvider["sendTransactionUntil"]>>,
) {
  check(
    typeof outcome.status === "object" &&
      "SuccessValue" in outcome.status &&
      typeof outcome.status.SuccessValue === "string",
  );
  check(
    !outcome.receipts_outcome?.some(
      (r) =>
        typeof r.outcome.status === "object" && "Failure" in r.outcome.status,
    ),
  );
  check(typeof outcome.transaction?.hash === "string");
  return { hash: outcome.transaction.hash, value: outcome.status.SuccessValue };
}
async function sendLocal(
  guest: RecoveryGuest,
  provider: RecoveryProvider,
  tx: Transaction,
) {
  const { signedTransaction } = await KeyPairSigner.fromSecretKey(
    guest.secret,
  ).signTransaction(tx);
  return confirmed(
    await provider.sendTransactionUntil(signedTransaction, "FINAL"),
  );
}
async function googleSigned(
  tx: Transaction,
  sponsor: RecoveryGuest,
  provider: RecoveryProvider,
  session: GoogleSession,
) {
  const recovery = ed25519(session.publicKey);
  check(tx.publicKey.toString() === recovery.toString());
  const bytes = encodeTransaction(tx);
  const expected = {
    userId: session.userId,
    publicKey: recovery.toString(),
    clientId: session.clientId,
  };
  const request = validateAuthRequest(
    await session.requestSignature(bytes),
    bytes,
    expected,
  );
  const local = KeyPair.fromString(sponsor.secret).getPublicKey();
  const sponsorTx = await transaction(
    provider,
    sponsor.accountId,
    local,
    "fast-auth.testnet",
    actions.functionCall("sign", request, teraToGas(300), 10n ** 22n),
  );
  const signed = await sendLocal(sponsor, provider, sponsorTx);
  const payload: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      base64Decode(signed.value),
    ),
  );
  const signature = session.signatureBytes(payload);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
  );
  check(signature.length === 64 && recovery.verify(digest, signature));
  return new SignedTransaction({
    transaction: tx,
    signature: new Signature({ keyType: KeyType.ED25519, data: signature }),
  });
}
async function sendGoogle(
  tx: Transaction,
  sponsor: RecoveryGuest,
  provider: RecoveryProvider,
  session: GoogleSession,
) {
  const signed = await googleSigned(tx, sponsor, provider, session);
  const current = await fullKey(provider, tx.signerId, tx.publicKey);
  check(
    current.nonce < tx.nonce,
    "That recovery pass was used while Google was open. Try recovery again.",
  );
  return confirmed(await provider.sendTransactionUntil(signed, "FINAL"));
}
function bytesEqual(a: unknown, b: Uint8Array) {
  return (
    (Array.isArray(a) || a instanceof Uint8Array) &&
    a.length === b.length &&
    b.every((byte, i) => a[i] === byte)
  );
}
function jwtPart(part: string) {
  check(/^[A-Za-z0-9_-]+$/.test(part));
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(
      base64Decode(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
    ),
  );
}

export function validateAuthRequest(
  value: unknown,
  bytes: Uint8Array,
  session: Pick<GoogleSession, "userId" | "publicKey" | "clientId">,
) {
  check(value && typeof value === "object");
  const response = value as {
    user?: { userId?: unknown };
    publicKey?: unknown;
    signatureRequest?: {
      guardId?: unknown;
      verifyPayload?: unknown;
      signPayload?: unknown;
    };
  };
  const request = response.signatureRequest;
  check(
    response.user?.userId === session.userId &&
      response.publicKey === session.publicKey,
  );
  check(/^google-oauth2\|[^#]{1,240}$/.test(session.userId));
  check(
    request?.guardId === "jwt#https://login.testnet.fast-auth.com/" &&
      typeof request.verifyPayload === "string" &&
      request.verifyPayload.length <= 16_384 &&
      bytesEqual(request.signPayload, bytes),
  );
  const parts = request.verifyPayload.split(".");
  check(parts.length === 3);
  const header = jwtPart(parts[0]);
  const claims = jwtPart(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  // The on-chain guard verifies the JWT signature; these checks bind its claims to this exact request.
  check(header.alg === "RS256" && typeof header.kid === "string");
  check(
    claims.iss === "https://login.testnet.fast-auth.com/" &&
      claims.sub === session.userId &&
      claims.azp === session.clientId,
  );
  check(
    claims.aud === "auth0.jwt.fast-auth.testnet" ||
      (Array.isArray(claims.aud) &&
        claims.aud.includes("auth0.jwt.fast-auth.testnet")),
  );
  check(
    Number.isSafeInteger(claims.exp) &&
      claims.exp > now &&
      Number.isSafeInteger(claims.iat) &&
      claims.iat <= now + 60 &&
      (claims.nbf === undefined ||
        (Number.isSafeInteger(claims.nbf) && claims.nbf <= now)),
  );
  check(
    typeof claims.scope === "string" &&
      claims.scope.split(" ").includes("transaction:sign") &&
      bytesEqual(claims.fatxn, bytes),
  );
  return {
    guard_id: request.guardId,
    verify_payload: request.verifyPayload,
    sign_payload: [...bytes],
    algorithm: "eddsa",
  };
}

export function googleRecoveryAvailable(
  origin: string,
  clientId = TESTNET_AUTH_CLIENT_ID,
) {
  return (
    !!clientId &&
    (clientId !== TESTNET_AUTH_CLIENT_ID || origin === "http://localhost:3000")
  );
}
export async function signInGoogle(
  rpcUrl: string,
  origin = globalThis.location.origin,
): Promise<GoogleSession> {
  const clientId =
    import.meta.env.VITE_NEAR_AUTH_CLIENT_ID || TESTNET_AUTH_CLIENT_ID;
  if (!googleRecoveryAvailable(origin, clientId))
    throw new RecoveryError(
      "AUTH_ORIGIN",
      "Google recovery is not connected for this address. The local Google demo runs at http://localhost:3000.",
    );
  try {
    check(
      rpcUrl.replace(/\/$/, "") === "https://test.rpc.fastnear.com",
      "Google recovery requires a verified public testnet connection.",
    );
    const { openGoogleSession } = await import("./auth-sdk");
    return await openGoogleSession(rpcUrl, clientId);
  } catch (error) {
    return safeFailure(error);
  }
}

export async function keepWithGoogle(
  guest: RecoveryGuest,
  provider: RecoveryProvider,
  session: GoogleSession,
) {
  try {
    await network(guest, provider);
    check(
      /^google-oauth2\|[^#]{1,240}$/.test(session.userId),
      "Choose Google to keep this pet. Your guest pass has not changed.",
    );
    const original = KeyPair.fromString(guest.secret).getPublicKey();
    const recovery = ed25519(session.publicKey);
    const originalAccess = await fullKey(provider, guest.accountId, original);
    const { keys } = await provider.viewAccessKeyList({
      accountId: guest.accountId,
      finalityQuery: { finality: "final" },
    });
    const access = keys.find(
      (key) => key.public_key === recovery.toString(),
    )?.access_key;
    let installationHash: string | undefined;
    let hash: string;
    if (access) {
      check(access.permission === "FullAccess");
      const proof = await transaction(
        provider,
        guest.accountId,
        recovery,
        guest.accountId,
        actions.transfer(0n),
      );
      hash = (await sendGoogle(proof, guest, provider, session)).hash;
    } else {
      // Prove the candidate Google key before granting it account authority; this challenge is never broadcast.
      const proof = createTransaction(
        guest.accountId,
        recovery,
        guest.accountId,
        1n,
        [actions.transfer(0n)],
        baseDecode(originalAccess.block_hash),
      );
      await googleSigned(proof, guest, provider, session);
      const tx = await transaction(
        provider,
        guest.accountId,
        original,
        guest.accountId,
        actions.addFullAccessKey(recovery),
      );
      installationHash = (await sendLocal(guest, provider, tx)).hash;
      hash = installationHash;
    }
    await fullKey(provider, guest.accountId, recovery);
    await fullKey(provider, guest.accountId, original);
    return { hash, installationHash, publicKey: recovery.toString() };
  } catch (error) {
    return safeFailure(error);
  }
}

export async function recoverWithGoogle(
  name: string,
  sponsor: RecoveryGuest,
  provider: RecoveryProvider,
  session: GoogleSession,
) {
  try {
    await network(sponsor, provider);
    check(validName(name), "Enter your pet's short name to find its home.");
    const token_id = `${name}.${sponsor.root}`;
    const lookup = () =>
      provider.callFunction<{ token_id: string; owner_id: string }>({
        contractId: sponsor.root,
        method: "nft_token",
        args: { token_id },
        blockQuery: { finality: "final" },
      });
    const token = await lookup();
    check(
      token?.token_id === token_id && player(token.owner_id, sponsor.root),
      "That pet could not be found in this town.",
    );
    const recovery = ed25519(session.publicKey);
    const local = KeyPair.fromString(sponsor.secret).getPublicKey();
    await fullKey(provider, token.owner_id, recovery);
    const { keys } = await provider.viewAccessKeyList({
      accountId: token.owner_id,
      finalityQuery: { finality: "final" },
    });
    const installed = keys.find((key) => key.public_key === local.toString());
    let outcome: { hash: string };
    if (installed) {
      check(installed.access_key.permission === "FullAccess");
      const proof = await transaction(
        provider,
        token.owner_id,
        local,
        token.owner_id,
        actions.transfer(0n),
      );
      outcome = await sendLocal(
        { ...sponsor, accountId: token.owner_id },
        provider,
        proof,
      );
    } else {
      const tx = await transaction(
        provider,
        token.owner_id,
        recovery,
        token.owner_id,
        actions.addFullAccessKey(local),
      );
      outcome = await sendGoogle(tx, sponsor, provider, session);
    }
    await fullKey(provider, token.owner_id, local);
    await fullKey(provider, token.owner_id, recovery);
    const after = await lookup();
    check(
      after?.owner_id === token.owner_id && after.token_id === token_id,
      "This pet changed homes during recovery. Your current guest pass is unchanged.",
    );
    return {
      guest: { ...sponsor, accountId: token.owner_id },
      hash: outcome.hash,
      publicKey: recovery.toString(),
    };
  } catch (error) {
    return safeFailure(error);
  }
}
