import { expect,test } from "bun:test";
import { lstat,mkdir,mkdtemp,readFile,readlink,realpath,rename,rm,symlink,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname,join } from "node:path";
import { GAME_HTML,HTTP_PATHS,RUNTIME_METADATA,RUNTIME_WEBPS,baselineFunctionScope,copyRuntimeAssets,installFunctionAliases,overlayGameStatic,staticFiles,validateProject,validateRouting } from "./package-tidebound-review";

async function fixture() {
  const root=await mkdtemp(join(tmpdir(),"familiar-game-overlay-test-")),baseline=join(root,"baseline"),overlay=join(root,"overlay");
  for(const dir of ["outing","plan","legacy","privy-spike","assets"])await mkdir(join(baseline,dir),{recursive:true});
  await mkdir(join(overlay,"outing"),{recursive:true});await mkdir(join(overlay,"assets"));
  const content={"index.html":"old home","outing/index.html":"old game","plan/index.html":"preserved book","legacy/index.html":"preserved legacy","privy-spike/index.html":"preserved recovery","assets/shared-Abc12345.js":"preserved motion and art"};
  for(const [path,text] of Object.entries(content))await writeFile(join(baseline,path),text);
  await writeFile(join(overlay,"index.html"),"new home");await writeFile(join(overlay,"outing/index.html"),"new game");
  return {root,baseline,overlay,content};
}
test("H1 overlay changes only two approved HTML pages, retains recovery/book/legacy, and adds hashed assets",async()=>{
  const f=await fixture();await writeFile(join(f.overlay,"assets/new-Def67890.js"),"new game chunk");await writeFile(join(f.overlay,"assets/shared-Abc12345.js"),f.content["assets/shared-Abc12345.js"]);
  const report=await overlayGameStatic(f.overlay,f.baseline);
  expect(report.changes.map(change=>change.path)).toEqual([...GAME_HTML]);expect(report.added.map(file=>file.path)).toEqual(["assets/new-Def67890.js"]);
  expect(report.changes.every(change=>change.beforeSha256!==change.afterSha256 && /^[a-f0-9]{64}$/.test(change.afterSha256))).toBe(true);
  for(const [path,text] of Object.entries(f.content))if(!(GAME_HTML as readonly string[]).includes(path))expect(await readFile(join(f.baseline,path),"utf8")).toBe(text);
  expect(report.preserved).toHaveLength(4);
});
test("unexpected HTML, unhashed files, asset collisions and server configuration fail before any write",async()=>{
  for(const [path,content] of [["plan/index.html","changed book"],["privy-spike/index.html","changed recovery"],["legacy/index.html","changed legacy"],["assets/shared-Abc12345.js","changed existing chunk"],["assets/mutable.js","unhashed"],["src/server.ts","server source"],...["PRIVY_APP_SECRET","RELAYER_PRIVATE_KEY","ROOT_PRIVATE_KEY","NPC_ADMIN_PRIVATE_KEY","NPC_PRIVATE_KEY","NEAR_PRIVATE_KEY"].map(name=>["assets/new-Def67890.js",`process.env.${name}`])]) {
    const f=await fixture();await mkdir(join(f.overlay,path,".."),{recursive:true});await writeFile(join(f.overlay,path),content);
    await expect(overlayGameStatic(f.overlay,f.baseline)).rejects.toThrow();
    for(const [original,text] of Object.entries(f.content))expect(await readFile(join(f.baseline,original),"utf8")).toBe(text);
    expect(await staticFiles(f.baseline)).toHaveLength(6);
  }
});
test("missing baseline pages and symlinked static files cannot be packaged",async()=>{
  const f=await fixture();await symlink(join(f.baseline,"index.html"),join(f.overlay,"assets/link-Abc12345.js"));
  await expect(overlayGameStatic(f.overlay,f.baseline)).rejects.toThrow("symlinks");expect(await readFile(join(f.baseline,"index.html"),"utf8")).toBe("old home");
  const missing=await fixture(),empty=join(missing.root,"empty");await mkdir(empty);await expect(overlayGameStatic(missing.overlay,empty)).rejects.toThrow("Both baseline and overlay");
  const linked=join(missing.root,"linked-site");await symlink(missing.baseline,linked,"dir");await expect(overlayGameStatic(missing.overlay,linked)).rejects.toThrow("physical directory");
});
test("only the existing Familiar project and original-path function routing are accepted",()=>{
  const project={projectId:"prj_BfSIGWQo1vzXglQE2Hoh68ZWxriF",orgId:"team_fCwmTTXwBYiXVsmrpIWiIz1X"};
  expect(()=>validateProject(project)).not.toThrow();expect(()=>validateProject({...project,projectId:"another-project"})).toThrow();expect(()=>validateProject(null)).toThrow();
  const config={version:3,routes:[{src:"/(.*)",headers:{"x-content-type-options":"nosniff"},continue:true},{src:"/plan/?$",dest:"/plan/index.html"},{src:"/motion/?$",dest:"/legacy/index.html"},{handle:"filesystem"}]};
  const before=JSON.stringify(config);expect(()=>validateRouting(config)).not.toThrow();expect(JSON.stringify(config)).toBe(before);
  for(const path of HTTP_PATHS)expect(()=>validateRouting({...config,routes:[{src:path+"$",dest:"/wallet"},...config.routes]})).toThrow("original request URL");
  expect(()=>validateRouting({version:3,routes:[]})).toThrow("filesystem");
});
test("three fixed URLs share one physical handler using relative aliases without rewrites",async()=>{
  const output=await mkdtemp(join(tmpdir(),"familiar-game-function-test-")),primary=join(output,"functions/api/v1/privy/wallet.func");await mkdir(primary,{recursive:true});
  await writeFile(join(primary,"index.mjs"),"export default (req,res)=>res.end(req.url)");await writeFile(join(primary,".vc-config.json"),JSON.stringify({runtime:"nodejs24.x",handler:"index.mjs",shouldAddHelpers:false}));
  const aliases=await installFunctionAliases(output);
  expect(aliases).toEqual([{path:"api/health.func",target:"v1/privy/wallet.func"},{path:"api/v1/privy/player.func",target:"wallet.func"}]);
  for(const alias of aliases){const path=join(output,"functions",alias.path);expect((await lstat(path)).isSymbolicLink()).toBe(true);expect(await readlink(path)).not.toStartWith("/");expect(await realpath(path)).toBe(await realpath(primary));expect(await readFile(join(path,"index.mjs"),"utf8")).toBe(await readFile(join(primary,"index.mjs"),"utf8"));}
  const before=await Promise.all(aliases.map(alias=>lstat(join(output,"functions",alias.path)).then(stat=>stat.ino)));
  await writeFile(join(primary,"index.mjs"),"export default (req,res)=>res.end('patched '+req.url)");
  expect(await installFunctionAliases(output)).toEqual(aliases);
  expect(await Promise.all(aliases.map(alias=>lstat(join(output,"functions",alias.path)).then(stat=>stat.ino)))).toEqual(before);
  for(const alias of aliases)expect(await readFile(join(output,"functions",alias.path,"index.mjs"),"utf8")).toBe("export default (req,res)=>res.end('patched '+req.url)");
  const linked=await mkdtemp(join(tmpdir(),"familiar-game-linked-function-test-"));await symlink(join(output,"functions"),join(linked,"functions"),"dir");
  await expect(installFunctionAliases(linked)).rejects.toThrow("symlinked parents");
});
test("wrong, absolute, physical or unknown aliases are rejected before adding a missing known alias",async()=>{
  for(const kind of ["noncanonical-relative","absolute","physical","unknown","unknown-physical"]) {
    const output=await mkdtemp(join(tmpdir(),"familiar-game-bad-alias-test-")),primary=join(output,"functions/api/v1/privy/wallet.func"),player=join(output,"functions/api/v1/privy/player.func");await mkdir(primary,{recursive:true});await writeFile(join(primary,"index.mjs"),"original handler");
    if(kind==="physical")await mkdir(player);
    else if(kind==="absolute")await symlink(primary,player,"dir");
    else if(kind==="noncanonical-relative")await symlink("./wallet.func",player,"dir");
    else if(kind==="unknown-physical")await mkdir(join(output,"functions/api/unknown.func"));
    else await symlink("v1/privy/wallet.func",join(output,"functions/api/unknown.func"),"dir");
    await expect(installFunctionAliases(output)).rejects.toThrow(kind==="unknown"?"Unknown function alias":kind==="unknown-physical"||kind==="physical"?"Unknown physical function":"incorrect H1 alias");
    expect(await lstat(join(output,"functions/api/health.func")).then(()=>true,()=>false)).toBe(false);
    expect(await readFile(join(primary,"index.mjs"),"utf8")).toBe("original handler");
  }
});
test("scope distinguishes recovery rollout from H1 patch only with a hash-bound manifest and exact aliases",()=>{
  const sha256="a".repeat(64),aliases=[{path:"api/health.func",target:"v1/privy/wallet.func"},{path:"api/v1/privy/player.func",target:"wallet.func"}];
  const recovery={mode:"LOCAL_REVIEW_ONLY",gameIssuance:false,privateFunction:{path:"api/v1/privy/wallet",sha256}};
  const h1={mode:"LOCAL_H1_REVIEW_ONLY",privateFunction:{path:"api/v1/privy/wallet.func",sha256,aliases,endpoints:[{path:"/api/health",methods:["GET","OPTIONS"]},{path:"/api/v1/privy/wallet",methods:["POST","OPTIONS"]},{path:"/api/v1/privy/player",methods:["POST","OPTIONS"]}]}};
  expect(baselineFunctionScope(recovery,sha256,[])).toBe("recovery-only");expect(baselineFunctionScope(h1,sha256,aliases)).toBe("h1");
  expect(()=>baselineFunctionScope(h1,"b".repeat(64),aliases)).toThrow("actual private handler hash");
  expect(()=>baselineFunctionScope(recovery,sha256,aliases)).toThrow("recovery-only");
  expect(()=>baselineFunctionScope(h1,sha256,aliases.slice(0,1))).toThrow("scope or aliases");
  expect(()=>baselineFunctionScope({...h1,privateFunction:{...h1.privateFunction,endpoints:[]}},sha256,aliases)).toThrow("scope or aliases");
  expect(()=>baselineFunctionScope(null,sha256,[])).toThrow("scope is unverified");
});
test("an H1 patch retains both prior generations of hashed chunks for already-open tabs",async()=>{
  const f=await fixture(),older="assets/previous-Abcd1234.js",current="assets/current-Efgh5678.js";
  await writeFile(join(f.baseline,older),"older open-tab chunk");await writeFile(join(f.baseline,current),"currently published chunk");await writeFile(join(f.overlay,"assets/patched-Ijkl9012.js"),"new patched chunk");
  const report=await overlayGameStatic(f.overlay,f.baseline);
  expect(report.preserved.map(file=>file.path)).toContain(older);expect(report.preserved.map(file=>file.path)).toContain(current);
  expect(await readFile(join(f.baseline,older),"utf8")).toBe("older open-tab chunk");expect(await readFile(join(f.baseline,current),"utf8")).toBe("currently published chunk");
  expect(report.added.map(file=>file.path)).toEqual(["assets/patched-Ijkl9012.js"]);
});
async function runtimeFixture() {
  const f=await fixture(),source=join(f.root,"public");await mkdir(join(source,"assets/first-light-motion"),{recursive:true});
  for(const path of [...RUNTIME_WEBPS,...RUNTIME_METADATA]){await mkdir(dirname(join(source,path)),{recursive:true});await writeFile(join(source,path),path.endsWith(".json")?'{}':`committed bytes for ${path}`);}
  return {...f,source};
}
test("the redesigned court ships its actual environment sprites and generation provenance",()=>{
  for(const name of ["tide-court-v2","stone-island-v2","wooden-bridge-v2"])
    expect(RUNTIME_WEBPS).toContain(`assets/expedition-v2/${name}.webp`);
  expect(RUNTIME_METADATA).toContain("assets/expedition-v2/provenance.json");
});
test("missing runtime WebPs and the specific Wind Gate receipt are added with hashes, while old provenance stays intact",async()=>{
  const f=await runtimeFixture(),harbor=RUNTIME_WEBPS[0]!;
  await mkdir(join(f.baseline,"assets/first-light-motion"),{recursive:true});await writeFile(join(f.baseline,harbor),await readFile(join(f.source,harbor)));
  const provenance="assets/first-light-motion/provenance.json";await writeFile(join(f.baseline,provenance),'old public provenance');await writeFile(join(f.source,provenance),'different source provenance');
  await writeFile(join(f.source,"assets/first-light-motion/unapproved.png"),'unused source art');
  const report=await copyRuntimeAssets(f.source,f.baseline);
  expect(report.reused.map(file=>file.path)).toEqual([harbor]);expect(report.added).toHaveLength(RUNTIME_WEBPS.length+RUNTIME_METADATA.length-1);
  expect(report.added.some(file=>file.path==="assets/first-light-motion/wind-gate-v1.webp" && /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
  expect(report.added.some(file=>file.path===RUNTIME_METADATA[0])).toBe(true);
  for(const file of report.added)expect(await readFile(join(f.baseline,file.path))).toEqual(await readFile(join(f.source,file.path)));
  expect(await readFile(join(f.baseline,provenance),"utf8")).toBe('old public provenance');
  expect((await staticFiles(f.baseline)).some(path=>path.endsWith("unapproved.png"))).toBe(false);
});
test("a symlinked new-art directory cannot turn the publication allowlist into an arbitrary file read",async()=>{
  for(const relative of ["assets/expedition-v2","assets/expedition-v2/runtime"]){
  const f=await runtimeFixture(),directory=join(f.source,relative),outside=join(f.root,"outside-art");
  await rename(directory,outside);await symlink(outside,directory,"dir");
  const before=await staticFiles(f.baseline);
  await expect(copyRuntimeAssets(f.source,f.baseline)).rejects.toThrow("physical directories");
  expect(await staticFiles(f.baseline)).toEqual(before);
  }
});
test("a conflicting existing runtime image or receipt rejects all additions before writing",async()=>{
  for(const path of [RUNTIME_WEBPS[2]!,RUNTIME_METADATA[0]]) {
    const f=await runtimeFixture();await mkdir(join(f.baseline,"assets/first-light-motion"),{recursive:true});await writeFile(join(f.baseline,path),'preserved older bytes');
    const before=await staticFiles(f.baseline);await expect(copyRuntimeAssets(f.source,f.baseline)).rejects.toThrow("preserved runtime asset differs");
    expect(await staticFiles(f.baseline)).toEqual(before);expect(await readFile(join(f.baseline,path),"utf8")).toBe('preserved older bytes');
  }
});
test("missing or symlinked runtime sources fail without adding earlier valid images",async()=>{
  for(const kind of ["missing","symlink"]) {
    const f=await runtimeFixture(),path=RUNTIME_WEBPS[6]!;await rm(join(f.source,path));
    if(kind==="symlink")await symlink(join(f.source,RUNTIME_WEBPS[0]!),join(f.source,path));
    const before=await staticFiles(f.baseline);await expect(copyRuntimeAssets(f.source,f.baseline)).rejects.toThrow(kind==="missing"?"source asset is missing":"regular file");
    expect(await staticFiles(f.baseline)).toEqual(before);
  }
});
