import { expect, test } from "bun:test";
import { MotionPlayer, type MotionScheduler } from "./timeline";

function clock() {
  let time = 0;
  let id = 0;
  const callbacks = new Map<number, () => void>();
  const scheduler: MotionScheduler = {
    now: () => time,
    request: (callback) => {
      callbacks.set(++id, callback);
      return id;
    },
    cancel: (handle) => { callbacks.delete(handle); },
  };
  return {
    scheduler,
    callbacks,
    elapse: (milliseconds: number) => { time += milliseconds; },
    tick: (milliseconds: number) => {
      time += milliseconds;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    },
  };
}

test("one playback loop survives repeated play and preserves exact pause time", () => {
  const fake = clock();
  const frames: number[] = [];
  const player = new MotionPlayer({ duration: 1000, onFrame: time => frames.push(time), scheduler: fake.scheduler });
  player.play();
  player.play();
  expect(fake.callbacks.size).toBe(1);
  fake.tick(100);
  fake.elapse(35);
  player.pause();
  expect(player.state).toEqual({ time: 135, duration: 1000, playing: false, rate: 1 });
  expect(frames.at(-1)).toBe(135);
  expect(fake.callbacks.size).toBe(0);
  fake.elapse(5000);
  player.play();
  fake.tick(65);
  expect(player.state.time).toBe(200);
  player.destroy();
});

test("changing rate first accounts for elapsed time at the old rate", () => {
  const fake = clock();
  const player = new MotionPlayer({ duration: 1000, onFrame: () => {}, scheduler: fake.scheduler });
  player.play();
  fake.elapse(100);
  player.setRate(2);
  expect(player.state.time).toBe(100);
  fake.tick(200);
  expect(player.state.time).toBe(500);
  player.pause();
  player.setRate(0.5);
  player.play();
  fake.tick(200);
  expect(player.state.time).toBe(600);
  player.destroy();
});

test("seeking clamps time without charging elapsed time from before the seek", () => {
  const fake = clock();
  const player = new MotionPlayer({ duration: 1000, onFrame: () => {}, scheduler: fake.scheduler });
  player.seek(-50);
  expect(player.state.time).toBe(0);
  player.play();
  fake.elapse(200);
  player.seek(400);
  fake.tick(100);
  expect(player.state.time).toBe(500);
  player.seek(2000);
  expect(player.state.time).toBe(1000);
  expect(player.state.playing).toBe(false);
  expect(fake.callbacks.size).toBe(0);
});

test("finish settles once per reset run, including repeated skip and replay", () => {
  const fake = clock();
  let finishes = 0;
  const frames: number[] = [];
  const player = new MotionPlayer({ duration: 1000, onFrame: time => frames.push(time), onFinish: () => { finishes++; }, scheduler: fake.scheduler });
  player.play();
  fake.tick(1200);
  expect(player.state.time).toBe(1000);
  expect(finishes).toBe(1);
  player.finish();
  player.play();
  fake.tick(1000);
  expect(finishes).toBe(1);
  expect(fake.callbacks.size).toBe(0);
  player.reset();
  expect(frames.at(-1)).toBe(0);
  expect(player.state.playing).toBe(false);
  player.play();
  fake.tick(30);
  player.finish();
  expect(finishes).toBe(2);
  expect(frames.at(-1)).toBe(1000);
  expect(fake.callbacks.size).toBe(0);
});

test("reset cancels an old run and destroy makes late callbacks harmless", () => {
  const fake = clock();
  const frames: number[] = [];
  let finishes = 0;
  const player = new MotionPlayer({ duration: 1000, onFrame: time => frames.push(time), onFinish: () => { finishes++; }, scheduler: fake.scheduler });
  player.play();
  fake.tick(200);
  player.reset();
  expect(fake.callbacks.size).toBe(0);
  expect(player.state.time).toBe(0);
  player.play();
  const lateFrame = [...fake.callbacks.values()][0]!;
  player.destroy();
  lateFrame();
  player.play();
  player.seek(900);
  player.finish();
  player.reset();
  expect(frames).toEqual([200, 0]);
  expect(finishes).toBe(0);
  expect(fake.callbacks.size).toBe(0);
});

test("a frame callback can destroy the player without leaving a scheduled frame", () => {
  const fake = clock();
  const player = new MotionPlayer({ duration: 1000, onFrame: () => player.destroy(), scheduler: fake.scheduler });
  player.play();
  fake.tick(20);
  expect(fake.callbacks.size).toBe(0);
  expect(player.state.playing).toBe(false);
});

test("a cancelled callback from before reset cannot advance the replacement run", () => {
  const fake = clock();
  const player = new MotionPlayer({ duration: 1000, onFrame: () => {}, scheduler: fake.scheduler });
  player.play();
  const oldFrame = [...fake.callbacks.values()][0]!;
  fake.elapse(500);
  player.reset();
  player.play();
  oldFrame();
  expect(player.state.time).toBe(0);
  expect(fake.callbacks.size).toBe(1);
  fake.tick(100);
  expect(player.state.time).toBe(100);
  player.destroy();
});

test("invalid clock inputs cannot leave a non-finite or backwards playback state", () => {
  const fake = clock();
  for (const duration of [0, -1, Infinity, NaN]) {
    expect(() => new MotionPlayer({ duration, onFrame: () => {}, scheduler: fake.scheduler })).toThrow(RangeError);
  }
  const player = new MotionPlayer({ duration: 1000, onFrame: () => {}, scheduler: fake.scheduler });
  for (const rate of [0, -1, Infinity, NaN]) expect(() => player.setRate(rate)).toThrow(RangeError);
  expect(() => player.seek(NaN)).toThrow(RangeError);
  expect(() => player.seek(Infinity)).toThrow(RangeError);
  expect(player.state).toEqual({ time: 0, duration: 1000, playing: false, rate: 1 });
});
