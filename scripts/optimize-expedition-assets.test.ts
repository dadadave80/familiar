import {expect,test} from "bun:test";
import {createHash} from "node:crypto";
import {resolve} from "node:path";

test("the shipped runtime art stays within transfer budget and preserves every source",async()=>{
 const root=resolve(import.meta.dir,"../web/public"),manifest=await Bun.file(`${root}/assets/expedition/runtime/manifest.json`).json();
 expect(manifest.files).toHaveLength(11);let originalBytes=0,runtimeBytes=0;
 for(const item of manifest.files){
  const source=await Bun.file(`${root}/${item.source}`).bytes(),runtime=await Bun.file(`${root}/${item.output}`).bytes();
  expect(createHash("sha256").update(source).digest("hex")).toBe(item.sourceSha256);expect(createHash("sha256").update(runtime).digest("hex")).toBe(item.sha256);
  expect(runtime.length).toBeLessThan(source.length);originalBytes+=source.length;runtimeBytes+=runtime.length;
 }
 expect(originalBytes).toBe(manifest.sourceBytes);expect(runtimeBytes).toBe(manifest.bytes);expect(runtimeBytes).toBeLessThan(1_200_000);
});
