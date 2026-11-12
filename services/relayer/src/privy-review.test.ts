import { expect, test } from "bun:test";
import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { createPrivyReviewHandler, type PrivyReviewEnvironment } from "./privy-review";
import { PrivyBridgeError, type PrivyService } from "./auth/privy";

const origin="https://familiar-two.vercel.app",path="/api/v1/privy/wallet";
const enabled:PrivyReviewEnvironment={PRIVY_REVIEW_ENABLED:"true",PRIVY_APP_ID:"synthetic-app",PRIVY_APP_SECRET:"synthetic-not-a-credential"};
async function serve(environment:PrivyReviewEnvironment,service:PrivyService,work:(url:string)=>Promise<void>){
  const server=createServer(createPrivyReviewHandler({environment,service}));
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",resolve)});
  try{await work(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)}finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))}
}
test("review entry is default off and omits every non-wallet route over actual local HTTP",async()=>{
  let calls=0;const service:PrivyService={wallet:async()=>{calls++;return null}};
  for(const environment of [{},{...enabled,PRIVY_REVIEW_ENABLED:"false"},{...enabled,PRIVY_APP_SECRET:""}])await serve(environment,service,async url=>{
    const response=await fetch(url+path,{method:"POST",headers:{origin,"content-type":"application/json",authorization:"Bearer a.b.c"},body:'{"create":false}'});
    expect(response.status).toBe(503);expect(response.headers.get("cache-control")).toBe("no-store");expect(await response.text()).not.toContain("synthetic-not-a-credential");
  });
  await serve(enabled,service,async url=>{
    for(const target of ["/health","/api/health","/v1/privy/wallet","/api/v1/privy/player","/api/v1/guest","/api/v1/auth/sign","/api/v1/relay",path+"/",path+"?create=true"]){
      const response=await fetch(url+target,{method:"POST",headers:{origin},body:"{}"});expect(response.status).toBe(404);
    }
    expect((await fetch(url+path)).status).toBe(405);
  });expect(calls).toBe(0);
});
test("review entry preserves origin, authorization, strict body and streamed size guards before the service",async()=>{
  let calls=0;const service:PrivyService={wallet:async()=>{calls++;return null}};
  await serve(enabled,service,async url=>{
    const post=(body:string,headers:Record<string,string>={})=>fetch(url+path,{method:"POST",headers:{origin,"content-type":"application/json",authorization:"Bearer header.payload.signature",...headers},body});
    expect((await post('{"create":false}',{origin:""})).status).toBe(403);
    expect((await post('{"create":false}',{origin:"https://wrong.example"})).status).toBe(403);
    for(const authorization of ["","Bearer invalid","Basic synthetic"]){expect((await post('{"create":false}',{authorization})).status).toBe(401)}
    for(const body of ["{",'{}','{"create":"false"}','{"create":true,"userId":"attacker"}'])expect((await post(body)).status).toBe(400);
    expect((await post(JSON.stringify({create:false,padding:"x".repeat(16_384)}))).status).toBe(413);
    // No Content-Length: exercise Readable.toWeb and Hono's streaming body limit too.
    const chunked=await new Promise<number>((resolve,reject)=>{
      const req=httpRequest(url+path,{method:"POST",headers:{origin,"content-type":"application/json",authorization:"Bearer header.payload.signature","transfer-encoding":"chunked"}},res=>{res.resume();res.on("end",()=>resolve(res.statusCode!));});req.on("error",reject);req.write('{"create":false,"padding":"');req.write("x".repeat(16_384));req.end('"}');
    });expect(chunked).toBe(413);
  });expect(calls).toBe(0);
});
test("review entry exposes only the synthetic wallet response, with safe errors and CORS, over actual local HTTP",async()=>{
  const calls:{token:string;create:boolean}[]=[];
  const wallet={walletId:"synthetic-wallet",implicitAddress:"1".repeat(64),publicKey:"ed25519:synthetic-public-key"};
  const service:PrivyService={wallet:async(token,create)=>{calls.push({token,create});return create?wallet:null}};
  await serve(enabled,service,async url=>{
    for(const create of [false,true]){
      const response=await fetch(url+path,{method:"POST",headers:{origin,"content-type":"application/json",authorization:"Bearer header.payload.signature"},body:JSON.stringify({create})});
      expect(response.status).toBe(200);expect(await response.json()).toEqual({wallet:create?wallet:null});expect(response.headers.get("cache-control")).toBe("no-store");
    }
    const preflight=await fetch(url+path,{method:"OPTIONS",headers:{origin,"access-control-request-method":"POST","access-control-request-headers":"authorization,content-type"}});
    expect(preflight.status).toBe(204);expect(preflight.headers.get("access-control-allow-origin")).toBe(origin);expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain("authorization");
  });expect(calls).toEqual([{token:"header.payload.signature",create:false},{token:"header.payload.signature",create:true}]);
  await serve(enabled,{wallet:async()=>{throw new PrivyBridgeError("ERR_PRIVY_OWNER")}},async url=>{
    const response=await fetch(url+path,{method:"POST",headers:{origin,authorization:"Bearer secret.payload.signature","content-type":"application/json"},body:'{"create":false}'});
    expect(response.status).toBe(403);expect(await response.text()).not.toContain("secret.payload.signature");
  });
});
