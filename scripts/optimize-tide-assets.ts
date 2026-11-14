import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TIDE_POOL } from "../web/src/tide/cards";

// Offline regeneration; builds use these derivatives and leave the PNG masters untouched.
const webRoot = resolve(import.meta.dir, "../web");
const sourceRoot = join(webRoot, "assets/source/tide"), target = join(webRoot, "public/assets/tide");
type Rule = { resize: string; fuzz?: number; erode?: number; center?: boolean; trim?: boolean };
const rules: Record<string, Rule> = Object.fromEntries(TIDE_POOL.map(({ id }) => [`card-${id}`, { resize: "480x480" }]));
Object.assign(rules, {
  "keeper-ask": { resize: "960x", fuzz: 6, erode: 2 },
  "log-cover": { resize: "384x384", fuzz: 6, erode: 2 },
  "seal-kept": { resize: "168x168", fuzz: 10, erode: 2 },
  "seal-all-three": { resize: "168x168", fuzz: 10, erode: 2 },
  "seal-slipped": { resize: "168x168", fuzz: 10, erode: 2, center: true },
  "log-page": { resize: "900x", fuzz: 12, erode: 3, trim: true },
});
const names = (await readdir(sourceRoot)).filter(name => name.endsWith(".png")).map(name => name.slice(0, -4)).sort();
for (const name of names) assert(Object.hasOwn(rules, name), `Unknown tide master: ${name}.png`);
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
const work = await mkdtemp(join(tmpdir(), "tide-art-")), files = [];
try {
  for (const name of names) {
    const master = join(sourceRoot, name + ".png"), cut = join(work, name + ".png"), output = join(target, name + ".webp");
    const before = await Bun.file(master).bytes(), rule = rules[name];
    try {
      const treatment: string[] = [];
      if (rule.fuzz) {
        const { width, height } = pixelSize(master);
        const seeds = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
        if (rule.center) seeds.push([Math.floor(width / 2), Math.floor(height / 2)]);
        treatment.push("-alpha", "set", "-fuzz", `${rule.fuzz}%`, "-fill", "none",
          ...seeds.flatMap(([x, y]) => ["-draw", `alpha ${x} ${y} floodfill`]),
          "-channel", "A", "-morphology", "Erode", `Disk:${rule.erode}`, "-blur", "0x1", "+channel");
        if (rule.trim) treatment.push("-trim", "+repage");
      } else treatment.push("-alpha", "off");
      run(["magick", master, ...treatment, "-filter", "Lanczos", "-resize", rule.resize, cut]);
      run(["cwebp", "-quiet", "-q", "88", "-m", "6", "-alpha_q", "100", "-sharp_yuv",
        ...(!rule.fuzz ? ["-noalpha"] : []), cut, "-o", output]);
      const after = await Bun.file(output).bytes();
      files.push({ source: `assets/source/tide/${name}.png`, output: `assets/tide/${name}.webp`,
        sourceSha256: hash(before), sha256: hash(after), sourceBytes: before.length, bytes: after.length,
        resizedTo: pixelSize(output) });
    } finally {
      assert.equal(hash(await Bun.file(master).bytes()), hash(before), `Master must stay byte-identical: ${name}.png`);
    }
  }
  const report = { purpose: "Tide runtime artwork; opaque card pictures and alpha cut-outs with original masters preserved",
    encoder: "magick Lanczos + cwebp quality88 method6 alpha100 sharp_yuv", files };
  await Bun.write(join(target, "manifest.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  await rm(work, { recursive: true, force: true });
}
