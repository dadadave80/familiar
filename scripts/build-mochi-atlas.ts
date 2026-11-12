import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Bun entry point for registering the generated source art. Requires ImageMagick
// and cwebp. Poses share a body pivot and a ground line; crouches retain their
// shorter silhouette rather than being stretched to the standing pose's height.
const art = new URL("../web/public/assets/first-light-motion/", import.meta.url).pathname;
const poses = [
  ["pose", 0, 174], ["pose", 1, 174], ["pose", 2, 176], ["pose", 3, 176],
  ["walk", 0, 330], ["walk", 1, 316], ["contact", 0, 650], ["walk", 3, 320],
  ["pose", 8, 154], ["pose", 9, 154], ["pose", 10, 155], ["pose", 11, 154],
  ["pose", 12, 164], ["pose", 13, 165], ["pose", 14, 166], ["pose", 15, 166],
] as const;

function run(args: string[]) {
  const result = Bun.spawnSync(args, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(`${args[0]}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

const temporary = await mkdtemp(join(tmpdir(), "familiar-mochi-register-"));
try {
  run(["magick", join(art, "mochi-poses-source-v1.png"), "-crop", "4x4@", "+repage", join(temporary, "pose-%02d.png")]);
  run(["magick", join(art, "mochi-walk-source-v1.png"), "-crop", "2x2@", "+repage", join(temporary, "walk-%02d.png")]);
  run(["magick", join(art, "mochi-contact-b-source-v1.png"), join(temporary, "contact-00.png")]);
  const cells: string[] = [];
  for (const [index, [source, frame, pivot]] of poses.entries()) {
    const input = join(temporary, `${source}-${String(frame).padStart(2, "0")}.png`);
    // Measure opaque silhouette only; retain the original soft alpha in the crop.
    const bounds = run(["magick", input, "-alpha", "extract", "-threshold", "50%", "-format", "%@", "info:"]);
    const match = /^(\d+)x(\d+)\+(\d+)\+(\d+)$/.exec(bounds);
    if (!match) throw new Error(`Unrecognized silhouette bounds: ${bounds}`);
    const [, width, height, left, top] = match.map(Number);
    const scale = { pose: .7, walk: .4, contact: .21 }[source];
    const x = Math.round(128 - (pivot - left! + 2) * scale);
    const y = Math.round(224 - (height! + 2) * scale);
    const output = join(temporary, `registered-${index}.png`);
    run([
      "magick", "-size", "256x256", "canvas:none", "(", input,
      "-crop", `${width! + 4}x${height! + 4}+${left! - 2}+${top! - 2}`, "+repage",
      "-resize", `${scale * 100}%`, ")", "-geometry", `+${x}+${y}`, "-compose", "Over", "-composite", output,
    ]);
    cells.push(output);
  }
  const master = join(temporary, "atlas.png");
  run(["magick", "montage", ...cells, "-tile", "4x4", "-geometry", "256x256+0+0", "-background", "none", master]);
  run(["cwebp", "-quiet", "-q", "88", "-alpha_q", "100", "-m", "6", master, "-o", join(art, "mochi-poses-v1.webp")]);
  console.info("Registered 16 Mochi poses: 1024×1024, 256px cells, body x=128, ground y=224.");
} finally {
  await rm(temporary, { recursive: true, force: true });
}
