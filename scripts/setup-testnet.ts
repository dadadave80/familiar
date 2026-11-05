import { KeyPair } from "near-api-js";
import { writeFile } from "node:fs/promises";

if (process.env.NEAR_NETWORK && process.env.NEAR_NETWORK !== "testnet")
  throw new Error("Refusing non-testnet setup.");
if (await Bun.file(".env").exists())
  throw new Error(
    ".env already exists. Keep the existing dev keys; setup never overwrites them.",
  );
const root = `familiar-1105-${crypto.randomUUID().slice(0, 6)}.testnet`;
const rootKey = KeyPair.fromRandom("ed25519");
const relayer = KeyPair.fromRandom("ed25519");
const npcAdmin = KeyPair.fromRandom("ed25519");
const npc = KeyPair.fromRandom("ed25519");
const sample = await Bun.file(".env.example").text();
const values: Record<string, string> = {
  NEAR_ROOT: root,
  ROOT_PRIVATE_KEY: rootKey.toString(),
  RELAYER_ID: `relayer.${root}`,
  RELAYER_PRIVATE_KEY: relayer.toString(),
  NPC_ID: `bram.${root}`,
  NPC_PRIVATE_KEY: npc.toString(),
  NPC_ADMIN_PRIVATE_KEY: npcAdmin.toString(),
  VITE_NEAR_ROOT: root,
};
const content = sample
  .split("\n")
  .map((line) => {
    const key = line.split("=", 1)[0];
    return key in values ? `${key}=${values[key]}` : line;
  })
  .join("\n");
await writeFile(".env", content, { flag: "wx", mode: 0o600 });
console.info(
  `Project dev keys saved privately in .env for ${root}. No key was printed.`,
);
const processResult = Bun.spawn(
  [
    "near",
    "account",
    "create-account",
    "sponsor-by-faucet-service",
    root,
    "use-manually-provided-public-key",
    rootKey.getPublicKey().toString(),
    "network-config",
    "testnet",
    "create",
  ],
  { stdout: "inherit", stderr: "inherit" },
);
const exit = await processResult.exited;
if (exit !== 0) {
  console.error(
    "The faucet did not create the account. The generated keys are retained; retry the faucet with scripts/faucet.sh.",
  );
  process.exit(exit);
}
console.info(`Created ${root}. Verify funding before deploying global code.`);
