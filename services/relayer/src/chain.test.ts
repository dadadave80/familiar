import { expect, spyOn, test } from "bun:test";
import {
  Account,
  actions,
  base64Encode,
  DelegateAction,
  encodeSignedDelegate,
  JsonRpcProvider,
  KeyPair,
  KeyPairSigner,
  teraToGas,
} from "near-api-js";
import { createBackend } from "./chain";

test("concurrent delivery retries submit once and never share another signed payload", async () => {
  const key = KeyPair.fromRandom("ed25519");
  const root = "familiar.testnet";
  const make = async (senderId: string) => {
    const delegate = new DelegateAction({
      senderId,
      receiverId: root,
      actions: [
        actions.functionCall(
          "act",
          { token_id: `mochi.${root}`, action: { kind: "feed" } },
          teraToGas(250),
          0n,
        ),
      ],
      nonce: 1n,
      maxBlockHeight: 150n,
      publicKey: key.getPublicKey(),
    });
    return base64Encode(
      encodeSignedDelegate(
        (await new KeyPairSigner(key).signDelegateAction(delegate))
          .signedDelegate,
      ),
    );
  };
  let sends = 0;
  const mocks = [
    spyOn(JsonRpcProvider.prototype, "getNetworkId").mockResolvedValue(
      "testnet",
    ),
    spyOn(JsonRpcProvider.prototype, "viewBlock").mockResolvedValue({
      header: { height: 100 },
    } as Awaited<ReturnType<JsonRpcProvider["viewBlock"]>>),
    spyOn(JsonRpcProvider.prototype, "viewAccessKey").mockImplementation(
      async () => {
        await Bun.sleep(20);
        return { nonce: 0n, permission: "FullAccess" } as Awaited<
          ReturnType<JsonRpcProvider["viewAccessKey"]>
        >;
      },
    ),
    spyOn(JsonRpcProvider.prototype, "viewAccount").mockResolvedValue({
      amount: 10n ** 25n,
      storage_usage: 0,
    } as Awaited<ReturnType<JsonRpcProvider["viewAccount"]>>),
    spyOn(Account.prototype, "signAndSendTransaction").mockImplementation(
      async () => {
        sends++;
        return {
          status: { SuccessValue: "" },
          transaction: { hash: "2".repeat(44) },
          receipts_outcome: [
            {
              id: "inner",
              outcome: {
                executor_id: root,
                status: { SuccessValue: btoa("true") },
              },
            },
          ],
        } as Awaited<ReturnType<Account["signAndSendTransaction"]>>;
      },
    ),
  ];
  try {
    const backend = createBackend(
      root,
      `relayer.${root}`,
      key.toString(),
      "https://rpc.testnet.near.org",
    );
    const encoded = await make(`p-1.${root}`);
    const [a, b] = await Promise.all([
      backend.relay(encoded),
      backend.relay(encoded),
    ]);
    expect(a.hash).toBe(b.hash);
    expect(sends).toBe(1);
    await backend.relay(await make(`p-2.${root}`));
    expect(sends).toBe(2);
  } finally {
    for (const mock of mocks) mock.mockRestore();
  }
});
