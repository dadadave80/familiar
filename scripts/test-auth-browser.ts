import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const chunks = [...new Bun.Glob("auth-sdk-*.js").scanSync("web/dist/assets")];
assert.equal(
  chunks.length,
  1,
  "Build the frontend before testing its Auth bundle.",
);
const server = Bun.spawn(
  ["bun", "run", "--cwd", "web", "preview", "--port", "5185", "--strictPort"],
  { stdout: "ignore", stderr: "ignore" },
);
const browser = await chromium.launch();
try {
  for (let attempt = 0; attempt < 100; attempt++) {
    assert.equal(
      server.exitCode,
      null,
      "The production preview server exited.",
    );
    try {
      if ((await fetch("http://127.0.0.1:5185")).ok) break;
    } catch {}
    if (attempt === 99)
      throw new Error("The production preview server did not start.");
    await Bun.sleep(100);
  }
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:5185/legacy/");
  const hasSession = await page.evaluate(async (path) => {
    const sdk = await import(path);
    return typeof sdk.openGoogleSession === "function";
  }, `/assets/${chunks[0]}`);
  assert(hasSession, "The production Auth SDK loads in a real browser.");
  assert.deepEqual(errors, []);
  console.info(
    "PASS production Auth SDK: browser globals and isolated legacy modules load; no OAuth or signing attempted",
  );
} finally {
  await browser.close();
  server.kill();
  await server.exited;
}
