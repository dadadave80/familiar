import { cp,lstat,mkdir,mkdtemp,readFile,readdir,readlink,realpath,rm,symlink,writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname,join,relative,resolve } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";

export const GAME_HTML=["index.html","outing/index.html"] as const;
export const HTTP_PATHS=["/api/health","/api/v1/privy/wallet","/api/v1/privy/player","/api/v1/privy/note"] as const;
// A reviewed baseline predates the sealed-note path; its declared scope is checked against these originals.
const BASELINE_HTTP_PATHS=HTTP_PATHS.slice(0,3);
export const RUNTIME_WEBPS=[
  ...["harbor","arena","wind-gate","mochi","mochi-poses","tidekeeper","lens","moth"].map(name=>`assets/first-light-motion/${name}.webp`),
  ...["harbor","mochi-poses","tidekeeper","shell","lens","moth","wave","bram","tide-court","stone-island","wooden-bridge"].map(name=>`assets/expedition/runtime/${name}.webp`),
];
export const RUNTIME_METADATA=["assets/first-light-motion/provenance.json","assets/first-light-motion/wind-gate.webp.json","assets/expedition/provenance.json","assets/expedition/runtime/manifest.json"] as const;
export const BRAND_ASSETS=["icons/mochi.ico",...[32,180,192,512].map(size=>`icons/mochi-${size}.png`),"social/familiar-harbor.jpg","familiar.webmanifest"];
const primaryFunction="api/v1/privy/wallet.func";
const aliases=["api/health.func","api/v1/privy/player.func","api/v1/privy/note.func"] as const;
const baselineAliases=aliases.slice(0,2);
const endpointsFor=(paths:readonly string[])=>[{path:paths[0],methods:["GET","OPTIONS"]},...paths.slice(1).map(path=>({path,methods:["POST","OPTIONS"]}))];
const endpoints=endpointsFor(HTTP_PATHS),baselineEndpoints=endpointsFor(BASELINE_HTTP_PATHS);
const gameRoot="familiar-game.testnet",origin="https://familiar-two.vercel.app";
const digest=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
const hash=async(path:string)=>digest(await readFile(path));
function check(value:unknown,message:string):asserts value {if(!value)throw Error(message);}
async function physicalDirectory(path:string) {const stat=await lstat(path);check(stat.isDirectory() && !stat.isSymbolicLink(),"Review output must use physical directories, without symlinked parents.");}
async function functionDirectories(output:string) {for(const path of [output,...["functions","functions/api","functions/api/v1","functions/api/v1/privy",`functions/${primaryFunction}`].map(path=>join(output,path))])await physicalDirectory(path);}
export async function staticFiles(folder:string,prefix=""):Promise<string[]> {
  if(!prefix){const stat=await lstat(folder);check(stat.isDirectory() && !stat.isSymbolicLink(),"Static review assets must be a physical directory, without symlinks.");}
  const entries=await readdir(join(folder,prefix),{withFileTypes:true});
  return (await Promise.all(entries.map(entry=>{
    check(!entry.isSymbolicLink(),"Static review assets must not contain symlinks.");
    const path=join(prefix,entry.name);return entry.isDirectory()?staticFiles(folder,path):[path];
  }))).flat().sort();
}
export function validateProject(project:unknown) {
  check(project && typeof project==="object" && "projectId" in project && project.projectId==="prj_BfSIGWQo1vzXglQE2Hoh68ZWxriF" && "orgId" in project && project.orgId==="team_fCwmTTXwBYiXVsmrpIWiIz1X","The baseline is not the existing Familiar Vercel project.");
}
export function validateRouting(config:unknown) {
  check(config && typeof config==="object" && "version" in config && config.version===3 && "routes" in config && Array.isArray(config.routes),"The existing release routing is missing.");
  check(config.routes.some(route=>route?.handle==="filesystem"),"The existing release filesystem route is missing.");
  for(const route of config.routes)if(route?.dest && typeof route.src==="string")
    check(!HTTP_PATHS.some(path=>new RegExp(route.src).test(path)),"A baseline rewrite would change an H1 function's original request URL.");
}
function publicBytes(bytes:Uint8Array,path:string) {
  check(!/NEAR_AI_API_KEY|PRIVY_APP_SECRET|VITE_PRIVY_APP_SECRET|RELAYER_PRIVATE_KEY|ROOT_PRIVATE_KEY|NPC_ADMIN_PRIVATE_KEY|NPC_PRIVATE_KEY|NEAR_PRIVATE_KEY|-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{64,}-----END/.test(new TextDecoder().decode(bytes)),`Server configuration or private key material appears in the static overlay: ${path}`);
}
/** Add only approved art and branding that the baseline lacks; never replace its assets. */
export async function copyRuntimeAssets(sourcePublic:string,destination:string) {
  await physicalDirectory(sourcePublic);await physicalDirectory(join(sourcePublic,"assets"));
  for(const directory of ["first-light-motion","expedition","expedition/runtime"])await physicalDirectory(join(sourcePublic,"assets",directory));
  for(const directory of ["icons","social"])await physicalDirectory(join(sourcePublic,directory));
  await staticFiles(destination);
  const added:{path:string;sha256:string}[]=[],reused:{path:string;sha256:string}[]=[],writes:{path:string;bytes:Uint8Array}[]=[];
  for(const path of [...RUNTIME_WEBPS,...RUNTIME_METADATA,...BRAND_ASSETS]) {
    const source=join(sourcePublic,path),stat=await lstat(source).catch(error=>{if(error.code==="ENOENT")throw Error(`A required runtime source asset is missing: ${path}`);throw error;});
    check(stat.isFile() && !stat.isSymbolicLink(),`A runtime source asset must be a regular file: ${path}`);
    const bytes=await readFile(source);if(/\.(?:json|webmanifest)$/.test(path))publicBytes(bytes,path);
    const previous=await readFile(join(destination,path)).catch(error=>{if(error.code==="ENOENT")return null;throw error;});
    check(!previous || previous.equals(bytes),`A preserved runtime asset differs from source: ${path}`);
    const entry={path,sha256:digest(bytes)};
    if(previous)reused.push(entry);else {added.push(entry);writes.push({path,bytes});}
  }
  // Validate every input and collision before making any addition.
  for(const write of writes){await mkdir(dirname(join(destination,write.path)),{recursive:true});await writeFile(join(destination,write.path),write.bytes);}
  return {added,reused};
}
/** Start from an empty site so retired pages and bundles never return from an old baseline. */
export async function copyGameStatic(source:string,destination:string) {
  const paths=await staticFiles(source);
  check((await staticFiles(destination)).length===0,"Current static output must be empty.");
  for(const path of GAME_HTML)check(paths.includes(path),`The current build must contain ${path}.`);
  const writes=await Promise.all(paths.map(async path=>{
    check((GAME_HTML as readonly string[]).includes(path)||/^assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|jpe?g|svg|webp|avif)$/.test(path),`Current build path is not approved: ${path}`);
    const bytes=await readFile(join(source,path));if(/\.(?:html|js|css)$/.test(path))publicBytes(bytes,path);
    return {path,bytes};
  }));
  for(const file of writes){await mkdir(dirname(join(destination,file.path)),{recursive:true});await writeFile(join(destination,file.path),file.bytes);}
  return writes.map(file=>({path:file.path,sha256:digest(file.bytes)}));
}
// Original API URLs reach their physical functions; retired interfaces redirect without rewrites.
export function currentRouting(config?:unknown) {
  if(config!==undefined)validateRouting(config);
  return {version:3,routes:[
    {src:"/(.*)",headers:{"X-Content-Type-Options":"nosniff","Referrer-Policy":"strict-origin-when-cross-origin"},continue:true},
    {src:"^/(?:legacy|motion|privy-spike)(?:/.*)?$",status:308,headers:{Location:"/outing/"}},
    {src:"^/plan(?:/.*)?$",status:308,headers:{Location:"/"}},
    {src:"^/(?:outing|expedition)/?$",dest:"/outing/index.html"},
    {src:"^/$",dest:"/index.html"},
    {handle:"filesystem"},
  ]};
}
async function existingFunctionAliases(output:string) {
  await functionDirectories(output);
  const functions=join(output,"functions"),primary=join(functions,primaryFunction),existing:{path:string;target:string}[]=[];
  async function rejectUnknown(directory:string,prefix="") {
    for(const entry of await readdir(directory,{withFileTypes:true})) {
      const path=join(prefix,entry.name);
      if(entry.isSymbolicLink())check((aliases as readonly string[]).includes(path),`Unknown function alias in baseline: ${path}`);
      else if(entry.isDirectory()) {
        if(entry.name.endsWith(".func"))check(path===primaryFunction,`Unknown physical function in baseline: ${path}`);
        else await rejectUnknown(join(directory,entry.name),path);
      }
    }
  }
  await rejectUnknown(functions);
  for(const path of aliases) {
    const file=join(functions,path),stat=await lstat(file).catch(error=>{if(error.code==="ENOENT")return null;throw error;});
    if(!stat)continue;
    const expected=relative(dirname(file),primary);
    check(stat.isSymbolicLink() && await readlink(file)===expected,`The baseline contains an incorrect H1 alias: ${path}`);
    check(await realpath(file)===await realpath(primary),`The baseline H1 alias escaped its physical handler: ${path}`);
    existing.push({path,target:expected});
  }
  return existing;
}
/** Vercel supports .func symlinks. Preserve exact known aliases and the original request URL. */
export async function installFunctionAliases(output:string) {
  const existing=await existingFunctionAliases(output),functions=join(output,"functions"),primary=join(functions,primaryFunction);
  for(const path of aliases)if(!existing.some(alias=>alias.path===path)){const target=join(functions,path);await mkdir(dirname(target),{recursive:true});await symlink(relative(dirname(target),primary),target,"dir");check(await realpath(target)===await realpath(primary),"An H1 alias escaped its physical handler.");}
  return Promise.all(aliases.map(async path=>({path,target:await readlink(join(functions,path))})));
}

