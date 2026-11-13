import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { PrivyProvider as PrivySdkProvider, useLogin, usePrivy, useUser, type User } from "@privy-io/react-auth";
import { useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { createPrivyConnection, type PrivyConnection, type PrivyIdentity, type PrivySessionPort } from "./privy-adapter";

interface Props { children:(connection:PrivyConnection|null,session:PrivySessionPort|null)=>ReactNode }
function identity(user:User|null):PrivyIdentity|null {
  if(!user)return null;
  return {id:user.id,wallets:user.linkedAccounts.flatMap(account=>account.type==="wallet" ? [{
    id:account.id,address:account.address,chainType:account.chainType,walletClientType:account.walletClientType,
    userCanSign:account.userCanSign,imported:account.imported,recoveryMethod:account.recoveryMethod,publicKey:account.publicKey,
  }] : [])};
}
function PrivyBridge({children,appId}:{children:Props["children"];appId:string}) {
  const sdk=usePrivy(),{refreshUser}=useUser(),{signRawHash}=useSignRawHash();
  const latest=useRef({sdk,refreshUser,signRawHash});latest.current={sdk,refreshUser,signRawHash};
  const owner=useRef<PrivyIdentity|null>(identity(sdk.user));
  const ready=useRef(new Set<{resolve:()=>void;reject:(error:Error)=>void}>());
  const loginPending=useRef<{promise:Promise<void>;resolve:()=>void;reject:(error:Error)=>void;generation:number}|null>(null);
  const alive=useRef(true);
  const generation=useRef(0);
  function assertOpen(expected=generation.current) {
    if(!alive.current || expected!==generation.current)throw Error("The account surface was closed. Its original state is preserved.");
  }
  const {login}=useLogin({
    onComplete:({user})=>{
      const pending=loginPending.current;if(!alive.current || !pending || pending.generation!==generation.current)return;
      owner.current=identity(user);pending.resolve();loginPending.current=null;
    },
    onError:()=>{if(!alive.current)return;loginPending.current?.reject(Error("Sign-in did not finish. Your local preview and original wallet are unchanged."));loginPending.current=null;},
  });
  const loginRef=useRef(login);loginRef.current=login;
  useEffect(()=>{
    if(!alive.current)return;
    owner.current=identity(sdk.user);
    if(sdk.ready || sdk.error){for(const wait of ready.current)sdk.error?wait.reject(Error("Privy could not initialize at this address.")):wait.resolve();ready.current.clear();}
  },[sdk.ready,sdk.user,sdk.error]);
  useEffect(()=>{
    alive.current=true;owner.current=identity(latest.current.sdk.user);
    return ()=>{alive.current=false;generation.current++;owner.current=null;const error=Error("The account surface was closed. Its original state is preserved.");for(const wait of ready.current)wait.reject(error);ready.current.clear();loginPending.current?.reject(error);loginPending.current=null;};
  },[]);
  const session=useMemo<PrivySessionPort>(()=>({
    waitUntilReady(){
      if(!alive.current)return Promise.reject(Error("The account surface is closed."));
      if(latest.current.sdk.error)return Promise.reject(Error("Privy could not initialize at this address."));
      if(latest.current.sdk.ready)return Promise.resolve();
      return new Promise<void>((resolve,reject)=>{ready.current.add({resolve,reject});});
    },
    identity:()=>alive.current?owner.current:null,
    async login(){
      assertOpen();
      if(owner.current)return;
      if(loginPending.current)return loginPending.current.promise;
      let resolve!:()=>void,reject!:(error:Error)=>void;
      const promise=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});loginPending.current={promise,resolve,reject,generation:generation.current};
      try{loginRef.current({loginMethods:["email"]});}catch{loginPending.current=null;throw Error("Sign-in could not open at this address.");}
      return promise;
    },
    async logout(){assertOpen();generation.current++;owner.current=null;try{await latest.current.sdk.logout();}catch{throw Error("Privy could not end this session. Retry sign out.");}finally{owner.current=null;}},
    async refreshUser(){
      assertOpen();const expected=generation.current;
      let refreshed:User;try{refreshed=await latest.current.refreshUser();}catch{throw Error("Your Privy identity could not be refreshed. Keep the original wallet and sign in again.");}
      assertOpen(expected);
      const next=identity(refreshed);if(!next)throw Error("The signed-in identity is unavailable.");owner.current=next;return next;
    },
    async accessToken(){
      assertOpen();const expected=generation.current;
      let token:string|null;try{token=await latest.current.sdk.getAccessToken();}catch{throw Error("Your Privy session expired. Sign in again with the same identity.");}
      assertOpen(expected);return token;
    },
    async signHash(address,hash){
      assertOpen();const expected=generation.current;
      let signature:`0x${string}`;
      try{signature=(await latest.current.signRawHash({address,chainType:"near",hash})).signature;}
      catch{throw Error("Privy did not authorize the original signature. Its saved payload is unchanged.");}
      assertOpen(expected);return signature;
    },
  }),[]);
  const connection=useMemo(()=>{
    try{return createPrivyConnection({appId,root:import.meta.env.VITE_NEAR_ROOT??"",rpcUrl:import.meta.env.VITE_NEAR_RPC_URL??"https://test.rpc.fastnear.com",relayerUrl:import.meta.env.VITE_RELAYER_URL??"/api"},session);}
    catch{return null;}
  },[appId,session]);
  return children(connection,session);
}

/** Email is the single initial route. Additional account linking is never automatic here. */
export function PrivyAccountProvider({children}:Props) {
  const appId=import.meta.env.VITE_PRIVY_APP_ID??"",clientId=import.meta.env.VITE_PRIVY_CLIENT_ID;
  if(!appId)return children(null,null);
  return <PrivySdkProvider appId={appId} clientId={clientId||undefined} config={{
    loginMethods:["email"],embeddedWallets:{ethereum:{createOnLogin:"off"},solana:{createOnLogin:"off"}},
    appearance:{theme:"light",accentColor:"#3f6855",logo:"/icons/mochi-192.png"},
  }}><PrivyBridge appId={appId}>{children}</PrivyBridge></PrivySdkProvider>;
}
