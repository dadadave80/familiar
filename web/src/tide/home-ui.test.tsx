import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { cardForDay } from "./cards";
import { replayRun, solve } from "./asks";
import TideHome from "./TideHome";

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
