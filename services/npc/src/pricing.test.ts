import { expect, test } from "bun:test";
import { priceQuote } from "./pricing";
import { reason } from "./reasoning";

test("scarcity raises bids; every dial respects price bounds and spread", () => {
  for (const dial of ["steady", "generous", "careful"] as const) {
    const scarce = priceQuote({ last: 100n, stock: 0n, dial });
    const surplus = priceQuote({ last: 100n, stock: 100n, dial });
    expect(scarce.bid >= surplus.bid).toBe(true);
    for (const q of [scarce, surplus]) {
      expect(q.bid >= 50n && q.ask <= 150n).toBe(true);
      expect(q.bid <= q.ask).toBe(true);
    }
  }
  expect(priceQuote({ last: 1n, stock: 0n, dial: "steady" })).toEqual({
    bid: 1n,
    ask: 1n,
    max_qty: 10n,
  });
  expect(() => priceQuote({ last: 0n, stock: 0n, dial: "steady" })).toThrow();
  const high = priceQuote({ last: 10n ** 24n, stock: 0n, dial: "generous" });
  expect(high.ask).toBe(10n ** 24n);
  expect(high.bid <= high.ask).toBe(true);
});
test("LLM cannot supply a price or arbitrary dial and failure keeps the current dial", async () => {
  const fake = (content: string) => async () =>
    Response.json({ choices: [{ message: { content } }] });
  expect(await reason("careful")).toMatchObject({
    dial: "careful",
    source: "script",
  });
  expect(
    await reason("steady", {
      key: "test",
      model: "test",
      fetcher: fake('{"dial":"spend-everything","tooltip":"hi"}'),
    }),
  ).toMatchObject({ dial: "steady", source: "script" });
  expect(
    await reason("steady", {
      key: "test",
      model: "test",
      fetcher: fake('{"dial":"generous","tooltip":"hi","price":999}'),
    }),
  ).toMatchObject({ dial: "steady", source: "script" });
  const valid = await reason("steady", {
    key: "test",
    model: "test",
    fetcher: fake(
      JSON.stringify({ dial: "generous", tooltip: "B".repeat(200) }),
    ),
  });
  expect(valid.dial).toBe("generous");
  expect(valid.tooltip.length).toBe(140);
  expect(valid.source).toBe("llm");
});
