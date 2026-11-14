import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Offline regeneration of the Season 2 icons; masters in web/assets/source/season stay byte-identical.
// The cream backdrop is flood-filled to transparency from the corners, then encoded like the expedition art.
const webRoot=resolve(import.meta.dir,"../web"),target=join(webRoot,"public/assets/season"),work=await mkdtemp(join(tmpdir(),"season-art-"));
const images=[["glass",192],["reed",192],["shelf-till",320],["purse",192],["wish-token",192]] as const;
const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
await mkdir(target,{recursive:true});const files=[];
for(const [name,size] of images){
 const master=join(webRoot,"assets/source/season",name+".png"),cut=join(work,name+".png"),output=join(target,name+".webp"),before=await Bun.file(master).bytes();
 const corners=["0,0","1023,0","0,1023","1023,1023"].flatMap(p=>["-draw",`alpha ${p.replace(","," ")} floodfill`]);
 const magick=Bun.spawnSync(["magick",master,"-alpha","set","-fuzz","7%","-fill","none",...corners,"-resize",`${size}x${size}`,cut]);
 assert.equal(magick.exitCode,0,`magick failed for ${name}: ${magick.stderr.toString()}`);
 const encode=Bun.spawnSync(["cwebp","-quiet","-q","85","-m","6","-alpha_q","100",cut,"-o",output]);
 assert.equal(encode.exitCode,0,`cwebp failed for ${name}: ${encode.stderr.toString()}`);
 const after=await Bun.file(output).bytes();assert.equal(hash(await Bun.file(master).bytes()),hash(before),"Master stays byte-identical");
 files.push({source:`assets/source/season/${name}.png`,output:`assets/season/${name}.webp`,sourceSha256:hash(before),sha256:hash(after),sourceBytes:before.length,bytes:after.length,resizedTo:{width:size,height:size}});
}
const report={purpose:"Season 2 runtime icons; cream backdrop removed by corner flood fill (fuzz 7%)",encoder:"magick + cwebp quality85 method6 alpha100",files};
await Bun.write(join(target,"manifest.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));
