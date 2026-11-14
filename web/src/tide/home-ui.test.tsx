import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { cardForDay } from "./cards";
import { replayRun, solve } from "./asks";
import TideHome from "./TideHome";
import type { DayResult } from "./run-day";

const card = cardForDay(20771), run = replayRun(card.tool, solve(card.tool, card.asks)!)!;
const base = {card, run, canShelve:true, reduced:false, notice:"Home with Beacon Lens.", sailBlockedReason:null, onBram:()=>{}, onSail:()=>{}, onOpenLog:()=>{}};

test("the Home sheet shows the actual three asks and one next action", () => {
  const html = renderToStaticMarkup(<TideHome {...base}/>);
  expect(html).toContain("All three asks kept.");
  expect(html).toContain("9 decisions · the Tidekeeper’s way");
  expect(html).toContain("Home with Beacon Lens.");
  expect(html).toContain("Take it to Bram");
  expect(html).toContain("See the tide log");
  expect(html).toContain('src="/assets/ui/mochi-portrait-proud.webp"');
  expect(html).toMatch(/<img[^>]*class="tide-home-portrait"[^>]*width="72"[^>]*height="72"[^>]*alt=""[^>]*decoding="async"/);
  expect(html.match(/data-kept="true"/g)).toHaveLength(3);
  expect(html.match(/class="exp-primary"/g)).toHaveLength(1);
  expect(html).toContain('data-press="true"');
  for (const delay of [360,480,600]) expect(html).toContain(`--ask-delay:${delay}ms`);
});

test("reduced motion renders a final result and sailing explains its block", () => {
  const reason = "Finish the outing in progress first.";
  const html = renderToStaticMarkup(<TideHome {...base} canShelve={false} reduced sailBlockedReason={reason}/>);
  expect(html).toContain("All three asks kept.");
  expect(html).toContain("Sail again");
  expect(html).not.toContain("data-press");
  expect(html).toContain('aria-disabled="true"');
  expect(html).toContain("aria-describedby=");
  expect(html).toContain(reason);
});

test("an empty replay cannot borrow the successful day's headline", () => {
  const empty = replayRun(card.tool, ["return"])!;
  const html = renderToStaticMarkup(<TideHome {...base} run={empty} canShelve={false}/>);
  expect(html).toContain("An empty satchel keeps no asks.");
  expect(html).not.toContain("All three asks kept.");
  expect(html.match(/data-kept="false"/g)).toHaveLength(3);
  expect(html).not.toContain("Take it to Bram");
  expect(html).not.toContain("mochi-portrait-proud");
});

test("a returned haul with a slipped ask has no proud portrait", () => {
  const partial = { ...run, state: { ...run.state, resolve: 3 } };
  const html = renderToStaticMarkup(<TideHome {...base} run={partial}/>);
  expect(html).toContain('data-kept="false"');
  expect(html).not.toContain("mochi-portrait-proud");
});

test("the Home sheet renders the supplied notice without rewriting it", () => {
  const notice = "Home with Beacon Lens. All three asks kept.";
  const html = renderToStaticMarkup(<TideHome {...base} notice={notice}/>);
  expect(html).toContain(`<p class="tide-home-note">${notice}</p>`);
  expect(renderToStaticMarkup(<TideHome {...base} notice=""/>)).not.toContain('class="tide-home-note"');
});

const runResult: DayResult = { day: 20771, score: 6, guess: 6, banked: ["reed", "reed", "reed", "glass", "pearl"], stamps: { home: true, guess: true, dry: true }, splashes: 0 };
const runHome = { card, result: runResult, canShelve: true, reduced: false, notice: "Kept on this device.", sailBlockedReason: null, onBram: () => {}, onSail: () => {}, onOpenLog: () => {} };

