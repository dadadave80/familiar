import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import WrensLightPreview from "./Preview";
import { LARGE_LANDSCAPE_MEDIA, openingPictureSizes } from "./wrens-light-scenes";
import { FINAL_OPENING_PLACEHOLDER, OPENING_PLACEHOLDER } from "./opening-placeholder";

function preview() {
  const view = new WrensLightPreview({ onStart: async () => {}, onDone() {} });
  view.setState = (update, callback) => {
    const change = typeof update === "function" ? update(view.state, view.props) : update;
    if (change) view.state = { ...view.state, ...change };
    callback?.();
  };
  view.componentDidMount();
  return view;
}

const image = (decode = () => Promise.resolve()) => ({ decode, currentSrc: "/assets/opening/mochi-quay.webp" }) as HTMLImageElement;

test("preview can exit on its inline final poster while full art remains unavailable", async () => {
  const view = preview();
  expect(renderToStaticMarkup(view.render())).not.toContain("mochi-quay.webp");
  view.requestDestination();
  const waiting = renderToStaticMarkup(view.render());
  expect(waiting).toContain(FINAL_OPENING_PLACEHOLDER.portrait);
  expect(waiting).toContain(FINAL_OPENING_PLACEHOLDER.landscape);
  expect(waiting).toContain('class="wl-placeholder"');
  expect(waiting).toContain('data-plate="mochi-quay"');
  expect(waiting).toContain('visibility:hidden');
  expect(waiting).toContain('inert=""');
  expect(waiting).toContain(`media="${LARGE_LANDSCAPE_MEDIA}"`);
  expect(waiting).toContain('srcSet="/assets/opening/mochi-quay-landscape.webp 1728w, /assets/opening/mochi-quay-landscape-2880.webp 2880w"');
  expect(waiting).toContain(`sizes="${openingPictureSizes("/assets/opening/mochi-quay-landscape.webp")}"`);
  await view.prepareDestination(image());
  expect(view.state.ready).toBe(true);
  expect(view.state.painted).toBe(false);
  expect(view.state.ended).toBe(false);
  let focused = false;
  view.heading = { focus() { focused = true; } } as unknown as HTMLHeadingElement;
  view.finish();
  expect(focused).toBe(true);
  expect(view.state.ended).toBe(true);
  const ended = renderToStaticMarkup(view.render());
  expect(ended).not.toContain('aria-label="Keep Wren’s Light opening"');
  expect(ended).toContain("Film preview complete");
  expect(ended).toContain("data:image/webp;base64,");
  view.componentWillUnmount();
});

test("the full final image becomes visible only after decode; failures keep the inline poster", async () => {
  const view = preview();
  view.requestDestination();
  await view.prepareDestination(image());
  let resolve!: () => void;
  const upgrade = view.preparePicture(image(() => new Promise<void>(done => { resolve = done; })));
  expect(view.state.painted).toBe(false);
  resolve();
  await upgrade;
  expect(view.state.painted).toBe(true);
  expect(renderToStaticMarkup(view.render())).toContain('visibility:visible');
  view.restart();
  view.requestDestination();
  await view.prepareDestination(image());
  await view.preparePicture(image(() => Promise.reject(new Error("missing image"))));
  expect(view.state.ready).toBe(true);
  expect(view.state.painted).toBe(false);
  view.componentWillUnmount();
});

test("replay and unmount discard stale poster and full-image decodes", async () => {
  const view = preview();
  view.requestDestination();
  let resolvePoster!: () => void, resolvePicture!: () => void;
  const poster = view.prepareDestination(image(() => new Promise<void>(done => { resolvePoster = done; })));
  const picture = view.preparePicture(image(() => new Promise<void>(done => { resolvePicture = done; })));
  view.restart();
  resolvePoster();
  resolvePicture();
  await Promise.all([poster, picture]);
  expect(view.state).toEqual({ requested: false, ready: false, painted: false, ended: false, replay: 1 });
  view.requestDestination();
  const abandoned = view.prepareDestination(image(() => new Promise<void>(done => { resolvePoster = done; })));
  view.componentWillUnmount();
  resolvePoster();
  await abandoned;
  expect(view.state.ready).toBe(false);
});

test("StrictMode remount retries the inline poster without waiting for network artwork", async () => {
  const view = preview();
  view.requestDestination();
  Object.assign(view, { destination: image() });
  view.componentWillUnmount();
  view.componentDidMount();
  await Promise.resolve();
  await Promise.resolve();
  expect(view.state.ready).toBe(true);
  expect(view.state.painted).toBe(false);
  view.componentWillUnmount();
});

test("inline final posters are distinct from storm and match their delivery provenance", async () => {
  const manifest = await Bun.file(new URL("../../../public/assets/opening/manifest.json", import.meta.url)).json();
  for (const orientation of ["portrait", "landscape"] as const) {
    expect(FINAL_OPENING_PLACEHOLDER[orientation]).not.toBe(OPENING_PLACEHOLDER[orientation]);
    const source = `web/assets/source/opening/mochi-quay${orientation === "landscape" ? "-landscape" : ""}.png`;
    const record = manifest.inlinePosters.files.find((file: { source: string }) => file.source === source);
    const bytes = Buffer.from(FINAL_OPENING_PLACEHOLDER[orientation].split(",")[1], "base64");
    expect(record.orientation).toBe(orientation);
    expect(record.bytes).toBe(bytes.length);
    expect(record.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(record.dataUriBytes).toBe(FINAL_OPENING_PLACEHOLDER[orientation].length);
  }
});

test("rotation during full-image decode does not expose a different undecoded candidate", async () => {
  const view = preview();
  view.requestDestination();
  let resolve!: () => void;
  const candidate = image(() => new Promise<void>(done => { resolve = done; }));
  const decoding = view.preparePicture(candidate);
  Object.assign(candidate, { currentSrc: "/assets/opening/mochi-quay-landscape.webp" });
  resolve();
  await decoding;
  expect(view.state.painted).toBe(false);
  view.componentWillUnmount();
});
