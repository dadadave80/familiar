import { afterEach, expect, test } from "bun:test";
import type { KeyboardEvent, PointerEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WrensLightSequence, WRENS_LIGHT_DISSOLVE_MS, type WrensLightSequenceProps } from "./WrensLightSequence";
import { LANDSCAPE_MEDIA, LARGE_LANDSCAPE_MEDIA, OPENING_LANDSCAPE_SIZES, WRENS_LIGHT_FINAL_COMPOSITION, WRENS_LIGHT_SCENES } from "./wrens-light-scenes";
import { preloadWrensLight } from "./opening-preload";

const originals = new Map(["Image", "document", "matchMedia", "window"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
const created: TestImage[] = [];
const views: WrensLightSequence[] = [];
class TestImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  src = "";
  srcset = "";
  sizes = "";
  fetchPriority = "auto";
  constructor() { created.push(this); }
  decode() { return Promise.resolve(); }
}
function opening(props: Partial<WrensLightSequenceProps> = {}) {
  created.length = 0;
  Object.defineProperty(globalThis, "Image", { configurable: true, value: TestImage });
  let completed = 0, skipped = 0, exited = 0;
  const view = new WrensLightSequence({ onComplete() { completed++; }, onSkip() { skipped++; }, onExited() { exited++; }, ...props });
  // Most interaction tests begin after the first plate; mount tests exercise the cold state explicitly.
  view.state = { ...view.state, loading: false, hasPicture: true };
  views.push(view);
  Object.assign(view, { live: true });
  view.setState = (update, callback) => {
    const change = typeof update === "function" ? update(view.state, view.props) : update;
    if (change) view.state = { ...view.state, ...change };
    view.componentDidUpdate();
    callback?.();
  };
  return { view, counts: () => ({ completed, skipped, exited }) };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
afterEach(() => {
  for (const view of views.splice(0)) view.componentWillUnmount();
  for (const image of created) image.onerror?.();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

function browser() {
  const listeners = new Map<string, () => void>();
  const motion = { matches: false, addEventListener(_name: string, listener: () => void) { listeners.set("motion", listener); }, removeEventListener() {} };
  const landscape = { matches: false, addEventListener(_name: string, listener: () => void) { listeners.set("landscape", listener); }, removeEventListener() {} };
  const largeLandscape = { matches: false, addEventListener(_name: string, listener: () => void) { listeners.set("largeLandscape", listener); }, removeEventListener() {} };
  const document = { activeElement: null as unknown };
  Object.defineProperty(globalThis, "document", { configurable: true, value: document });
  Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: (query: string) => query === LANDSCAPE_MEDIA ? landscape : query === LARGE_LANDSCAPE_MEDIA ? largeLandscape : motion });
  return { document, motion, landscape, largeLandscape, change: (key: string) => listeners.get(key)?.() };
}
function key(value: string, options: { button?: boolean; repeat?: boolean; shiftKey?: boolean } = {}) {
  let prevented = false;
  return {
    event: { key: value, ...options, preventDefault() { prevented = true; }, target: { closest() { return options.button ? {} : null; } } } as unknown as KeyboardEvent<HTMLDivElement>,
    prevented: () => prevented,
  };
}
const pointer = (x: number, y: number, isPrimary = true, pointerId = 1) => ({
  clientX: x, clientY: y, isPrimary, pointerId, button: 0,
} as PointerEvent<HTMLDivElement>);

test("every scene has one code-native caption, persistent orientation and just two native controls", () => {
  const { view } = opening();
  for (let scene = 0; scene < WRENS_LIGHT_SCENES.length; scene++) {
    view.state = { ...view.state, scene, picture: scene, landscape: true };
    const html = renderToStaticMarkup(view.render());
    expect(html).toContain(WRENS_LIGHT_SCENES[scene].heading);
    expect(html.match(/tabindex="-1"/g)?.length).toBe(2);
    expect(html).toContain('id="wl-progress"');
    expect(html).toContain(`Scene ${scene + 1} of 7`);
    expect(html.match(/wl-page-current/g)?.length).toBe(1);
    expect(html).toContain("Skip<span");
    expect(html).toContain(scene === 6 ? "Enter the harbor" : ">Continue<");
    expect(html).not.toContain("Help Mochi");
    expect(html.match(/<h1/g)?.length).toBe(1);
    expect(html.match(/<button/g)?.length).toBe(2);
    expect(html).toContain(`${WRENS_LIGHT_SCENES[scene].id}-landscape.webp`);
    expect(html).toContain(`data-plate="${WRENS_LIGHT_SCENES[scene].id}"`);
    expect(html).not.toContain("wl-atmosphere");
  }
});

test("cold opening shows painted fallback and holds Continue until the first image decodes", async () => {
  const { view } = opening();
  browser();
  view.componentDidMount();
  let decode!: () => void;
  created[0].decode = () => new Promise<void>(resolve => { decode = resolve; });
  expect(created).toHaveLength(1);
  expect(created[0].fetchPriority).toBe("high");
  const loading = renderToStaticMarkup(view.render());
  expect(loading).toContain("data:image/webp;base64,");
  expect(loading).toContain("Bringing the harbor into view…");
  expect(loading).not.toContain('class="wl-picture wl-current"');
  view.advance();
  expect(created).toHaveLength(1);
  created[0].onload?.();
  await flush();
  expect(created).toHaveLength(1);
  decode();
  await flush();
  await flush();
  expect(view.state.scene).toBe(0);
  expect(created[1].src).toBe("/assets/opening/beacon-dark.webp");
  expect(created[1].fetchPriority).toBe("low");
  expect(renderToStaticMarkup(view.render())).toContain('class="wl-picture wl-current"');
  expect(renderToStaticMarkup(view.render())).toContain(">Continue<");
});

test("entry-route preload selects only the first plate in the current orientation and deduplicates", () => {
  const fixture = browser();
  const links: HTMLLinkElement[] = [];
  Object.assign(fixture.document, {
    head: {
      querySelector(selector: string) { return links.find(link => selector.includes(`href="${link.href}"`)); },
      append(link: HTMLLinkElement) { links.push(link); },
    },
    createElement: () => ({}),
  });
  preloadWrensLight();
  preloadWrensLight();
  expect(links).toHaveLength(1);
  expect(links[0]).toMatchObject({ href: "/assets/opening/storm.webp", as: "image", rel: "preload", fetchPriority: "high" });
  fixture.landscape.matches = true;
  preloadWrensLight();
  expect(links).toHaveLength(2);
  expect(links[1].href).toBe("/assets/opening/storm-landscape.webp");
});

test("failed first image keeps the painted fallback, releases reading and does not warm another image", async () => {
  const { view } = opening();
  browser();
  view.componentDidMount();
  created[0].onerror?.();
  await flush();
  expect(created).toHaveLength(1);
  expect(view.state.loading).toBe(false);
  expect(view.state.hasPicture).toBe(false);
  expect(renderToStaticMarkup(view.render())).toContain("You can keep reading.");
  view.advance();
  created[1].onload?.();
  await flush();
  expect(view.state.scene).toBe(1);
  expect(view.state.hasPicture).toBe(true);
  expect(view.state.previous).toBeNull();
});

test("desktop decodes the responsive first plate before warming the next; phones have no srcset", async () => {
  const { view } = opening();
  const fixture = browser();
  fixture.landscape.matches = fixture.largeLandscape.matches = true;
  view.componentDidMount();
  expect(created).toHaveLength(1);
  expect(created[0].srcset).toBe("/assets/opening/storm-landscape.webp 1728w, /assets/opening/storm-landscape-2880.webp 2880w");
  expect(created[0].sizes).toBe(OPENING_LANDSCAPE_SIZES);
  expect(created[0].fetchPriority).toBe("high");
  created[0].onload?.();
  await flush();
  expect(created[1].fetchPriority).toBe("low");
  expect(created[1].srcset).toContain("beacon-dark-landscape-2880.webp 2880w");
  expect(renderToStaticMarkup(view.render())).toContain('srcSet="/assets/opening/storm-landscape.webp 1728w');
  fixture.landscape.matches = fixture.largeLandscape.matches = false;
  fixture.change("landscape");
  expect(created[2].srcset).toBe("");
  created[2].onload?.();
  await flush();
  expect(renderToStaticMarkup(view.render())).not.toContain("2880.webp");
});

test("desktop breakpoint predecodes a new candidate set even when the base URL is cached", async () => {
  const { view } = opening();
  const fixture = browser();
  fixture.landscape.matches = true;
  view.componentDidMount();
  created[0].onload?.();
  await flush();
  expect(view.state.largeLandscape).toBe(false);
  fixture.largeLandscape.matches = true;
  fixture.change("largeLandscape");
  const upgrade = created[2];
  expect(upgrade.src).toBe(created[0].src);
  expect(upgrade.srcset).toContain("2880.webp");
  expect(view.state.largeLandscape).toBe(false);
  upgrade.onload?.();
  await flush();
  expect(view.state.largeLandscape).toBe(true);
});

test("a desktop DPR change redecodes the next scene instead of reusing its smaller prewarm", async () => {
  const { view } = opening();
  const fixture = browser();
  const viewport = { innerWidth: 1440, innerHeight: 900, devicePixelRatio: 1 };
  Object.defineProperty(globalThis, "window", { configurable: true, value: viewport });
  fixture.landscape.matches = fixture.largeLandscape.matches = true;
  view.componentDidMount();
  created[0].onload?.();
  await flush();
  created[1].onload?.();
  await flush();
  viewport.devicePixelRatio = 2;
  view.advance();
  expect(created).toHaveLength(3);
  expect(created[2].src).toBe(created[1].src);
  expect(created[2].srcset).toContain("2880.webp");
  expect(view.state.scene).toBe(0);
  created[2].onload?.();
  await flush();
  expect(view.state.scene).toBe(1);
});

test("the final desktop crop upgrades a smaller prewarm and renders the same sizes it decoded", async () => {
  const { view } = opening();
  const fixture = browser();
  const viewport = { innerWidth: 1440, innerHeight: 1000, devicePixelRatio: 1 };
  Object.defineProperty(globalThis, "window", { configurable: true, value: viewport });
  fixture.landscape.matches = fixture.largeLandscape.matches = true;
  const fixtureMatchMedia = globalThis.matchMedia;
  Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: (query: string) => query.includes("max-aspect-ratio: 16/9")
    ? { matches: viewport.innerHeight === 900 } : fixtureMatchMedia(query) });
  view.componentDidMount();
  created[0].onload?.();
  await flush();
  view.state = { ...view.state, scene: 4, picture: 4 };
  view.advance();
  created[2].onload?.();
  await flush();
  const prewarm = created[3];
  expect(prewarm.src).toBe("/assets/opening/mochi-quay-landscape.webp");
  expect(prewarm.sizes).toContain("130vw");
  prewarm.onload?.();
  await flush();
  view.finishShot();
  viewport.innerHeight = 900;
  view.advance();
  expect(created).toHaveLength(5);
  const cropped = created[4];
  expect(cropped.src).toBe(prewarm.src);
  expect(cropped.sizes).toBe(prewarm.sizes);
  expect(view.state.scene).toBe(5);
  cropped.onload?.();
  await flush();
  expect(view.state.scene).toBe(6);
  expect(renderToStaticMarkup(view.render())).toContain(`sizes="${cropped.sizes}"`);
});

