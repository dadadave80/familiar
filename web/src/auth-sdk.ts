import { Buffer } from "buffer";
import type { GoogleSession } from "./auth";

// The official Auth SDK uses near-api-js 5 and browser Buffer; only canonical bytes cross into version 7.
if (typeof globalThis.Buffer === "undefined")
  Object.defineProperty(globalThis, "Buffer", {
    value: Buffer,
    writable: true,
    configurable: true,
  });
if (!("global" in globalThis))
  Object.defineProperty(globalThis, "global", {
    value: globalThis,
    configurable: true,
  });
const [
  { connect, transactions },
  { FastAuthClient, FastAuthSignature },
  { JavascriptProvider },
] = await Promise.all([
  import("near-api-js-legacy"),
  import("@fast-auth-near/browser-sdk"),
  import("@fast-auth-near/javascript-provider"),
]);

export async function openRecoverableGoogleSession(
  rpcUrl: string,
  clientId: string,
  mode: "authenticate" | "restore" = "authenticate",
): Promise<(GoogleSession & { endSession(): Promise<void> }) | null> {
  const provider = new JavascriptProvider({ network: "testnet", clientId });
  const { connection } = await connect({
    networkId: "testnet",
    nodeUrl: rpcUrl,
  });
  const client = new FastAuthClient(provider, connection, {
    fastAuthContractId: "fast-auth.testnet",
    mpcContractId: "v1.signer-prod.testnet",
  });
  if (mode === "restore" && !(await provider.isLoggedIn())) return null;
  if (mode === "authenticate") await client.login();
  const path = await provider.getPath();
  const prefix = "jwt#https://login.testnet.fast-auth.com/#";
  if (!path.startsWith(prefix)) throw new Error("Auth identity changed");
  const user = { userId: path.slice(prefix.length) };
  if (!/^google-oauth2\|[^#]{1,240}$/.test(user.userId)) throw new Error("Choose the configured Google route");
  const signer = await client.getSigner();
  if (
    (await provider.getPath()) !==
    `jwt#https://login.testnet.fast-auth.com/#${user.userId}`
  )
    throw new Error("Auth identity changed");
  const publicKey = String(await signer.getPublicKey("ed25519"));
  return {
    userId: user.userId,
    publicKey,
    clientId,
    async endSession() {
      // The pinned client logout forwards an array; call the documented provider directly.
      await provider.logout({ logoutParams: { returnTo: globalThis.location.origin } });
    },
    async requestSignature(bytes) {
      const transaction = transactions.Transaction.decode(bytes);
      const roundtrip = transactions.encodeTransaction(transaction);
      if (
        roundtrip.length !== bytes.length ||
        !bytes.every((byte, i) => byte === roundtrip[i])
      )
        throw new Error("Auth transaction encoding mismatch");
      await signer.requestTransactionSignature({ transaction });
      const response = await signer.getSignatureRequest();
      const freshSigner = await client.getSigner();
      return {
        ...response,
        publicKey: String(await freshSigner.getPublicKey("ed25519")),
      };
    },
    signatureBytes(value) {
      if (
        !value ||
        typeof value !== "object" ||
        !("signature" in value) ||
        !Array.isArray(value.signature) ||
        value.signature.length !== 64 ||
        !value.signature.every(
          (n: unknown) =>
            Number.isInteger(n) && Number(n) >= 0 && Number(n) <= 255,
        )
      )
        throw new Error("Invalid Auth signature");
      return new FastAuthSignature({
        scheme: "eddsa",
        signature: value.signature,
      }).recover("ed25519");
    },
  };
}

export async function openGoogleSession(rpcUrl: string, clientId: string): Promise<GoogleSession> {
  const session = await openRecoverableGoogleSession(rpcUrl, clientId);
  if (!session) throw new Error("Google authentication did not finish");
  return session;
}
