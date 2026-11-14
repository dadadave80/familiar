import { expect, test } from "bun:test";
import { CARD_PICTURE, cardArt, keeperArt, logCoverArt, logPageArt, sealArt } from "./art";
import { TIDE_POOL } from "./cards";

const publicRoot = new URL("../../public/", import.meta.url);
const manifest: { files: { output: string; bytes: number; resizedTo: { width: number; height: number } }[] } =
  await Bun.file(new URL("assets/tide/manifest.json", publicRoot)).json();
const sizeOf = (url: string) => manifest.files.find(file => `/${file.output}` === url)?.resizedTo;

test("every tide card has a picture description and a 480px picture", () => {
  expect(Object.keys(CARD_PICTURE).sort()).toEqual(TIDE_POOL.map(card => card.id).sort());
  for (const { id } of TIDE_POOL) {
    expect(CARD_PICTURE[id]?.trim().length).toBeGreaterThan(0);
    expect(sizeOf(cardArt(id))).toEqual({ width: 480, height: 480 });
  }
});

test("the seals, keeper and log artwork have their runtime sizes", () => {
  for (const kind of ["kept", "slipped", "all-three"] as const)
    expect(sizeOf(sealArt(kind))).toEqual({ width: 168, height: 168 });
  expect(sizeOf(keeperArt)?.width).toBe(960);
  expect(sizeOf(logCoverArt)).toEqual({ width: 384, height: 384 });
  expect(sizeOf(logPageArt)?.width).toBe(900);
});

test("every manifest output exists with its recorded byte count", async () => {
  expect(manifest.files).toHaveLength(20);
  for (const { output, bytes } of manifest.files) {
    const file = Bun.file(new URL(output, publicRoot));
    expect(await file.exists()).toBe(true);
    expect(file.size).toBe(bytes);
  }
});
