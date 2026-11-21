import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { WRENS_LIGHT_SCENES } from "../web/src/opening/wrens-light/wrens-light-scenes";

// Delivery derivatives only; generation and documented normalization happen before this script.
const project = resolve(import.meta.dir, "..");
const source = join(project, "web/assets/source/opening");
const target = join(project, "web/public/assets/opening");
const delivery = {
  portrait: { width: 780, height: 1688, maxBytes: 1_250_000, firstMaxBytes: 200_000 },
  landscape: { width: 1728, height: 1080, maxBytes: 1_800_000, firstMaxBytes: 300_000 },
  landscapeRetina: { width: 2880, height: 1800, maxBytes: 3_200_000, firstMaxBytes: 500_000 },
} as const;
const quality = 87;
const placeholderTarget = "web/src/opening/wrens-light/opening-placeholder.ts";
const names = WRENS_LIGHT_SCENES.flatMap(scene => [scene.id, `${scene.id}-landscape`]).sort();
const actual = (await readdir(source)).filter(name => name.endsWith(".png")).map(name => name.slice(0, -4)).sort();
assert.deepEqual(actual, names, "Each of the seven scenes needs a portrait and a landscape master");

type Size = { width: number; height: number };
type ArtRecord = {
  prompt: string; sourceSha256: string; styleReferences: (string | { path: string; use: string })[];
  native?: Size & { path: string; sha256: string };
  generatedSource?: string; generatedSize?: Size; generatedSha256?: string;
};
type ArtRecords = { created: string; generator: { tool: string; requestedModel: string; model?: string }; files: Record<string, ArtRecord> };
const record = await Bun.file(join(source, "provenance.json")).json() as ArtRecords;
assert(/^\d{4}-\d{2}-\d{2}$/.test(record.created), "Art record needs its actual creation date");
assert(record.generator?.tool, "Art record needs its actual generator tool");
assert.equal(record.generator.requestedModel, "gpt-6-astra", "Record the requested model without claiming the unexposed backend");
assert.deepEqual(Object.keys(record.files).sort(), names.map(name => `${name}.png`).sort(), "Every scene needs exactly one generation record");

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function run(command: string[]) {
  const result = Bun.spawnSync(command);
  assert.equal(result.exitCode, 0, `${command[0]} failed: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}
function pixelSize(path: string) {
  const [width, height] = run(["magick", "identify", "-format", "%w %h", path]).split(" ").map(Number);
  assert(Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0, `Invalid image dimensions: ${path}`);
  return { width, height };
}
const publicValue = (key: string, value: unknown) => key === "originalGeneratedPath"
  || typeof value === "string" && /^\/(Users|private|tmp)\//.test(value) ? undefined : value;
assert.equal(JSON.stringify({ nested: { originalGeneratedPath: "/Users/local.png", path: "web/assets/source/opening/storm.png" }, local: "/tmp/local.png" }, publicValue),
  '{"nested":{"path":"web/assets/source/opening/storm.png"}}', "Public metadata removes private paths recursively");

const work = await mkdtemp(join(tmpdir(), "opening-art-"));
const files = [], provenance: Record<string, unknown> = {};
const placeholders: { orientation: "portrait" | "landscape"; source: string; sourceSha256: string; sha256: string; bytes: number; dataUriBytes: number; width: number; height: number }[] = [];
const inline: Record<string, string> = {}, finalInline: Record<string, string> = {};
try {
  for (const name of names) {
    const master = join(source, `${name}.png`), stripped = join(work, `${name}.png`);
    const before = await Bun.file(master).bytes();
    const art = record.files[`${name}.png`];
    assert.equal(hash(before), art.sourceSha256, `Source differs from its verified generation record: ${name}`);
    const landscape = name.endsWith("-landscape"), orientation = landscape ? "landscape" : "portrait";
    const expectedSize = landscape ? { width: 2304, height: 1440 } : { width: 1170, height: 2532 };
    const native = art.native ?? { path: art.generatedSource, sha256: art.generatedSha256, ...art.generatedSize };
    assert(typeof native.path === "string" && native.path.startsWith("web/assets/source/opening/generated/") && !native.path.split("/").includes(".."), `Missing preserved native image: ${name}`);
    const nativePath = join(project, native.path), nativeBytes = await Bun.file(nativePath).bytes();
    assert.equal(hash(nativeBytes), native.sha256, `Native generation differs from its provenance: ${name}`);
    assert.deepEqual(pixelSize(nativePath), { width: native.width, height: native.height }, `Native dimensions differ from provenance: ${name}`);
    try {
      const sourceSize = pixelSize(master);
      assert.deepEqual(sourceSize, expectedSize, `Master needs the authored ${orientation} delivery canvas: ${name}`);
      assert.equal(run(["magick", nativePath, "-format", "%[opaque]", "info:"]).toLowerCase(), "true", `Native scene must be opaque: ${name}`);
      assert.equal(run(["magick", master, "-format", "%[opaque]", "info:"]).toLowerCase(), "true", `Opening scene must be opaque: ${name}`);
      assert(typeof art.prompt === "string" && art.prompt.length > 0, `Missing prompt: ${name}`);
      assert(Array.isArray(art.styleReferences) && art.styleReferences.every(ref => {
        const path = typeof ref === "string" ? ref : ref.path;
        return typeof path === "string" && path.startsWith("web/assets/source/") && !path.split("/").includes("..");
      }), `References must use repository-relative master paths: ${name}`);
      for (const tier of landscape ? ["landscape", "landscapeRetina"] as const : ["portrait"] as const) {
        const size = delivery[tier], outputName = `${name}${tier === "landscapeRetina" ? "-2880" : ""}.webp`;
        const output = join(work, outputName);
        run(["magick", master, "-filter", "Lanczos", "-resize", `${size.width}x${size.height}`, "-strip", stripped]);
        run(["cwebp", "-quiet", "-q", String(quality), "-m", "6", "-sharp_yuv", stripped, "-o", output]);
        const after = await Bun.file(output).bytes(), outputSize = pixelSize(output);
        assert.deepEqual(outputSize, { width: size.width, height: size.height }, `Runtime must preserve the authored aspect ratio: ${name}`);
        assert.equal(run(["magick", output, "-format", "%[opaque]", "info:"]).toLowerCase(), "true", `Output must stay opaque: ${name}`);
        files.push({ source: `web/assets/source/opening/${name}.png`, output: `web/public/assets/opening/${outputName}`,
          orientation, tier, sourceSha256: hash(before), sha256: hash(after), sourceBytes: before.length, bytes: after.length, sourceSize, outputSize,
          native: { path: native.path, sha256: native.sha256, width: native.width, height: native.height, bytes: nativeBytes.length } });
        provenance[outputName] = { master: `web/assets/source/opening/${name}.png`, created: record.created,
          generator: record.generator, ...art, delivery: { operation: `Proportional Lanczos ${tier === "landscapeRetina" ? "upsample from approved master; no new native detail" : "downsample"}; no crop or repaint`, quality, outputSize, sha256: hash(after), bytes: after.length } };
        if (name === "storm" || name === "storm-landscape") {
          assert(after.length <= size.firstMaxBytes, `First ${tier} scene exceeds its cold-load budget`);
        }
      }
      if (["storm", "storm-landscape", "mochi-quay", "mochi-quay-landscape"].includes(name)) {
        const poster = join(work, `${name}-poster.png`), encoded = join(work, `${name}-poster.webp`);
        run(["magick", master, "-filter", "Lanczos", "-resize", landscape ? "96x60" : "60x130", "-strip", poster]);
        run(["cwebp", "-quiet", "-q", "55", "-m", "6", poster, "-o", encoded]);
        const bytes = await Bun.file(encoded).bytes();
        const posters = name.startsWith("storm") ? inline : finalInline;
        posters[orientation] = `data:image/webp;base64,${Buffer.from(bytes).toString("base64")}`;
        assert(posters[orientation].length <= 2500, `Inline ${name} poster must stay tiny`);
        placeholders.push({ orientation, source: `web/assets/source/opening/${name}.png`, sourceSha256: hash(before),
          sha256: hash(bytes), bytes: bytes.length, dataUriBytes: posters[orientation].length, ...pixelSize(encoded) });
      }
    } finally {
      assert.equal(hash(await Bun.file(master).bytes()), hash(before), `Master must stay byte-identical: ${name}.png`);
    }
  }
  const totalBytes = files.reduce((total, file) => total + file.bytes, 0);
  const bytesByOrientation: Record<string, number> = { portrait: 0, landscape: 0 };
  const bytesByDelivery = { portrait: 0, landscape: 0, landscapeRetina: 0 };
  for (const file of files) {
    bytesByOrientation[file.orientation] += file.bytes;
    bytesByDelivery[file.tier] += file.bytes;
  }
  for (const tier of ["portrait", "landscape", "landscapeRetina"] as const) assert(bytesByDelivery[tier] <= delivery[tier].maxBytes, `${tier} film exceeds its delivery budget`);
  assert.deepEqual(Object.keys(inline).sort(), ["landscape", "portrait"], "Both first-scene orientations need an inline poster");
  assert.deepEqual(Object.keys(finalInline).sort(), ["landscape", "portrait"], "Both final-scene orientations need an inline poster");
  const placeholderModule = `// Generated by scripts/optimize-opening-assets.ts from the approved first and final plates.\nexport const OPENING_PLACEHOLDER = ${JSON.stringify(inline, null, 2)} as const;\nexport const FINAL_OPENING_PLACEHOLDER = ${JSON.stringify(finalInline, null, 2)} as const;\n`;
  const manifest = { purpose: "Keep Wren’s Light opening; seven authored portrait and landscape pairs with responsive desktop delivery", encoder: `ImageMagick Lanczos proportional resize + metadata strip; cwebp quality${quality} method6 sharp_yuv`,
    budget: { ...delivery, inlinePostersMaxBytes: 10000, note: "Portrait is unchanged at 2x the 390x844 phone. Landscape candidates are 1728 and 2880 pixels wide; the latter is resampled from the approved 2304px master, not newly generated detail. Each delivery tier has its own budget; rotating or resizing may fetch more than one tier. Native outputs and source masters remain unchanged." },
    totalBytes, bytesByOrientation, bytesByDelivery, inlinePosters: { module: placeholderTarget, moduleBytes: Buffer.byteLength(placeholderModule), files: placeholders }, files };
  const publicProvenance = { purpose: "Authored opening scenes for Familiar", delivery: "Native generator outputs and full-resolution masters remain separately preserved and hashed. Delivery WebPs use proportional Lanczos resizing to portrait780x1688 and landscape1728x1080 or landscape2880x1800, encoded at quality87, method6, sharp_yuv. The 2880px candidate resamples the approved 2304px master and adds no native detail; preserved landscape generator outputs are approximately 1586px wide. No crops or repaints. Tiny first- and final-scene WebP posters (quality55) are inlined in code for immediate paint. All text is rendered in code.", inlinePosters: placeholders, files: provenance };
  const metadata = JSON.stringify(publicProvenance, publicValue, 2) + "\n";
  assert(!metadata.includes("/Users/") && !metadata.includes("/private/") && !metadata.includes("/tmp/"), "Public provenance must not contain private local paths");
  await mkdir(target, { recursive: true });
  for (const file of files) await copyFile(join(work, file.output.split("/").at(-1)!), join(project, file.output));
  await Bun.write(join(target, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  await Bun.write(join(target, "provenance.json"), metadata);
  await Bun.write(join(project, placeholderTarget), placeholderModule);
  console.log(JSON.stringify(manifest, null, 2));
} finally {
  await rm(work, { recursive: true, force: true });
}
