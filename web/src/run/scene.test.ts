import { expect, mock, test } from "bun:test";
import { companionIdle } from "../expedition/companion";
import { MOCHI_GROUND } from "../motion/mochi";
import { legalMoves, startTide, stepDestination, type Position } from "./engine";
import { storyStart } from "./story";

// Exercise scene geometry and input without opening a renderer or browser.
mock.module("phaser", () => ({ default: { Scene: class {} } }));
const { TideScene } = await import("./scene");

function board(width: number, height: number, readingTop: number | null) {
  const scene = new TideScene({ tide: startTide(storyStart("lens")), reducedMotion: true }, {} as never);
  Object.assign(scene, { scale: { width, height }, readingTop, hudBottom: 186, bottomInset: 10 });
  return scene as unknown as {
    field(): { dx: number; dy: number };
    targetSize(): { width: number; height: number };
    actorSize(): number;
    point(position: Position): { x: number; y: number };
  };
}

test("Mochi's complete idle bounds leave every legal destination's full 44px target usable", () => {
  const breath = Math.max(...Array.from({ length: 110 }, (_, tick) => companionIdle(tick * 84, "player", false).breath));
  for (const [width, height, readingTop] of [[390, 844, 476.76], [390, 844, 622], [320, 480, 124], [390, 759, 204], [844, 390, 140], [1280, 800, 450]] as const) {
    const scene = board(width, height, readingTop), { width: targetWidth, height: targetHeight } = scene.targetSize();
    const size = scene.actorSize();
    expect(targetWidth).toBeGreaterThanOrEqual(44);
    expect(targetHeight).toBeGreaterThanOrEqual(44);
    expect(size).toBeGreaterThan(0);
    for (const y of [0, 1, 3, 4]) for (const x of [0, 1, 2] as const) {
      const state = { ...startTide(storyStart("lens")), position: { x, y } }, at = scene.point(state.position);
      const actor = { left: at.x - size / 2, right: at.x + size / 2, top: at.y - size * breath * MOCHI_GROUND, bottom: at.y + size * breath * (1 - MOCHI_GROUND) };
      for (const move of legalMoves(state)) {
        const to = stepDestination(state, move);
        if (!to) continue;
        const target = scene.point(to);
        expect(actor.right < target.x - targetWidth / 2 || actor.left > target.x + targetWidth / 2 || actor.bottom < target.y - targetHeight / 2 || actor.top > target.y + targetHeight / 2).toBe(true);
      }
    }
  }
});

test("open phone controls accept north edge taps, while Mochi taps remain free and holds inspect", () => {
  const scene = board(390, 844, 476.76), size = scene.actorSize(), at = scene.point({ x: 1, y: 0 });
  const move = mock(() => {}), target = mock(() => {}), inspect = mock(() => {});
  const canvas = { getBoundingClientRect: () => ({ left: 0, right: 390, top: 0, bottom: 844 }) };
  const contains = (x: number, y: number) => Math.abs(x - at.x) <= size / 2 && y >= at.y - size * MOCHI_GROUND && y <= at.y + size * (1 - MOCHI_GROUND);
  Object.assign(scene, { game: { canvas }, actor: { getBounds: () => ({ contains }) }, hooks: { move, target, inspect } });
  const input = scene as unknown as { press(pointer: unknown, over: unknown[]): void; release(pointer: unknown, over: unknown[]): void };
  const destination = { x: 1, y: 1 } as const, zone = { getData: (key: string) => key === "cellTarget" ? destination : undefined };
  const tap = (x: number, y: number, duration = 20) => {
    const pointer = { id: 0, x, y, event: { clientX: x, clientY: y }, downElement: canvas, wasTouch: true, wasCanceled: false, getDuration: () => duration, rightButtonReleased: () => false };
    input.press(pointer, [zone]); input.release(pointer, [zone]);
  };
  const document = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: false, elementFromPoint: () => canvas } });
  try {
    const north = scene.point(destination), area = scene.targetSize();
    for (const [dx, dy] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      tap(north.x + dx! * (area.width / 2 - 1), north.y + dy! * (area.height / 2 - 1));
    }
    tap(195, 400); // The reported overlap must reach the legal north destination.
    expect(target).toHaveBeenCalledTimes(6);
    expect(target).toHaveBeenLastCalledWith(destination);
    tap(at.x, at.y - size * .4);
    expect(target).toHaveBeenCalledTimes(6);
    expect(move).not.toHaveBeenCalled();
    tap(at.x, at.y - size * .4, 500);
    expect(inspect).toHaveBeenCalledTimes(1);
    expect(target).toHaveBeenCalledTimes(6);
  } finally {
    if (document) Object.defineProperty(globalThis, "document", document);
    else Reflect.deleteProperty(globalThis, "document");
  }
});