test("Skip during the first decode cannot later warm or show the next story scene", async () => {
  const { view, counts } = opening();
  browser();
  view.componentDidMount();
  view.skip();
  created[0].onload?.();
  await flush();
  expect(view.state.scene).toBe(0);
  expect(created.map(image => image.src)).toEqual(["/assets/opening/storm.webp"]);
  expect(counts().skipped).toBe(1);
  expect(view.state.picture).toBe(0);
  expect(renderToStaticMarkup(view.render())).toContain(WRENS_LIGHT_SCENES[0].heading);
});

test("caption focus styling follows intentional keyboard input and resets on touch", () => {
  const { view } = opening();
  expect(renderToStaticMarkup(view.render())).not.toContain('data-keyboard="true"');
  view.onKeyDown(key("ArrowDown").event);
  expect(renderToStaticMarkup(view.render())).toContain('data-keyboard="true"');
  view.onPictureDown(pointer(10, 10));
  expect(renderToStaticMarkup(view.render())).not.toContain('data-keyboard="true"');
});

test("advance waits for decoded art and visibly says Preparing without changing button class", async () => {
  const { view, counts } = opening();
  let focused = 0;
  view.reading = { scrollTop: 200 } as HTMLDivElement;
  view.caption = { focus() { focused++; } } as unknown as HTMLHeadingElement;
  view.advance();
  view.advance();
  expect(view.state.scene).toBe(0);
  expect(view.state.picture).toBe(0);
  expect(view.state.pending).toBe(true);
  expect(renderToStaticMarkup(view.render())).toContain(">Preparing…<");
  expect(created).toHaveLength(1);
  expect(created[0].src).toBe("/assets/opening/beacon-dark.webp");
  created[0].onload?.();
  await flush();
  expect(view.state.scene).toBe(1);
  expect(view.state.picture).toBe(1);
  expect(view.state.previous).toBe("/assets/opening/storm.webp");
  expect(view.state.pending).toBe(false);
  expect(focused).toBe(1);
  expect(view.reading.scrollTop).toBe(0);
  expect(created[1].src).toBe("/assets/opening/wrens-lantern.webp");
  expect(counts()).toEqual({ completed: 0, skipped: 0, exited: 0 });
});

