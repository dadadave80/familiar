import { copyFile, mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { build } from "vite";
import { BRAND_ASSETS } from "./package-tidebound-review";

// Only the rendered public edition belongs in a release. The editable plan lives outside Git.
const book = process.argv[2];
if (!book) throw new Error("Pass the directory containing the reviewed plan/index.html (the plan directory itself).");
const source = resolve(book);
for (const required of ["index.html", "docs/START-HERE.html", "docs/GAMEPLAY.html", "docs/BUILD-PLAN.html", "docs/MOTION-BRIEF.html", "data/CONTENT.json", "data/ASSET-MANIFEST.json"]) {
  if (!(await Bun.file(join(source, required)).exists())) throw new Error("Incomplete review package: " + required);
}
const root = resolve(import.meta.dir, "..");
const release = await mkdtemp(join(tmpdir(), "familiar-public-"));
const output = join(release, ".vercel", "output");
const site = join(output, "static");
await build({
  root: join(root, "web"),
  envDir: false,
  envPrefix: [],
  define: { "import.meta.env.VITE_EMBEDDED_PLAN": "true" },
  publicDir: false,
  build: { outDir: site, sourcemap: false },
});

async function include(from: string, to: string) {
  await mkdir(dirname(to), { recursive: true });
  await copyFile(from, to);
}
const assets = join(root, "web/public");
for (const path of ["pet.svg", "manifest.webmanifest", "outing.webmanifest", "icons/beacon-192.png", "icons/beacon-512.png", "assets/tiny-town.png", "assets/kenney-license.txt", ...BRAND_ASSETS]) {
  await include(join(assets, path), join(site, path));
}
for await (const file of new Bun.Glob("licenses/*.txt").scan(assets)) {
  await include(join(assets, file), join(site, file));
}
for await (const file of new Bun.Glob("assets/first-light-motion/*.webp").scan(assets)) {
  await include(join(assets, file), join(site, file));
}
await include(join(assets, "assets/first-light-motion/provenance.json"), join(site, "assets/first-light-motion/provenance.json"));

const publicFile = /^(?:index\.html|[\w-]+\.css|docs\/[\w-]+\.(?:html|css)|art\/[\w-]+\.(?:webp|jpe?g)|art\/image-prompts\.json|fonts\/[\w-]+\.(?:woff2|txt)|data\/(?:CONTENT\.json|ASSET-MANIFEST\.json|gameplay-search-results\.json|gameplay-paper-model\.mjs))$/;
async function copyPlan(folder = "") {
  for (const entry of await readdir(join(source, folder), { withFileTypes: true })) {
    const name = join(folder, entry.name);
    if (entry.isDirectory() && ["docs", "art", "fonts", "data"].includes(name)) {
      await copyPlan(name);
    } else if (entry.isFile() && publicFile.test(name)) {
      await include(join(source, name), join(site, "plan", name));
    } else {
      throw new Error("Unexpected file in public review: " + name);
    }
  }
}
await copyPlan();
await writeFile(join(output, "config.json"), JSON.stringify({
  version: 3,
  routes: [
    { src: "/(.*)", headers: { "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin" }, continue: true },
    { src: "/plan/?$", dest: "/plan/index.html" },
    { src: "/outing/?$", dest: "/outing/index.html" },
    { src: "/motion/?$", dest: "/legacy/index.html" },
    { src: "/legacy/?$", dest: "/legacy/index.html" },
    { src: "/$", dest: "/index.html" },
    { handle: "filesystem" },
  ],
}, null, 2));
await include(join(root, ".vercel/project.json"), join(release, ".vercel/project.json"));
console.log("Review deployment directory:", release);
