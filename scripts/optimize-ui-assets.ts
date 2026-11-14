import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Offline regeneration; builds use these derivatives and leave the PNG masters untouched.
const webRoot = resolve(import.meta.dir, "../web");
const sourceRoot = join(webRoot, "assets/source/ui"), target = join(webRoot, "public/assets/ui");
type Rule = { family: "sign" | "portrait" | "ask"; fuzz: number; erode: number };
const rules: Record<string, Rule> = {
  "sign-beacon": { family: "sign", fuzz: 4, erode: 1 },
  "sign-bram": { family: "sign", fuzz: 4, erode: 1 },
  "sign-workbench": { family: "sign", fuzz: 4, erode: 1 },
  "sign-satchel": { family: "sign", fuzz: 4, erode: 1 },
  "mochi-portrait": { family: "portrait", fuzz: 4, erode: 1 },
  "mochi-portrait-splashed": { family: "portrait", fuzz: 4, erode: 1 },
  "mochi-portrait-proud": { family: "portrait", fuzz: 4, erode: 1 },
  "ask-lens": { family: "ask", fuzz: 8, erode: 1 },
  "ask-moth": { family: "ask", fuzz: 8, erode: 1 },
  "ask-dry": { family: "ask", fuzz: 8, erode: 1 },
  "ask-splash": { family: "ask", fuzz: 8, erode: 1 },
  "ask-coiled": { family: "ask", fuzz: 8, erode: 1 },
  "ask-no-wait": { family: "ask", fuzz: 8, erode: 1 },
  "ask-all-marks": { family: "ask", fuzz: 8, erode: 1 },
  "ask-one-crossing": { family: "ask", fuzz: 8, erode: 1 },
  "ask-both-shells": { family: "ask", fuzz: 8, erode: 1 },
  "ask-bridge": { family: "ask", fuzz: 8, erode: 1 },
  "ask-shut-shell": { family: "ask", fuzz: 8, erode: 1 },
  "ask-within": { family: "ask", fuzz: 8, erode: 1 },
};
const names = (await readdir(sourceRoot)).filter(name => name.endsWith(".png")).map(name => name.slice(0, -4)).sort();
assert.deepEqual(names, Object.keys(rules).sort(), "UI masters must match the nineteen runtime assets");
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
function alphaBounds(path: string) {
  const bounds = run(["magick", path, "-alpha", "extract", "-threshold", "0", "-format", "%@", "info:"]);
  const match = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(bounds);
  assert(match, `Invalid alpha bounds: ${path}: ${bounds}`);
  const [, width, height, x, y] = match.map(Number);
  assert(width > 0 && height > 0, `Empty cut-out: ${path}`);
  return { x, y, width, height };
}

await mkdir(target, { recursive: true });
const work = await mkdtemp(join(tmpdir(), "ui-art-")), files = [];
const originals = new Map(await Promise.all(names.map(async name => [name, await Bun.file(join(sourceRoot, name + ".png")).bytes()] as const)));
try {
  for (const name of names) {
    const master = join(sourceRoot, name + ".png"), rule = rules[name];
    const { width, height } = pixelSize(master);
    assert.deepEqual({ width, height }, rule.family === "sign" ? { width: 1536, height: 1024 } : { width: 1254, height: 1254 }, `Unexpected master size: ${name}`);
    const seeds = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
    run(["magick", master, "-alpha", "set", "-fuzz", `${rule.fuzz}%`, "-fill", "none",
      ...seeds.flatMap(([x, y]) => ["-draw", `alpha ${x} ${y} floodfill`]),
      "-channel", "A", "-morphology", "Erode", `Disk:${rule.erode}`, "-blur", "0x1", "+channel", join(work, name + ".png")]);
  }
  const portraits = names.filter(name => rules[name].family === "portrait").map(name => alphaBounds(join(work, name + ".png")));
  const x = Math.min(...portraits.map(box => box.x)), y = Math.min(...portraits.map(box => box.y));
  const sharedPortraitCrop = { x, y, width: Math.max(...portraits.map(box => box.x + box.width)) - x, height: Math.max(...portraits.map(box => box.y + box.height)) - y };
  assert(sharedPortraitCrop.width <= 1254 && sharedPortraitCrop.height <= 1254, "Portrait crop must fit the masters");
  for (const name of names) {
    const rule = rules[name], cut = join(work, name + ".png"), resized = join(work, name + "-runtime.png"), output = join(target, name + ".webp");
    const crop = sharedPortraitCrop;
    const framing = rule.family === "portrait" ? ["-crop", `${crop.width}x${crop.height}+${crop.x}+${crop.y}`, "+repage"] : ["-trim", "+repage"];
    const sizing = rule.family === "sign" ? ["-resize", "480x"] : ["-resize", rule.family === "portrait" ? "256x256" : "84x84", "-background", "none", "-gravity", "center", "-extent", rule.family === "portrait" ? "256x256" : "96x96"];
    run(["magick", cut, ...framing, "-filter", "Lanczos", ...sizing, resized]);
    run(["cwebp", "-quiet", "-q", "88", "-m", "6", "-alpha_q", "100", "-sharp_yuv", resized, "-o", output]);
    const before = originals.get(name)!, after = await Bun.file(output).bytes(), resizedTo = pixelSize(output);
    assert.equal(run(["magick", output, "-format", "%[opaque]", "info:"]).toLowerCase(), "false", `UI asset must have alpha: ${name}`);
    if (rule.family === "sign") assert.equal(resizedTo.width, 480, `Unexpected sign width: ${name}`);
    else assert.deepEqual(resizedTo, rule.family === "portrait" ? { width: 256, height: 256 } : { width: 96, height: 96 }, `Unexpected runtime size: ${name}`);
    if (rule.family === "ask") {
      const bounds = alphaBounds(output);
      assert.equal(Math.max(bounds.width, bounds.height), 84, `Ask must have a common visual size: ${name}`);
      assert(bounds.x >= 6 && bounds.y >= 6 && bounds.x + bounds.width <= 90 && bounds.y + bounds.height <= 90, `Ask must have six-pixel minimum margins: ${name}`);
    }
    files.push({ source: `assets/source/ui/${name}.png`, output: `assets/ui/${name}.webp`,
      sourceSha256: hash(before), sha256: hash(after), sourceBytes: before.length, bytes: after.length, resizedTo, ...rule });
  }
  const report = { purpose: "Painted UI runtime artwork; transparent cut-outs with original masters preserved",
    encoder: "magick four-corner floodfill per-asset fuzz/erode blur0x1 Lanczos + cwebp quality88 method6 alpha100 sharp_yuv",
    sharedPortraitCrop, askContentSize: 84, askMargin: 6, files };
  await Bun.write(join(target, "manifest.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
} finally {
  try {
    for (const [name, before] of originals) assert.equal(hash(await Bun.file(join(sourceRoot, name + ".png")).bytes()), hash(before), `Master must stay byte-identical: ${name}.png`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