test("the run Home sheet celebrates all three with one primary and a compact, readable haul", () => {
  const html = renderToStaticMarkup(<TideHome {...runHome}/>);
  expect(html).toContain("All three kept.");
  expect(html).toContain("Banked 6 · Bram guessed 6");
  expect(html).toContain('src="/assets/ui/mochi-portrait-proud.webp"');
  expect(html).toMatch(/<img[^>]*class="tide-home-portrait"[^>]*width="72"[^>]*height="72"[^>]*alt=""[^>]*decoding="async"/);
  expect(html).toContain('class="tide-stamp-seal"');
  expect(html).toContain('data-press="true"');
  expect(html.match(/data-kept="true"/g)).toHaveLength(3);
  expect(html.match(/\(kept\)/g)).toHaveLength(3);
  expect(html.match(/class="tide-ask-mark"/g)).toHaveLength(3);
  for (const label of ["Came home with something", "Matched Bram’s guess", "Dry paws"]) expect(html).toContain(label);
  for (const delay of [360, 480, 600]) expect(html).toContain(`--ask-delay:${delay}ms`);
  for (const icon of ["/assets/season/purse.webp", "/assets/ui/ask-all-marks.webp", "/assets/ui/ask-dry.webp"]) expect(html).toContain(`src="${icon}" width="28" height="28" alt="" decoding="async"`);
  const haul = html.match(/<p class="tide-haul">[\s\S]*?<\/p>/)![0];
  expect(haul).toContain('<span class="tide-sr">Haul: 3 reed, 1 glass and 1 pearl.</span>');
  for (const [path, count] of [["/assets/season/reed.webp", 3], ["/assets/season/glass.webp", 1], ["/assets/run/pearl.webp", 1]] as const) {
    expect(haul).toContain(`<span aria-hidden="true"><img src="${path}" width="24" height="24" alt="" decoding="async"/>×${count}</span>`);
  }
  expect(html).toContain('<p class="tide-home-note">Kept on this device.</p>');
  expect(html.match(/class="exp-primary"/g)).toHaveLength(1);
  expect(html).toContain("Take it to Bram");
  expect(html).toContain("See the tide log");
  expect(html).not.toContain("Sail again for practice");
});

test("partial run results show slipped labels without a proud portrait or all-three seal", () => {
  const partial = { ...runResult, score: 5, stamps: { home: true, guess: false, dry: false }, splashes: 1 };
  const html = renderToStaticMarkup(<TideHome {...runHome} result={partial} canShelve={false}/>);
  expect(html).toContain("1 of 3 kept.");
  expect(html).toContain("Came home with something");
  expect(html).toContain("Short of Bram’s guess");
  expect(html).toContain("One splash");
  expect(html.match(/\(kept\)/g)).toHaveLength(1);
  expect(html.match(/\(slipped\)/g)).toHaveLength(2);
  expect(html).not.toContain("mochi-portrait-proud");
  expect(html).not.toContain("tide-stamp-seal");
  expect(html).toContain("Sail again for practice");
  expect(html).not.toContain("Take it to Bram");
});

test("an empty run haul renders no haul row and only banked prizes appear", () => {
  const empty = { ...runResult, banked: [], score: 0, stamps: { home: false, guess: false, dry: false }, splashes: 2 };
  const html = renderToStaticMarkup(<TideHome {...runHome} result={empty} notice=""/>);
  expect(html).toContain("Nothing kept this time.");
  expect(html).toContain("Came home empty-pawed");
  expect(html).toContain("2 splashes");
  expect(html).not.toContain('class="tide-haul"');
  expect(html).not.toContain("mochi-portrait-proud");
  expect(html).not.toContain('class="tide-home-note"');
  const reedOnly = renderToStaticMarkup(<TideHome {...runHome} result={{ ...runResult, banked: ["reed", "reed"] }}/>).match(/<p class="tide-haul">[\s\S]*?<\/p>/)![0];
  expect(reedOnly).toContain("Haul: 2 reed.");
  expect(reedOnly).not.toContain("glass.webp");
  expect(reedOnly).not.toContain("pearl.webp");
});

test("the reduced run Home sheet shows the final result and explains a sailing block", () => {
  const reason = "Finish the outing in progress first.";
  const html = renderToStaticMarkup(<TideHome {...runHome} reduced canShelve={false} sailBlockedReason={reason}/>);
  expect(html).toContain('data-reduced="true"');
  expect(html).not.toContain("data-press");
  expect(html).toContain("All three kept.");
  expect(html).toContain("Matched Bram’s guess");
  expect(html).toContain("Sail again for practice");
  const described = html.match(/class="exp-primary" aria-disabled="true" aria-describedby="([^"]+)"/);
  expect(described).not.toBeNull();
  expect(html).toContain(`<p class="tide-note" id="${described![1]}">${reason}</p>`);
  expect(html).not.toMatch(/<button[^>]*\sdisabled(?:[=>\s])/);
  const shelve = renderToStaticMarkup(<TideHome {...runHome} sailBlockedReason={reason}/>);
  expect(shelve).toContain('aria-disabled="false"');
  expect(shelve).toContain("Take it to Bram");
  expect(shelve).not.toContain(reason);
});
