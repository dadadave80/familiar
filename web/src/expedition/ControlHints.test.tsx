import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import ControlHints from "./ControlHints";

test("touch hints retain an optional native button alternative without opening it", () => {
  const html=renderToStaticMarkup(<ControlHints id="input-help" initialMode="touch" context="Tap the dock to come home."><button>Wait</button></ControlHints>);
  expect(html).toContain("Swipe to move");
  expect(html).toContain("tap a glowing stone");
  expect(html).toContain("Tap the dock to come home.");
  expect(html).toContain('id="input-help"');
  expect(html).toContain("<summary>Button controls</summary>");
  expect(html).toContain("<button>Wait</button>");
  expect(html).not.toContain(" open");
});

test("desktop hints explain movement and the remaining shortcuts as text", () => {
  const html=renderToStaticMarkup(<ControlHints id="keys" initialMode="keyboard"><button>Wait</button></ControlHints>);
  expect(html).toContain("WASD or arrow keys to move");
  expect(html).toContain("Space waits");
  expect(html).toContain("E interacts");
  expect(html).toContain("R returns at the dock");
  expect(html).toContain("I inspects");
  expect(html).not.toContain('role="application"');
  expect(html).not.toContain('aria-live');
});
