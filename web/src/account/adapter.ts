import { base64Decode, base64Encode, decodeSignedTransaction, encodeTransaction, KeyType, PublicKey, Signature, SignedTransaction, type JsonRpcProvider, type Transaction } from "near-api-js";
import type { GoogleSession } from "../auth";
import type { PlayerBinding } from "../tidebound/domain";
import { AUTH_ISSUER, validateAuthRequest } from "./signing-request";

export type AccountSession = GoogleSession & { endSession():Promise<void> };
export interface CredentialBinding { namespace:"near-auth"; issuer:string; subject:string; kind:"google"|"email"|"synced-passkey"; signerBindingId:string }
export interface PlayerIdentityRecord { playerId:string; credentials:readonly CredentialBinding[]; wallets:readonly PlayerBinding[] }
export interface PendingAuthorization { operationId:string; transaction:string; state:"prepared"|"signed"|"submitted"; signedTransaction?:string }
export interface RecoverableAccountAdapter {
  restoreSession():Promise<PlayerBinding|null>;
  authenticate():Promise<PlayerBinding|null>;
  resolveBinding():Promise<PlayerBinding|null>;
  provisionAccount():Promise<PlayerBinding>;
  authorizeNative(transaction:Transaction,operationId:string):Promise<SignedTransaction>;
  endSession():Promise<void>;
}
export interface NearAuthAdapterOptions {
  root:string; items:string; clientId:string; origin:string; approvedOrigin:string;
  provider:Pick<JsonRpcProvider,"getNetworkId"|"callFunction"|"viewAccessKey">;
  storage:Pick<Storage,"getItem"|"setItem">;
  openSession(mode:"authenticate"|"restore"):Promise<AccountSession|null>;
  provision(publicKey:string):Promise<{accountId:string;root:string;network:string}>;
  sponsor(body:{transaction:string;response:unknown}):Promise<unknown>;
}
function check(ok:unknown,message="The recoverable account could not be verified."):asserts ok { if(!ok) throw new Error(message); }
const sharedClient="np8paqIpMWmNbzT4xAvOOapZBjsOpptl";
export function recoverableOriginAvailable(config:Pick<NearAuthAdapterOptions,"origin"|"approvedOrigin"|"clientId">) {
  return !!config.clientId && config.origin===config.approvedOrigin &&
    (config.clientId===sharedClient ? config.origin==="http://localhost:3000" : /^https:\/\//.test(config.origin));
}
/** The chain's public-key mapping is canonical; browser storage holds pending payloads, never wallet keys. */
export class NearAuthAccountAdapter implements RecoverableAccountAdapter {
  private session:AccountSession|null=null;
  private provisioning:Promise<PlayerBinding>|null=null;
  constructor(private readonly options:NearAuthAdapterOptions) {}
  private async network() {
    const o=this.options;
    check(recoverableOriginAvailable(o),"Google sign-in is not configured for this address.");
    check(o.root.endsWith(".testnet") && o.items===`items.${o.root}` && await o.provider.getNetworkId()==="testnet","This account is configured for NEAR testnet only.");
  }
  async restoreSession() {
    await this.network();
    this.session=await this.options.openSession("restore");
    return this.resolveBinding();
  }
  async authenticate() {
    await this.network();
    this.session=await this.options.openSession("authenticate");
    check(this.session,"Sign-in was canceled. Your local preview is unchanged.");
    return this.resolveBinding();
  }
  async resolveBinding():Promise<PlayerBinding|null> {
    if(!this.session) return null;
    await this.network();
    const session=this.session,key=PublicKey.fromString(session.publicKey);
    check(key.keyType===KeyType.ED25519 && session.clientId===this.options.clientId && /^google-oauth2\|[^#]{1,240}$/.test(session.userId));
    const account=await this.options.provider.callFunction<string>({contractId:this.options.root,method:"get_player",args:{public_key:session.publicKey},blockQuery:{finality:"final"}});
    if(!account) return null;
    check(typeof account==="string" && account.endsWith(`.${this.options.root}`) && /^p-[0-9]+$/.test(account.slice(0,-this.options.root.length-1)));
    const access=await this.options.provider.viewAccessKey({accountId:account,publicKey:key,finalityQuery:{finality:"final"}});
    check(access.permission==="FullAccess");
    return {playerId:`testnet:${this.options.root}:${account}`,network:"testnet",nearAccountId:account,signerPublicKey:session.publicKey,signerBindingId:`jwt#${AUTH_ISSUER}#${session.userId}`};
  }
  async provisionAccount():Promise<PlayerBinding> {
    if(this.provisioning) return this.provisioning;
    this.provisioning=(async()=>{
      const existing=await this.resolveBinding();if(existing) return existing;
      check(this.session,"Sign in before creating an account.");
      const created=await this.options.provision(this.session.publicKey);
      check(created.network==="testnet" && created.root===this.options.root);
      const binding=await this.resolveBinding();check(binding?.nearAccountId===created.accountId);
      return binding;
    })();
    try{return await this.provisioning}finally{this.provisioning=null}
  }
  private pendingKey(operationId:string,binding:PlayerBinding) {
    check(/^[a-zA-Z0-9:_-]{1,128}$/.test(operationId));
    return `familiar.auth.pending.v1:${this.options.root}:${binding.nearAccountId}:${operationId}`;
  }
  async authorizeNative(transaction:Transaction,operationId:string):Promise<SignedTransaction> {
    const binding=await this.resolveBinding();check(binding && this.session,"Sign in to authorize this action.");
    check(transaction.signerId===binding.nearAccountId && transaction.publicKey.toString()===binding.signerPublicKey);
    check(transaction.receiverId===this.options.root || transaction.receiverId===this.options.items || transaction.receiverId===binding.nearAccountId,"The action belongs to a different harbor.");
    const bytes=encodeTransaction(transaction),encoded=base64Encode(bytes),key=this.pendingKey(operationId,binding);
    const stored=this.options.storage.getItem(key);
    const pending:PendingAuthorization=stored?JSON.parse(stored):{operationId,transaction:encoded,state:"prepared"};
    check(pending.operationId===operationId && pending.transaction===encoded,"This operation already has a different action. Keep the original operation.");
    check(pending.state==="prepared" || pending.state==="signed" || pending.state==="submitted");
    check(pending.state!=="submitted","This action was submitted; reconcile its original transaction before another signature.");
    const verify=async(signed:SignedTransaction)=>{
      check(signed.signature.ed25519Signature);
      const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(bytes)));
      check(base64Encode(encodeTransaction(signed.transaction))===encoded && transaction.publicKey.verify(hash,new Uint8Array(signed.signature.ed25519Signature.data)),"The returned signature does not match this action.");
      return signed;
    };
    if(pending.signedTransaction) return verify(decodeSignedTransaction(base64Decode(pending.signedTransaction)));
    const access=await this.options.provider.viewAccessKey({accountId:binding.nearAccountId,publicKey:transaction.publicKey,finalityQuery:{finality:"final"}});
    check(access.permission==="FullAccess" && access.nonce<transaction.nonce,"The signing nonce changed. Reconcile the original operation.");
    this.options.storage.setItem(key,JSON.stringify(pending));
    const response=await this.session.requestSignature(bytes);
    validateAuthRequest(response,bytes,this.session);
    const payload=await this.options.sponsor({transaction:encoded,response});
    const signature=this.session.signatureBytes(payload);
    check(signature.length===64);
    const current=await this.options.provider.viewAccessKey({accountId:binding.nearAccountId,publicKey:transaction.publicKey,finalityQuery:{finality:"final"}});
    check(current.permission==="FullAccess" && current.nonce<transaction.nonce,"The signing nonce changed. Reconcile the original operation.");
    const signed=await verify(new SignedTransaction({transaction,signature:new Signature({keyType:KeyType.ED25519,data:signature})}));
    this.options.storage.setItem(key,JSON.stringify({...pending,state:"signed",signedTransaction:base64Encode(signed.encode())}));
    return signed;
  }
  markSubmitted(operationId:string,binding:PlayerBinding) {
    check(this.session);
    const account=binding.nearAccountId;
    const prefix=`familiar.auth.pending.v1:${this.options.root}:`;
    check(account,"Pass the confirmed player binding when marking an action submitted.");
    const key=`${prefix}${account}:${operationId}`,raw=this.options.storage.getItem(key);check(raw);
    const pending:PendingAuthorization=JSON.parse(raw);check(pending.operationId===operationId && (pending.state==="signed" || pending.state==="submitted"));
    this.options.storage.setItem(key,JSON.stringify({...pending,state:"submitted"}));
  }
  async endSession() {
    const session=this.session;this.session=null;
    if(session) await session.endSession();
  }
}