export async function buildAccountFunction(source:string,output:string){
  const fn=join(output,"functions",primaryFunction);
  await mkdir(fn,{recursive:true});
  const result=await Bun.build({entrypoints:[join(source,"services/relayer/src/tidebound-http.ts")],outdir:fn,naming:"index.mjs",target:"node",format:"esm",minify:true,env:"disable"});
  check(result.success,"The private H1 HTTP function did not bundle.");
  await writeFile(join(fn,".vc-config.json"),JSON.stringify({runtime:"nodejs24.x",handler:"index.mjs",launcherType:"Nodejs",maxDuration:60,shouldAddHelpers:false}));
  return installFunctionAliases(output);
}

export async function buildGameSite(source:string,site:string,appId:string,clientId:string,sealedNote=false){
  const overlay=await mkdtemp(join(tmpdir(),"familiar-game-static-"));
  try{
    await build({configFile:false,plugins:[react()],root:join(source,"web"),envDir:false,envPrefix:[],publicDir:false,define:{
      "import.meta.env.VITE_PRIVY_APP_ID":JSON.stringify(appId),"import.meta.env.VITE_PRIVY_CLIENT_ID":JSON.stringify(clientId),
      "import.meta.env.VITE_ACCOUNT_PROVIDER":JSON.stringify("privy"),"import.meta.env.VITE_NEAR_ROOT":JSON.stringify(gameRoot),
      "import.meta.env.VITE_NEAR_RPC_URL":JSON.stringify("https://test.rpc.fastnear.com"),"import.meta.env.VITE_RELAYER_URL":JSON.stringify("/api"),
      "import.meta.env.VITE_TIDEBOUND_ENABLED":JSON.stringify(appId?"true":"false"),
      "import.meta.env.VITE_SEALED_NOTE_ENABLED":JSON.stringify(appId&&sealedNote?"true":"false"),
    },build:{outDir:overlay,rollupOptions:{input:{home:join(source,"web/index.html"),outing:join(source,"web/outing/index.html")},output:{manualChunks:id=>id.includes("/phaser/")?"phaser":undefined}}}});
    const staticReport=await copyGameStatic(overlay,site);
    const runtimeAssets=await copyRuntimeAssets(join(source,"web/public"),site);
    const licenses=join(source,"web/public/licenses");await physicalDirectory(licenses);
    for(const name of await staticFiles(licenses)){
      check(/^[a-z-]+\.txt$/.test(name),"Unexpected license path.");
      await mkdir(join(site,"licenses"),{recursive:true});await cp(join(licenses,name),join(site,"licenses",name));
    }
    return {staticReport,runtimeAssets};
  }finally{await rm(overlay,{recursive:true,force:true});}
}
/** Scope is declared by the prior review manifest, then bound to its actual handler hash and aliases. */
export function baselineFunctionScope(manifest:unknown,actualHash:string,actualAliases:{path:string;target:string}[]):"recovery-only"|"h1" {
  check(manifest && typeof manifest==="object" && "privateFunction" in manifest && manifest.privateFunction && typeof manifest.privateFunction==="object","The baseline's private function scope is unverified.");
  const fn=manifest.privateFunction;
  check("sha256" in fn && /^[a-f0-9]{64}$/.test(actualHash) && fn.sha256===actualHash,"The baseline manifest does not match the actual private handler hash.");
  if("mode" in manifest && manifest.mode==="LOCAL_H1_REVIEW_ONLY") {
    const expected=[{path:baselineAliases[0],target:"v1/privy/wallet.func"},{path:baselineAliases[1],target:"wallet.func"}];
    const declaredAliases="aliases" in fn?fn.aliases:null;
    check("path" in fn && fn.path===primaryFunction && "endpoints" in fn && JSON.stringify(fn.endpoints)===JSON.stringify(baselineEndpoints) &&
      Array.isArray(declaredAliases) && declaredAliases.length===expected.length && expected.every(alias=>declaredAliases.some((item:unknown)=>!!item&&typeof item==="object"&&"path" in item&&"target" in item&&item.path===alias.path&&item.target===alias.target)) &&
      JSON.stringify(actualAliases)===JSON.stringify(expected),"The baseline H1 function scope or aliases are unverified.");
    return "h1";
  }
  check("mode" in manifest && manifest.mode==="LOCAL_REVIEW_ONLY" && "gameIssuance" in manifest && manifest.gameIssuance===false && "path" in fn && fn.path==="api/v1/privy/wallet" && actualAliases.length===0,"The baseline is not a verified recovery-only function.");
  return "recovery-only";
}

