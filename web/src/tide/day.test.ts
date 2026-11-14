import { expect, test } from "bun:test";
import { msUntilNextTideDay, tideDay } from "./cards";

const delay = msUntilNextTideDay;
const midnight = Date.parse("2026-11-15T00:00:00.000Z");

test("the tide timer waits only until the next UTC midnight", () => {
  expect(delay(midnight - 10_000)).toBe(10_000);
  expect(delay(midnight - 1)).toBe(1);
  expect(delay(midnight + 1)).toBe(86_399_999);
});

test("exactly at midnight the next tide boundary is a whole day away", () => {
  expect(delay(midnight)).toBe(86_400_000);
  expect(delay(0)).toBe(86_400_000);
});

test("the timer reaches the next day for UTC and offset timestamps", () => {
  for (const now of [midnight - 1, midnight, Date.parse("2026-11-14T19:00:00-05:00"), -1]) {
    const wait = delay(now);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(86_400_000);
    expect(tideDay(now + wait - 1)).toBe(tideDay(now));
    expect(tideDay(now + wait)).toBe(tideDay(now) + 1);
  }
});
