import { useEffect, useEffectEvent, useRef } from "react";
import type { Action, Lane, Outing } from "./engine";

export const lanes: readonly Lane[] = ["left", "center", "right"];
type Direction = -1 | 1;

export function adjacentMove(lane: Lane, direction: Direction): Action | null {
  const next = lanes[lanes.indexOf(lane) + direction];
  return next ? `move:${next}` : null;
}

export function swipeDirection(dx: number, dy: number): Direction | null {
  if (Math.abs(dx) < 42 || Math.abs(dx) < 1.5 * Math.abs(dy)) return null;
  return dx < 0 ? -1 : 1;
}

const nativeArrowTarget =
  "input, textarea, select, [contenteditable]:not([contenteditable=false]), " +
  "a[href], details, button:not([data-action]), dialog, [role=dialog], [role=slider], [role=tablist], [role=listbox]";

export function useCourtControls(
  run: Outing | null,
  commit: (action: Action, fromKeyboard?: boolean) => void,
) {
  const board = useRef<HTMLElement>(null);
  const currentRun = useEffectEvent(() => run);
  const move = useEffectEvent((direction: Direction, keyboard = false) => {
    const action = run && adjacentMove(run.lane, direction);
    if (action) commit(action, keyboard);
    return !!action;
  });
  useEffect(() => {
    const stage = board.current;
    if (!stage) return;
    const main = stage.closest("main");
    let touch: { id: number; x: number; y: number; run: Outing } | null = null;
    let suppressTouchClickUntil = 0;

    function keyDown(e: KeyboardEvent) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      if (e.repeat || e.isComposing || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if (!(e.target instanceof Element) || e.target.closest(nativeArrowTarget)) return;
      if (e.target !== document.body && !main?.contains(e.target)) return;
      if (move(e.key === "ArrowLeft" ? -1 : 1, true)) e.preventDefault();
    }

    const touchStart = (e: TouchEvent) => {
      suppressTouchClickUntil = 0;
      const first = e.touches[0];
      const startRun = currentRun();
      // A second finger anywhere on the page cancels the pending move.
      touch = startRun && e.touches.length === 1 && stage.contains(e.target as Node)
        ? { id: first.identifier, x: first.clientX, y: first.clientY, run: startRun }
        : null;
    };
    function cancelTouch() { touch = null; }
    function touchMove(e: TouchEvent) {
      if (!touch || e.touches.length !== 1) return;
      const dy = Math.abs(e.touches[0].clientY - touch.y);
      if (dy >= 18 && dy > Math.abs(e.touches[0].clientX - touch.x)) cancelTouch();
    }
    function touchEnd(e: TouchEvent) {
      const start = touch;
      touch = null;
      if (!start || start.run !== currentRun() || e.touches.length || e.changedTouches.length !== 1 || e.defaultPrevented) return;
      const end = e.changedTouches[0];
      if (end.identifier !== start.id) return;
      const direction = swipeDirection(end.clientX - start.x, end.clientY - start.y);
      if (!direction) return;
      // Browsers can report a noncancelable end even for a horizontal swipe.
      suppressTouchClickUntil = performance.now() + 600;
      if (e.cancelable) e.preventDefault();
      move(direction);
    }
    function newPress() { suppressTouchClickUntil = 0; }
    function click(e: MouseEvent) {
      if (performance.now() < suppressTouchClickUntil && e.detail > 0) {
        e.preventDefault();
        e.stopPropagation();
      }
      suppressTouchClickUntil = 0;
    }

    document.addEventListener("keydown", keyDown);
    document.addEventListener("touchstart", touchStart, { passive: true, capture: true });
    stage.addEventListener("touchmove", touchMove, { passive: true });
    stage.addEventListener("touchcancel", cancelTouch, { passive: true });
    stage.addEventListener("pointercancel", cancelTouch);
    stage.addEventListener("touchend", touchEnd, { passive: false });
    stage.addEventListener("pointerdown", newPress, true);
    stage.addEventListener("click", click, true);
    return () => {
      document.removeEventListener("keydown", keyDown);
      document.removeEventListener("touchstart", touchStart, true);
      stage.removeEventListener("touchmove", touchMove);
      stage.removeEventListener("touchcancel", cancelTouch);
      stage.removeEventListener("pointercancel", cancelTouch);
      stage.removeEventListener("touchend", touchEnd);
      stage.removeEventListener("pointerdown", newPress, true);
      stage.removeEventListener("click", click, true);
    };
  }, []);
  return board;
}
