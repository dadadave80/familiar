import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Ask, Style } from "./asks";
import AskIcon, { askIcons } from "./AskIcon";

test("haul asks pair the matching finds and decision asks use the hourglass", () => {
  expect(askIcons({ kind: "haul", haul: "lens" }, "rope")).toEqual(["/assets/ui/ask-lens.webp"]);
  expect(askIcons({ kind: "haul", haul: "moth" }, "lantern")).toEqual(["/assets/ui/ask-moth.webp"]);
  expect(askIcons({ kind: "haul", haul: "both" }, "rope")).toEqual(["/assets/ui/ask-lens.webp", "/assets/ui/ask-moth.webp"]);
  expect(askIcons({ kind: "within", decisions: 10 }, "rope")).toEqual(["/assets/ui/ask-within.webp"]);
});

test("every style maps to its painted object, with no rope art for an unlit lantern", () => {
  const styles: Record<Style, string> = {
    dry: "dry", splash: "splash", coiled: "coiled", "no-wait": "no-wait", "all-marks": "all-marks",
    "one-crossing": "one-crossing", "both-shells": "both-shells", "shut-left": "shut-shell", "shut-right": "shut-shell",
    "bridge-left": "bridge", "bridge-center": "bridge", "bridge-right": "bridge",
  };
  for (const [style, icon] of Object.entries(styles)) {
    expect(askIcons({ kind: "style", style: style as Style }, "rope")).toEqual([`/assets/ui/ask-${icon}.webp`]);
  }
  expect(askIcons({ kind: "style", style: "coiled" }, "lantern")).toEqual([]);
});

test("ask art is decorative, sized, asynchronously decoded and paired when needed", () => {
  for (const size of [24, 28, 32]) {
    const html = renderToStaticMarkup(<AskIcon ask={{ kind: "haul", haul: "both" }} tool="rope" size={size}/>);
    expect(html).toContain('class="tide-ask-icon tide-ask-icon-pair"');
    expect(html.match(new RegExp(`width="${size}" height="${size}" alt="" decoding="async"`, "g"))).toHaveLength(2);
    expect(html).toContain('aria-hidden="true"');
  }
  const unlit: Ask = { kind: "style", style: "coiled" };
  expect(renderToStaticMarkup(<AskIcon ask={unlit} tool="lantern" size={32}/>)).toBe("");
});
