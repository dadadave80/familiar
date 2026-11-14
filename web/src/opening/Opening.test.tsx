import { expect, test } from "bun:test";
import { HarborAudio } from "../expedition/audio";
import Opening from "./Opening";

test("painted boards survive frame updates and the bell keeps its pivot and touch target", () => {
  for (const [width, height] of [[320, 480], [390, 844], [844, 390], [1280, 800], [1536, 1024]]) {
    const opening = new Opening({ audio: new HarborAudio(), hasSave: false, onStart: async () => {}, onDone() {} });
    const bell = { style: {} as Record<string, string>, isConnected: true };
    const world = { style: {} as Record<string, string>, isConnected: true };
    const post = { style: {} as Record<string, string>, isConnected: true };
    const boards = Object.fromEntries(opening.items().map(id => [id, { style: { background: "painted board" } as Record<string, string>, isConnected: true }]));
    opening.root = {
      clientWidth: width, clientHeight: height, dataset: {},
      querySelector: (selector: string) => selector === '[data-el="bell"]' ? bell : selector === '[data-el="world"]' ? world : selector === '[data-el="post"]' ? post : boards[selector.match(/data-plank="([^"]+)"/)?.[1] ?? ""] ?? null,
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
    for (const board of Object.values(boards)) expect(board.style.background).toBe("painted board");
    expect(boards.new.style.filter).toContain("brightness(1.06)");
    expect(boards.tide.style.filter).toBe("drop-shadow(0 3px 3px #2a1d1166)");
  }
});