test("failed images keep captions and Skip usable; failed preload is retried", async () => {
  const { view, counts } = opening();
  browser();
  view.componentDidMount();
  created[0].onload?.();
  await flush();
  created[1].onerror?.();
  await flush();
  view.advance();
  expect(created[2].src).toBe("/assets/opening/beacon-dark.webp");
  created[2].onerror?.();
  await flush();
  expect(view.state.scene).toBe(1);
  expect(view.state.picture).toBe(0);
  expect(view.state.unavailable).toBe(true);
  expect(renderToStaticMarkup(view.render())).toContain("You can keep reading.");
  view.skip();
  expect(counts().skipped).toBe(1);
});

test("Skip wins during loading and keeps the current painting, caption and dots paired", async () => {
  const { view, counts } = opening();
  view.advance();
  view.skip();
  view.skip();
  created[0].onload?.();
  await flush();
  expect(view.state.scene).toBe(0);
  expect(view.state.revealing).toBe(false);
  expect(created).toHaveLength(1);
  view.advance();
  expect(view.state.picture).toBe(0);
  expect(view.state.exit).toBe("skip");
  expect(view.state.revealing).toBe(false);
  expect(counts()).toEqual({ completed: 0, skipped: 1, exited: 0 });
  expect(renderToStaticMarkup(view.render())).not.toContain('inert=""');
  expect(renderToStaticMarkup(view.render())).toContain("Scene 1 of 7");
  expect(renderToStaticMarkup(view.render())).not.toContain(`>${WRENS_LIGHT_SCENES[6].heading}</h1>`);
});

