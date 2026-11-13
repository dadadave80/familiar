import { expect, test } from "bun:test";
import { walkingPose } from "./mochi";

test("paw contact follows traversed distance and a double crossing takes two strides", () => {
  expect([0, .25, .5, .75].map(walkingPose)).toEqual([
    "walk-contact-a", "walk-pass-a", "walk-contact-b", "walk-pass-b",
  ]);
  expect(walkingPose(1)).toBe("walk-contact-a");
  expect(walkingPose(1.5)).toBe("walk-contact-b");
  expect(walkingPose(2)).toBe("walk-contact-a");
});
