import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HarborAudio } from "../expedition/audio";
import Opening from "./Opening";

test("painted boards survive frame updates and the bell keeps its pivot and touch target", () => {
  for (const [width, height] of [[320, 480], [390, 844], [844, 390], [1280, 800], [1536, 1024]]) {
    const opening = new Opening({ audio: new HarborAudio(), hasSave: false, onStart: async () => {}, onDone() {} });
    const bell = { style: {} as Record<string, string>, isConnected: true };
    const soundtag = { style: {} as Record<string, string>, isConnected: true };
    const world = { style: {} as Record<string, string>, isConnected: true };
    const post = { style: {} as Record<string, string>, isConnected: true };
    const boards = Object.fromEntries(opening.items().map(id => [id, { style: { background: "painted board" } as Record<string, string>, isConnected: true }]));
    opening.root = {
      clientWidth: width, clientHeight: height, dataset: {},
      querySelector: (selector: string) => selector === '[data-el="bell"]' ? bell : selector === '[data-el="soundtag"]' ? soundtag : selector === '[data-el="world"]' ? world : selector === '[data-el="post"]' ? post : boards[selector.match(/data-plank="([^"]+)"/)?.[1] ?? ""] ?? null,
      querySelectorAll: () => [],
    } as unknown as HTMLDivElement;
    opening.s = { camT: 0, zoomAdd: 0, courtA: 0, titleA: 1, promptA: 0, capA: 0 };
    opening.mode = "menu"; opening.sel = "new";
    for (const id of opening.items()) opening.mp[id] = 1;
    opening.draw();
    const scale = Number(world.style.transform.match(/scale\(([^)]+)\)/)![1]);
    const k = Number(post.style.transform.match(/scale\(([^)]+)\)/)![1]);
    expect(parseFloat(bell.style.width) * scale * k).toBeGreaterThanOrEqual(44 - 1e-9);
    expect(parseFloat(bell.style.height) * scale * k).toBeGreaterThanOrEqual(44 - 1e-9);
    expect(parseFloat(bell.style.left) + parseFloat(bell.style.width) / 2).toBe(826);
    expect(parseFloat(soundtag.style.fontSize) * scale * k).toBeGreaterThanOrEqual(12 - 1e-9);
    for (const board of Object.values(boards)) expect(board.style.background).toBe("painted board");
    expect(boards.new.style.filter).toContain("brightness(1.06)");
    expect(boards.tide.style.filter).toBe("drop-shadow(0 3px 3px #2a1d1166)");
  }
});

test("options keep volume targets at 44px and the scroll inside the viewport", () => {
  for (const [width, height] of [[320, 480], [390, 844], [844, 390], [1280, 800], [1536, 1024]]) {
    const opening = new Opening({ audio: new HarborAudio(), hasSave: false, onStart: async () => {}, onDone() {} });
    const world = { style: {} as Record<string, string>, isConnected: true };
    const post = { style: {} as Record<string, string>, isConnected: true };
    const pegs = Array.from({ length: 10 }, () => ({ dataset: { bus: "music" }, style: {} as Record<string, string> }));
    const buttons = [...pegs, ...Array.from({ length: 2 }, () => ({ dataset: {}, style: {} as Record<string, string> }))];
    const scroll = { style: {} as Record<string, string>, offsetHeight: 330, get offsetWidth() { return parseFloat(this.style.width); }, isConnected: true, querySelectorAll: () => buttons };
    opening.root = {
      clientWidth: width, clientHeight: height, dataset: {},
      querySelector: (selector: string) => ({ '[data-el="world"]': world, '[data-el="post"]': post, '[data-el="scroll"]': scroll } as Record<string, unknown>)[selector] ?? null,
      querySelectorAll: () => [],
    } as unknown as HTMLDivElement;
    opening.s = { camT: 0, zoomAdd: 0, courtA: 0, titleA: 1, promptA: 0, capA: 0, scrollP: 1 };
    opening.mode = "menu";
    opening.draw();
    const [, tx, , scale] = world.style.transform.match(/translate\(([^,]+)px,([^)]+)px\) scale\(([^)]+)\)/)!;
    const [, dx, k] = post.style.transform.match(/translateX\(([^)]+)px\) scale\(([^)]+)\)/)!;
    const factor = Number(scale) * Number(k);
    for (const peg of pegs) {
      expect(parseFloat(peg.style.width) * factor).toBeGreaterThanOrEqual(44 - 1e-9);
      expect(parseFloat(peg.style.height) * factor).toBeGreaterThanOrEqual(44 - 1e-9);
    }
    const x = parseFloat(scroll.style.transform.match(/translate\(([^,]+)px/)![1]);
    const left = Number(tx) + (890 + Number(dx) - 8 * Number(k) + x * Number(k)) * Number(scale);
    expect(left).toBeGreaterThanOrEqual(10 - 1e-9);
    expect(left + parseFloat(scroll.style.width) * factor).toBeLessThanOrEqual(width - 10 + 1e-9);
  }
});

test("options show current volume without changing the control names", () => {
  const opening = new Opening({ audio: new HarborAudio(), hasSave: false, onStart: async () => {}, onDone() {} });
  opening.state = { ...opening.state, scroll: "options" };
  const html = renderToStaticMarkup(opening.render());
  expect(html).toContain("Music 4 of 5");
  expect(html).toContain("Effects 5 of 5");
  for (const bus of ["Music", "Effects"]) for (let n = 1; n <= 5; n++) expect(html).toContain(`aria-label="${bus} level ${n}"`);
  expect(html).toContain('role="dialog" aria-label="Options"');
  expect(html).toContain('aria-pressed="false"');
  expect(html).toContain(">Sound off</span>");
  expect(html).toContain(">Back</span>");
});
