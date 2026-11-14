import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CARD_PICTURE } from "./art";
import { cardForDay, dayLabel, TIDE_POOL } from "./cards";
import { tideSummary, type TideEntry } from "./log";
import { logPages } from "./pages";
import type { DayResult } from "./run-day";
import TideLog from "./TideLog";
import { CHAPTERS, harborMemories } from "../run/story";

const day = 20771, card = cardForDay(day);
const result: DayResult = {
  day, score: 6, guess: 6, banked: ["reed", "reed", "reed", "glass", "pearl"],
  stamps: { home: true, guess: true, dry: true }, splashes: 0,
};
const legacy: TideEntry = {
  day, cardId: card.id, tool: card.tool, commands: ["return"], kept: [true, false, true],
  decisions: 1, outcome: "returned", late: false, attempts: 1, savedAt: "",
};

function render(run = result, entries: readonly TideEntry[] = []) {
  const pages = logPages([], entries, [run]);
  return renderToStaticMarkup(<TideLog pages={pages} initialPage={pages.length - 1} reduced={false}
    sailBlockedReason="Finish the outing in progress first." summary={tideSummary(entries, [run])} onSail={() => {}}/>);
}

test("a tide-run page shows its card, paper, haul, facts and three final stamp lines", () => {
  const html = render();
  expect(html).toContain(`<h4>Tide Run · ${dayLabel(day)}</h4>`);
  expect(html).toContain('class="tide-log-chart tide-log-run"');
  expect(html).toContain('--tide-paper:url(/assets/tide/log-page.webp)');
  expect(html).toContain('--stamp:84px;--tilt:5deg');
  expect(html).toContain(`alt="${CARD_PICTURE[card.id]}"`);
  expect(html).toContain('class="tide-haul"');
  expect(html).toContain('class="tide-sr">Haul: 3 reed, 1 glass and 1 pearl.</span>');
  for (const prize of ["/assets/season/reed.webp", "/assets/season/glass.webp", "/assets/run/pearl.webp"]) {
    expect(html).toContain(`src="${prize}" width="24" height="24" alt="" decoding="async"`);
  }
  expect(html).toContain("Reed and glass go to Bram’s shelf. Pearls stay with Mochi.");
  expect(html).toContain('<dt>Score</dt><dd>6</dd>');
  expect(html).toContain('<dt>Bram’s guess</dt><dd>6</dd>');
  expect(html).toContain('<dt>Splashes</dt><dd>0</dd>');
  for (const line of ["Came home with something", "Matched Bram’s guess", "Dry paws"]) expect(html).toContain(line);
  expect(html.match(/class="tide-ask-mark"/g)).toHaveLength(3);
  expect(html.match(/data-kept="true"/g)).toHaveLength(3);
  expect(html.match(/\(kept\)/g)).toHaveLength(3);
  expect(html).not.toContain("--ask-delay");
  expect(html).not.toContain("data-arrival");
  expect(html).not.toContain("data-press");
  expect(html).not.toContain("Chart of Mochi’s route");
  expect(html).not.toContain('class="exp-primary"');
  expect(html).not.toContain("Sail this tide again");
  expect(html).not.toContain("Finish the outing in progress first.");
});

test("a run-only stamp is collected, sealed and labelled with its kept count", () => {
  const html = render();
  expect(html).toContain('aria-label="Tide Run stamp, 3 of 3 kept. Open its page."');
  expect(html).toContain("1 of 14 collected, 1 with the brass seal");
  expect(html.match(/class="tide-stamp-seal"/g)).toHaveLength(2);
});

test("an empty run still collects its card and shows slipped stamps without a haul", () => {
  const html = render({ ...result, score: 0, banked: [], stamps: { home: false, guess: false, dry: false }, splashes: 2 });
  expect(html).toContain('aria-label="Tide Run stamp, 0 of 3 kept. Open its page."');
  expect(html).toContain("1 of 14 collected");
  expect(html).not.toContain("brass seal");
  expect(html).not.toContain('class="tide-stamp-seal"');
  expect(html).not.toContain('class="tide-haul"');
  for (const line of ["Came home empty-pawed", "Short of Bram’s guess", "2 splashes"]) expect(html).toContain(line);
  expect(html.match(/data-kept="false"/g)).toHaveLength(3);
  expect(html.match(/\(slipped\)/g)).toHaveLength(3);
});

