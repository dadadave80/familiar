import { expect, test } from "bun:test";
import { rules, validName } from "./rules";
test("browser uses exported constants and infrastructure names are reserved", () => {
  expect(rules.ENERGY_MAX).toBe(3);
  expect(rules.ENERGY_REFILL_SECS).toBe(28800);
  expect(rules.LEVEL_XP).toEqual([0, 2, 4, 7, 11, 16]);
  for (const name of [
    "items",
    "p-1",
    "den-meadow",
    "a",
    "two.words",
    "ab__cd",
    "MOCHI",
  ])
    expect(validName(name)).toBe(false);
  for (const name of ["mochi", "bean-2", "ab_cd"])
    expect(validName(name)).toBe(true);
});
