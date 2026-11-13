import { lstat,mkdir,mkdtemp,rename,rm,writeFile } from "node:fs/promises";
import { join,resolve } from "node:path";
import { buildAccountFunction,buildGameSite,currentRouting } from "./package-tidebound-review";

export function releaseSettings(env:Record<string,string|undefined>){
  if(env.VERCEL_ENV!=="production")return {appId:"",clientId:""};
  const appId=env.VITE_PRIVY_APP_ID??env.PRIVY_APP_ID??"",clientId=env.VITE_PRIVY_CLIENT_ID??"";
  const id=/^[A-Za-z0-9_-]{1,128}$/;
  if(!id.test(appId)||(clientId&&!id.test(clientId)))throw Error("Production requires a valid public Privy app ID and, if supplied, a valid public client ID.");
  return {appId,clientId};
}

export async function buildRelease(source:string,settings:ReturnType<typeof releaseSettings>){
  const vercel=join(source,".vercel"),output=join(vercel,"output");
  await mkdir(vercel,{recursive:true});
  if(!(await lstat(vercel)).isDirectory())throw Error("Build output requires a physical .vercel directory.");
  const staged=await mkdtemp(join(vercel,"build-output-"));
  try{
    const site=join(staged,"static");
    await mkdir(site);
    await buildGameSite(source,site,settings.appId,settings.clientId);
    if(settings.appId)await buildAccountFunction(source,staged);
    await writeFile(join(staged,"config.json"),JSON.stringify(currentRouting(),null,2)+"\n");
    await rm(output,{recursive:true,force:true});
    await rename(staged,output);
    return output;
  }finally{await rm(staged,{recursive:true,force:true});}
}

if(import.meta.main){
  const output=await buildRelease(resolve(import.meta.dir,".."),releaseSettings(process.env));
  console.info(`Prepared Familiar’s ${process.env.VERCEL_ENV==="production"?"production":"device-preview"} release at ${output}.`);
}
