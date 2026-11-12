import { expect, test } from "bun:test";
import { adjacentMove, swipeDirection } from "./controls";

test("arrows take one relative step and an outward move at the edge has no action", () => {
  expect(adjacentMove("center", -1)).toBe("move:left");
  expect(adjacentMove("center", 1)).toBe("move:right");
  expect(adjacentMove("right", -1)).toBe("move:center");
  expect(adjacentMove("left", 1)).toBe("move:center");
  expect(adjacentMove("right", 1)).toBeNull();
  expect(adjacentMove("left", -1)).toBeNull();
});

test("horizontal swipes clear both the distance and direction threshold", () => {
  expect(swipeDirection(42, 28)).toBe(1);
  expect(swipeDirection(-90, -20)).toBe(-1);
  expect(swipeDirection(41, 0)).toBeNull();
  expect(swipeDirection(42, 29)).toBeNull();
  expect(swipeDirection(70, 100)).toBeNull();
  expect(swipeDirection(0, 0)).toBeNull();
});