test("every device stamp and run page keeps its art without borrowing the retained court name", () => {
  for (const daily of TIDE_POOL) {
    const date = Array.from({ length: 14 }, (_, i) => day + i).find(value => cardForDay(value).id === daily.id)!;
    const html = render({ ...result, day: date });
    expect(html).toContain(`<h4>Tide Run · ${dayLabel(date)}</h4>`);
    expect(html).toContain('aria-label="Tide Run stamp, 3 of 3 kept. Open its page."');
    expect(html).toContain(`alt="${CARD_PICTURE[daily.id]}"`);
    expect(html).not.toContain(`<h4>${daily.name}</h4>`);
  }
});

test("mixed logs retain the legacy stamp label while crediting a run's brass seal", () => {
  const html = render(result, [legacy]);
  expect(html).toContain('aria-label="Surf home stamp, 2 of 3 asks kept. Open its page."');
  expect(html).toContain("1 of 14 collected, 1 with the brass seal");
  expect(html).toContain("Page 2 of 2");
});

test("harbor memories follow earned home state without creating route pages", () => {
  expect(harborMemories({ banked: [], lit: false, signaled: false })).toEqual([]);
  const filed = harborMemories({ banked: ["lens", "vane"], lit: false, signaled: false });
  expect(filed.map(memory => memory.id)).toEqual(["lens", "vane"]);
  expect(filed.map(memory => memory.lines)).toEqual([
    ["Mochi brought the Beacon Lens safely to the harbor."], ["Mochi recovered the Signal Vane."],
  ]);
  const memories = harborMemories({ banked: ["lens", "vane", "moth"], lit: true, signaled: true });
  expect(memories.map(memory => memory.title)).toEqual(["The lens comes home", "Wren’s light", "The vane comes home", "The light’s keeper", "Two familiars and one light"]);
  expect(memories[1]!.lines).toEqual(["The beacon shines again. The Tidekeeper stopped to watch."]);
  expect(memories[3]!.lines).toEqual(CHAPTERS.vane.after);
  expect(memories[4]!.lines).toEqual(["The Tidekeeper let Mochi bring Wren’s wind-moth home. Bram made room beside the hearth.", ...CHAPTERS.moth.after]);
  expect(logPages([], [], [])).toEqual([]);
  expect(JSON.stringify(memories)).not.toMatch(/\b(day|date|commands|decisions|accepted|stamps)\b/);
});

test("a milestone-only log has native expandable memories and no invented chart or daily result", () => {
  const home = { banked: ["lens"], lit: true, signaled: false };
  const renderMemory = () => renderToStaticMarkup(<TideLog pages={[]} memories={harborMemories(home)} reduced
    sailBlockedReason={null} summary={tideSummary([])} onSail={() => {}}/>);
  const html = renderMemory();
  expect(html).toContain('aria-label="Harbor memories"');
  expect(html).toContain("<details><summary>The lens comes home</summary>");
  expect(html).toContain("<details><summary>Wren’s light</summary>");
  expect(html).toContain("Harbor memories appear as Mochi brings finds home. Daily pages appear after a finished daily outing.");
  expect(html).not.toContain("The log is empty");
  expect(html).not.toContain("Chart of Mochi’s route");
  expect(html).not.toContain("Page 1 of");
  expect(html).not.toContain("data-kept");
  expect(renderMemory()).toBe(html);
});

test("an empty saved-harbor log preserves its actual return-page promise", () => {
  const html=renderToStaticMarkup(<TideLog device={false} pages={[]} reduced sailBlockedReason={null}
    summary={tideSummary([])} onSail={() => {}}/>);
  expect(html).toContain("The log is empty. Bring the lens home and Bram starts the first page.");
  expect(html).not.toContain("Harbor memories appear");
  expect(html).not.toContain('aria-label="Harbor memories"');
});
