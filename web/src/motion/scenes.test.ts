import { expect, test } from "bun:test";
import { CLIPS, sampleScene } from "./scenes";

test("every authored clip has readable ordered beats and a stable finite final state", () => {
  expect(new Set(CLIPS.map(clip => clip.id)).size).toBe(9);
  for (const clip of CLIPS) {
    expect(clip.beats.length).toBeGreaterThanOrEqual(3);
    expect(clip.beats[0]!.at).toBe(0);
    expect(clip.beats.every((beat, index) => index === 0 || beat.at > clip.beats[index - 1]!.at)).toBe(true);
    expect(sampleScene(clip.id, -500)).toEqual(sampleScene(clip.id, 0));
    expect(sampleScene(clip.id, clip.duration + 9999)).toEqual(sampleScene(clip.id, clip.duration));
    for (let time = 0; time <= clip.duration; time += 100) {
      const state = sampleScene(clip.id, time);
      for (const value of Object.values(state)) if (typeof value === "number") expect(Number.isFinite(value)).toBe(true);
      for (const name of ["waveProgress", "waveOpacity", "targetOpacity", "echoOpacity", "lensOpacity", "ropeProgress", "lureOpacity", "beacon", "moth", "bram", "celebration"] as const) {
        expect(state[name]).toBeGreaterThanOrEqual(0);
        expect(state[name]).toBeLessThanOrEqual(1);
      }
      expect(state.cue.length).toBeGreaterThan(0);
      expect(state.detail.length).toBeGreaterThan(0);
    }
  }
});

test("Mochi dodges only to adjacent Center before the left wave arrives", () => {
  for (let time = 0; time <= 6200; time += 50) {
    const state = sampleScene("dodge", time);
    expect(state.mochiX).toBeGreaterThanOrEqual(21);
    expect(state.mochiX).toBeLessThanOrEqual(50);
    if (state.waveOpacity > 0) {
      expect(state.mochiX).toBe(50);
      expect(state.waveLane).toBe(0);
    }
    expect(state.resolve).toBe(3);
  }
  expect(sampleScene("dodge", 6200).lensOpacity).toBe(1);
});

test("Lure replaces the locked source without moving Mochi", () => {
  expect(sampleScene("lure", 500).targetLane).toBe(1);
  expect(sampleScene("lure", 2000).targetLane).toBe(0);
  for (let time = 0; time <= 6100; time += 100) {
    const state = sampleScene("lure", time);
    expect(state.mochiX).toBe(50);
    if (state.waveOpacity > 0) expect(state.waveLane).toBe(0);
  }
});

test("Lure redirects during Surge, after the source has locked", () => {
  expect(sampleScene("lure", 2000).phase).toBe("Surge ready");
});

test("Reel brings the exposed lens to a stationary Mochi, then stows it", () => {
  expect(sampleScene("reel", 0).lensX).toBe(21);
  expect(sampleScene("reel", 2000).ropeProgress).toBe(1);
  expect(sampleScene("reel", 2800).lensX).toBe(50);
  expect(sampleScene("reel", 2800).ropeProgress).toBe(1);
  expect(sampleScene("reel", 3100).ropeProgress).toBe(0);
  expect(sampleScene("reel", 5500).lensOpacity).toBe(0);
  for (let time = 0; time <= 5500; time += 100) expect(sampleScene("reel", time).mochiX).toBe(50);
});

test("the echo is queued after the wave and resolves separately on Low", () => {
  const queued = sampleScene("echo", 2600);
  expect(queued.waveOpacity).toBe(0);
  expect(queued.echoLane).toBe(0);
  expect(queued.echoOpacity).toBeGreaterThan(0);
  expect(queued.phase).toContain("Low");
  const returning = sampleScene("echo", 4500);
  expect(returning.waveOpacity).toBeGreaterThan(0);
  expect(returning.waveLane).toBe(0);
  expect(sampleScene("echo", 6800).echoLane).toBeNull();
  expect(sampleScene("echo", 6800).resolve).toBe(3);
});

test("the vane changes the exit while preserving the locked source", () => {
  expect(sampleScene("vane", 0).vaneRotation).toBe(120);
  expect(sampleScene("vane", 0).waveLane).toBe(2);
  const turned = sampleScene("vane", 2000);
  expect(turned.vaneRotation).toBe(240);
  expect(turned.targetLane).toBe(1);
  expect(turned.waveLane).toBe(0);
  expect(turned.mochiX).toBe(50);
  const settled = sampleScene("vane", 6000);
  expect(settled.lensOpacity).toBe(0);
  expect(settled.detail).toContain("Signal Vane");
});

test("impact settles at two resolve and restoration settles with the beacon lit", () => {
  expect(sampleScene("hit", 2100).resolve).toBe(3);
  expect(sampleScene("hit", 2300).resolve).toBe(2);
  expect(sampleScene("hit", 5500).resolve).toBe(2);
  const before = sampleScene("beacon", 0);
  const restored = sampleScene("beacon", 6500);
  expect(before.harbor).toBe(true);
  expect(before.beacon).toBe(0);
  expect(restored.beacon).toBe(1);
  expect(restored.lensOpacity).toBe(0);
  expect(restored.mochiX).toBe(43);
  expect(restored.mochiY).toBe(83);
});

test("invalid times are rejected before non-finite values reach styles", () => {
  expect(() => sampleScene("dodge", NaN)).toThrow(RangeError);
  expect(() => sampleScene("dodge", Infinity)).toThrow(RangeError);
});
