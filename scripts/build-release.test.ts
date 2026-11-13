import { expect,test } from "bun:test";
import { mkdtemp,readFile,realpath,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { releaseSettings } from "./build-release";
import { buildAccountFunction,currentRouting,HTTP_PATHS } from "./package-tidebound-review";

test("only production builds receive explicitly allowlisted public account settings",()=>{
  expect(releaseSettings({})).toEqual({appId:"",clientId:"",sealedNote:false,records:false});
  expect(releaseSettings({VERCEL_ENV:"preview",PRIVY_APP_ID:"prod-app",VITE_PRIVY_CLIENT_ID:"prod-client",VITE_SEALED_NOTE_ENABLED:"true"})).toEqual({appId:"",clientId:"",sealedNote:false,records:false});
  expect(releaseSettings({VERCEL_ENV:"production",PRIVY_APP_ID:"existing-app"})).toEqual({appId:"existing-app",clientId:"",sealedNote:false,records:false});
  expect(releaseSettings({VERCEL_ENV:"production",PRIVY_APP_ID:"existing-app",VITE_SEALED_NOTE_ENABLED:"1"}).sealedNote).toBe(false);
  expect(releaseSettings({VERCEL_ENV:"production",PRIVY_APP_ID:"existing-app",VITE_SEALED_NOTE_ENABLED:"true"}).sealedNote).toBe(true);
  expect(releaseSettings({VERCEL_ENV:"production",PRIVY_APP_ID:"existing-app",VITE_RECORDS_ENABLED:"true"}).records).toBe(true);
  expect(releaseSettings({VERCEL_ENV:"production",PRIVY_APP_ID:"existing-app",VITE_RECORDS_ENABLED:"yes"}).records).toBe(false);
  expect(releaseSettings({VERCEL_ENV:"preview",PRIVY_APP_ID:"existing-app",VITE_RECORDS_ENABLED:"true"}).records).toBe(false);
  expect(releaseSettings({VERCEL_ENV:"production",VITE_PRIVY_APP_ID:"public-app",PRIVY_APP_ID:"fallback",VITE_PRIVY_CLIENT_ID:"public-client"})).toEqual({appId:"public-app",clientId:"public-client",sealedNote:false,records:false});
  for(const id of ["","invalid id", "a".repeat(129)])
    expect(()=>releaseSettings({VERCEL_ENV:"production",PRIVY_APP_ID:id})).toThrow();
  expect(()=>releaseSettings({VERCEL_ENV:"production",PRIVY_APP_SECRET:"never-an-app-id"})).toThrow();
});

test("source release bundles one Node 24 H1 handler behind the original API paths",async()=>{
  const output=await mkdtemp(join(tmpdir(),"familiar-source-function-"));
  try {
    await buildAccountFunction(join(import.meta.dir,".."),output);
    const wallet=join(output,"functions/api/v1/privy/wallet.func");
    expect(await Bun.file(join(wallet,".vc-config.json")).json()).toEqual({runtime:"nodejs24.x",handler:"index.mjs",launcherType:"Nodejs",maxDuration:60,shouldAddHelpers:false});
    const source=await readFile(join(wallet,"index.mjs"),"utf8");
    const paths=currentRouting().routes;
    for(const url of HTTP_PATHS){
      expect(await realpath(join(output,"functions",url.slice(1)+".func"))).toBe(await realpath(wallet));
      expect(source).toContain(url);
      expect(paths.some(r=>r.src&&("dest" in r||"status" in r)&&new RegExp(r.src).test(url))).toBe(false);
    }
  }finally{await rm(output,{recursive:true,force:true});}
});