test("Skip exits a ready destination without requesting or waiting for final film art", () => {
  const { view, counts } = opening({ destinationReady: true });
  view.skip();
  expect(created).toHaveLength(0);
  expect(view.state.revealing).toBe(true);
  expect(counts()).toEqual({ completed: 0, skipped: 1, exited: 1 });
});

test("Skip restores the visible plate's caption after a failed scene image", () => {
  const { view, counts } = opening({ destinationReady: true });
  view.state = { ...view.state, scene: 6, picture: 4, unavailable: true, reduced: true };
  view.skip();
  expect(view.state.scene).toBe(4);
  expect(view.state.picture).toBe(4);
  expect(created).toHaveLength(0);
  expect(counts().exited).toBe(1);
});

test("completion holds indefinitely, then gives a 600ms reveal notification exactly once", async () => {
  const { view, counts } = opening();
  view.state = { ...view.state, scene: 6, picture: 6 };
  view.advance();
  view.advance();
  view.skip();
  expect(counts()).toEqual({ completed: 1, skipped: 0, exited: 0 });
  expect(view.state.revealing).toBe(false);
  Object.assign(view, { props: { ...view.props, destinationReady: true } });
  view.componentDidUpdate();
  expect(view.state.revealing).toBe(true);
  expect(renderToStaticMarkup(view.render())).toContain('inert=""');
  expect(counts().exited).toBe(0);
  await Bun.sleep(WRENS_LIGHT_DISSOLVE_MS + 20);
  view.componentDidUpdate();
  view.advance();
  view.skip();
  expect(counts()).toEqual({ completed: 1, skipped: 0, exited: 1 });
});

test("exit immediately shows honest busy controls and polite feedback without moving focus", () => {
  const { view } = opening();
  let focused = 0;
  view.caption = { focus() { focused++; } } as unknown as HTMLHeadingElement;
  view.skip();
  const html = renderToStaticMarkup(view.render());
  expect(html).toContain(">Opening…<");
  expect(html).not.toContain(">Enter the harbor<");
  expect(html).toContain('aria-busy="true" aria-disabled="true"');
  expect(html).toContain('class="wl-loading wl-wait"');
  expect(html).toContain("Opening the harbor…");
  expect(html).toContain('class="wl-sr wl-exit-status" role="status" aria-live="polite"');
  expect(focused).toBe(0);
  Object.assign(view, { props: { ...view.props, destinationReady: true } });
  view.componentDidUpdate();
  expect(renderToStaticMarkup(view.render())).not.toContain('class="wl-loading wl-wait"');
});

