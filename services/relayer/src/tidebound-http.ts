import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { KeyPairString } from "near-api-js";
import { createApp, type Backend } from "./app";
import { createBackend } from "./chain";
import { createPrivyBridge, type PrivyService } from "./auth/privy";
import { createNoteRelay, rpcNoteChain, type NoteChain, type NoteFetch } from "./sealed-note";

const origin="https://familiar-two.vercel.app",root="familiar-game.testnet",items=`items.${root}`;
const rpc="https://test.rpc.fastnear.com";
export interface TideboundHttpEnvironment {
  TIDEBOUND_HTTP_ENABLED?:string;ACCOUNT_PROVIDER?:string;NEAR_NETWORK?:string;NEAR_ROOT?:string;
  RELAYER_ID?:string;RELAYER_PRIVATE_KEY?:string;PRIVY_APP_ID?:string;PRIVY_APP_SECRET?:string;NEAR_AI_API_KEY?:string;
}
/** Expose through the four exact .func aliases; request headers and query strings never choose a route. */
export function createTideboundHttpHandler(options:{environment?:TideboundHttpEnvironment;backend?:Backend;privy?:PrivyService;noteChain?:NoteChain;noteFetch?:NoteFetch}={}) {
  const environment=options.environment??process.env;
  // Hono's quotas are process-local. Use one configured instance or add durable quotas before scaling.
  let app:ReturnType<typeof createApp>|undefined;
  return async function handler(req:IncomingMessage,res:ServerResponse):Promise<void> {
    res.setHeader("cache-control","no-store");res.setHeader("x-content-type-options","nosniff");
    const json=(status:number,code:string,error:string)=>{res.statusCode=status;res.setHeader("content-type","application/json; charset=utf-8");res.end(JSON.stringify({code,error}));};
    const path=req.url??"";
    const method=path==="/api/health"?"GET":
      path==="/api/v1/privy/wallet"||path==="/api/v1/privy/player"||path==="/api/v1/privy/note"?"POST":null;
    if(!method){json(404,"NOT_FOUND","This harbor serves only H1 account requests.");return;}
    if(req.method!==method&&req.method!=="OPTIONS"){res.setHeader("allow",`${method}, OPTIONS`);json(405,"METHOD_NOT_ALLOWED","Use the account request's configured method.");return;}
    if(environment.TIDEBOUND_HTTP_ENABLED!=="true"||environment.ACCOUNT_PROVIDER!=="privy"||environment.NEAR_NETWORK!=="testnet"||
      environment.NEAR_ROOT!==root||environment.RELAYER_ID!==`relayer.${root}`||!environment.RELAYER_PRIVATE_KEY||!environment.PRIVY_APP_ID||!environment.PRIVY_APP_SECRET){
      json(503,"TIDEBOUND_DISABLED","H1 account saving is not enabled for this harbor.");return;
    }
    const apiKey=environment.NEAR_AI_API_KEY;
    if(path==="/api/v1/privy/note"&&!apiKey){json(503,"NOTE_DISABLED","Mochi's sealed note is not enabled for this harbor.");return;}
    try {
      if(!app){
        const backend=options.backend??createBackend(root,`relayer.${root}`,environment.RELAYER_PRIVATE_KEY as KeyPairString,rpc,{provider:"privy",items,origins:[origin]});
        if(backend.accountProvider!=="privy"||backend.authSign)throw Error("Invalid H1 account provider.");
        const notes=apiKey?createNoteRelay({apiKey,chain:options.noteChain??rpcNoteChain(root,rpc),fetch:options.noteFetch}):undefined;
        app=createApp({origins:[origin],root},backend,options.privy??createPrivyBridge({appId:environment.PRIVY_APP_ID,appSecret:environment.PRIVY_APP_SECRET}),notes);
      }
      const headers=new Headers();
      for(const [name,value] of Object.entries(req.headers)){
        if(Array.isArray(value))for(const part of value)headers.append(name,part);
        else if(value!==undefined)headers.set(name,value);
      }
      const init:RequestInit&{duplex?:"half"}={method:req.method,headers};
      // Node's stream types differ from DOM overloads; this is a standard Web byte stream at runtime.
      if(req.method==="POST"){init.body=Readable.toWeb(req) as unknown as BodyInit;init.duplex="half";}
      const response=await app.fetch(new Request(origin+path.slice(4),init));
      res.statusCode=response.status;response.headers.forEach((value,name)=>res.setHeader(name,value));res.setHeader("cache-control","no-store");
      res.end(Buffer.from(await response.arrayBuffer()));
    }catch{if(!res.headersSent)json(503,"TIDEBOUND_UNAVAILABLE","The original account request could not be confirmed. Keep the same wallet and pending action.");else res.end();}
  };
}
export default createTideboundHttpHandler();
