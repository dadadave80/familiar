import type { JSX } from "react";
import type { Tool } from "../expedition/types";
import type { Ask, Style } from "./asks";

const styleIcons: Record<Style, string> = {
  dry: "dry", splash: "splash", coiled: "coiled", "no-wait": "no-wait", "all-marks": "all-marks",
  "one-crossing": "one-crossing", "both-shells": "both-shells", "shut-left": "shut-shell", "shut-right": "shut-shell",
  "bridge-left": "bridge", "bridge-center": "bridge", "bridge-right": "bridge",
};

export function askIcons(ask: Ask, tool: Tool): readonly string[] {
  if (ask.kind === "style" && ask.style === "coiled" && tool === "lantern") return [];
  const names = ask.kind === "haul" ? ask.haul === "both" ? ["lens", "moth"] : [ask.haul]
    : [ask.kind === "within" ? "within" : styleIcons[ask.style]];
  return names.map(name => `/assets/ui/ask-${name}.webp`);
}

export default function AskIcon({ ask, tool, size }: { ask: Ask; tool: Tool; size: number }): JSX.Element | null {
  const icons = askIcons(ask, tool);
  if (!icons.length) return null;
  return <span className={`tide-ask-icon${icons.length > 1 ? " tide-ask-icon-pair" : ""}`} aria-hidden="true">
    {icons.map(src => <img key={src} src={src} width={size} height={size} alt="" decoding="async"/>)}
  </span>;
}
