import { actions, base64Decode, base64Encode, baseDecode, baseEncode, createTransaction, decodeSignedTransaction, encodeTransaction, JsonRpcProvider, KeyType, PublicKey, Signature, SignedTransaction, type Transaction } from "near-api-js";
import type { RecoverableAccountAdapter, PendingAuthorization } from "./adapter";
import { isPlayerAccount, usernameAccountId, UsernameError, usernameErrors, type UsernameAvailability } from "./names";
import type { PlayerBinding } from "../tidebound/domain";
import { assertTideboundProtocol } from "../tidebound/protocol";
import { validateNativeIntent } from "../../../services/relayer/src/auth/sign";
import { normalizePrivyNearKey } from "./privy-key";

export interface PrivyLinkedWallet {
  id?:string|null; address:string; chainType:string; walletClientType?:string;
  userCanSign:boolean; imported:boolean; recoveryMethod?:string; publicKey?:string;
}
export interface PrivyIdentity { id:string; wallets:readonly PrivyLinkedWallet[] }
export interface PrivySessionPort {
  waitUntilReady():Promise<void>;
  identity():PrivyIdentity|null;
  login():Promise<void>;
  logout():Promise<void>;
  refreshUser():Promise<PrivyIdentity>;
  accessToken():Promise<string|null>;
  signHash(address:string,hash:`0x${string}`):Promise<`0x${string}`>;
}
export interface PrivyWalletBinding { walletId:string; implicitAddress:string; publicKey:string }
export interface PrivyAccountOptions {
  appId:string; root:string; items:string; session:PrivySessionPort;
  provider:Pick<JsonRpcProvider,"getNetworkId"|"callFunction"|"viewAccessKey">;
  storage:Pick<Storage,"getItem"|"setItem">;
  wallet(create:boolean,token:string):Promise<{wallet:PrivyWalletBinding|null}>;
  player(username:string,token:string):Promise<{accountId:string;root:string;network:string}>;
  availability(username:string):Promise<UsernameAvailability>;
}
function check(value:unknown,message:string):asserts value { if(!value)throw Error(message); }
const hex=(bytes:Uint8Array)=>[...bytes].map(n=>n.toString(16).padStart(2,"0")).join("");
export async function nearSigningDigest(transaction:Transaction) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256",new Uint8Array(encodeTransaction(transaction))));
}
export function privyWalletKey(wallet:PrivyWalletBinding):PublicKey {
  check(wallet && typeof wallet.walletId==="string" && /^[A-Za-z0-9_-]{1,128}$/.test(wallet.walletId) && /^[a-f0-9]{64}$/.test(wallet.implicitAddress),"The canonical Privy NEAR wallet is malformed. No replacement was created.");
  const key=PublicKey.fromString(wallet.publicKey);
  const implicit=new Uint8Array(wallet.implicitAddress.match(/../g)!.map(n=>Number.parseInt(n,16)));
  check(key.keyType===KeyType.ED25519 && key.toString()===`ed25519:${baseEncode(implicit)}`,"The wallet's NEAR public key does not match its implicit address.");
  return key;
}
function linkedPublicKeyMatches(value:string,key:PublicKey) {
  try{return normalizePrivyNearKey(value).publicKey===key.toString();}catch{return false;}
}
export function verifyPrivyWalletOwner(identity:PrivyIdentity,wallet:PrivyWalletBinding) {
  const key=privyWalletKey(wallet);
  const linked=identity.wallets.filter(w=>w.id===wallet.walletId);
  check(linked.length===1 && linked[0]!.address===wallet.implicitAddress && linked[0]!.chainType==="near" && linked[0]!.walletClientType==="privy" && linked[0]!.userCanSign===true && !linked[0]!.imported && linked[0]!.recoveryMethod==="privy-v2" && (!linked[0]!.publicKey || linkedPublicKeyMatches(linked[0]!.publicKey,key)),"This canonical wallet is not a user-owned NEAR wallet for the signed-in identity. Keep the existing account; do not create another wallet.");
  return key;
}
function signatureBytes(signature:string):Uint8Array {
  check(/^0x[a-fA-F0-9]{128}$/.test(signature),"Privy returned an unsupported NEAR signature.");
  return new Uint8Array(signature.slice(2).match(/../g)!.map(n=>Number.parseInt(n,16)));
}

