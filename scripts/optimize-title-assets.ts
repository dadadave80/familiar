import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Offline regeneration; builds use these derivatives and leave the PNG masters untouched.
const webRoot = resolve(import.meta.dir, "../web");
const sourceRoot = join(webRoot, "assets/source/title"), target = join(webRoot, "public/assets/title");
type Rule = { resize: string; fuzz: number; erode: number };
const rules: Record<string, Rule> = {
  "title-plank-1": { resize: "720x", fuzz: 8, erode: 2 },
  "title-plank-2": { resize: "720x", fuzz: 8, erode: 2 },
  "title-plank-3": { resize: "720x", fuzz: 8, erode: 2 },
  "title-plank-4": { resize: "720x", fuzz: 8, erode: 2 },
  "title-post": { resize: "x1240", fuzz: 8, erode: 2 },
  "title-bell": { resize: "x330", fuzz: 8, erode: 2 },
  "title-tag": { resize: "260x", fuzz: 8, erode: 2 },
  "title-paper": { resize: "780x", fuzz: 8, erode: 2 },
};
const names = (await readdir(sourceRoot)).filter(name => name.endsWith(".png")).map(name => name.slice(0, -4)).sort();
assert.deepEqual(names, Object.keys(rules).sort(), "Title masters must match the eight runtime assets");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function run(command: string[]) {
  const result = Bun.spawnSync(command);
  assert.equal(result.exitCode, 0, `${command[0]} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}
function pixelSize(path: string) {
  const [width, height] = run(["magick", "identify", "-format", "%w %h", path]).split(" ").map(Number);
  assert(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0, `Invalid image size: ${path}`);
  return { width, height };
}

await mkdir(target, { recursive: true });
const work = await mkdtemp(join(tmpdir(), "title-art-")), files = [];
try {
  for (const name of names) {
    const master = join(sourceRoot, name + ".png"), cut = join(work, name + ".png"), output = join(target, name + ".webp");
    const before = await Bun.file(master).bytes(), rule = rules[name];
    try {
      const { width, height } = pixelSize(master);
      const seeds = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
      run(["magick", master, "-alpha", "set", "-fuzz", `${rule.fuzz}%`, "-fill", "none",
        ...seeds.flatMap(([x, y]) => ["-draw", `alpha ${x} ${y} floodfill`]),
        "-channel", "A", "-morphology", "Erode", `Disk:${rule.erode}`, "-blur", "0x1", "+channel",
        "-trim", "+repage", "-filter", "Lanczos", "-resize", rule.resize, cut]);
      run(["cwebp", "-quiet", "-q", "88", "-m", "6", "-alpha_q", "100", "-sharp_yuv", cut, "-o", output]);
      const after = await Bun.file(output).bytes();
      assert.equal(run(["magick", output, "-format", "%[opaque]", "info:"]).toLowerCase(), "false", `Title asset must have alpha: ${name}`);
      const resizedTo = pixelSize(output), expected = Number(rule.resize.replace("x", ""));
      assert.equal(rule.resize.startsWith("x") ? resizedTo.height : resizedTo.width, expected, `Unexpected runtime size: ${name}`);
      files.push({ source: `assets/source/title/${name}.png`, output: `assets/title/${name}.webp`,
        sourceSha256: hash(before), sha256: hash(after), sourceBytes: before.length, bytes: after.length, resizedTo });
    } finally {
      assert.equal(hash(await Bun.file(master).bytes()), hash(before), `Master must stay byte-identical: ${name}.png`);
    }
  }
  const report = { purpose: "Title signpost runtime artwork; trimmed alpha cut-outs with original masters preserved",
    encoder: "magick corner floodfill alpha erode2 blur0x1 trim Lanczos + cwebp quality88 method6 alpha100 sharp_yuv", files };
  await Bun.write(join(target, "manifest.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(work, { recursive: true, force: true });
}
