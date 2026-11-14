import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { LANDSCAPE_MEDIA, LARGE_LANDSCAPE_MEDIA, OPENING_FINAL_CROP_MEDIA, openingPicture, openingPictureSet, openingPictureSizes, OPENING_LANDSCAPE_SIZES, WRENS_LIGHT_FINAL_COMPOSITION, WRENS_LIGHT_SCENES } from "./wrens-light-scenes";
import { preloadWrensLight } from "./opening-preload";

const css = await Bun.file(new URL("./wrens-light-sequence.css", import.meta.url)).text();
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf("}", start) + 1);
};

test("warm edits cut plates only beneath a fully opaque, spatial light veil", () => {
  const incoming = rule('.wl-opening[data-edit="light"] .wl-reveal');
  const outgoing = rule('.wl-opening[data-edit="light"] .wl-previous');
  expect(incoming).toContain("wl-light-in");
  expect(outgoing).toContain("wl-light-out");
  expect(incoming).toContain("steps(1, end)");
  expect(outgoing).toContain("steps(1, end)");
  expect(css).toContain("@keyframes wl-light-in { 0% { opacity: 0; } 50%, 100% { opacity: 1; } }");
  expect(css).toContain("@keyframes wl-light-out { 0% { opacity: 1; } 50%, 100% { opacity: 0; } }");
  expect(css).toContain("44%, 56% { opacity: 1; }");
  const veil = rule(".wl-light");
  expect(veil).toContain("background-color: #f5dfbb");
  expect(veil.match(/radial-gradient/g)?.length).toBeGreaterThanOrEqual(3);
  expect(veil).not.toMatch(/mix-blend-mode|mask-image/);
});