/** Privy authenticates; the root's public-key mapping remains the NEAR account authority. */
export class PrivyAccountAdapter implements RecoverableAccountAdapter {
  private generation=0;
  private signedOut=false;
  private provisioning:{username:string;result:Promise<PlayerBinding>}|null=null;
  constructor(readonly options:PrivyAccountOptions) {}
  get accountRoot(){return this.options.root;}
  private async identity() {
    await this.options.session.waitUntilReady();
    return this.signedOut?null:this.options.session.identity();
  }
  private sameIdentity(id:string,generation=this.generation) {
    check(!this.signedOut && this.generation===generation && this.options.session.identity()?.id===id,"The sign-in changed. The original account and pending action were preserved.");
  }
  private async token(identity:PrivyIdentity) {
    const token=await this.options.session.accessToken();this.sameIdentity(identity.id);
    check(token,"Sign in again before requesting your canonical wallet.");return token;
  }
  /** Independent of root deployment, for explicit wallet setup and the sign-only recovery spike. */
  async canonicalWallet(create=false):Promise<PrivyWalletBinding|null> {
    const identity=await this.identity();if(!identity)return null;
    const generation=this.generation,token=await this.token(identity);
    const response=await this.options.wallet(create,token);this.sameIdentity(identity.id,generation);
    if(response.wallet===null)return null;
    privyWalletKey(response.wallet);
    const refreshed=await this.options.session.refreshUser();this.sameIdentity(identity.id,generation);
    check(refreshed.id===identity.id,"The Privy identity changed while reading the wallet.");
    verifyPrivyWalletOwner(refreshed,response.wallet);
    return response.wallet;
  }
  async authenticateWallet() {
    this.signedOut=false;await this.options.session.waitUntilReady();
    if(!this.options.session.identity())await this.options.session.login();
    check(this.options.session.identity(),"Sign-in was canceled. Your local preview is unchanged.");
    return this.canonicalWallet(false);
  }
  private async network() {
    check(this.options.appId && this.options.root.endsWith(".testnet") && this.options.items===`items.${this.options.root}` && await this.options.provider.getNetworkId()==="testnet","This account is configured for the selected NEAR testnet harbor only.");
  }
  private async compatibleStack() {
    await this.network();
    const [root,items]=await Promise.all([
      this.options.provider.callFunction<{registry:string;items:string;network:string;rules_version:string;content_version:string}>({contractId:this.options.root,method:"tidebound_protocol",args:{},blockQuery:{finality:"final"}}),
      this.options.provider.callFunction({contractId:this.options.items,method:"craft_protocol",args:{},blockQuery:{finality:"final"}}),
    ]);
    assertTideboundProtocol(this.options.root,root,items,"The compatible Tidebound harbor is not deployed here. Your recovery wallet is unchanged.");
  }
  async restoreSession() {return this.resolveBinding();}
  async authenticate() {await this.authenticateWallet();return this.resolveBinding();}
  async resolveBinding():Promise<PlayerBinding|null> {
    const identity=await this.identity();if(!identity)return null;
    const generation=this.generation,wallet=await this.canonicalWallet(false);if(!wallet)return null;
    await this.network();
    const account=await this.options.provider.callFunction<string>({contractId:this.options.root,method:"get_player",args:{public_key:wallet.publicKey},blockQuery:{finality:"final"}});
    this.sameIdentity(identity.id,generation);if(account===null || account===undefined || account==="")return null;
    check(isPlayerAccount(account,this.options.root),"The wallet is bound to a different harbor.");
    const access=await this.options.provider.viewAccessKey({accountId:account,publicKey:privyWalletKey(wallet),finalityQuery:{finality:"final"}});
    this.sameIdentity(identity.id,generation);check(access.permission==="FullAccess","The canonical wallet no longer controls this NEAR account.");
    return {playerId:`testnet:${this.options.root}:${account}`,network:"testnet",nearAccountId:account,signerPublicKey:wallet.publicKey,signerBindingId:`privy:${this.options.appId}:${wallet.walletId}`};
  }
  async checkUsername(username:string) {
    await this.network();const accountId=usernameAccountId(username,this.options.root);
    const result=await this.options.availability(username);
    check(result?.username===username && result.accountId===accountId && result.root===this.options.root && result.network==="testnet" && typeof result.available==="boolean","The username check belongs to a different harbor.");return result;
  }
  async provisionAccount(username:string):Promise<PlayerBinding> {
    usernameAccountId(username,this.options.root);
    if(this.provisioning){if(this.provisioning.username!==username)throw new UsernameError("ERR_USERNAME_PENDING");return this.provisioning.result;}
    const result=(async()=>{
      const existing=await this.resolveBinding();if(existing)return existing;
      await this.compatibleStack();
      const identity=await this.identity();check(identity,"Sign in before creating a player.");const generation=this.generation;
      const wallet=await this.canonicalWallet(true);check(wallet,"Your canonical wallet could not be confirmed. Check it before trying player creation again.");
      const created=await this.options.player(username,await this.token(identity));this.sameIdentity(identity.id,generation);
      check(created.root===this.options.root && created.network==="testnet" && isPlayerAccount(created.accountId,this.options.root),"Player creation returned a different harbor. Preserve the original request.");
      const binding=await this.resolveBinding();check(binding?.nearAccountId===created.accountId && binding.signerPublicKey===wallet.publicKey,"Player creation is still being checked. Sign in again to resolve the same account.");return binding;
    })();
    this.provisioning={username,result};try{return await result}finally{this.provisioning=null;}
  }
  private pendingKey(operationId:string,binding:PlayerBinding) {
    check(/^[A-Za-z0-9:_-]{1,128}$/.test(operationId),"The signing operation is invalid.");
    return `familiar.privy.authorization.v1:${this.options.appId}:${this.options.root}:${binding.nearAccountId}:${operationId}`;
  }
  async authorizeNative(transaction:Transaction,operationId:string):Promise<SignedTransaction> {
    const identity=await this.identity(),generation=this.generation,binding=await this.resolveBinding();
    check(identity && binding,"Sign in to authorize this action.");
    const wallet=await this.canonicalWallet(false);check(wallet,"The canonical recovery wallet is unavailable.");
    check(transaction.signerId===binding.nearAccountId && transaction.publicKey.toString()===binding.signerPublicKey && [this.options.root,this.options.items,binding.nearAccountId].includes(transaction.receiverId),"The native transaction belongs to a different account or harbor.");
    validateNativeIntent(transaction,{root:this.options.root,items:this.options.items});
    const encoded=base64Encode(encodeTransaction(transaction)),digest=await nearSigningDigest(transaction),key=this.pendingKey(operationId,binding);
    const raw=this.options.storage.getItem(key),pending:PendingAuthorization=raw?JSON.parse(raw):{operationId,transaction:encoded,state:"prepared"};
    check(pending.operationId===operationId && pending.transaction===encoded && ["prepared","signed","submitted"].includes(pending.state),"This operation already contains a different transaction. Preserve the original action.");
    check(pending.state!=="submitted","This action was submitted. Check its original receipt before another signature.");
    const verify=(signed:SignedTransaction)=>{
      check(base64Encode(encodeTransaction(signed.transaction))===encoded && signed.signature.ed25519Signature && transaction.publicKey.verify(digest,new Uint8Array(signed.signature.ed25519Signature.data)),"The signature does not match the original NEAR transaction.");return signed;
    };
    this.sameIdentity(identity.id,generation);
    if(pending.signedTransaction)return verify(decodeSignedTransaction(base64Decode(pending.signedTransaction)));
    const access=await this.options.provider.viewAccessKey({accountId:binding.nearAccountId,publicKey:transaction.publicKey,finalityQuery:{finality:"final"}});
    check(access.permission==="FullAccess" && access.nonce<transaction.nonce,"The signing nonce changed. Reconcile the original action.");
    this.sameIdentity(identity.id,generation);this.options.storage.setItem(key,JSON.stringify(pending));
    const signature=await this.options.session.signHash(wallet.implicitAddress,`0x${hex(digest)}`);this.sameIdentity(identity.id,generation);
    const current=await this.options.provider.viewAccessKey({accountId:binding.nearAccountId,publicKey:transaction.publicKey,finalityQuery:{finality:"final"}});
    check(current.permission==="FullAccess" && current.nonce<transaction.nonce,"The signing nonce changed. Reconcile the original action.");
    this.sameIdentity(identity.id,generation);
    const signed=verify(new SignedTransaction({transaction,signature:new Signature({keyType:KeyType.ED25519,data:signatureBytes(signature)})}));
    check(this.options.storage.getItem(key)===JSON.stringify(pending),"Another tab changed this signing operation. Preserve the original action.");
    this.options.storage.setItem(key,JSON.stringify({...pending,state:"signed",signedTransaction:base64Encode(signed.encode())}));return signed;
  }
  markSubmitted(operationId:string,binding:PlayerBinding) {
    const identity=this.options.session.identity();
    check(!this.signedOut && identity,"Sign-in ended before this action was submitted. Its original envelope remains available.");
    const wallet=identity.wallets.find(w=>w.id && binding.signerBindingId===`privy:${this.options.appId}:${w.id}`);
    check(wallet?.id,"The signing identity changed before submission. Preserve the original action.");
    verifyPrivyWalletOwner(identity,{walletId:wallet.id,implicitAddress:wallet.address,publicKey:binding.signerPublicKey});
    check(binding.network==="testnet" && isPlayerAccount(binding.nearAccountId,this.options.root),"The submitted action belongs to another harbor.");
    const key=this.pendingKey(operationId,binding),raw=this.options.storage.getItem(key);check(raw,"The original signing record is missing.");
    const pending:PendingAuthorization=JSON.parse(raw);check(pending.operationId===operationId && ["signed","submitted"].includes(pending.state),"The original action has not been signed.");
    this.options.storage.setItem(key,JSON.stringify({...pending,state:"submitted"}));
  }
  async endSession(){this.generation++;this.signedOut=true;await this.options.session.logout();}
}

