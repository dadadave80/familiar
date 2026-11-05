import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
test("testnet setup never replaces an existing dev-key file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "familiar-setup-"));
  try {
    await Bun.write(join(dir, ".env"), "PRESERVE=original-local-data\n");
    const child = Bun.spawn(["bun", resolve("scripts/setup-testnet.ts")], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: { PATH: process.env.PATH, NEAR_NETWORK: "testnet" },
    });
    expect(await child.exited).not.toBe(0);
    expect(await Bun.file(join(dir, ".env")).text()).toBe(
      "PRESERVE=original-local-data\n",
    );
    expect(await new Response(child.stderr).text()).toContain(
      ".env already exists",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("sample configuration defaults to testnet and contains no usable keys", async () => {
  const sample = await Bun.file(".env.example").text();
  expect(sample).toContain("NEAR_NETWORK=testnet");
  expect(sample).not.toMatch(/ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/);
  const ignore = await Bun.file(".gitignore").text();
  expect(ignore.split("\n")).toContain("HANDOFF.md");
  expect(ignore.split("\n")).toContain(".env");
});
