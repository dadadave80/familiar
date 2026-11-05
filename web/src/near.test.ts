import { expect, test } from "bun:test";
import {
  commitRecoveredGuest,
  guestIdentity,
  savings,
  inputAmount,
} from "./near";
test("guest identity survives provisioning failures and is never silently overwritten", () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
  const original = guestIdentity(storage);
  expect(guestIdentity(storage).secret).toBe(original.secret);
  storage.setItem("familiar.guest.v1", "broken");
  expect(() => guestIdentity(storage)).toThrow("has not been replaced");
  expect(storage.getItem("familiar.guest.v1")).toBe("broken");
});
test("recovery backs up the current guest before switching and refuses stale or conflicting passes", () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  };
  const current = {
    ...guestIdentity(storage),
    accountId: "p-2.familiar.testnet",
    root: "familiar.testnet",
  };
  const old = JSON.stringify(current);
  storage.setItem("familiar.guest.v1", old);
  const recovered = { ...current, accountId: "p-1.familiar.testnet" };
  const backup =
    "familiar.guest.backup.v1:familiar.testnet:p-2.familiar.testnet";
  expect(commitRecoveredGuest(storage, current, recovered)).toEqual(recovered);
  expect(storage.getItem(backup)).toBe(old);
  expect(JSON.parse(storage.getItem("familiar.guest.v1")!)).toEqual(recovered);
  expect(() => commitRecoveredGuest(storage, current, recovered)).toThrow();
  storage.setItem("familiar.guest.v1", old);
  storage.setItem(backup, "a different saved pass");
  expect(() => commitRecoveredGuest(storage, current, recovered)).toThrow();
  expect(storage.getItem("familiar.guest.v1")).toBe(old);
  entries.delete(backup);
  const cannotSwitch = {
    ...storage,
    setItem(key: string, value: string) {
      if (key === "familiar.guest.v1") throw new Error("storage full");
      storage.setItem(key, value);
    },
  };
  expect(() =>
    commitRecoveredGuest(cannotSwitch, current, recovered),
  ).toThrow();
  expect(storage.getItem("familiar.guest.v1")).toBe(old);
  expect(storage.getItem(backup)).toBe(old);
  entries.delete(backup);
  const noSpace = {
    ...storage,
    setItem() {
      throw new Error("storage full");
    },
  };
  expect(() => commitRecoveredGuest(noSpace, current, recovered)).toThrow();
  expect(storage.getItem("familiar.guest.v1")).toBe(old);
  expect(() =>
    commitRecoveredGuest(storage, current, {
      ...recovered,
      root: "other.testnet",
    }),
  ).toThrow();
  expect(storage.getItem("familiar.guest.v1")).toBe(old);
});
test("savings display avoids floating-point amounts", () => {
  expect(savings("1000000000000000000000000")).toBe("1");
  expect(savings("1234567890123456789012345")).toBe("1.2345");
  expect(savings("0")).toBe("0");
  expect(inputAmount("0.000000000000000000000001")).toBe(1n);
  for (const bad of [
    "0",
    "-1",
    "1e2",
    "Infinity",
    "0.0000000000000000000000001",
  ])
    expect(() => inputAmount(bad)).toThrow();
});
