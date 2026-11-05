import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "@playwright/test";
import { deserialize } from "borsh";
import { SCHEMA, type SignedDelegate } from "near-api-js";

// These are explicit browser fixtures, separate from the real-chain sandbox and testnet commands.
const root = "familiar.testnet";
const petId = `mochi.${root}`;
const server = Bun.spawn(["bun", "run", "dev", "--port", "5184"], {
  stdout: "ignore",
  stderr: "pipe",
});
const browser = await chromium.launch();
await mkdir("web/screenshots", { recursive: true });
try {
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch("http://127.0.0.1:5184")).ok) break;
    } catch {}
    await Bun.sleep(100);
    if (n === 99) throw new Error("Browser test server did not start.");
  }
  for (const [width, height, label] of [
    [390, 844, "mobile"],
    [1280, 800, "desktop"],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    let adopted = false,
      online = true;
    let marketWeek = "2966";
    const requests: string[] = [];
    const state = {
      registry: root,
      items: `items.${root}`,
      bakery: `bakery.${root}`,
      market: `market.${root}`,
      pool: "pool.testnet",
      mood: 70,
      energy: 3,
      xp: 0,
      level: 1,
      streak: 0,
      freeze_available: true,
      sleeping: false,
      staked: "0",
      unstaking_epoch: null,
      unstaking_amount: "0",
      den: null,
      pending: null,
      balance: "300000000000000000000000",
      spendable: "190000000000000000000000",
      recent: [] as { event: string; timestamp: number; data: string }[],
    };
    const inventory = ["0", "0", "0", "0", "0", "0", "0"];
    const quotes = [
      "flour",
      "water",
      "berries",
      "bread",
      "hat",
      "scarf",
      "lantern",
    ].map((item) => ({
      item,
      bid: "5000000000000000000000",
      ask: "10000000000000000000000",
      max_qty: "10",
      stock: "4",
    }));
    await page.route("**/api/**", async (route) => {
      if (route.request().url().endsWith("/health"))
        return route.fulfill({
          status: online ? 200 : 503,
          json: { ready: online, root, network: "testnet" },
        });
      const body = route.request().postData() ?? "";
      requests.push(body);
      if (route.request().url().endsWith("/guest"))
        return route.fulfill({
          json: { accountId: `p-1.${root}`, root, network: "testnet" },
        });
      const signed = deserialize(
        SCHEMA.SignedDelegate,
        Uint8Array.from(Buffer.from(JSON.parse(body).signedDelegate, "base64")),
      ) as unknown as SignedDelegate;
      const call = signed.delegateAction.actions[0].functionCall!;
      const args = JSON.parse(
        new TextDecoder().decode(Uint8Array.from(call.args)),
      );
      let key = call.methodName;
      if (key === "adopt") {
        adopted = true;
      } else if (key === "act") {
        key = args.action.kind;
        if (key === "feed") {
          state.mood = 100;
          state.xp++;
        }
        if (key === "forage") {
          state.energy--;
          state.xp++;
          inventory[
            args.action.spot === "well"
              ? 1
              : args.action.spot === "mill"
                ? 0
                : 2
          ] = "2";
          state.recent.push({ event: "errand", timestamp: 1, data: "{}" });
        }
        state.level = state.xp >= 2 ? 2 : 1;
      }
      return route.fulfill({
        json: {
          hash: "2".repeat(44),
          receiptSentenceKey: key,
          value: key === "adopt" ? petId : true,
        },
      });
    });
    await page.route("**/npc-api/**", (route) =>
      route.fulfill({
        json: {
          tooltip: "A little flour, a little patience.",
          source: "script",
          available: true,
        },
      }),
    );
    await page.route("https://test.rpc.fastnear.com/**", async (route) => {
      const body = route.request().postDataJSON();
      let result: unknown;
      if (body.method === "status") result = { chain_id: "testnet" };
      else if (body.method === "block")
        result = { header: { height: 100, hash: "1".repeat(32) } };
      else if (
        body.method === "query" &&
        body.params.request_type === "view_access_key"
      )
        result = {
          nonce: 0,
          permission: "FullAccess",
          block_hash: "1".repeat(32),
          block_height: 100,
        };
      else if (
        body.method === "query" &&
        body.params.request_type === "call_function"
      ) {
        const method = body.params.method_name;
        const value =
          method === "nft_tokens_for_owner"
            ? adopted
              ? [{ token_id: petId }]
              : []
            : method === "get_state"
              ? state
              : method === "mt_batch_balance_of"
                ? inventory
                : method === "get_npc"
                  ? {
                      quotes,
                      balance: "1000000000000000000000000",
                      den_fees: ["0", "0", "0", "0"],
                      week: marketWeek,
                      weekly_fees: ["2000000000000000000000", "0", "0", "0"],
                    }
                  : method === "get_listings"
                    ? []
                    : method === "get_dens"
                      ? [1, 2, 3, 4].map((den) => ({
                          den,
                          bread: "999",
                          week: "2966",
                          weekly_bread: "7",
                        }))
                      : "0";
        result = {
          result: Array.from(new TextEncoder().encode(JSON.stringify(value))),
          logs: [],
          block_height: 100,
          block_hash: "1".repeat(32),
        };
      } else throw new Error(`Unexpected fixture RPC ${body.method}`);
      return route.fulfill({ json: { jsonrpc: "2.0", id: body.id, result } });
    });
    await page.goto("http://127.0.0.1:5184");
    await page.locator("canvas").waitFor();
    await page.waitForFunction(() => {
      const pixel = document
        .querySelector("canvas")
        ?.getContext("2d")
        ?.getImageData(4, 250, 1, 1).data;
      return pixel && pixel[0] < 90 && pixel[2] > 100;
    });
    await page.getByText("Harbor open", { exact: true }).waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({
      path: `web/screenshots/${label}-adoption-fixture.png`,
      fullPage: true,
    });
    const input = page.getByLabel("Your companion’s name");
    await page
      .getByRole("button", { name: "Coming back? Find your companion" })
      .click();
    assert.equal(
      await page
        .getByRole("button", { name: "Continue with Google" })
        .isDisabled(),
      true,
      "unsupported Google origin is honest",
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    assert(
      (await page
        .getByRole("button", { name: "Continue with Google" })
        .boundingBox())!.height >= 44,
    );
    await page.screenshot({
      path: `web/screenshots/${label}-recovery-fixture.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Coming back? Find your companion" })
      .click();
    await input.fill("items");
    await page.getByRole("button", { name: "Adopt", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(requests.length, 0, "reserved name never leaves browser");
    await input.fill("mochi");
    await page.getByRole("button", { name: "Adopt", exact: true }).click();
    await page.getByRole("heading", { name: "mochi." }).waitFor();
    await page.getByText("TESTNET · CONFIRMED", { exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Keep with Google", exact: true })
        .count(),
      0,
      "retention waits for the first errand",
    );
    await page.getByRole("button", { name: "Share a snack" }).click();
    await page
      .getByText("A full belly, a better mood.", { exact: false })
      .waitFor();
    await page
      .getByRole("button", { name: "The well Bring home water" })
      .click();
    await page
      .getByText("A small errand, something useful brought home.", {
        exact: false,
      })
      .waitFor();
    await page.getByRole("button", { name: "X-ray on" }).click();
    assert.equal(
      await page
        .getByRole("button", { name: "Keep with Google", exact: true })
        .isDisabled(),
      true,
    );
    assert.match(
      (await page
        .getByRole("link", { name: "Read the public record" })
        .getAttribute("href")) ?? "",
      /^https:\/\/testnet.nearblocks.io\/txns\//,
    );
    const secret = await page.evaluate(
      () =>
        JSON.parse(localStorage.getItem("familiar.guest.v1")!).secret as string,
    );
    assert(
      requests.every((body) => !body.includes(secret)),
      "private key never leaves the browser",
    );
    for (const tab of ["Bag", "Market", "Nap", "Den", "Town"]) {
      await page.getByRole("button", { name: tab, exact: true }).click();
      if (tab === "Den") {
        await page
          .getByRole("heading", { name: "This week in the dens" })
          .waitFor();
        assert.equal(
          await page
            .locator(".den-score")
            .first()
            .locator("span")
            .first()
            .textContent(),
          "7",
        );
        assert.equal(
          await page
            .locator(".den-score")
            .first()
            .locator("span")
            .last()
            .textContent(),
          "0.002",
        );
        marketWeek = "2967";
        await page.getByRole("button", { name: "Town", exact: true }).click();
        await page.getByRole("button", { name: "Refresh town" }).click();
        await page.getByRole("button", { name: "Den", exact: true }).click();
        await page
          .getByText(
            "Weekly records changed while you were looking. Refresh the town.",
            { exact: true },
          )
          .waitFor();
        assert.equal(
          await page.locator(".den-score").count(),
          0,
          "different weekly snapshots are never combined",
        );
        marketWeek = "2966";
        await page.getByRole("button", { name: "Town", exact: true }).click();
        await page.getByRole("button", { name: "Refresh town" }).click();
        await page.getByRole("button", { name: "Den", exact: true }).click();
        await page.locator(".den-score").first().waitFor();
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
        `${label} ${tab}: no overflow`,
      );
      if (tab !== "Town")
        await page.screenshot({
          path: `web/screenshots/${label}-${tab.toLowerCase()}-fixture.png`,
          fullPage: true,
        });
    }
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: `web/screenshots/${label}-town-fixture.png`,
      fullPage: true,
    });
    assert.equal(
      await page
        .locator(".pet-body")
        .evaluate((el) => getComputedStyle(el).animationName),
      "none",
      "reduced motion respected",
    );
    const controls = await page
      .locator("button:visible")
      .evaluateAll((elements) =>
        elements.map((el) => ({
          name: el.textContent,
          height: el.getBoundingClientRect().height,
        })),
      );
    assert(
      controls.every((c) => c.height >= 44),
      `${label}: all buttons meet 44px touch height`,
    );
    online = false;
    await page.getByRole("button", { name: "Refresh town" }).click();
    await page.getByText("Post Office resting", { exact: true }).waitFor();
    assert(
      await page.getByRole("button", { name: "Share a snack" }).isDisabled(),
    );
    assert.equal(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("familiar.guest.v1")!).secret,
      ),
      secret,
      "offline state preserves guest",
    );
    assert.deepEqual(errors, [], `${label}: no browser errors`);
    await context.close();
    console.info(
      `PASS ${label} ${width}×${height}: adopt, care, errand, receipt, inventory, market, nap, den, offline, signed payload, reduced motion, touch targets, overflow`,
    );
  }
} finally {
  await browser.close();
  server.kill();
  await server.exited;
}
