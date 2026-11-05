import { expect, test } from "bun:test";
import { assertStakedPrincipal } from "./staking";

const principal = 10_000_000_000_000_000_000_000n;
const rounded = {
  staked_balance: "9999999999999999999998",
  unstaked_balance: "2",
};

test("staking preserves the exact principal across share-rounding dust", () => {
  expect(() => assertStakedPrincipal(rounded, principal)).not.toThrow();
  expect(() =>
    assertStakedPrincipal(
      { staked_balance: principal.toString(), unstaked_balance: "0" },
      principal,
    ),
  ).not.toThrow();
});

test("staking rejects even one yocto of missing principal", () => {
  expect(() =>
    assertStakedPrincipal({ ...rounded, unstaked_balance: "1" }, principal),
  ).toThrow("principal");
});

test("staking rejects a deposit with no positive stake", () => {
  expect(() =>
    assertStakedPrincipal(
      { staked_balance: "0", unstaked_balance: principal.toString() },
      principal,
    ),
  ).toThrow("positive stake");
});

test("staking requires a positive bigint principal", () => {
  for (const invalid of [0n, -1n, "1", 1, null, undefined])
    expect(() => assertStakedPrincipal(rounded, invalid as bigint)).toThrow(
      "positive bigint",
    );
});

test("staking validates the RPC balance object and decimal strings", () => {
  for (const invalid of [null, undefined, true, [], {}, "account", 1])
    expect(() => assertStakedPrincipal(invalid, principal)).toThrow("RPC");
  for (const field of ["staked_balance", "unstaked_balance"])
    for (const invalid of [
      undefined,
      null,
      2,
      2n,
      "",
      " ",
      "-1",
      "+2",
      "2.0",
      "2e0",
      "0x2",
    ])
      expect(() =>
        assertStakedPrincipal({ ...rounded, [field]: invalid }, principal),
      ).toThrow("RPC");
});
