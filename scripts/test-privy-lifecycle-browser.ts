import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

// Exercise the actual React bridge with a synthetic SDK. No auth, wallet or RPC requests.
const sdkId="\0familiar-privy-lifecycle-sdk",entryId="\0familiar-privy-lifecycle-entry.js";
const sdk=`
const user={id:'did:privy:synthetic-owner',linkedAccounts:[]};
const fixture=window.__privyLifecycle={user,ready:true,hold:{},release:{},calls:{login:0,refresh:0,token:0,sign:0},userRecord:user};
const result=(kind,value)=>fixture.hold[kind]?new Promise(resolve=>fixture.release[kind]=()=>resolve(value)):Promise.resolve(value);
export function PrivyProvider({children}){return children}
export function usePrivy(){return {ready:fixture.ready,user:fixture.user,error:null,async logout(){fixture.user=null},async getAccessToken(){fixture.calls.token++;return result('token','synthetic-token')}}}
export function useUser(){return {async refreshUser(){fixture.calls.refresh++;return result('refresh',user)}}}
export function useLogin(callbacks){fixture.callbacks=callbacks;return {login(){fixture.calls.login++}}}
export function useSignRawHash(){return {async signRawHash(){fixture.calls.sign++;return result('sign',{signature:'0x'+'0'.repeat(128)})}}}
`;
const entry=`
import '/src/browser-globals.ts';
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {PrivyAccountProvider} from '/src/account/PrivyProvider.tsx';
function App(){
 const [open,setOpen]=useState(true);window.__privyLifecycle.open=()=>setOpen(true);window.__privyLifecycle.close=()=>setOpen(false);
 return open?React.createElement(PrivyAccountProvider,null,(_connection,session)=>{window.__privyLifecycle.port=session;return React.createElement('p',null,'Bridge mounted')}):React.createElement('p',null,'Bridge closed');
}
createRoot(document.getElementById('root')).render(React.createElement(App));
`;
const temporary=await mkdtemp(join(tmpdir(),"familiar-privy-lifecycle-"));
const server=await createServer({
  root:resolve(import.meta.dir,"../web"),envDir:false,envPrefix:[],cacheDir:join(temporary,"vite-cache"),logLevel:"error",
  define:{"import.meta.env.VITE_PRIVY_APP_ID":JSON.stringify("synthetic-privy-app")},
  plugins:[{name:"isolated-privy-lifecycle",enforce:"pre",
    resolveId(source){if(["@privy-io/react-auth","@privy-io/react-auth/extended-chains"].includes(source))return sdkId;if(source==="/__privy-lifecycle-entry.js")return entryId;},
    load(id){if(id===sdkId)return sdk;if(id===entryId)return entry;},
    configureServer(server){server.middlewares.use((req,res,next)=>{if(req.url!=="/__privy-lifecycle/")return next();void server.transformIndexHtml(req.url,'<div id="root"></div><script type="module" src="/__privy-lifecycle-entry.js"></script>').then(html=>{res.setHeader("content-type","text/html");res.end(html);}).catch(next);});},
  }],server:{host:"127.0.0.1",port:0},
});
await server.listen();const origin=server.resolvedUrls!.local[0]!.replace(/\/$/,"");
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage(),external:string[]=[],errors:string[]=[];
  page.on("pageerror",error=>{errors.push(error.message);console.error("Synthetic lifecycle page error:",error.message);});
  await page.route("**/*",route=>{const url=route.request().url();if(url.startsWith(origin+"/")||url.startsWith("data:"))return route.continue();external.push(url);return route.abort();});
  await page.goto(origin+"/__privy-lifecycle/");await expect(page.getByText("Bridge mounted",{exact:true})).toBeVisible();
  const initial=await page.evaluate(async()=>{
    const f=(window as any).__privyLifecycle;await f.port.waitUntilReady();
    const original=JSON.stringify({state:"prepared",transaction:"original-canonical-native-bytes"});localStorage.setItem("lifecycle-original",original);
    f.oldPort=f.port;f.hold={refresh:true,token:true,sign:true};
    f.pending=Promise.all([
      f.port.refreshUser(),f.port.accessToken(),f.port.signHash("0".repeat(64),"0x00"),
    ].map(p=>p.then(()=>"unexpected-success",(error:Error)=>error.message)));
    return {identity:f.port.identity()?.id,original};
  });
  assert.equal(initial.identity,"did:privy:synthetic-owner");
  await expect.poll(()=>page.evaluate(()=>Object.keys((window as any).__privyLifecycle.release).length)).toBe(3);
  await page.evaluate(()=>{(window as any).__privyLifecycle.close();});await expect(page.getByText("Bridge closed",{exact:true})).toBeVisible();
  const closed=await page.evaluate(async()=>{
    const f=(window as any).__privyLifecycle,counts={...f.calls};
    f.callbacks.onComplete({user:f.userRecord});
    const identity=f.oldPort.identity();
    const immediate=await Promise.all([()=>f.oldPort.login(),()=>f.oldPort.refreshUser(),()=>f.oldPort.accessToken(),()=>f.oldPort.signHash("0".repeat(64),"0x00")].map(work=>work().then(()=>"unexpected-success",(error:Error)=>error.message)));
    const after={...f.calls};for(const release of Object.values(f.release) as (()=>void)[])release();
    return {identity,immediate,late:await f.pending,counts,after,original:localStorage.getItem("lifecycle-original")};
  });
  assert.equal(closed.identity,null,"a retained session cannot expose its previous owner after unmount");
  assert(closed.immediate.every(message=>message.includes("closed")),"closed ports reject before invoking the SDK");
  assert(closed.late.every((message:string)=>message.includes("closed")),"in-flight refresh, token and signature results cannot escape a closed bridge");
  assert.deepEqual(closed.after,closed.counts);assert.equal(closed.original,initial.original,"closing the provider preserves the original pending bytes");
  await page.evaluate(()=>{const f=(window as any).__privyLifecycle;f.user=null;f.hold={};f.release={};f.open();});
  await expect(page.getByText("Bridge mounted",{exact:true})).toBeVisible();
  await page.evaluate(()=>{const f=(window as any).__privyLifecycle;f.loginPort=f.port;f.pendingLogin=f.port.login().then(()=>"unexpected-success",(error:Error)=>error.message);});
  await expect.poll(()=>page.evaluate(()=>(window as any).__privyLifecycle.calls.login)).toBe(1);
  await page.evaluate(()=>{(window as any).__privyLifecycle.close();});await expect(page.getByText("Bridge closed",{exact:true})).toBeVisible();
  const login=await page.evaluate(async()=>{const f=(window as any).__privyLifecycle;f.callbacks.onComplete({user:f.userRecord});return {identity:f.loginPort.identity(),result:await f.pendingLogin};});
  assert.equal(login.identity,null);assert(login.result.includes("closed"),"a late login callback cannot reopen an unmounted session");
  assert.deepEqual(external,[],"synthetic lifecycle regression makes no external requests");assert.deepEqual(errors,[]);
  console.log("PASS: closed Privy bridge clears identity, rejects late login/refresh/token/sign results, preserves pending bytes, and makes no external calls.");
} finally {await browser.close();await server.close();}