export interface PrivyConnection {adapter:PrivyAccountAdapter;provider:JsonRpcProvider}
export interface PrivyConnectionConfig {appId:string;root:string;rpcUrl:string;relayerUrl:string}
const privyMessages:Record<string,string>={
  ERR_PRIVY_SESSION:"Sign in again with the same email before checking this wallet.",
  ERR_PRIVY_OWNER:"This wallet's user ownership could not be verified. No replacement was created.",
  ERR_PRIVY_WALLET:"The canonical NEAR wallet could not be verified. Keep its original reference.",
  ERR_PRIVY_UNAVAILABLE:"The Privy account service is unavailable. Your local preview is safe.",
  ERR_PRIVY_CREATE_UNKNOWN:"Wallet creation is still uncertain. Check the existing canonical wallet; do not create a replacement.",
};
export function createPrivyConnection(config:PrivyConnectionConfig,session:PrivySessionPort):PrivyConnection {
  const provider=new JsonRpcProvider({url:config.rpcUrl}),base=config.relayerUrl.replace(/\/$/,"");
  async function read<T>(response:Response):Promise<T> {
    const body=await response.json().catch(()=>null);
    if(!response.ok){if(typeof body?.code==="string" && Object.hasOwn(usernameErrors,body.code))throw new UsernameError(body.code as keyof typeof usernameErrors);throw Error(privyMessages[body?.code]??"The account service could not confirm the original request. Check the same wallet before trying again.");}
    return body as T;
  }
  const post=<T,>(path:string,body:unknown,token:string)=>fetch(`${base}${path}`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)}).then(read<T>);
  return {provider,adapter:new PrivyAccountAdapter({...config,items:`items.${config.root}`,provider,session,storage:globalThis.localStorage,
    wallet:(create,token)=>post("/v1/privy/wallet",{create},token),player:(username,token)=>post("/v1/privy/player",{username},token),
    availability:username=>fetch(`${base}/v1/player-name/${encodeURIComponent(username)}`,{signal:AbortSignal.timeout(15000)}).then(read<UsernameAvailability>),
  })};
}

