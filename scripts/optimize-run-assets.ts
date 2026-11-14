import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { resolve, join } from "node:path";

// Offline derivatives only: keep the generated masters and their original alpha intact.
const web = resolve(import.meta.dir, "../web"), target = join(web, "public/assets/run");
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const files = [];
await mkdir(target, { recursive: true });
for (const name of ["pearl", "vane"]) {
  const source = `assets/source/run/${name}.png`, output = `assets/run/${name}.webp`;
  const before = await Bun.file(join(web, source)).bytes();
  const scaled = Bun.spawnSync(["magick", join(web, source), "-trim", "+repage", "-resize", "168x168", "-gravity", "center", "-background", "none", "-extent", "192x192", "png:-"]);
  assert.equal(scaled.exitCode, 0, scaled.stderr.toString());
  const temporary = join(target, `.${name}.png`);
  await Bun.write(temporary, scaled.stdout);
  try {
    const encoded = Bun.spawnSync(["cwebp", "-quiet", "-q", "85", "-m", "6", "-alpha_q", "100", temporary, "-o", join(web, "public", output)]);
    assert.equal(encoded.exitCode, 0, encoded.stderr.toString());
  } finally { await rm(temporary, { force: true }); }
  const after = await Bun.file(join(web, "public", output)).bytes();
  assert(after.length < before.length, `${name}: optimized derivative must be smaller`);
  assert.equal(hash(await Bun.file(join(web, source)).bytes()), hash(before), "Master must remain byte-identical");
  const alpha = Bun.spawnSync(["magick", join(web, "public", output), "-format", "%[opaque] %[fx:p{0,0}.a] %[fx:mean.a]", "info:"]);
  assert.equal(alpha.exitCode, 0, alpha.stderr.toString());
  const [opaque, corner, coverage] = alpha.stdout.toString().trim().split(" ");
  assert.equal(opaque?.toLowerCase(), "false", `${name}: real alpha required`);
  assert.equal(Number(corner), 0, `${name}: transparent corner required`);
  assert(Number(coverage) > .1 && Number(coverage) < .8, `${name}: visible object with clear margins required`);
  files.push({ source, output, sourceSha256: hash(before), sha256: hash(after), sourceBytes: before.length, bytes: after.length, width: 192, height: 192 });
}
const report = { purpose: "Tide-run prize derivatives; generated transparent alpha preserved", encoder: "ImageMagick trim, fit168 in transparent192; cwebp quality85 method6 alpha100", files };
await Bun.write(join(target, "manifest.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
