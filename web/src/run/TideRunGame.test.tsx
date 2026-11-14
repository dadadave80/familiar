import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import TideRunGame from "./TideRunGame";
import { applyMove, startTide, type TideState } from "./engine";
import { CHAPTERS, itemName, storyStart } from "./story";

function render(initial: TideState, blocked = false) {
  const document = Object.getOwnPropertyDescriptor(globalThis, "document"), onFinish = mock(() => true);
  Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: false } });
  try {
    const html = renderToStaticMarkup(<TideRunGame initial={initial} reduced sound={false} audio={null} blocked={blocked}
      onSave={() => true} onFinish={onFinish} onLeave={() => {}} onToggleSound={() => {}}/>);
    return { html, onFinish };
  } finally {
    if (document) Object.defineProperty(globalThis, "document", document);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

test("a finished daily tide never renders an end card before filing", () => {
  const finished = applyMove(startTide({ seed: 20771 }), "home")!.after;
  for (const outcome of ["home", "turned", "rescued"] as const) for (const blocked of [false, true]) {
    const { html, onFinish } = render({ ...finished, outcome }, blocked);
    expect(html).toContain(`data-outcome="${outcome}"`);
    expect(html).not.toContain('aria-label="The tide is over"');
    expect(html).not.toContain('aria-label="Guide Mochi"');
    expect(html).not.toContain('data-testid="tide-again"');
    expect(html).not.toContain('class="tide-stamps"');
    expect(onFinish).not.toHaveBeenCalled();
  }
});

test("all three story chapters keep their end card and retry button", () => {
  for (const prize of ["lens", "vane", "moth"] as const) {
    const finished = applyMove(startTide(storyStart(prize)), "home")!.after;
    const { html, onFinish } = render(finished);
    expect(html).toContain(CHAPTERS[prize].title);
    expect(html).toContain('aria-label="The tide is over"');
    expect(html).toContain("Home for the day.");
    expect(html).toContain(`The ${itemName(prize)} is still in its shell. The same tide comes again.`);
    expect(html).toContain('data-testid="tide-finish"');
    expect(html).toContain("Back to the harbor");
    expect(html).toContain('data-testid="tide-again"');
    expect(html).toContain("Try this tide again");
    expect(onFinish).not.toHaveBeenCalled();
  }
});

test("a story prize brought home keeps the return card without offering a retry", () => {
  for (const prize of ["lens", "vane", "moth"] as const) {
    const finished = applyMove(startTide(storyStart(prize)), "home")!.after;
    const { html } = render({ ...finished, banked: [prize], score: 3 });
    expect(html).toContain(`The ${itemName(prize)} is home. Banked 3 besides.`);
    expect(html).toContain('data-testid="tide-finish"');
    expect(html).not.toContain('data-testid="tide-again"');
  }
});

test("the tide run teaches direct play and keeps a closed native button alternative", () => {
  const { html } = render(startTide({ seed: 20771 }));
  expect(html).toContain("WASD or arrow keys to move");
  expect(html).toContain("Space waits");
  expect(html).toContain("R ends the tide at the dock");
  expect(html).toContain("I explains the tide");
  expect(html).not.toContain("E interacts");
  expect(html).not.toContain("tap a find to collect it");
  expect(html).toContain('<summary>Button controls</summary>');
  expect(html).toContain('aria-describedby="tide-input-hints"');
  expect(html).not.toContain('<details class="exp-button-controls" open');
  expect(html).toContain('data-testid="tide-guide"');
});
