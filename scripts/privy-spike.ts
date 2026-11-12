import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "vite";
import { createApp } from "../services/relayer/src/app";
import { createPrivyBridge } from "../services/relayer/src/auth/privy";

const appId=process.env.PRIVY_APP_ID??"";
const appSecret=process.env.PRIVY_APP_SECRET??"";
if(!appId || !appSecret || process.env.VITE_PRIVY_APP_ID!==appId)
  throw Error("Set matching Privy App IDs and the server secret in the ignored .env.privy.local file.");

const origin="http://localhost:3000";
const root="familiar-game.testnet";
// No game backend, NEAR signing key or broadcast route exists in this isolated spike.
const app=createApp({root,origins:[origin]},undefined,createPrivyBridge({appId,appSecret}));
const backend=Bun.serve({hostname:"127.0.0.1",port:0,fetch:app.fetch});
const cacheDir=await mkdtemp(join(tmpdir(),"familiar-privy-vite-"));
const server=await createServer({
  root:resolve(import.meta.dir,"../web"),envDir:false,envPrefix:[],cacheDir,
  define:{
    "import.meta.env.VITE_PRIVY_APP_ID":JSON.stringify(appId),
    "import.meta.env.VITE_PRIVY_CLIENT_ID":JSON.stringify(process.env.VITE_PRIVY_CLIENT_ID??""),
    "import.meta.env.VITE_ACCOUNT_PROVIDER":JSON.stringify("privy"),
    "import.meta.env.VITE_NEAR_ROOT":JSON.stringify(root),
    "import.meta.env.VITE_NEAR_RPC_URL":JSON.stringify("https://test.rpc.fastnear.com"),
    "import.meta.env.VITE_RELAYER_URL":JSON.stringify("/api"),
    "import.meta.env.VITE_TIDEBOUND_ENABLED":JSON.stringify("false"),
  },
  server:{host:"localhost",port:3000,strictPort:true,proxy:{"/api":{target:`http://127.0.0.1:${backend.port}`,rewrite:path=>path.replace(/^\/api/,"")}}},
});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;backend.stop();await server.close();}
process.on("SIGINT",()=>void stop());
process.on("SIGTERM",()=>void stop());
try{
  await server.listen();
  console.info(`Privy recovery spike: ${origin}/privy-spike/ — sign only, no broadcast or spending.`);
}catch{
  await stop();throw Error("The local Privy spike could not start. Check that port 3000 is free; credentials were not printed.");
}
