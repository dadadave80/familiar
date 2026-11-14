import { expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import TideRunGame, { TideRunRules } from "./TideRunGame";
import { applyMove, startTide, type TideState } from "./engine";
import { CHAPTERS, itemName, storyStart } from "./story";

function render(initial: TideState, blocked = false, preferences: { guidance?: boolean; buttonsOpen?: boolean } = {}) {
  const document = Object.getOwnPropertyDescriptor(globalThis, "document"), onFinish = mock(() => true);
  Object.defineProperty(globalThis, "document", { configurable: true, value: { hidden: false } });
  try {
    const html = renderToStaticMarkup(<TideRunGame initial={initial} reduced sound={false} audio={null} blocked={blocked} {...preferences}
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
    expect(html).toContain(`The ${itemName(prize)} is back in its shell. You can try the same tide again.`);
    expect(html).toContain('data-testid="tide-finish"');
    expect(html).toContain("Return to the harbor");
    expect(html).toContain('data-testid="tide-again"');
    expect(html).toContain("Try this tide again");
    expect(onFinish).not.toHaveBeenCalled();
  }
});

test("a story prize brought home keeps the return card without offering a retry", () => {
  for (const prize of ["lens", "vane", "moth"] as const) {
    const finished = applyMove(startTide(storyStart(prize)), "home")!.after;
    const { html } = render({ ...finished, banked: [prize], score: 3 });
    expect(html).toContain(`The ${itemName(prize)} is safe. Score: 3. Return to the harbor to continue.`);
    expect(html).toContain('data-testid="tide-finish"');
    expect(html).not.toContain('data-testid="tide-again"');
  }
});

test("the tide run teaches direct play and keeps a closed native button alternative", () => {
  const { html } = render(startTide({ seed: 20771 }));
  expect(html).toContain("WASD or arrow keys to move");
  expect(html).toContain("Space waits");
  expect(html).toContain("R finishes at the dock");
  expect(html).toContain("I opens the guide");
  expect(html).not.toContain("E interacts");
  expect(html).not.toContain("tap a find to collect it");
  expect(html).toContain('<summary>Button controls</summary>');
  expect(html).toContain('aria-describedby="tide-input-hints"');
  expect(html).not.toContain('<details class="exp-button-controls" open');
  expect(html).toContain('data-testid="tide-guide"');
});

test("pause and finishing are distinct and safe story prizes do not depend on points", () => {
  for (const prize of ["lens", "vane", "moth"] as const) {
    const label = prize === "lens" ? "Lens" : prize === "vane" ? "Vane" : "Moth";
    const active = { ...startTide(storyStart(prize)), moves: ["wait"] as const };
    const carried = render({ ...active, pack: [prize] }).html;
    expect(carried).toContain(`${label} carried`);
    expect(carried).not.toContain(`${label} safe`);
    const banked = render({ ...active, banked: [prize] }).html;
    expect(banked).toContain(`${label} safe`);
    expect(banked).toContain('data-testid="tide-score">0');
    expect(banked).toContain("Pause outing");
    expect(banked).toContain("Pause returns you to the harbor with this outing still open.");
    expect(banked).toContain("Step onto the center dock to bank cargo. Banking keeps the outing open.");
    expect(banked).toContain('data-testid="tide-finish-return"');
    expect(banked).toContain("Finish and return");
    expect(banked).toContain("Keep gathering");
    expect(banked.indexOf('data-testid="tide-prize-status"')).toBeLessThan(banked.indexOf('class="tide-tray-reading"'));
    expect(banked.indexOf('data-testid="tide-finish-return"')).toBeLessThan(banked.indexOf('<summary>Button controls</summary>'));
    const finished = render({ ...active, banked: [prize], outcome: "home" }).html;
    expect(finished).toContain(`The ${itemName(prize)} is safe. Score: 0. Return to the harbor to continue.`);
  }
});

test("chapter briefings are narration without inventing Bram dialogue", () => {
  for (const prize of ["lens", "vane", "moth"] as const) {
    const { html } = render(startTide(storyStart(prize)));
    expect(html).toContain(`aria-live="polite">${CHAPTERS[prize].before}</div>`);
    expect(html).not.toContain(`Bram: “${CHAPTERS[prize].before}”`);
  }
});

test("the named objective remains visible beside last-wave advice", () => {
  const { html } = render({ ...startTide(storyStart("lens")), wave: 7, beat: 21, pack: ["reed"] });
  expect(html).toContain(CHAPTERS.lens.goal);
  expect(html).toContain("Last wave. Bank what you can at the center dock.");
});

test("guidance starts with one dismissible movement cue and never replays it for a resumed trace", () => {
  const initial = startTide(storyStart("lens")), line = "Swipe on the board, or tap a glowing neighboring stone. Mochi moves one step at a time.";
  const guided = render(initial, false, { guidance: true }).html;
  expect(guided.split(line)).toHaveLength(2);
  expect(guided).toContain("Dismiss cue");
  expect(guided).toContain(CHAPTERS.lens.goal);
  expect(render(initial).html).not.toContain(line);
  const resumed = applyMove(initial, "wait")!.after;
  expect(render(resumed, false, { guidance: true }).html).not.toContain(line);
  const banked = render({ ...resumed, banked: ["lens"] }, false, { guidance: true }).html;
  expect(banked).not.toContain('data-testid="tide-lens-decision"');
  expect(banked).toContain('data-testid="tide-finish-return"');
});

test("remembered button controls open without changing the outing", () => {
  const initial = startTide(storyStart("lens")), before = JSON.stringify(initial);
  const { html } = render(initial, false, { buttonsOpen: true, guidance: true });
  expect(html).toContain('<details class="exp-button-controls" open="">');
  expect(html).toContain('data-buttons-open="true"');
  expect(html).toContain('aria-label="Guide Mochi" tabindex="0"');
  expect(html).toContain('aria-label="Wait one move"');
  expect(JSON.stringify(initial)).toBe(before);
});

test("shared Tide Run rules explain timing, cargo and activity length", () => {
  for (const story of [undefined, "lens", "vane", "moth"] as const) {
    const html = renderToStaticMarkup(<TideRunRules story={story}/>);
    expect(html).toContain("Every step or wait advances the water by one move. A wave arrives after every third move. Mochi moves first, then the wave lands.");
    expect(html).toContain("Pause outing keeps the outing open. Reading, inspection, and menus spend no moves.");
    expect(html).toContain("Story finds restore the harbor and add no points.");
    expect(html).toContain(story === "lens" ? "This outing is 8 waves." : "This outing is 12 waves. From wave 7, each wave takes two lanes.");
  }
});
