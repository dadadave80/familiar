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

test("outing guidance shares the hint reading area while native controls remain outside it", () => {
  const html=renderToStaticMarkup(<ControlHints id="outing-help" reading={<p>Banking keeps the outing open.</p>}><button>Wait</button></ControlHints>);
  expect(html).toContain('class="exp-input-reading" tabindex="0" role="region" aria-label="Outing guidance"');
  expect(html).toContain('<p>Banking keeps the outing open.</p><div id="outing-help" class="exp-input-help">');
  expect(html).toContain('</div></div><details class="exp-button-controls">');
});

test("a controlled button preference opens native controls while the default remains closed", () => {
  const html=renderToStaticMarkup(<ControlHints id="remembered-buttons" buttonsOpen onButtonsOpenChange={()=>{}}><button>Wait</button></ControlHints>);
  expect(html).toContain('<details class="exp-button-controls" open="">');
  expect(html).toContain('<summary>Button controls</summary>');
  expect(html).toContain('<button>Wait</button>');
});