test("reduced motion preserves the same held final frame and exits immediately after readiness", () => {
  const { view, counts } = opening();
  view.state = { ...view.state, scene: 6, picture: 6, reduced: true };
  view.advance();
  expect(view.state.picture).toBe(6);
  expect(counts().exited).toBe(0);
  Object.assign(view, { props: { ...view.props, destinationReady: true } });
  view.componentDidUpdate();
  expect(counts().exited).toBe(1);
  expect(view.state.picture).toBe(6);
  expect(renderToStaticMarkup(view.render())).toContain('data-still="true"');
});

test("enabling reduced motion during reveal finishes immediately and cancels the delayed callback", async () => {
  const { view, counts } = opening({ destinationReady: true });
  const fixture = browser();
  view.componentDidMount();
  view.state = { ...view.state, scene: 6, picture: 6, loading: false, hasPicture: true };
  view.advance();
  expect(counts().exited).toBe(0);
  fixture.motion.matches = true;
  fixture.change("motion");
  expect(counts().exited).toBe(1);
  await Bun.sleep(WRENS_LIGHT_DISSOLVE_MS + 20);
  expect(counts().exited).toBe(1);
});

test("unmount cancels both pending decoding and the reveal callback", async () => {
  const { view, counts } = opening({ destinationReady: true });
  view.state = { ...view.state, scene: 6, picture: 6 };
  view.advance();
  view.componentWillUnmount();
  await Bun.sleep(WRENS_LIGHT_DISSOLVE_MS + 20);
  expect(counts().exited).toBe(0);
});

test("native controls own Enter and Space; caption keyboard advances and scoped Escape skips once", () => {
  const { view, counts } = opening();
  view.onKeyDown(key("Enter", { button: true }).event);
  view.onKeyDown(key(" ", { button: true }).event);
  view.onKeyDown(key("Enter", { repeat: true }).event);
  expect(created).toHaveLength(0);
  view.onKeyDown(key("ArrowRight").event);
  expect(created).toHaveLength(1);
  view.onKeyDown(key("Escape", { button: true }).event);
  view.onKeyDown(key("Escape").event);
  expect(counts().skipped).toBe(1);
});

test("pointer tap returns caption focus before decode; drag, cancellation and multitouch also retain focus", () => {
  const { view } = opening();
  let focused = 0;
  view.caption = { focus() { focused++; } } as unknown as HTMLHeadingElement;
  view.onPictureDown(pointer(10, 10));
  view.onPictureUp(pointer(10, 60));
  expect(focused).toBe(2);
  expect(created).toHaveLength(0);
  view.onPictureDown(pointer(10, 10));
  view.onPictureCancel();
  view.onPictureUp(pointer(10, 10));
  expect(created).toHaveLength(0);
  view.onPictureDown(pointer(10, 10));
  view.onPictureDown(pointer(20, 20, false, 2));
  view.onPictureUp(pointer(10, 10));
  expect(created).toHaveLength(0);
  view.onPictureDown(pointer(10, 10));
  view.onPictureUp(pointer(11, 11));
  expect(focused).toBe(10);
  expect(created).toHaveLength(1);
});

test("after canceled artwork gestures Enter, Space and Right Arrow each work from the retained caption", () => {
  for (const value of ["Enter", " ", "ArrowRight"]) {
    const { view } = opening();
    const fixture = browser();
    const caption = { focus() { fixture.document.activeElement = caption; } };
    view.caption = caption as HTMLHeadingElement;
    view.onPictureDown(pointer(10, 10));
    view.onPictureCancel();
    expect(fixture.document.activeElement).toBe(caption);
    view.onKeyDown(key(value).event);
    expect(created).toHaveLength(1);
  }
});

