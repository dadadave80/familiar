import { describe, expect, test } from "bun:test";
import {
  actions,
  base64Encode,
  DelegateAction,
  encodeSignedDelegate,
  KeyPair,
  KeyPairSigner,
  teraToGas,
} from "near-api-js";
import { validateDelegate, Quota } from "./relay";

const key = KeyPair.fromRandom("ed25519");
const root = "familiar.testnet";
async function signed(
  receiverId = root,
  action = actions.functionCall(
    "act",
    { token_id: `mochi.${root}`, action: { kind: "feed" } },
    teraToGas(250),
    0n,
  ),
) {
  const delegate = new DelegateAction({
    senderId: `p-1.${root}`,
    receiverId,
    actions: [action],
    nonce: 1n,
    maxBlockHeight: 150n,
    publicKey: key.getPublicKey(),
  });
  const { signedDelegate } = await new KeyPairSigner(key).signDelegateAction(
    delegate,
  );
  return base64Encode(encodeSignedDelegate(signedDelegate));
}
describe("signed delegate trust boundary", () => {
  test("accepts a browser signature and returns its method and canonical key", async () => {
    const result = await validateDelegate(await signed(), root, 100n);
    expect(result.method).toBe("act");
    expect(result.receiptSentenceKey).toBe("feed");
    expect(result.publicKey.toString()).toBe(key.getPublicKey().toString());
  });
  test("rejects receiver escape, key changes, invalid signatures, expiry and oversized gas", async () => {
    await expect(
      validateDelegate(await signed("attacker.testnet"), root, 100n),
    ).rejects.toThrow("ERR_RECEIVER");
    await expect(
      validateDelegate(
        await signed(root, actions.addFullAccessKey(key.getPublicKey())),
        root,
        100n,
      ),
    ).rejects.toThrow("ERR_ACTION");
    const bytes = Uint8Array.from(Buffer.from(await signed(), "base64"));
    bytes[bytes.length - 1] ^= 1;
    await expect(
      validateDelegate(base64Encode(bytes), root, 100n),
    ).rejects.toThrow("ERR_SIGNATURE");
    await expect(validateDelegate(await signed(), root, 151n)).rejects.toThrow(
      "ERR_EXPIRED",
    );
    await expect(
      validateDelegate(
        await signed(root, actions.functionCall("act", {}, teraToGas(301), 0n)),
        root,
        100n,
      ),
    ).rejects.toThrow("ERR_GAS");
  });
  test("rejects arbitrary calls, malformed args and extra deposits", async () => {
    await expect(
      validateDelegate(
        await signed(
          root,
          actions.functionCall("create_player", {}, teraToGas(30), 0n),
        ),
        root,
        100n,
      ),
    ).rejects.toThrow("ERR_METHOD");
    await expect(
      validateDelegate(
        await signed(
          root,
          actions.functionCall(
            "act",
            { token_id: `mochi.${root}`, action: { kind: "delete_account" } },
            teraToGas(250),
            0n,
          ),
        ),
        root,
        100n,
      ),
    ).rejects.toThrow("ERR_ARGS");
    await expect(
      validateDelegate(
        await signed(
          root,
          actions.functionCall("adopt", { name: "mochi" }, teraToGas(250), 1n),
        ),
        root,
        100n,
      ),
    ).rejects.toThrow("ERR_DEPOSIT");
  });
});
test("quotas reserve before work, bound cardinality and expire", () => {
  const quota = new Quota(2, 1000, 2);
  expect(quota.take("a", 0)).toBe(true);
  expect(quota.take("a", 1)).toBe(true);
  expect(quota.take("a", 2)).toBe(false);
  expect(quota.take("b", 2)).toBe(true);
  expect(quota.take("c", 3)).toBe(false);
  expect(quota.take("c", 1001)).toBe(true);
});
