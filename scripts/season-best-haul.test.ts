import { expect, test } from "bun:test";
import committed from "../contracts/season/fixtures/best-haul.json";
import { bestHaulTable } from "./season-best-haul";

test("Season 2 best-haul constants regenerate exactly from the court search", () => {
  expect(bestHaulTable()).toEqual(committed as ReturnType<typeof bestHaulTable>);
});
