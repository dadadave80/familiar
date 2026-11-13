import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve,join } from "node:path";

// Offline regeneration only; builds use the committed derivatives, never overwrite the source art.
const publicRoot=resolve(import.meta.dir,"../web/public"),target=join(publicRoot,"assets/expedition/runtime");
const images=[
 ["first-light-motion/harbor",0,0],["first-light-motion/mochi-poses",0,0],
 ["first-light-motion/tidekeeper",576,384],["first-light-motion/bram",384,439],
 ["first-light-motion/shell",256,256],["first-light-motion/lens",256,256],
 ["first-light-motion/moth",384,256],["first-light-motion/wave",768,256],
 ["expedition/tide-court",0,0],["expedition/stone-island",512,171],
 ["expedition/wooden-bridge",192,576],
] as const;
const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
await mkdir(target,{recursive:true});const files=[];
for(const [name,width,height]of images){
 const source=join(publicRoot,"assets",name+".webp"),output=join(target,name.split("/").at(-1)!+".webp"),before=await Bun.file(source).bytes();
 const process=Bun.spawnSync(["cwebp","-quiet","-q","85","-m","6","-alpha_q","100",...(width?["-resize",String(width),String(height)]:[]),source,"-o",output]);
 assert.equal(process.exitCode,0,`cwebp failed for ${name}: ${process.stderr.toString()}`);
 const after=await Bun.file(output).bytes();assert(after.length<before.length,`${name}: derivative must reduce transfer size`);assert.equal(hash(await Bun.file(source).bytes()),hash(before),"Original source stays byte-identical");
 files.push({source:"assets/"+name+".webp",output:"assets/expedition/runtime/"+name.split("/").at(-1)!+".webp",sourceSha256:hash(before),sha256:hash(after),sourceBytes:before.length,bytes:after.length,resizedTo:width?{width,height}:null});
}
const report={purpose:"Runtime encodings of existing artwork; original files preserved",encoder:"cwebp quality85 method6 alpha100",sourceBytes:files.reduce((n,f)=>n+f.sourceBytes,0),bytes:files.reduce((n,f)=>n+f.bytes,0),files};
await Bun.write(join(target,"manifest.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
