import { createHash } from "node:crypto";
import { NotFoundError, PrivyClient, type VerifyAccessTokenResponse, type PrivyClientOptions } from "@privy-io/node";
import { Quota } from "../relay";
import { normalizePrivyNearKey } from "../../../../web/src/account/privy-key";

export type PrivyWallet = {walletId:string;implicitAddress:string;publicKey:string};
export class PrivyBridgeError extends Error {
  constructor(readonly code:"ERR_PRIVY_SESSION"|"ERR_PRIVY_OWNER"|"ERR_PRIVY_WALLET"|"ERR_PRIVY_UNAVAILABLE"|"ERR_PRIVY_CREATE_UNKNOWN"|"ERR_QUOTA") { super(code); }
}
/** Deliberately excludes signing, export, ownership changes and wallet enumeration. */
export interface PrivyBoundary {
  verifyAccessToken(token:string):Promise<VerifyAccessTokenResponse>;
  getWallet(externalId:string):Promise<unknown|null>;
  createWallet(input:{chain_type:"near";owner:{user_id:string};external_id:string;idempotency_key:string}):Promise<unknown>;
  getUser(userId:string):Promise<unknown>;
}
export interface PrivyService { wallet(token:string,create:boolean):Promise<PrivyWallet|null> }
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
export function privyExternalId(appId:string,userId:string) {
  return `familiar_near_${createHash("sha256").update(JSON.stringify([appId,userId,"near"])).digest("base64url")}`;
}
function normalizedKey(value:unknown):{publicKey:string;implicitAddress:string} {
  try{return normalizePrivyNearKey(value);}catch{throw new PrivyBridgeError("ERR_PRIVY_WALLET");}
}
export function createPrivyService(appId:string,boundary:PrivyBoundary):PrivyService {
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(appId))throw Error("Invalid Privy app configuration.");
  const pending=new Map<string,Promise<PrivyWallet|null>>();
  const creations=new Quota(200,86_400_000,1),userCreations=new Quota(4,3_600_000);
  async function verifiedUser(userId:string) {
    const user=await boundary.getUser(userId);
    if(!object(user)||user.id!==userId||!Array.isArray(user.linked_accounts))throw new PrivyBridgeError("ERR_PRIVY_OWNER");
    return user as Record<string,unknown>&{linked_accounts:unknown[]};
  }
  async function validate(wallet:unknown,userId:string,externalId:string):Promise<PrivyWallet> {
    if(!object(wallet)||wallet.chain_type!=="near"||typeof wallet.id!=="string"||! /^[A-Za-z0-9_-]{1,128}$/.test(wallet.id)||
      typeof wallet.owner_id!=="string"||!wallet.owner_id||wallet.external_id!==externalId||wallet.archived_at!=null)
      throw new PrivyBridgeError("ERR_PRIVY_WALLET");
    const normalized=normalizedKey(wallet.public_key);
    if(wallet.address!==normalized.implicitAddress)throw new PrivyBridgeError("ERR_PRIVY_WALLET");
    const user=await verifiedUser(userId);
    const linked=user.linked_accounts.filter((v):v is Record<string,unknown>=>object(v)&&v.id===wallet.id);
    if(linked.length!==1)throw new PrivyBridgeError("ERR_PRIVY_OWNER");
    const link=linked[0];
    if(link.type!=="wallet"||link.chain_type!=="near"||link.wallet_client_type!=="privy"||link.connector_type!=="embedded"||link.user_can_sign!==true||
      link.address!==normalized.implicitAddress||normalizedKey(link.public_key).publicKey!==normalized.publicKey)
      throw new PrivyBridgeError("ERR_PRIVY_OWNER");
    return {walletId:wallet.id, ...normalized};
  }
  return {async wallet(token,create){
    let claims:VerifyAccessTokenResponse;
    try{claims=await boundary.verifyAccessToken(token);}catch{throw new PrivyBridgeError("ERR_PRIVY_SESSION");}
    const now=Math.floor(Date.now()/1000);
    if(!claims||claims.app_id!==appId||claims.issuer!=="privy.io"||!/^did:privy:[A-Za-z0-9_-]{1,128}$/.test(claims.user_id)||
      !Number.isSafeInteger(claims.expiration)||claims.expiration<=now||!Number.isSafeInteger(claims.issued_at)||claims.issued_at>now+30)
      throw new PrivyBridgeError("ERR_PRIVY_SESSION");
    const userId=claims.user_id,externalId=privyExternalId(appId,userId);
    // Restoring never waits on or initiates a creation. An interrupted create is recovered by the same external ID.
    if(create&&pending.has(externalId))return pending.get(externalId)!;
    const work=(async()=>{
      let wallet=await boundary.getWallet(externalId);
      if(wallet===null&&!create)return null;
      if(wallet===null){
        // Preserve noncanonical wallets from an earlier app integration. Never adopt the first wallet or create a second one silently.
        const user=await verifiedUser(userId);
        if(user.linked_accounts.some(link=>object(link)&&link.type==="wallet"&&link.chain_type==="near"&&
          (link.wallet_client_type==="privy"||link.wallet_client==="privy"||link.connector_type==="embedded")))
          throw new PrivyBridgeError("ERR_PRIVY_WALLET");
        if(!creations.take("all")||!userCreations.take(userId))throw new PrivyBridgeError("ERR_QUOTA");
        try {wallet=await boundary.createWallet({chain_type:"near",owner:{user_id:userId},external_id:externalId,idempotency_key:externalId});}
        catch {
          // Includes conflicts and indeterminate HTTP outcomes. Never invent another ID or retry creation here.
          wallet=await boundary.getWallet(externalId).catch(()=>null);
          if(wallet===null)throw new PrivyBridgeError("ERR_PRIVY_CREATE_UNKNOWN");
        }
      }
      return validate(wallet,userId,externalId);
    })().catch(error=>{if(error instanceof PrivyBridgeError)throw error;throw new PrivyBridgeError("ERR_PRIVY_UNAVAILABLE");});
    if(create){pending.set(externalId,work);try{return await work;}finally{pending.delete(externalId);}}
    return work;
  }};
}
/** SDK-owned JWT verification/JWKS. The server's app secret is never used for signing. */
export function createPrivyBridge(config:{appId:string;appSecret:string},transport:Pick<PrivyClientOptions,"fetch">={}):PrivyService {
  const sdk=new PrivyClient({...config,...transport,maxRetries:0,timeout:15_000});
  return createPrivyService(config.appId,{
    verifyAccessToken:token=>sdk.utils().auth().verifyAccessToken(token),
    getWallet:async externalId=>{try{return await sdk.wallets().get(`ext_wal_${externalId}`);}catch(error){if(error instanceof NotFoundError)return null;throw error;}},
    // The public SDK maps idempotency_key to the HTTP header and removes it from JSON; covered at the fetch boundary.
    createWallet:input=>sdk.wallets().create(input),
    getUser:userId=>sdk.users()._get(userId),
  });
}
