import { cp,lstat,mkdir,mkdtemp,readFile,readdir,readlink,realpath,rm,symlink,writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname,join,relative,resolve } from "node:path";
import { build } from "vite";
import react from "@vitejs/plugin-react";

export const GAME_HTML=["index.html","outing/index.html"] as const;
export const HTTP_PATHS=["/api/health","/api/v1/privy/wallet","/api/v1/privy/player"] as const;
export const RUNTIME_WEBPS=["harbor","arena","wind-gate-v1","bram","mochi","mochi-poses-v1","tidekeeper","wave","shell","lens","moth"].map(name=>`assets/first-light-motion/${name}.webp`);
export const RUNTIME_METADATA=["assets/first-light-motion/wind-gate-v1.webp.json"] as const;
const primaryFunction="api/v1/privy/wallet.func";
const aliases=["api/health.func","api/v1/privy/player.func"] as const;
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
  check(!/PRIVY_APP_SECRET|VITE_PRIVY_APP_SECRET|RELAYER_PRIVATE_KEY|ROOT_PRIVATE_KEY|NPC_ADMIN_PRIVATE_KEY|NPC_PRIVATE_KEY|NEAR_PRIVATE_KEY|-----BEGIN (?:EC |RSA |OPENSSH )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{64,}-----END/.test(new TextDecoder().decode(bytes)),`Server configuration or private key material appears in the static overlay: ${path}`);
}
export interface StaticChange {path:string;beforeSha256:string;afterSha256:string}
/** Add only committed runtime art that the older baseline lacks; never replace its art or provenance. */
export async function copyRuntimeAssets(sourcePublic:string,destination:string) {
  await physicalDirectory(sourcePublic);await physicalDirectory(join(sourcePublic,"assets"));await physicalDirectory(join(sourcePublic,"assets/first-light-motion"));
  await staticFiles(destination);
  const added:{path:string;sha256:string}[]=[],reused:{path:string;sha256:string}[]=[],writes:{path:string;bytes:Uint8Array}[]=[];
  for(const path of [...RUNTIME_WEBPS,...RUNTIME_METADATA]) {
    const source=join(sourcePublic,path),stat=await lstat(source).catch(error=>{if(error.code==="ENOENT")throw Error(`A required runtime source asset is missing: ${path}`);throw error;});
    check(stat.isFile() && !stat.isSymbolicLink(),`A runtime source asset must be a regular file: ${path}`);
    const bytes=await readFile(source);if(path.endsWith(".json"))publicBytes(bytes,path);
    const previous=await readFile(join(destination,path)).catch(error=>{if(error.code==="ENOENT")return null;throw error;});
    check(!previous || previous.equals(bytes),`A preserved runtime asset differs from source: ${path}`);
    const entry={path,sha256:digest(bytes)};
    if(previous)reused.push(entry);else {added.push(entry);writes.push({path,bytes});}
  }
  // Validate every input and collision before making any addition.
  for(const write of writes){await mkdir(dirname(join(destination,write.path)),{recursive:true});await writeFile(join(destination,write.path),write.bytes);}
  return {added,reused};
}
/** Validate the complete overlay before copying; only the two named HTML pages may change. */
export async function overlayGameStatic(source:string,destination:string) {
  const originalPaths=await staticFiles(destination),originals=await Promise.all(originalPaths.map(async path=>({path,sha256:await hash(join(destination,path))})));
  const paths=await staticFiles(source),changes:StaticChange[]=[],added:{path:string;sha256:string}[]=[],writes:{path:string;bytes:Uint8Array}[]=[];
  for(const path of GAME_HTML)check(paths.includes(path) && originalPaths.includes(path),`Both baseline and overlay must contain ${path}.`);
  for(const path of paths) {
    const html=(GAME_HTML as readonly string[]).includes(path);
    check(html || /^assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|png|jpe?g|svg|webp|avif)$/.test(path),`H1 overlay path is not approved: ${path}`);
    const bytes=await readFile(join(source,path));if(/\.(?:html|js|css)$/.test(path))publicBytes(bytes,path);
    const previous=await readFile(join(destination,path)).catch(error=>{if(error.code==="ENOENT")return null;throw error;});
    if(previous?.equals(bytes))continue;
    check(!previous || html,`H1 overlay would overwrite a preserved asset: ${path}`);
    if(previous)changes.push({path,beforeSha256:digest(previous),afterSha256:digest(bytes)});else added.push({path,sha256:digest(bytes)});
    writes.push({path,bytes});
  }
  for(const write of writes){await mkdir(dirname(join(destination,write.path)),{recursive:true});await writeFile(join(destination,write.path),write.bytes);}
  const preserved=originals.filter(file=>!(GAME_HTML as readonly string[]).includes(file.path));
  for(const file of preserved)check(await hash(join(destination,file.path))===file.sha256,`A preserved baseline file changed: ${file.path}`);
  return {originals,preserved,changes,added};
}
/** Vercel supports .func symlinks. No route rewrite or wrapper strips the original URL. */
export async function installFunctionAliases(output:string) {
  await functionDirectories(output);
  const functions=join(output,"functions"),primary=join(functions,primaryFunction),stat=await lstat(primary);
  check(stat.isDirectory() && !stat.isSymbolicLink(),"The H1 handler must be one physical function directory.");
  for(const path of aliases) {
    const exists=await lstat(join(functions,path)).then(()=>true,error=>{if(error.code==="ENOENT")return false;throw error;});
    check(!exists,`The baseline already contains an unexpected H1 alias: ${path}`);
  }
  for(const path of aliases){const target=join(functions,path);await mkdir(dirname(target),{recursive:true});await symlink(relative(dirname(target),primary),target,"dir");check(await realpath(target)===await realpath(primary),"An H1 alias escaped its physical handler.");}
  return Promise.all(aliases.map(async path=>({path,target:await readlink(join(functions,path))})));
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
  const baselineStatic=await Promise.all((await staticFiles(site)).map(async path=>({path,sha256:await hash(join(site,path))})));
  // publicDir stays disabled. Copy only missing approved runtime art, preserving every existing byte.
  const runtimeAssets=await copyRuntimeAssets(join(source,"web/public"),site);
  const overlay=await mkdtemp(join(tmpdir(),"familiar-tidebound-static-"));
  await build({configFile:false,plugins:[react()],root:join(source,"web"),envDir:false,envPrefix:[],publicDir:false,define:{
    "import.meta.env.VITE_PRIVY_APP_ID":JSON.stringify(appId),"import.meta.env.VITE_PRIVY_CLIENT_ID":JSON.stringify(clientId),
    "import.meta.env.VITE_ACCOUNT_PROVIDER":JSON.stringify("privy"),"import.meta.env.VITE_NEAR_ROOT":JSON.stringify(gameRoot),
    "import.meta.env.VITE_NEAR_RPC_URL":JSON.stringify("https://test.rpc.fastnear.com"),"import.meta.env.VITE_RELAYER_URL":JSON.stringify("/api"),
    "import.meta.env.VITE_TIDEBOUND_ENABLED":JSON.stringify("true"),
  },build:{outDir:overlay,rollupOptions:{input:{home:join(source,"web/index.html"),outing:join(source,"web/outing/index.html")},output:{manualChunks:id=>id.includes("/phaser/")?"phaser":undefined}}}});
  const staticReport=await overlayGameStatic(overlay,site);
  const fn=join(output,"functions",primaryFunction);await functionDirectories(output);await staticFiles(fn);
  const oldFunctionSha256=await hash(join(fn,"index.mjs"));
  await rm(fn,{recursive:true,force:true});await mkdir(fn,{recursive:true});
  const result=await Bun.build({entrypoints:[join(source,"services/relayer/src/tidebound-http.ts")],outdir:fn,naming:"index.mjs",target:"node",format:"esm",minify:true,env:"disable"});
  check(result.success,"The private H1 HTTP function did not bundle.");
  await writeFile(join(fn,".vc-config.json"),JSON.stringify({runtime:"nodejs24.x",handler:"index.mjs",launcherType:"Nodejs",maxDuration:60,shouldAddHelpers:false}));
  const functionAliases=await installFunctionAliases(output);
  check((await readFile(join(output,"config.json"))).equals(configBytes),"The preserved public routing configuration changed.");
  const preserved=baselineStatic.filter(file=>!(GAME_HTML as readonly string[]).includes(file.path));
  for(const file of preserved)check(await hash(join(site,file.path))===file.sha256,`A preserved baseline file changed: ${file.path}`);
  const manifest={mode:"LOCAL_H1_REVIEW_ONLY",origin,baseline,release,network:"testnet",plannedRoot:gameRoot,
    static:{baselineCount:baselineStatic.length,preservedCount:preserved.length,allowedHtmlReplacementPaths:GAME_HTML,replacedHtml:staticReport.changes,addedFiles:[...runtimeAssets.added,...staticReport.added],runtimeAssets:{allowedWebps:RUNTIME_WEBPS,allowedMetadata:RUNTIME_METADATA,...runtimeAssets},preservedFiles:preserved,recoveryPageUnchanged:true},
    routing:{baselineConfigSha256:digest(configBytes),changed:false,originalFunctionRequestUrlPreserved:true},
    publicBuild:{provider:"privy",tideboundUiEnabled:true,root:gameRoot,relayerUrl:"/api",appIdSha256:digest(new TextEncoder().encode(appId)),environmentFilesLoaded:false},
    privateFunction:{path:primaryFunction,scopeChangedFromRecoveryOnly:true,beforeSha256:oldFunctionSha256,sha256:await hash(join(fn,"index.mjs")),bytes:await Bun.file(join(fn,"index.mjs")).size,runtime:"nodejs24.x",shouldAddHelpers:false,aliases:functionAliases,endpoints:[{path:HTTP_PATHS[0],methods:["GET","OPTIONS"]},...HTTP_PATHS.slice(1).map(path=>({path,methods:["POST","OPTIONS"]}))],enabledByDefault:false},
    requiredRuntimeEnvironmentNames:["TIDEBOUND_HTTP_ENABLED","ACCOUNT_PROVIDER","NEAR_NETWORK","NEAR_ROOT","RELAYER_ID","RELAYER_PRIVATE_KEY","PRIVY_APP_ID","PRIVY_APP_SECRET"],
    requiredNonSecretRuntimeValues:{TIDEBOUND_HTTP_ENABLED:"true",ACCOUNT_PROVIDER:"privy",NEAR_NETWORK:"testnet",NEAR_ROOT:gameRoot,RELAYER_ID:`relayer.${gameRoot}`},
    limits:{compatibleContractsVerified:false,liveGameActionsTested:false,hostingAliasUrlBehaviorVerified:false,privateRuntimeConfigured:false},uploaded:false,deployed:false};
  await writeFile(join(release,"review-manifest.json"),JSON.stringify(manifest,null,2)+"\n");console.info(JSON.stringify(manifest,null,2));
}
if(import.meta.main)await main();