test("caption focus reserves a full 12px clearance without changing focused layout", () => {
  const focus = rule('.wl-opening[data-keyboard] .wl-caption:focus');
  const reading = rule(".wl-reading");
  expect(focus).toContain("outline-offset: 12px");
  expect(focus).toContain("outline: 3px");
  expect(focus).not.toMatch(/(?:^|[;{])\s*(padding|margin|border|width|height):/);
  expect(reading).toContain("margin: -18px");
  expect(reading).toContain("padding: 18px");
  expect(rule(".wl-detail")).toContain("margin: 20px 0 0");
});

test("desktop final crop excludes foreground flowers while keeping Mochi and beacon inside", () => {
  const crop = rule('.wl-preview-destination [data-plate="mochi-quay"]');
  expect(crop).toContain("transform: scale(1.3)");
  expect(crop).toContain("transform-origin: 75% 0%");
  expect(crop).toContain("object-position: center 77%");
  expect(css).toContain('@media (min-width: 1024px) and (min-height: 600px) and (min-aspect-ratio: 8/5) and (max-aspect-ratio: 16/9)');
  const scale = 1.3, offsetX = 1440 * .75 * (1 - scale);
  // The existing 2304×1440 master has flower crowns near its lower-right edge, below y≈1110.
  expect(900 / (.625 * scale)).toBeLessThan(1110);
  expect(816 * scale + offsetX).toBeGreaterThan(0);
  expect((322 + 349) * scale).toBeLessThan(900);
  expect(1171 * scale + offsetX).toBeGreaterThan(0);
  expect((1171 + 148) * scale + offsetX).toBeLessThan(1440);
  expect(WRENS_LIGHT_FINAL_COMPOSITION.landscape.foot.x).toBeCloseTo(985 * scale + offsetX);
  expect(WRENS_LIGHT_FINAL_COMPOSITION.landscape.foot.y).toBeCloseTo(667 * scale);
  for (const height of [900, 810]) {
    const coverOffset = (height - 900) * .77 * scale;
    expect((height - coverOffset) / (.625 * scale)).toBeLessThan(1110);
    expect((322 + 349) * scale + coverOffset).toBeLessThan(height - 25);
  }
});

test("busy controls lose the raised action appearance and display a waiting mark", () => {
  expect(rule('.wl-next[aria-busy="true"]')).toContain("cursor: progress");
  expect(rule('.wl-next[aria-busy="true"]')).toContain("background: #d5c9ad");
  expect(rule('.wl-skip[aria-disabled="true"]')).toContain("text-decoration: none");
  expect(rule(".wl-busy-mark")).toContain("radial-gradient");
});

test("landscape candidates cover desktop DPR while portrait requests stay unchanged", () => {
  for (let scene = 0; scene < WRENS_LIGHT_SCENES.length; scene++) {
    expect(openingPictureSet(openingPicture(scene), true)).toBeUndefined();
    expect(openingPictureSet(openingPicture(scene, true), false)).toBeUndefined();
    expect(openingPicture(scene)).toBe(`/assets/opening/${WRENS_LIGHT_SCENES[scene].id}.webp`);
    expect(openingPictureSet(openingPicture(scene, true), true)).toBe(`${openingPicture(scene, true)} 1728w, /assets/opening/${WRENS_LIGHT_SCENES[scene].id}-landscape-2880.webp 2880w`);
  }
  expect(OPENING_LANDSCAPE_SIZES).toBe("(min-aspect-ratio: 8/5) 100vw, 160vh");
});

test("only the cropped final desktop plate requests its full 130vw painted width", () => {
  const sizes = openingPictureSizes(openingPicture(6, true));
  expect(css).toContain(`@media ${OPENING_FINAL_CROP_MEDIA} {`);
  expect(sizes).toBe(`${OPENING_FINAL_CROP_MEDIA} 130vw, ${OPENING_LANDSCAPE_SIZES}`);
  expect(1440 * 1.3).toBeGreaterThan(1728);
  for (let scene = 0; scene < WRENS_LIGHT_SCENES.length; scene++) {
    expect(openingPictureSizes(openingPicture(scene))).toBe(OPENING_LANDSCAPE_SIZES);
    if (scene !== 6) expect(openingPictureSizes(openingPicture(scene, true))).toBe(OPENING_LANDSCAPE_SIZES);
  }
});

test("entry preload offers the same desktop candidates without requesting them on phones", () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalMatchMedia = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");
  try {
    for (const [landscape, desktop] of [[false, false], [true, false], [true, true]]) {
      const links: HTMLLinkElement[] = [];
      Object.defineProperty(globalThis, "document", { configurable: true, value: {
        head: { querySelector: () => links[0], append: (link: HTMLLinkElement) => links.push(link) },
        createElement: () => ({}),
      } });
      Object.defineProperty(globalThis, "matchMedia", { configurable: true, value: (media: string) => ({
        matches: media === LANDSCAPE_MEDIA ? landscape : media === LARGE_LANDSCAPE_MEDIA ? desktop : false,
      }) });
      preloadWrensLight();
      preloadWrensLight();
      expect(links).toHaveLength(1);
      expect(links[0].href).toBe(openingPicture(0, landscape));
      expect(links[0].fetchPriority).toBe("high");
      const srcset = openingPictureSet(openingPicture(0, landscape), desktop);
      if (srcset) {
        expect(links[0].imageSrcset).toBe(srcset);
        expect(links[0].imageSizes).toBe(OPENING_LANDSCAPE_SIZES);
      } else {
        expect(links[0].imageSrcset).toBeUndefined();
        expect(links[0].imageSizes).toBeUndefined();
      }
    }
  } finally {
    if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (originalMatchMedia) Object.defineProperty(globalThis, "matchMedia", originalMatchMedia);
    else Reflect.deleteProperty(globalThis, "matchMedia");
  }
});

test("all delivered candidates have honest dimensions, bytes and source provenance", async () => {
  const project = resolve(import.meta.dir, "../../../..");
  const manifest = await Bun.file(resolve(project, "web/public/assets/opening/manifest.json")).json();
  const provenance = await Bun.file(resolve(project, "web/public/assets/opening/provenance.json")).json();
  expect(manifest.files).toHaveLength(21);
  for (const file of manifest.files) {
    const bytes = await Bun.file(resolve(project, file.output)).bytes();
    expect(bytes.length).toBe(file.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(file.sha256);
    const record = provenance.files[file.output.split("/").at(-1)];
    expect(record.sourceSha256).toBe(file.sourceSha256);
    expect(record.delivery.outputSize).toEqual(file.outputSize);
    if (file.output.endsWith("-2880.webp")) {
      expect(file.outputSize).toEqual({ width: 2880, height: 1800 });
      expect(record.delivery.operation).toContain("upsample");
    }
  }
  expect(manifest.bytesByDelivery.portrait).toBe(1_035_864);
  expect(manifest.bytesByDelivery.landscape).toBe(1_399_252);
});
