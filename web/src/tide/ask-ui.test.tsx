import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { replayRun, solve, startRun, type Ask } from "./asks";
import { askChip, askLine, cardForDay } from "./cards";
import type { TideEntry } from "./log";
import TideAsk from "./TideAsk";
import TideHud from "./TideHud";
import TideLog from "./TideLog";

const day = 20771, card = cardForDay(day);
const entry: TideEntry = { day, cardId: card.id, tool: card.tool, commands: ["return"], kept: [true, false, true], decisions: 1, outcome: "returned", late: false, attempts: 1, savedAt: "" };

test("today’s asks replace numerals with 32px objects and preserve every sentence", () => {
  const html = renderToStaticMarkup(<TideAsk today={{ day, card, entry: null }} earlier={[]} sailBlockedReason={null} onSail={() => {}} onOpenLog={() => {}}/>);
  expect(html.match(/src="\/assets\/ui\/ask-[^"]+" width="32" height="32" alt="" decoding="async"/g)).toHaveLength(3);
  expect(html).not.toContain('class="tide-ask-mark"');
  for (const ask of card.asks) expect(html).toContain(askLine(ask, card.tool));
});

test("saved asks and the log retain kept/slipped marks beside their painted objects", () => {
  for (const [size, html] of [
    [32, renderToStaticMarkup(<TideAsk today={{ day, card, entry }} earlier={[]} sailBlockedReason={null} onSail={() => {}} onOpenLog={() => {}}/>)],
    [28, renderToStaticMarkup(<TideLog pages={[{ kind: "tide", day, card, entry }]} reduced sailBlockedReason={null} summary={{ sailed: 1, kept: 2, allThree: 0 }} onSail={() => {}}/>)],
  ] as const) {
    expect(html.match(new RegExp(`src="/assets/ui/ask-[^"]+" width="${size}" height="${size}" alt="" decoding="async"`, "g"))).toHaveLength(3);
    expect(html.match(/class="tide-ask-mark"/g)).toHaveLength(3);
    expect(html.match(/\(kept\)/g)).toHaveLength(2);
    expect(html.match(/\(slipped\)/g)).toHaveLength(1);
  }
});

test("live chips retain noun and status separately without losing holding announcements", () => {
  const html = renderToStaticMarkup(<TideHud card={card} run={startRun(card.tool)} reduced/>);
  expect(html).toContain('aria-label="The Tidekeeper’s asks" aria-live="polite"');
  expect(html).toContain('<span class="tide-chip-noun">Lens · </span><span class="tide-chip-status">still out</span>');
  expect(html).toContain('<span class="tide-chip-noun">One splash · </span><span class="tide-chip-status">0 of 1</span>');
  expect(html).toContain('<span class="tide-chip-noun">Within 10 · </span><span class="tide-chip-status">10 left</span>');
  expect(html).toContain('(holding)');
  expect(html).toContain('(not yet)');
  expect(html.match(/class="tide-mark" aria-hidden="true"/g)).toHaveLength(3);
  const home = replayRun(card.tool, ["return"])!;
  expect(renderToStaticMarkup(<TideHud card={card} run={home} reduced/>).match(/\(slipped\)/g)).toHaveLength(3);
});

test("phone style chips expose only the status while preserving the original full label", () => {
  for (const [style, tool, prefix, status, suffix] of [
    ["dry", "rope", "", "Dry", " paws"],
    ["coiled", "rope", "Rope ", "coiled", ""],
    ["coiled", "lantern", "Lantern ", "unlit", ""],
    ["shut-left", "rope", "Left shell ", "shut", ""],
    ["shut-right", "lantern", "Right shell ", "shut", ""],
    ["no-wait", "rope", "", "No waiting", ""],
  ] as const) {
    const ask: Ask = { kind: "style", style };
    const html = renderToStaticMarkup(<TideHud card={{ ...card, tool, asks: [ask, ask, ask] }} run={startRun(tool)} reduced/>);
    const expected = `${prefix ? `<span class="tide-chip-noun">${prefix}</span>` : ""}<span class="tide-chip-status">${status}</span>${suffix ? `<span class="tide-chip-noun">${suffix}</span>` : ""}`;
    expect(html).toContain(`<span class="tide-chip-label">${expected}</span>`);
    expect(expected.replace(/<[^>]+>/g, "")).toBe(askChip(ask, tool, startRun(tool)));
  }
  const home = replayRun(card.tool, solve(card.tool, card.asks)!)!;
  const html = renderToStaticMarkup(<TideHud card={card} run={home} reduced/>);
  expect(html).toContain('<span class="tide-chip-label"><span class="tide-chip-status">Home in 9</span></span>');
});
