import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { createApp } from "./app";
import { createPrivyBridge, type PrivyService } from "./auth/privy";

const origin="https://familiar-two.vercel.app";
const walletPath="/api/v1/privy/wallet";
export interface PrivyReviewEnvironment {PRIVY_REVIEW_ENABLED?:string;PRIVY_APP_ID?:string;PRIVY_APP_SECRET?:string}
export function createPrivyReviewHandler(options:{environment?:PrivyReviewEnvironment;service?:PrivyService}={}) {
  const environment=options.environment??process.env;
  // Quotas are retained per process only. External IDs, not these counters, enforce canonical wallet uniqueness across instances.
  let app:ReturnType<typeof createApp>|undefined;
  return async function handler(req:IncomingMessage,res:ServerResponse):Promise<void> {
    res.setHeader("cache-control","no-store");res.setHeader("x-content-type-options","nosniff");
    const json=(status:number,code:string,error:string)=>{res.statusCode=status;res.setHeader("content-type","application/json; charset=utf-8");res.end(JSON.stringify({code,error}));};
    if(req.url!==walletPath){json(404,"NOT_FOUND","This review endpoint only checks the recovery wallet.");return;}
    if(req.method!=="POST"&&req.method!=="OPTIONS"){res.setHeader("allow","POST, OPTIONS");json(405,"METHOD_NOT_ALLOWED","Use the wallet recovery request.");return;}
    if(environment.PRIVY_REVIEW_ENABLED!=="true"||!environment.PRIVY_APP_ID||!environment.PRIVY_APP_SECRET){json(503,"REVIEW_DISABLED","The recovery review endpoint is not enabled.");return;}
    try {
      app??=createApp({origins:[origin],root:"familiar-game.testnet"},undefined,options.service??createPrivyBridge({appId:environment.PRIVY_APP_ID,appSecret:environment.PRIVY_APP_SECRET}));
      const headers=new Headers();
      for(const [name,value] of Object.entries(req.headers)){
        if(Array.isArray(value))for(const part of value)headers.append(name,part);
        else if(value!==undefined)headers.set(name,value);
      }
      const init:RequestInit&{duplex?:"half"}={method:req.method,headers};
      // Node and DOM declare distinct ReadableStream overloads; the runtime value is the standard Web stream.
      if(req.method==="POST"){init.body=Readable.toWeb(req) as unknown as BodyInit;init.duplex="half";}
      const response=await app.fetch(new Request(`${origin}/v1/privy/wallet`,init));
      res.statusCode=response.status;
      response.headers.forEach((value,name)=>res.setHeader(name,value));
      res.setHeader("cache-control","no-store");
      res.end(Buffer.from(await response.arrayBuffer()));
    }catch{if(!res.headersSent)json(503,"REVIEW_UNAVAILABLE","The original recovery wallet could not be checked. No replacement was requested.");else res.end();}
  };
}
export default createPrivyReviewHandler();
