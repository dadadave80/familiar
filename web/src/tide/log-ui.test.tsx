import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CARD_PICTURE } from "./art";
import { cardForDay, dayLabel } from "./cards";
import { tideSummary, type TideEntry } from "./log";
import { logPages } from "./pages";
import type { DayResult } from "./run-day";
import TideLog from "./TideLog";

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
  expect(html).toContain(`<h4>${card.name}</h4>`);
  expect(html).toContain(`${dayLabel(day)} · tide run`);
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
  expect(html).toContain('<dt>Banked</dt><dd>6</dd>');
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
  expect(html).toContain('aria-label="Surf home stamp, 3 of 3 kept. Open its page."');
  expect(html).toContain("1 of 14 collected, 1 with the brass seal");
  expect(html.match(/class="tide-stamp-seal"/g)).toHaveLength(2);
});

test("an empty run still collects its card and shows slipped stamps without a haul", () => {
  const html = render({ ...result, score: 0, banked: [], stamps: { home: false, guess: false, dry: false }, splashes: 2 });
  expect(html).toContain('aria-label="Surf home stamp, 0 of 3 kept. Open its page."');
  expect(html).toContain("1 of 14 collected");
  expect(html).not.toContain("brass seal");
  expect(html).not.toContain('class="tide-stamp-seal"');
  expect(html).not.toContain('class="tide-haul"');
  for (const line of ["Came home empty-pawed", "Short of Bram’s guess", "2 splashes"]) expect(html).toContain(line);
  expect(html.match(/data-kept="false"/g)).toHaveLength(3);
  expect(html.match(/\(slipped\)/g)).toHaveLength(3);
});

test("mixed logs retain the legacy stamp label while crediting a run's brass seal", () => {
  const html = render(result, [legacy]);
  expect(html).toContain('aria-label="Surf home stamp, 2 of 3 asks kept. Open its page."');
  expect(html).toContain("1 of 14 collected, 1 with the brass seal");
  expect(html).toContain("Page 2 of 2");
});
