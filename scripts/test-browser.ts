import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { deserialize } from "borsh";
import { SCHEMA, type SignedDelegate } from "near-api-js";

// These are explicit browser fixtures, separate from the real-chain sandbox and testnet commands.
const root = "familiar.testnet";
const layoutFailures: string[] = [];
const extraScreenshots = join(tmpdir(), "familiar-browser-fixtures");
const browser = await chromium.launch();
const server = Bun.spawn(
  ["bun", "--no-env-file", "run", "dev", "--port", "5184", "--strictPort"],
  {
    stdout: "ignore",
    stderr: "pipe",
    env: {
      ...process.env,
      VITE_NEAR_RPC_URL: "https://test.rpc.fastnear.com",
      VITE_NEAR_ROOT: root,
      VITE_RELAYER_URL: "/api",
      VITE_NPC_URL: "/npc-api",
      VITE_NEAR_AUTH_CLIENT_ID: "",
    },
  },
);
await mkdir("web/screenshots", { recursive: true });
await mkdir(extraScreenshots, { recursive: true });
try {
  for (let n = 0; n < 100; n++) {
    assert.equal(server.exitCode, null, "Browser test server exited.");
    try {
      if ((await fetch("http://127.0.0.1:5184")).ok) break;
    } catch {}
    await Bun.sleep(100);
    if (n === 99) throw new Error("Browser test server did not start.");
  }
  for (const [width, height, label] of [
    [390, 844, "mobile"],
    [1280, 800, "desktop"],
    [320, 844, "small-mobile"],
    [768, 1024, "tablet"],
  ] as const) {
    const screenshotDirectory =
      label === "mobile" || label === "desktop"
        ? "web/screenshots"
        : extraScreenshots;
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    const externalRequests: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === "http://127.0.0.1:5184")
        return route.continue();
      externalRequests.push(route.request().url());
      return route.abort("blockedbyclient");
    });
    const checkLayout = (condition: boolean, message: string) => {
      if (!condition)
        layoutFailures.push(`${label} ${width}×${height}: ${message}`);
    };
    const settleLayout = () => page.evaluate(() => new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    ));
    const checkPanel = async (name: string) => {
      const panel = page.getByRole("region", { name, exact: true });
      const box = (await page.locator(".play-column").boundingBox())!;
      checkLayout(
        width < 1000 || box.width >= 440,
        `${name}: desktop controls surface is at least 440px wide (got ${box.width}px)`,
      );
      const clipped = await panel
        .locator("button, input, select, h2, h3, p")
        .evaluateAll((elements) =>
          elements
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return box.width > 0 && (
                box.left < -1 ||
                box.right > innerWidth + 1 ||
                el.scrollWidth > el.clientWidth + 1
              );
            })
            .map((el) => el.textContent?.trim().slice(0, 80) || el.tagName),
        );
      checkLayout(
        clipped.length === 0,
        `${name}: controls and text are not clipped (${clipped.join(", ")})`,
      );
    };
    let petId = `mochi.${root}`;
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
    await page.goto("http://127.0.0.1:5184/legacy/");
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
    const adoptBox = (await page
      .getByRole("button", { name: "Adopt", exact: true })
      .boundingBox())!;
    checkLayout(
      adoptBox.y >= 0 && adoptBox.y + adoptBox.height <= height,
      "Adopt is wholly in the first viewport",
    );
    await page.screenshot({
      path: `${screenshotDirectory}/${label}-adoption-fixture.png`,
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
      path: `${screenshotDirectory}/${label}-recovery-fixture.png`,
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
    await page.waitForTimeout(100);
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await settleLayout();
    const careBox = (await page
      .getByRole("button", { name: "Share a snack" })
      .boundingBox())!;
    const navBox = (await page
      .getByRole("navigation", { name: "Places in town" })
      .boundingBox())!;
    const visibleBottom = Math.min(height, width < 1000 ? navBox.y : height);
    checkLayout(
      careBox.y >= 0 && careBox.y + careBox.height <= visibleBottom,
      `first care fits the first viewport (bottom ${careBox.y + careBox.height}px, available ${visibleBottom}px)`,
    );
    await checkPanel("Town");
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
    if (width < 1000) {
      await page.evaluate(() =>
        scrollTo(0, document.documentElement.scrollHeight),
      );
      const nav = page.getByRole("navigation", { name: "Places in town" });
      const bottomNav = (await nav.boundingBox())!;
      checkLayout(
        bottomNav.y >= height - 120 &&
          bottomNav.y + bottomNav.height <= height + 1,
        "navigation stays at the viewport bottom after scrolling the receipt",
      );
      const lastControl = await page
        .locator("main button, main a, main input, main select")
        .evaluateAll((elements) =>
          elements
            .filter((el) =>
              !el.closest(".play-nav") && el.getBoundingClientRect().height > 0,
            )
            .at(-1)?.getBoundingClientRect().bottom ?? 0,
        );
      checkLayout(
        lastControl <= bottomNav.y,
        "bottom navigation does not cover the last interactive control",
      );
      checkLayout(
        await nav.locator("button").evaluateAll((buttons) =>
          buttons.every((button) => {
            const rect = button.getBoundingClientRect();
            return button.contains(document.elementFromPoint(
              rect.x + rect.width / 2,
              rect.y + rect.height / 2,
            ));
          }),
        ),
        "all five navigation controls remain reachable after scrolling",
      );
    }
    await page.getByRole("button", { name: "Town", exact: true }).focus();
    await page.keyboard.press("Tab");
    const bagButton = page.getByRole("button", { name: "Bag", exact: true });
    checkLayout(
      await bagButton.evaluate((el) => {
        const style = getComputedStyle(el);
        return el === document.activeElement && el.matches(":focus-visible") &&
          ((style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
            style.boxShadow !== "none");
      }),
      "keyboard focus advances visibly through navigation",
    );
    await page.keyboard.press("Enter");
    await page.getByRole("region", { name: "Bag", exact: true }).waitFor();
    await settleLayout();
    checkLayout(
      await bagButton.getAttribute("aria-pressed") === "true",
      "keyboard activation identifies the selected panel",
    );
    await page.getByRole("button", { name: "Town", exact: true }).click();
    await page.getByRole("button", { name: "Den", exact: true }).focus();
    await page.keyboard.press("Tab");
    checkLayout(
      await page.getByRole("region", { name: "Town", exact: true })
        .evaluate((el) => el.contains(document.activeElement)),
      "keyboard focus can move from navigation into the selected panel",
    );
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
      await settleLayout();
      await checkPanel(tab);
      if (width < 1000) {
        const heading = page.getByRole("region", { name: tab, exact: true })
          .locator("h2").first();
        await page.waitForFunction(() =>
          document.querySelector(".play-panel h2")!.getBoundingClientRect().top >= 0,
        );
        const headingBox = (await heading.boundingBox())!;
        const bottomNav = (await page.locator(".play-nav").boundingBox())!;
        checkLayout(
          headingBox.y + headingBox.height <= bottomNav.y,
          `${tab}: selecting navigation brings its heading into view`,
        );
      }
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
        await settleLayout();
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
          path: `${screenshotDirectory}/${label}-${tab.toLowerCase()}-fixture.png`,
          fullPage: true,
        });
    }
    await settleLayout();
    await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
    await settleLayout();
    await page.screenshot({
      path: `${screenshotDirectory}/${label}-town-fixture.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: join(extraScreenshots, `${label}-town-viewport.png`),
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
    const longName = "m".repeat(24);
    petId = `${longName}.${root}`;
    await page.getByRole("button", { name: "Refresh town" }).click();
    await page.getByRole("heading", { name: `${longName}.`, exact: true }).waitFor();
    checkLayout(
      await page.locator("#town-title").evaluate((el) => {
        const box = el.getBoundingClientRect();
        return box.left >= 0 && box.right <= innerWidth &&
          el.scrollWidth <= el.clientWidth + 1;
      }),
      "a 24-character companion name stays readable without clipping",
    );
    checkLayout(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      "a 24-character companion name does not create horizontal overflow",
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
    assert.deepEqual(
      externalRequests, [], `${label}: fixture never reaches an external service`,
    );
    assert.equal(server.exitCode, null, "Browser fixture server exited during testing.");
    await context.close();
    console.info(
      `PASS ${label} ${width}×${height}: fixture gameplay, signed payload, offline identity, reduced motion, touch targets; layout regressions checked`,
    );
  }
  assert.deepEqual(layoutFailures, [], "responsive layout regressions");
} finally {
  await browser.close();
  server.kill();
  await server.exited;
}
