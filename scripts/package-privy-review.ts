import { copyFile,cp,mkdir,mkdtemp,readFile,readdir,writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname,join,resolve } from "node:path";
import { createHash } from "node:crypto";
import { build } from "vite";
import react from "@vitejs/plugin-react";

async function files(folder:string,prefix=""):Promise<string[]> {
  const entries=await readdir(join(folder,prefix),{withFileTypes:true});
  return (await Promise.all(entries.map(entry=>{
    if(entry.isSymbolicLink())throw Error("Review assets must not contain symlinks.");
    const path=join(prefix,entry.name);return entry.isDirectory()?files(folder,path):[path];
  }))).flat().sort();
}
export async function overlayStatic(source:string,destination:string) {
  const paths=await files(source),added:string[]=[];
  for(const path of paths) {
    const original=await readFile(join(destination,path)).catch(error=>{if(error.code==="ENOENT")return null;throw error;});
    if(original && !original.equals(await readFile(join(source,path))))throw Error(`Recovery overlay would overwrite ${path}.`);
    if(!original)added.push(path);
  }
  for(const path of added){await mkdir(dirname(join(destination,path)),{recursive:true});await copyFile(join(source,path),join(destination,path));}
  return added;
}

if(import.meta.main) {
  const baseline=resolve(process.argv[2]??"");
  const appId=process.env.VITE_PRIVY_APP_ID??"";
  if(!process.argv[2] || !/^[A-Za-z0-9_-]{1,128}$/.test(appId))throw Error("Pass the existing rendered release directory and configure only the public VITE_PRIVY_APP_ID for this build.");
  const project=JSON.parse(await readFile(join(baseline,".vercel/project.json"),"utf8"));
  if(project.projectId!=="prj_BfSIGWQo1vzXglQE2Hoh68ZWxriF" || project.orgId!=="team_fCwmTTXwBYiXVsmrpIWiIz1X")throw Error("The baseline is not the existing Familiar Vercel project.");
  const root=resolve(import.meta.dir,".."),release=await mkdtemp(join(tmpdir(),"familiar-privy-review-"));
  const output=join(release,".vercel/output"),site=join(output,"static");
  await cp(join(baseline,".vercel/output"),output,{recursive:true});
  await writeFile(join(release,".vercel/project.json"),JSON.stringify(project));
  const originals=await files(site),hash=async(path:string)=>createHash("sha256").update(await readFile(path)).digest("hex");
  const originalHashes=await Promise.all(originals.map(path=>hash(join(site,path))));
  const overlay=await mkdtemp(join(tmpdir(),"familiar-privy-static-"));
  await build({configFile:false,plugins:[react()],root:join(root,"web"),envDir:false,envPrefix:[],publicDir:false,define:{
    "import.meta.env.VITE_PRIVY_APP_ID":JSON.stringify(appId),"import.meta.env.VITE_PRIVY_CLIENT_ID":JSON.stringify(process.env.VITE_PRIVY_CLIENT_ID??""),
    "import.meta.env.VITE_ACCOUNT_PROVIDER":JSON.stringify("privy"),"import.meta.env.VITE_NEAR_ROOT":JSON.stringify("familiar-game.testnet"),
    "import.meta.env.VITE_NEAR_RPC_URL":JSON.stringify("https://test.rpc.fastnear.com"),"import.meta.env.VITE_RELAYER_URL":JSON.stringify("/api"),
    "import.meta.env.VITE_TIDEBOUND_ENABLED":JSON.stringify("false"),
  },build:{outDir:overlay,rollupOptions:{input:{privySpike:join(root,"web/privy-spike/index.html")}}}});
  for(const path of ["assets/first-light-motion/harbor.webp","icons/beacon-192.png"])
    if(await hash(join(site,path))!==await hash(join(root,"web/public",path)))throw Error(`The existing recovery artwork differs: ${path}`);
  const added=await overlayStatic(overlay,site);
  for(let i=0;i<originals.length;i++)if(await hash(join(site,originals[i]!))!==originalHashes[i])throw Error("The existing static site changed during packaging.");
  const fn=join(output,"functions/api/v1/privy/wallet.func");await mkdir(fn,{recursive:true});
  const result=await Bun.build({entrypoints:[join(root,"services/relayer/src/privy-review.ts")],outdir:fn,naming:"index.mjs",target:"node",format:"esm",minify:true,env:"disable"});
  if(!result.success)throw Error("The private wallet function did not bundle.");
  await writeFile(join(fn,".vc-config.json"),JSON.stringify({runtime:"nodejs24.x",handler:"index.mjs",launcherType:"Nodejs",maxDuration:60,shouldAddHelpers:false}));
  const config=JSON.parse(await readFile(join(output,"config.json"),"utf8"));
  if(!Array.isArray(config.routes))throw Error("The existing release routing is missing.");
  const filesystem=config.routes.findIndex((route:{handle?:string})=>route.handle==="filesystem");
  if(filesystem<0)throw Error("The existing release filesystem route is missing.");
  config.routes.splice(filesystem,0,{src:"/privy-spike/?$",dest:"/privy-spike/index.html"});
  await writeFile(join(output,"config.json"),JSON.stringify(config,null,2)+"\n");
  const manifest={mode:"LOCAL_REVIEW_ONLY",origin:"https://familiar-two.vercel.app",baseline,release,existingStaticFilesPreserved:originals.length,addedStaticFiles:added.length,privateFunction:{path:"api/v1/privy/wallet",runtime:"nodejs24.x",bytes:(await Bun.file(join(fn,"index.mjs")).size),sha256:await hash(join(fn,"index.mjs"))},requiredRuntimeEnvironment:["PRIVY_REVIEW_ENABLED=true","PRIVY_APP_ID","PRIVY_APP_SECRET"],gameIssuance:false,uploaded:false,deployed:false};
  await writeFile(join(release,"review-manifest.json"),JSON.stringify(manifest,null,2)+"\n");
  console.info(JSON.stringify(manifest,null,2));
}
