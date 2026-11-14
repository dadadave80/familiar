import { expect, test } from "bun:test";
import committed from "../contracts/season/fixtures/best-haul.json";
import { CARGO_GOODS, bestHaulTable } from "./season-best-haul";

test("Season 2 best-haul constants regenerate exactly from the court search", () => {
  expect(bestHaulTable()).toEqual(committed as ReturnType<typeof bestHaulTable>);
});

test("the TypeScript cargo table matches the contract's CARGO_GOODS", async () => {
  const source = await Bun.file(new URL("../contracts/season/src/lib.rs", import.meta.url)).text();
  const start = source.indexOf("pub const CARGO_GOODS");
  const table = source.slice(start, source.indexOf("];", start));
  const entries = Object.fromEntries([...table.matchAll(/\("(\w+)", (None|Some\((GLASS|REED)\))\)/g)]
    .map(m => [m[1], m[3] ? m[3].toLowerCase() : null]));
  expect(entries).toEqual(CARGO_GOODS);
});
