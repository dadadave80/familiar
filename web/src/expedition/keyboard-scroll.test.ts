import { expect, test } from "bun:test";
import type { KeyboardEvent } from "react";
import { scrollReadingRegion } from "./keyboard-scroll";

function readingRegion({ top = 100, height = 200, content = 1000, lineHeight = "24px", fontSize = "20px", scrollPaddingTop = "auto", scrollPaddingBottom = "auto" } = {}) {
  const calls: ScrollToOptions[] = [];
  const document = {
    activeElement: null as unknown,
    defaultView: { getComputedStyle: () => ({ lineHeight, fontSize, scrollPaddingTop, scrollPaddingBottom }) },
  };
  const region = {
    scrollTop: top, clientHeight: height, scrollHeight: content, ownerDocument: document,
    scrollTo(options: ScrollToOptions) { calls.push(options); region.scrollTop = options.top!; },
  } as unknown as HTMLElement;
  document.activeElement = region;
  const press = (key: string, options: Partial<KeyboardEvent<HTMLElement>> = {}) => {
    let prevented = 0;
    const event = {
      key, target: region, currentTarget: region, defaultPrevented: false,
      altKey: false, ctrlKey: false, metaKey: false, shiftKey: false,
      nativeEvent: { isComposing: false }, preventDefault: () => { prevented++; event.defaultPrevented = true; },
      ...options,
    } as KeyboardEvent<HTMLElement>;
    scrollReadingRegion(event);
    return prevented;
  };
  return { region, document, calls, press };
}

test("a focused reading region scrolls one text line on ArrowDown and cancels native scrolling", () => {
  const { region, calls, press } = readingRegion();
  expect(press("ArrowDown")).toBe(1);
  expect(region.scrollTop).toBe(124);
  expect(calls).toEqual([{ top: 124, behavior: "instant" }]);
});

test("line, page, Space and endpoint keys scroll the reading region in both directions", () => {
  for (const [key, shiftKey, expected] of [
    ["ArrowUp", false, 376], ["ArrowDown", false, 424],
    ["PageUp", false, 224], ["PageDown", false, 576],
    [" ", false, 576], [" ", true, 224],
    ["Home", false, 0], ["End", false, 800],
  ] as const) {
    const { region, calls, press } = readingRegion({ top: 400 });
    expect(press(key, { shiftKey })).toBe(1);
    expect(region.scrollTop).toBe(expected);
    expect(calls).toEqual([{ top: expected, behavior: "instant" }]);
  }
});

test("repeated keys advance from the current position and clamp at both scroll boundaries", () => {
  const { region, calls, press } = readingRegion({ top: 780 });
  expect(press("ArrowDown")).toBe(1);
  expect(press("ArrowDown", { repeat: true })).toBe(1);
  expect(region.scrollTop).toBe(800);
  expect(press("ArrowUp")).toBe(1);
  expect(press("ArrowUp", { repeat: true })).toBe(1);
  expect(region.scrollTop).toBe(752);
  expect(press("Home")).toBe(1);
  expect(press("PageUp")).toBe(1);
  expect(calls.map(call => call.top)).toEqual([800, 800, 776, 752, 0, 0]);
});

test("handled keys stay contained even when the region has no overflowing content", () => {
  for (const content of [100, 200]) {
    const { region, press } = readingRegion({ top: 0, content });
    for (const key of ["ArrowUp", "ArrowDown", "PageUp", "PageDown", " ", "Home", "End"]) {
      expect(press(key)).toBe(1);
      expect(region.scrollTop).toBe(0);
    }
  }
});

test("line and page steps follow enlarged text, including a normal line-height", () => {
  for (const lineHeight of ["normal", "48px"]) {
    const { region, calls, press } = readingRegion({ lineHeight, fontSize: "40px" });
    press("ArrowDown");
    press("PageDown");
    expect(region.scrollTop).toBe(300);
    expect(calls.map(call => call.top)).toEqual([148, 300]);
  }
  const small = readingRegion({ height: 12 });
  small.press("PageDown");
  expect(small.region.scrollTop).toBe(124);
});

test("paging preserves a line of overlap below the panel's sticky heading", () => {
  const { region, press } = readingRegion({ scrollPaddingTop: "78px", scrollPaddingBottom: "8px" });
  press("PageDown");
  expect(region.scrollTop).toBe(190);
  press("PageUp");
  expect(region.scrollTop).toBe(100);
});

test("descendant controls and an unfocused region keep their own keyboard behavior", () => {
  const { region, document, calls, press } = readingRegion();
  const control = {} as HTMLElement;
  document.activeElement = control;
  expect(press(" ", { target: control })).toBe(0);
  expect(press("End")).toBe(0);
  document.activeElement = region;
  expect(press("ArrowDown", { target: control })).toBe(0);
  expect(calls).toEqual([]);
});

test("a focused nested reading region never scrolls its ancestor too", () => {
  const inner = readingRegion();
  const outer = readingRegion();
  outer.document.activeElement = inner.region;
  expect(inner.press("ArrowDown")).toBe(1);
  expect(outer.press("ArrowDown", { target: inner.region })).toBe(0);
  expect(inner.region.scrollTop).toBe(124);
  expect(outer.calls).toEqual([]);
});

test("modified, composing, already handled and unrelated keys are left alone", () => {
  const { calls, press } = readingRegion();
  for (const options of [
    { altKey: true }, { ctrlKey: true }, { metaKey: true }, { defaultPrevented: true },
    { nativeEvent: { isComposing: true } as globalThis.KeyboardEvent },
  ]) expect(press("ArrowDown", options)).toBe(0);
  for (const key of ["Tab", "Enter", "Escape", "ArrowLeft", "ArrowRight", "w"]) expect(press(key)).toBe(0);
  expect(calls).toEqual([]);
});
