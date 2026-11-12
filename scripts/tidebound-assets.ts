import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir,"..");
const art = "web/public/assets/first-light-motion/";
const provenancePath = art + "provenance.json";
const provenance = JSON.parse(await readFile(resolve(root,provenancePath),"utf8"));
const definitions = [
  ["harbor", "Arrival and home background; porch/dock placements", "full-stage cover"],
  ["bram", "Bram at home", "26% x / 83% ground, 22% stage width"],
  ["mochi-poses-v1", "Mochi in both outings, home and origin diorama", "16 cells; 4×4; 256px cell; ground 224px; pivot x128px"],
  ["arena", "Beacon Court and static Storycraft origin background", "full-stage cover"],
  ["tidekeeper", "Tidekeeper forecast/impact actor; static origin composition", "50% x / 51% ground; 42% stage width"],
  ["shell", "Two Beacon shell halves and their opened state", "18% or 83% x / 43% y; hinge at bottom"],
  ["wave", "Accepted Surge consequence in either outing", "lane exit x20/50/79%; renderer owns movement"],
  ["lens", "Exposed Beacon Lens, reused lantern glass and Crest origin", "Beacon x18% / ground47%; lantern uses contained image"],
  ["moth", "Optional wind-moth rescue, home moth, Moth origin", "wild x82% / ground46%; home x66% / ground66%"],
  ["wind-gate-v1", "Existing optional Wind Gate background after beacon restoration", "full-stage cover; routing and sockets are DOM layers"],
] as const;

const assets = await Promise.all(definitions.map(async ([id,usage,anchor]) => {
  const path = `${art}${id}.webp`;
  const bytes = await readFile(resolve(root,path));
  const measurement = Bun.spawnSync(["magick","identify","-format","%w|%h|%[channels]",resolve(root,path)],{stdout:"pipe",stderr:"pipe"});
  assert.equal(measurement.exitCode,0,`ImageMagick identifies ${path}: ${measurement.stderr}`);
  const [width,height,channels] = measurement.stdout.toString().split("|");
  assert(Number(width)>0 && Number(height)>0 && channels,"valid dimensions and channel evidence");
  const source = provenance.files[`${id}.webp`] ?? provenance.files[`${id}.png`];
  assert.equal(typeof source,"string",`${id} has an existing provenance record`);
  return {
    id,path,publicPath:`/assets/first-light-motion/${id}.webp`,
    width:Number(width),height:Number(height),alpha:/a/.test(channels!),channels:channels!.trim(),
    bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),usage,anchor,
    frames:id === "mochi-poses-v1" ? {columns:4,rows:4,count:16,cellPixels:256} : {count:1},
    creator:provenance.source,
    provenance:{path:provenancePath,entry:`files/${id === "wind-gate-v1" || id === "mochi-poses-v1" ? id+".webp" : id+".png"}`,record:source},
    rights:{status:"unresolved",license:null,evidence:"Project provenance records generated or reused user-approved reference art. Separate reference-art rights and distribution terms are not independently documented in this inventory; do not infer an art license from the code license."},
  };
}));

const codeLayers = await Promise.all([
  ["web/src/outing/Outing.tsx",["custom outing compass, workshop lantern, account home and menu SVG icons","accessible navigation and contextual game HUD"]],
  ["web/src/outing/outing.css",["full-bleed coastal environment using existing raster art","wood and brass navigation","parchment objective/action surfaces","responsive registered playfield and safe-area HUD"]],
  ["web/src/tidebound/Storycraft.tsx",["lantern body using existing lens.webp","Crest wave engraving","Moth wing aperture","static origin composition from recorded motif"]],
  ["web/src/tidebound/storycraft.css",["lantern brass frame","harbor_polish enamel/glow appearance","porch anchor at x60% / ground77%","dock anchor at x82% / ground88% and reflected light","origin atlas crop"]],
].map(async ([path,layers]) => {
  const bytes = await readFile(resolve(root,path as string));
  return {path,layers,bytes:bytes.length,sha256:createHash("sha256").update(bytes).digest("hex"),kind:"DOM/CSS/inline SVG source",dimensions:"responsive renderer geometry",alpha:"DOM compositing; no additional raster",creator:"Project-authored game and Storycraft UI",rights:{status:"repository-code-license",license:"MIT",source:"LICENSE"},payloadNote:"Bundled source; byte count is source size, not a separately transferred runtime asset."};
}));
const byId = new Map(assets.map(asset=>[asset.id,asset]));
function payload(ids:readonly string[]) {
  const unique = [...new Set(ids)];
  return {ids:unique,bytes:unique.reduce((sum,id)=>{const entry=byId.get(id as typeof assets[number]["id"]);assert(entry,`known asset ${id}`);return sum+entry.bytes;},0)};
}
const arrival = ["harbor","bram","mochi-poses-v1"];
const beacon = ["arena","tidekeeper","shell","mochi-poses-v1"];
const fullBeacon = [...arrival,...beacon,"wave","lens","moth"];
const report = {
  schemaVersion:1,
  scope:"Raster files actually referenced by current outings/Storycraft and source-authored game/Storycraft UI layers; unused PNG masters and motion-study-only actors are excluded.",
  measurement:"On-disk encoded WebP bytes, SHA-256 and ImageMagick identify dimensions/channels. These are asset payloads, excluding JS/CSS/fonts, HTTP overhead and cache behavior; not measured physical-device startup.",
  assets,codeLayers,
  payloads:{arrival:payload(arrival),beaconPlayfield:payload(beacon),completeBeaconHomecomingWithOptionalMoth:payload(fullBeacon),windGateAdditionalBackground:payload(["wind-gate-v1"]),allUsedRasterAssets:payload(assets.map(a=>a.id)),newStorycraftRasterBytes:0},
  optionalReuse:"Origin diorama reuses arena/Tidekeeper/Mochi plus lens or moth. Storycraft origin images mount on the origin step. Reused lens imagery may already be loaded by the workbench; optional presentation is not claimed as a measured lazy-loading gain. Existing Wind Gate adds one background; Storycraft adds no new raster files; reused assets may still download in a fresh session.",
  availability:"Ordinary self-hosted assets in web/public, not permanent storage. Source hashes support integrity/export; on-chain item ownership alone does not guarantee art hosting or cross-game behavior.",
};
assert.equal(byId.size,10,"each used raster file appears once");
assert([...assets,...codeLayers].every(a=>a.bytes>0 && /^[0-9a-f]{64}$/.test(a.sha256)),"all asset measurements have bytes and SHA-256");
assert.deepEqual([byId.get("mochi-poses-v1")!.width,byId.get("mochi-poses-v1")!.height],[1024,1024],"registered atlas dimensions agree with sixteen 256px cells");
assert.equal(report.payloads.allUsedRasterAssets.bytes,assets.reduce((sum,a)=>sum+a.bytes,0),"payload sums do not double count reused art");
await writeFile(resolve(root,"docs/TIDEBOUND-ASSETS.json"),JSON.stringify(report,null,2)+"\n");
console.log(JSON.stringify({assets:assets.length,payloads:report.payloads,selfChecks:"passed",output:"docs/TIDEBOUND-ASSETS.json"},null,2));
