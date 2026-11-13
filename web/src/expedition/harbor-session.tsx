import {createContext,lazy,Suspense,useContext,useEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from "react";
import {createRecoverableAccountConnection,type AccountConnection} from "../account/client";
import {validName} from "../rules";
import type {UsernameAvailability} from "../account/names";
import {TideboundClient} from "../tidebound/client";
import {HarborController,type HarborConnection} from "./harbor-controller";
import type {HarborSession} from "./harbor-port";
export type {HarborSession,HarborState,RunContext,HomeCheckpoint,WorldIntent,WorldReview,WorkshopModel} from "./harbor-port";
export type {ReturnRecord} from "./return-record";

const Context=createContext<HarborController|null>(null);
const PrivyProvider=lazy(()=>import("../account/PrivyProvider").then(module=>({default:module.PrivyAccountProvider})));
const browserStore:Storage={
  getItem:key=>globalThis.localStorage.getItem(key),setItem:(key,value)=>globalThis.localStorage.setItem(key,value),removeItem:key=>globalThis.localStorage.removeItem(key),
  clear:()=>{throw Error("Clearing game storage is unavailable.");},key:index=>globalThis.localStorage.key(index),get length(){return globalThis.localStorage.length;},
};
type Children=ReactNode|((session:HarborSession)=>ReactNode);
export function HarborSessionProvider({connection,children,storage=browserStore}:{connection:AccountConnection|HarborConnection|null;children:Children;storage?:Pick<Storage,"getItem"|"setItem"|"removeItem">}) {
  const controller=useMemo(()=>new HarborController(connection&&("client"in connection?connection:{adapter:connection.adapter,client:new TideboundClient(connection.adapter.accountRoot,`items.${connection.adapter.accountRoot}`,connection.provider,connection.adapter,storage),accountExists:async accountId=>{await connection.provider.viewAccount({accountId,blockQuery:{finality:"final"}});}}),storage),[connection,storage]);
  useSyncExternalStore(controller.subscribe,()=>controller.state);
  useEffect(()=>{controller.open();return()=>controller.close();},[controller]);
  return <Context.Provider value={controller}>{typeof children==="function"?children(controller):children}</Context.Provider>;
}
export function useHarborSession():HarborSession {
  const controller=useContext(Context);if(!controller)throw Error("The game needs one persistent HarborSessionProvider.");
  useSyncExternalStore(controller.subscribe,()=>controller.state);return controller;
}
export function HarborSessionBoundary({children}:{children:Children}) {
  const [nearConnection]=useState(()=>{
    if(import.meta.env.VITE_TIDEBOUND_ENABLED!=="true"||import.meta.env.VITE_ACCOUNT_PROVIDER==="privy")return null;
    try{const root=import.meta.env.VITE_NEAR_ROOT??"";return createRecoverableAccountConnection({root,items:`items.${root}`,rpcUrl:import.meta.env.VITE_NEAR_RPC_URL??"https://test.rpc.fastnear.com",relayerUrl:import.meta.env.VITE_RELAYER_URL??"/api",clientId:import.meta.env.VITE_NEAR_AUTH_CLIENT_ID??"",approvedOrigin:import.meta.env.VITE_TIDEBOUND_AUTH_ORIGIN??""});}catch{return null;}
  });
  if(import.meta.env.VITE_TIDEBOUND_ENABLED!=="true"||import.meta.env.VITE_ACCOUNT_PROVIDER!=="privy")return <HarborSessionProvider connection={nearConnection}>{children}</HarborSessionProvider>;
  return <Suspense fallback={<section className="familiar-boot" role="status"><p className="boot-brand">familiar.</p><h1>The harbor is on its way.</h1><p>Opening the account connection. Your device preview stays separate.</p><a href="">Reload Familiar</a></section>}><PrivyProvider>{connection=><HarborSessionProvider connection={connection}>{children}</HarborSessionProvider>}</PrivyProvider></Suspense>;
}
/** Recovery only. Satchel, beacon, Bram and workbench own their reviewed game interactions. */
export function HarborAccountPanel() {
  const controller=useContext(Context);useHarborSession();if(!controller)throw Error("Missing harbor controller.");
  const {state}=controller;
  const [unbound,setUnbound]=useState(false),[username,setUsername]=useState(""),[availability,setAvailability]=useState<UsernameAvailability|null>(null),[busy,setBusy]=useState(false),[problem,setProblem]=useState("");
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  async function act(work:()=>Promise<unknown>) {setBusy(true);setProblem("");try{await work();}catch(error){if(alive.current)setProblem(error instanceof Error?error.message:"The original harbor could not be checked.");}finally{if(alive.current)setBusy(false);}}
  function downloadMemories(){try{const url=URL.createObjectURL(new Blob([controller!.exportReturns()],{type:"application/json"})),link=document.createElement("a");link.href=url;link.download="familiar-return-memories.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),0);}catch{setProblem("The return memories could not be exported. Their original browser records are preserved.");}}
  const blocked=busy||state.busy,checked=availability?.username===username&&availability.available;
  return <section aria-label="Account and recovery" className="ex-account">
    <h2>Your saved harbor</h2>
    {state.binding?<>
      <p>{state.binding.nearAccountId} · NEAR testnet</p>
      <p>Signing in keeps the device preview separate. Choose the saved harbor before starting a recorded outing.</p>
      <button disabled={blocked} onClick={()=>void act(()=>controller.selectSaved())}>Use saved harbor</button>
      <button disabled={blocked} onClick={()=>{try{controller.selectPreview();}catch(error){setProblem(error instanceof Error?error.message:"Finish the current outing first.");}}}>Stay in device preview</button>
      {state.snapshot?.pets.length?<p>Mochi is home · confirmed for this saved account.</p>:null}
      {state.mode==="saved"&&state.snapshot&&!state.snapshot.pets.length&&<button disabled={blocked||!!state.pending} onClick={()=>void act(()=>controller.review({kind:"adopt"}))}>Bring Mochi home</button>}
      <button onClick={()=>void act(()=>controller.signOut())}>Sign out</button>
    </>:<>
      <p>Use the same recoverable identity on each device. Login never creates another wallet or merges your memories.</p>
      {!controller.configured&&<p>Saving across devices is not connected at this address. Keep playing in the device preview.</p>}
      <button disabled={blocked||!controller.configured} onClick={()=>void act(async()=>{const binding=await controller.authenticate();if(alive.current)setUnbound(!binding);})}>{import.meta.env.VITE_ACCOUNT_PROVIDER==="privy"?"Continue with email":"Continue with Google"}</button>
      {unbound&&<form onSubmit={event=>{event.preventDefault();if(checked)void act(async()=>{await controller.provisionPlayer(username);if(alive.current)setUnbound(false);});}}>
        <label>Choose a username<input value={username} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={24} onChange={event=>{setUsername(event.target.value);setAvailability(null);}}/></label>
        <button type="button" disabled={blocked||!validName(username)} onClick={()=>void act(async()=>{const result=await controller.checkUsername(username);if(alive.current)setAvailability(result);})}>Check availability</button>
        {availability&&<p>{availability.accountId} · {availability.available?"available now":"unavailable"}</p>}
        <button disabled={blocked||!checked}>Create my testnet player</button>
        <button type="button" onClick={()=>void act(async()=>{await controller.signOut();if(alive.current)setUnbound(false);})}>Sign out</button>
      </form>}
    </>}
    {state.pending&&<section aria-label="Original pending request"><h3>Keep the original request</h3><p>{state.pending.method} · {state.pending.state}. It has not authorized another payment or item.</p>
      <button disabled={blocked} onClick={()=>void act(()=>state.pending?.state==="submitted"?controller.checkOriginal():controller.resumeOriginal())}>{state.pending.state==="submitted"?"Check original receipt":"Resume original action"}</button>
      <button disabled={blocked} onClick={()=>void act(()=>controller.resolveExpired())}>Check permanent expiry</button><p>Only proven expiry with an unused nonce can clear its local envelope. No contract reservation or Shell refund is inferred.</p>
    </section>}
    {!state.courtSupported&&state.binding&&<p>The current contracts do not yet advertise both sides of the new expedition. Existing Mochi, earned items and pending requests stay intact. New returns remain private memories.</p>}
    <details><summary>Return memories</summary><p>A copy of this branch’s returned expeditions, without credentials or signed requests.</p><button onClick={downloadMemories}>Download return memories</button></details>
    {(problem||state.message)&&<p role="status">{problem||state.message}</p>}
  </section>;
}
