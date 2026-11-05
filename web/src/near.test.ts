import { expect, test } from "bun:test";
import { guestIdentity, savings, inputAmount } from "./near";
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