export interface PrivySignatureProof {
  version:1;kind:"signature-only";network:"testnet";walletId:string;implicitAddress:string;publicKey:string;
  digestHex:string;transactionHash:string;signatureHex:string;verified:true;broadcast:false;createdAt:string;
}
/** Read-only RPC plus user-authorized raw signing. There is deliberately no broadcast capability. */
export async function signPrivyRecoveryProof(wallet:PrivyWalletBinding,session:PrivySessionPort,provider:Pick<JsonRpcProvider,"getNetworkId"|"viewBlock">,storage:Pick<Storage,"getItem"|"setItem">):Promise<PrivySignatureProof> {
  await session.waitUntilReady();const identity=session.identity();check(identity,"Sign in before signing a recovery proof.");
  const key=verifyPrivyWalletOwner(identity,wallet);check(await provider.getNetworkId()==="testnet","The proof must use the NEAR testnet RPC.");
  const block=await provider.viewBlock({finality:"final"});
  const transaction=createTransaction(wallet.implicitAddress,key,wallet.implicitAddress,1n,[actions.transfer(0n)],baseDecode(block.header.hash));
  const bytes=encodeTransaction(transaction),digest=await nearSigningDigest(transaction),digestHex=`0x${hex(digest)}` as const;
  const storageKey=`familiar.privy.sign-only.v1:${wallet.walletId}`;
  storage.setItem(storageKey,JSON.stringify({version:1,network:"testnet",walletId:wallet.walletId,transaction:base64Encode(bytes),digestHex,state:"prepared"}));
  const signature=await session.signHash(wallet.implicitAddress,digestHex);
  check(session.identity()?.id===identity.id,"Sign-in changed while the proof was being signed.");
  verifyPrivyWalletOwner(session.identity()!,wallet);
  check(key.verify(digest,signatureBytes(signature)),"The returned signature does not verify against this wallet's NEAR key.");
  const proof:PrivySignatureProof={version:1,kind:"signature-only",network:"testnet",walletId:wallet.walletId,implicitAddress:wallet.implicitAddress,publicKey:wallet.publicKey,digestHex,transactionHash:baseEncode(digest),signatureHex:signature,verified:true,broadcast:false,createdAt:new Date().toISOString()};
  storage.setItem(storageKey,JSON.stringify({...proof,state:"signed"}));return proof;
}
