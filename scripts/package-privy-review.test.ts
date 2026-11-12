import { expect,test } from "bun:test";
import { mkdtemp,mkdir,writeFile,readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { overlayStatic } from "./package-privy-review";

test("recovery overlay preserves every existing byte and rejects conflicting static paths",async()=>{
  const folder=await mkdtemp(join(tmpdir(),"familiar-overlay-test-")),baseline=join(folder,"baseline"),overlay=join(folder,"overlay");
  await mkdir(baseline);await mkdir(join(overlay,"privy-spike"),{recursive:true});
  await writeFile(join(baseline,"index.html"),"existing game");await writeFile(join(overlay,"index.html"),"existing game");
  await writeFile(join(overlay,"privy-spike/index.html"),"recovery check");
  expect(await overlayStatic(overlay,baseline)).toEqual(["privy-spike/index.html"]);
  expect(await readFile(join(baseline,"index.html"),"utf8")).toBe("existing game");
  await writeFile(join(overlay,"index.html"),"replacement game");
  await expect(overlayStatic(overlay,baseline)).rejects.toThrow("overwrite");
  expect(await readFile(join(baseline,"index.html"),"utf8")).toBe("existing game");
});