test("forward and reverse Tab circuits include only Skip and Continue, including after artwork cancellation", () => {
  const { view } = opening();
  const fixture = browser();
  const skip = { focus() { fixture.document.activeElement = skip; } };
  const next = { focus() { fixture.document.activeElement = next; } };
  const caption = { focus() { fixture.document.activeElement = caption; } };
  view.root = { querySelectorAll: () => [skip, next] } as unknown as HTMLDivElement;
  view.caption = caption as HTMLHeadingElement;
  view.onPictureCancel();
  view.onKeyDown(key("Tab").event);
  expect(fixture.document.activeElement).toBe(skip);
  const middle = key("Tab");
  view.onKeyDown(middle.event);
  expect(middle.prevented()).toBe(false);
  fixture.document.activeElement = next; // Native Tab performs the interior step.
  view.onKeyDown(key("Tab").event);
  expect(fixture.document.activeElement).toBe(skip);
  view.onKeyDown(key("Tab", { shiftKey: true }).event);
  expect(fixture.document.activeElement).toBe(next);
  fixture.document.activeElement = caption;
  view.onKeyDown(key("Tab", { shiftKey: true }).event);
  expect(fixture.document.activeElement).toBe(next);
});

test("the programmatically focused caption scrolls overflowing copy with arrows, pages, Home and End", () => {
  const { view } = opening();
  view.reading = { scrollTop: 0, clientHeight: 200, scrollHeight: 600 } as HTMLDivElement;
  view.onKeyDown(key("ArrowDown").event);
  expect(view.reading.scrollTop).toBe(40);
  view.onKeyDown(key("PageDown").event);
  expect(view.reading.scrollTop).toBe(200);
  view.onKeyDown(key("PageUp").event);
  expect(view.reading.scrollTop).toBe(40);
  view.onKeyDown(key("End").event);
  expect(view.reading.scrollTop).toBe(600);
  view.onKeyDown(key("Home").event);
  expect(view.reading.scrollTop).toBe(0);
  expect(created).toHaveLength(0);
});

test("rotation during the cold opening waits for the new first plate before warming the next", async () => {
  const { view } = opening();
  const fixture = browser();
  fixture.landscape.matches = true;
  view.componentDidMount();
  expect(created[0].src).toBe("/assets/opening/storm-landscape.webp");
  expect(created).toHaveLength(1);
  fixture.landscape.matches = false;
  fixture.change("landscape");
  expect(created).toHaveLength(2);
  expect(created[1].src).toBe("/assets/opening/storm.webp");
  expect(view.state.loading).toBe(true);
  created[1].onload?.();
  await flush();
  expect(created[2].src).toBe("/assets/opening/beacon-dark.webp");
  expect(view.state.landscape).toBe(false);
  expect(view.state.loading).toBe(false);
  created[0].onerror?.();
  await flush();
  expect(view.state.unavailable).toBe(false);
  expect(view.state.landscape).toBe(false);
});

test("rotation holds the decoded plate and a failed format cannot replace it with a broken image", async () => {
  const { view } = opening();
  const fixture = browser();
  view.componentDidMount();
  created[0].onload?.();
  await flush();
  created[1].onload?.();
  await flush();
  fixture.landscape.matches = true;
  fixture.change("landscape");
  expect(view.state.landscape).toBe(false);
  created[2].onerror?.();
  await flush();
  expect(view.state.landscape).toBe(false);
  expect(view.state.unavailable).toBe(true);
  expect(renderToStaticMarkup(view.render())).toContain('src="/assets/opening/storm.webp"');
});

test("rotating during advance waits for the new format before revealing that scene", async () => {
  const { view } = opening();
  const fixture = browser();
  view.componentDidMount();
  created[0].onload?.();
  await flush();
  view.advance();
  fixture.landscape.matches = true;
  fixture.change("landscape");
  created[1].onload?.();
  await flush();
  expect(view.state.scene).toBe(0);
  expect(view.state.pending).toBe(true);
  created[2].onload?.();
  created[3].onload?.();
  await flush();
  expect(view.state.scene).toBe(1);
  expect(view.state.landscape).toBe(true);
  expect(view.state.pending).toBe(false);
});

test("early advancement queues one edit until the outgoing dissolve has finished", async () => {
  const { view } = opening();
  view.advance();
  created[0].onload?.();
  await flush();
  view.advance();
  view.advance();
  expect(view.state.scene).toBe(1);
  expect(view.state.previous).toBe("/assets/opening/storm.webp");
  expect(view.state.pending).toBe(true);
  created[1].onload?.();
  await flush();
  expect(view.state.scene).toBe(1);
  view.finishShot();
  await flush();
  expect(view.state.scene).toBe(2);
  expect(view.state.previous).toBe("/assets/opening/beacon-dark.webp");
  expect(view.state.pending).toBe(false);
});