async function main() {
  const argument=process.argv[2],appId=process.env.VITE_PRIVY_APP_ID??"",clientId=process.env.VITE_PRIVY_CLIENT_ID??"";
  check(argument && /^[A-Za-z0-9_-]{1,128}$/.test(appId) && (!clientId || /^[A-Za-z0-9_-]{1,128}$/.test(clientId)),"Pass the existing rendered release directory and only public VITE_PRIVY_APP_ID / optional VITE_PRIVY_CLIENT_ID build configuration.");
  const baseline=resolve(argument),project=JSON.parse(await readFile(join(baseline,".vercel/project.json"),"utf8"));validateProject(project);
  const configBytes=await readFile(join(baseline,".vercel/output/config.json"));validateRouting(JSON.parse(configBytes.toString()));
  const source=resolve(import.meta.dir,".."),release=await mkdtemp(join(tmpdir(),"familiar-tidebound-review-")),output=join(release,".vercel/output"),site=join(output,"static");
  await cp(join(baseline,".vercel/output"),output,{recursive:true,verbatimSymlinks:true});
  await physicalDirectory(output);
  await writeFile(join(release,".vercel/project.json"),JSON.stringify(project));
  const fn=join(output,"functions",primaryFunction);await functionDirectories(output);await staticFiles(fn);
  const oldFunctionSha256=await hash(join(fn,"index.mjs")),oldAliases=await existingFunctionAliases(output);
  const scopeBefore=baselineFunctionScope(JSON.parse(await readFile(join(baseline,"review-manifest.json"),"utf8")),oldFunctionSha256,oldAliases);
  const baselineStatic=await Promise.all((await staticFiles(site)).map(async path=>({path,sha256:await hash(join(site,path))})));
  await rm(site,{recursive:true});await mkdir(site);
  const {staticReport,runtimeAssets}=await buildGameSite(source,site,appId,clientId);
  const routing=currentRouting(JSON.parse(configBytes.toString()));
  await writeFile(join(output,"config.json"),JSON.stringify(routing,null,2)+"\n");
  await rm(fn,{recursive:true,force:true});
  const functionAliases=await buildAccountFunction(source,output);
  const currentStatic=await Promise.all((await staticFiles(site)).map(async path=>({path,sha256:await hash(join(site,path))})));
  const preserved=baselineStatic.filter(file=>currentStatic.some(current=>current.path===file.path&&current.sha256===file.sha256));
  const removed=baselineStatic.filter(file=>!currentStatic.some(current=>current.path===file.path));
  const manifest={mode:"LOCAL_H1_REVIEW_ONLY",edition:"familiar",origin,baseline,release,network:"testnet",plannedRoot:gameRoot,
    static:{baselineCount:baselineStatic.length,currentCount:currentStatic.length,preservedCount:preserved.length,currentFiles:currentStatic,removedFiles:removed,runtimeAssets:{allowedWebps:RUNTIME_WEBPS,allowedMetadata:RUNTIME_METADATA,allowedBranding:BRAND_ASSETS,...runtimeAssets},preservedFiles:preserved,compiledFiles:staticReport},
    routing:{baselineConfigSha256:digest(configBytes),currentConfigSha256:await hash(join(output,"config.json")),changed:true,retiredPagesRedirected:true,originalFunctionRequestUrlPreserved:true},
    publicBuild:{provider:"privy",tideboundUiEnabled:true,root:gameRoot,relayerUrl:"/api",appIdSha256:digest(new TextEncoder().encode(appId)),environmentFilesLoaded:false},
    privateFunction:{path:primaryFunction,scopeBefore,scopeAfter:"h1",scopeChangedFromRecoveryOnly:scopeBefore==="recovery-only",beforeSha256:oldFunctionSha256,sha256:await hash(join(fn,"index.mjs")),bytes:await Bun.file(join(fn,"index.mjs")).size,runtime:"nodejs24.x",shouldAddHelpers:false,aliases:functionAliases,endpoints,enabledByDefault:false},
    requiredRuntimeEnvironmentNames:["TIDEBOUND_HTTP_ENABLED","ACCOUNT_PROVIDER","NEAR_NETWORK","NEAR_ROOT","RELAYER_ID","RELAYER_PRIVATE_KEY","PRIVY_APP_ID","PRIVY_APP_SECRET"],optionalRuntimeEnvironmentNames:["NEAR_AI_API_KEY"],
    requiredNonSecretRuntimeValues:{TIDEBOUND_HTTP_ENABLED:"true",ACCOUNT_PROVIDER:"privy",NEAR_NETWORK:"testnet",NEAR_ROOT:gameRoot,RELAYER_ID:`relayer.${gameRoot}`},
    limits:{compatibleContractsVerified:false,liveGameActionsTested:false,hostingAliasUrlBehaviorVerified:false,privateRuntimeConfigured:false},uploaded:false,deployed:false};
  await writeFile(join(release,"review-manifest.json"),JSON.stringify(manifest,null,2)+"\n");console.info(JSON.stringify(manifest,null,2));
}
if(import.meta.main)await main();
