import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Inspect, { forecast } from "./Inspect";
import { replayCourt } from "./engine";
import type { Command, Tool } from "./types";

const approach: Command[] = ["wait", "step:west", "step:north", "step:east", "step:north"];
const atWheel = (commands: Command[] = [], tool: Tool = "rope") =>
  replayCourt({ area: "wind", tool, banked: ["lens"] }, [...approach, ...commands])!;

test("Wind forecasts compare holding and turning the wheel on an already marked surge", () => {
  const state = atWheel();
  expect(forecast(state, null)).toContain("Center source → Right exit");
  const turned = forecast(state, "turn:vane");
  expect(turned).toContain("Center source → Left exit");
  expect(turned).toContain("left channel charges");
  expect(turned).not.toContain("cradle is open");
  expect(state.orientation).toBe(1);
  expect(state.opened).toEqual([1]);
});

test("aligning exposes the vane, rotating away covers it, and inspection respects pickup range", () => {
  const almostAligned = atWheel(["turn:vane"]);
  expect(forecast(almostAligned, "turn:vane")).toContain("within paw’s reach");
  const aligned = atWheel(["turn:vane", "turn:vane"]);
  expect(forecast(aligned, "turn:vane")).toContain("cradle closes");
  const nearby: Command[] = ["turn:vane", "turn:vane", "step:east"];
  const inspect = (tool: Tool) => renderToStaticMarkup(createElement(Inspect, { state: atWheel(nearby, tool) }));
  expect(inspect("rope")).toContain("within rope reach");
  expect(inspect("lantern")).toContain("Approach the center of the far shore");
});
