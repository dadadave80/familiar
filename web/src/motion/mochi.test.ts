import { expect, test } from "bun:test";
import { CLIPS, sampleScene } from "./scenes";
import { MOCHI_POSES, mochiPawPosition, sampleMochi, walkingPose } from "./mochi";

test("paw contact follows traversed distance and a double crossing takes two strides", () => {
  expect([0, .25, .5, .75].map(walkingPose)).toEqual([
    "walk-contact-a", "walk-pass-a", "walk-contact-b", "walk-pass-b",
  ]);
  expect(walkingPose(1)).toBe("walk-contact-a");
  expect(walkingPose(1.5)).toBe("walk-contact-b");
  expect(walkingPose(2)).toBe("walk-contact-a");
});

test("Mochi looks, turns, walks with alternating paws, then plants before the surge", () => {
  expect(sampleMochi("dodge", 900).pose).toBe("look-right");
  expect(sampleMochi("dodge", 1200).pose).toBe("turn-right");
  expect(sampleMochi("dodge", 1400).pose).toBe("turn-right");
  const walk = new Set<number>();
  for (let time = 1500; time < 2250; time += 10) {
    const state = sampleScene("dodge", time);
    const mochi = sampleMochi("dodge", time);
    expect(state.mochiX).toBeGreaterThanOrEqual(21);
    expect(state.mochiX).toBeLessThan(50);
    expect(mochi.pose.startsWith("walk-")).toBe(true);
    expect(mochi.lift).toBe(0);
    expect(mochi.rotate).toBe(0);
    walk.add(mochi.frame);
  }
  expect([...walk].sort()).toEqual([4, 5, 6, 7]);
  expect(sampleMochi("dodge", 2250).pose).toBe("turn-right");
  expect(sampleMochi("dodge", 2450).pose.startsWith("walk-")).toBe(false);
  expect(sampleScene("dodge", 2450).mochiX).toBe(50);
});

test("Reel turns left, reaches, draws inward and stows without moving lanes", () => {
  expect(sampleMochi("reel", 250).pose).toBe("turn-left");
  expect(sampleMochi("reel", 600).pose).toBe("reach-ready");
  expect(sampleMochi("reel", 1000).pose).toBe("reach-left");
  expect(sampleMochi("reel", 3000).pose).toBe("pull-in");
  expect(sampleMochi("reel", 3000).paw).toEqual({ x: .29, y: .64 });
  expect(sampleMochi("reel", 3800).pose).toBe("relieved");
  const reach = sampleMochi("reel", 1000);
  const pulled = sampleMochi("reel", 3000);
  const reachingPaw = mochiPawPosition(sampleScene("reel", 1000), reach);
  const pulledPaw = mochiPawPosition(sampleScene("reel", 3000), pulled);
  expect(reachingPaw.x).toBeLessThan(pulledPaw.x);
  expect(reachingPaw.x).toBeLessThan(50);
  expect(reachingPaw.y).toBeLessThan(62);
  for (let time = 0; time < 5500; time += 100) expect(sampleScene("reel", time).mochiX).toBe(50);
});

test("reactions acknowledge the cause and preserve scene outcomes", () => {
  expect(sampleMochi("hit", 2250).pose).toBe("startled");
  expect(sampleMochi("hit", 2800).pose).toBe("brace");
  expect(sampleMochi("hit", 3500).pose).toBe("relieved");
  expect(sampleMochi("hit", 5500).pose).toBe("neutral");
  expect(sampleScene("hit", 5500).resolve).toBe(2);
  expect(sampleMochi("moth", 1400).pose).toBe("look-right");
  expect(sampleMochi("moth", 2300).pose).toBe("curious");
  expect(sampleMochi("beacon", 4100).pose).toBe("relieved");
  expect(sampleScene("beacon", 6500).beacon).toBe(1);
});

test("poses use one atlas, bounded transforms and registered local paw anchors", () => {
  expect(new Set(Object.values(MOCHI_POSES).map(pose => pose.frame)).size).toBe(16);
  for (const clip of CLIPS) {
    for (let time = 0; time <= clip.duration; time += 25) {
      const pose = sampleMochi(clip.id, time);
      expect(pose.frame).toBeGreaterThanOrEqual(0);
      expect(pose.frame).toBeLessThan(16);
      expect(Number.isInteger(pose.frame)).toBe(true);
      expect(Math.abs(pose.rotate)).toBeLessThanOrEqual(2);
      expect(pose.scaleX).toBeGreaterThan(0);
      expect(pose.scaleY).toBeGreaterThan(0);
      expect(pose.lift).toBeGreaterThanOrEqual(0);
      expect(pose.lift).toBeLessThanOrEqual(.15);
      const paw = mochiPawPosition(sampleScene(clip.id, time), pose);
      expect(Number.isFinite(paw.x) && Number.isFinite(paw.y)).toBe(true);
      expect(pose.paw.x).toBeGreaterThanOrEqual(0);
      expect(pose.paw.x).toBeLessThanOrEqual(1);
      expect(pose.paw.y).toBeGreaterThanOrEqual(0);
      expect(pose.paw.y).toBeLessThanOrEqual(1);
    }
    expect(sampleMochi(clip.id, clip.duration).pose).toBe("neutral");
  }
});

test("reverse scrubbing and repeated sampling do not depend on playback history", () => {
  for (const clip of CLIPS) {
    const times = [0, 450, 850, 1200, 1700, 2100, 2800, 3500, 4300, clip.duration];
    const forward = times.map(time => sampleMochi(clip.id, time));
    const reverse = [...times].reverse().map(time => sampleMochi(clip.id, time)).reverse();
    expect(reverse).toEqual(forward);
    expect(sampleMochi(clip.id, -100)).toEqual(sampleMochi(clip.id, 0));
    expect(sampleMochi(clip.id, clip.duration + 500)).toEqual(sampleMochi(clip.id, clip.duration));
  }
  expect(() => sampleMochi("dodge", NaN)).toThrow(RangeError);
  expect(() => sampleMochi("dodge", Infinity)).toThrow(RangeError);
});

test("reduced motion holds intentional poses with no body movement or walking cycle", () => {
  for (const clip of CLIPS) {
    for (let time = 0; time <= clip.duration; time += 100) {
      const pose = sampleMochi(clip.id, time, true);
      expect(pose.lift).toBe(0);
      expect(pose.rotate).toBe(0);
      expect(pose.scaleX).toBe(1);
      expect(pose.scaleY).toBe(1);
      expect(pose.pose.startsWith("walk-")).toBe(false);
    }
  }
  expect(sampleMochi("reel", 1000, true).pose).toBe("reach-left");
  expect(sampleMochi("dodge", 1700, true).pose).toBe("turn-right");
  expect(sampleMochi("hit", 2500, true).pose).toBe("brace");
  expect(sampleMochi("moth", 2300, true).pose).toBe("curious");
});