test("an already canceled pointer cannot make optional capture throw out of the interaction", () => {
  const { view } = opening();
  const event = { ...pointer(10, 10), currentTarget: { setPointerCapture() { throw new Error("NotFoundError"); } } } as unknown as PointerEvent<HTMLDivElement>;
  expect(() => view.onPictureDown(event)).not.toThrow();
  view.onPictureCancel();
  expect(created).toHaveLength(0);
});

test("rotation releases a queued advance without leaving Preparing stuck", async () => {
  const { view } = opening();
  const fixture = browser();
  view.componentDidMount();
  created[0].onload?.();
  await flush();
  created[1].onload?.();
  await flush();
  view.advance();
  await flush();
  view.advance();
  expect(view.state.pending).toBe(true);
  fixture.landscape.matches = true;
  fixture.change("landscape");
  created.find(image => image.src === "/assets/opening/beacon-dark-landscape.webp")?.onload?.();
  await flush();
  created.find(image => image.src === "/assets/opening/wrens-lantern-landscape.webp")?.onload?.();
  await flush();
  await flush();
  expect(view.state.scene).toBe(2);
  expect(view.state.landscape).toBe(true);
  expect(view.state.pending).toBe(false);
});

test("rotation while exiting does not start a new film download or delay destination readiness", () => {
  const { view, counts } = opening();
  const fixture = browser();
  fixture.motion.matches = true;
  view.componentDidMount();
  view.skip();
  fixture.landscape.matches = true;
  fixture.change("landscape");
  expect(created.map(image => image.src)).toEqual(["/assets/opening/storm.webp"]);
  Object.assign(view, { props: { ...view.props, destinationReady: true } });
  view.componentDidUpdate();
  expect(counts()).toEqual({ completed: 0, skipped: 1, exited: 1 });
});

test("StrictMode remount replaces canceled promises and ignores stale completions", async () => {
  const { view } = opening();
  browser();
  view.componentDidMount();
  expect(created).toHaveLength(1);
  view.componentWillUnmount();
  view.componentDidMount();
  expect(created).toHaveLength(2);
  await flush();
  expect(view.state.unavailable).toBe(false);
  created[1].onload?.();
  await flush();
  created[2].onload?.();
  await flush();
  view.advance();
  await flush();
  expect(view.state.scene).toBe(1);
  expect(view.state.unavailable).toBe(false);
});

test("scene editing and provisional arrival metrics are explicit and do not invent a live match", () => {
  expect(WRENS_LIGHT_SCENES.filter(scene => scene.edit === "dissolve").map(scene => scene.id)).toEqual(["beacon-dark"]);
  expect(WRENS_LIGHT_SCENES[2].transitionMs).toBe(400);
  expect(WRENS_LIGHT_SCENES[3].transitionMs).toBe(400);
  expect(WRENS_LIGHT_SCENES[5].transitionMs).toBe(800);
  expect(WRENS_LIGHT_SCENES[6].transitionMs).toBe(600);
  expect(WRENS_LIGHT_SCENES.filter(scene => scene.edit === "light").map(scene => scene.id)).toEqual(["harbor-dawn", "mochi-quay"]);
  expect(WRENS_LIGHT_SCENES.slice(2, 5).every(scene => scene.edit === "dip" && scene.editColour === "#132b31")).toBe(true);
  expect(WRENS_LIGHT_SCENES[2].description).toBe("A brass lantern glows on the seat of Wren’s rowboat beside the quay.");
  expect(WRENS_LIGHT_FINAL_COMPOSITION.registration).toBe("film-target-unverified-against-prologue");
  expect(WRENS_LIGHT_FINAL_COMPOSITION.portrait.viewport).toEqual({ width: 390, height: 844 });
});

test("warm edits keep two painted layers with a transient light pass; reduced motion stays still", () => {
  const { view } = opening();
  view.state = { ...view.state, scene: 5, picture: 5, previous: "/assets/opening/boats-home.webp" };
  expect(renderToStaticMarkup(view.render())).toContain('class="wl-light"');
  view.finishShot();
  expect(renderToStaticMarkup(view.render())).not.toContain('class="wl-light"');
  view.state = { ...view.state, reduced: true, previous: "/assets/opening/boats-home.webp" };
  expect(renderToStaticMarkup(view.render())).not.toContain('class="wl-light"');
});
