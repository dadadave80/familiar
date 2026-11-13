/** Harbor records: each line states only what one live public read showed. */
export type Read<T=unknown>={ok:true;value:T}|{ok:false};
export interface RecordLine {text:string;detail?:string;state:"read"|"unchecked"|"finding"|"source"}
export interface HarborRecord {kind:"self"|"key"|"referee"|"admin";title:string;lines:RecordLine[]}
export interface RecordsTarget {rpcUrl:string;root:string;player:string;pet:string;signerKey:string;provider:"privy"|"other"}

/** Mirrors validateNativeIntent in services/relayer/src/auth/sign.ts; records.test.ts keeps the two in step. */
export const SIGNER_ACTIONS:readonly {receiver:"root"|"items"|"self";method:string;label:string}[]=[
  {receiver:"root",method:"adopt",label:"bring Mochi home"},
  {receiver:"root",method:"tidebound_claim",label:"record a return"},
  {receiver:"root",method:"tidebound_restore",label:"restore the beacon or signal"},
  {receiver:"root",method:"tidebound_commission",label:"Bram’s workshop commission"},
  {receiver:"root",method:"tidebound_craft",label:"craft a lantern"},
  {receiver:"root",method:"tidebound_polish",label:"polish a lantern"},
  {receiver:"root",method:"tidebound_cancel_polish",label:"settle an unfinished polish"},
  {receiver:"root",method:"tidebound_place",label:"place a lantern"},
  {receiver:"root",method:"tidebound_reconcile",label:"check an original request"},
  {receiver:"root",method:"tidebound_retry_operation",label:"retry an original request"},
  {receiver:"items",method:"mt_transfer",label:"gift a lantern"},
  {receiver:"items",method:"storage_deposit",label:"cover a lantern’s storage"},
  {receiver:"self",method:"transfer",label:"an empty, zero-value check on your own account"},
];

const ONES="11111111111111111111111111111111";
const obj=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
const str=(v:unknown):v is string=>typeof v==="string"&&v.length>0;
const count=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
export const shortHash=(h:string)=>h.length>14?`${h.slice(0,6)}…${h.slice(-4)}`:h;
export const shortKey=(k:string)=>{const [curve,body]=k.includes(":")?k.split(":",2) as [string,string]:["",k];return `${curve?curve+":":""}${body.slice(0,8)}…`;};
const plural=(n:number,one:string,many=one+"s")=>`${n} ${n===1?one:many}`;

type Key={public_key:string;permission:"FullAccess"|{receiver:string;methods:string[]}};
function keyList(read:Read):Key[]|null {
  if(!read.ok||!obj(read.value)||!Array.isArray(read.value.keys))return null;
  const out:Key[]=[];
  for(const raw of read.value.keys){
    if(!obj(raw)||!str(raw.public_key)||!obj(raw.access_key))return null;
    const p=raw.access_key.permission;
    if(p==="FullAccess")out.push({public_key:raw.public_key,permission:"FullAccess"});
    else if(obj(p)&&obj(p.FunctionCall)&&str(p.FunctionCall.receiver_id)&&Array.isArray(p.FunctionCall.method_names)&&p.FunctionCall.method_names.every(str))
      out.push({public_key:raw.public_key,permission:{receiver:p.FunctionCall.receiver_id,methods:p.FunctionCall.method_names as string[]}});
    else return null;
  }
  return out;
}
const permissionText=(k:Key)=>k.permission==="FullAccess"?"FullAccess: full control of the account":`FunctionCall: only ${k.permission.receiver}, ${k.permission.methods.length?k.permission.methods.join(", "):"any method"}`;

export function selfRecord(i:{root:string;player:string;pet:string;account:Read;keys:Read;token:Read;config:Read}):HarborRecord {
  const lines:RecordLine[]=[];
  const account=i.account.ok&&obj(i.account.value)&&str(i.account.value.code_hash)?i.account.value:null;
  lines.push(account?{state:"read",text:`Mochi’s own account is ${i.pet}.`}:{state:"unchecked",text:`Mochi’s account, ${i.pet}, couldn’t be checked just now.`});
  if(!i.token.ok)lines.push({state:"unchecked",text:"Mochi’s keeper couldn’t be checked just now."});
  else if(i.token.value===null)lines.push({state:"finding",text:`The harbor register has no papers for ${i.pet}.`});
  else if(obj(i.token.value)&&i.token.value.token_id===i.pet&&str(i.token.value.owner_id)){
    const owner=i.token.value.owner_id;
    lines.push({state:"read",text:owner===i.player?`The harbor register lists you, ${owner}, as Mochi’s keeper.`:`The harbor register lists ${owner} as Mochi’s keeper, not ${i.player}.`,detail:`Register: ${i.root}`});
  } else lines.push({state:"unchecked",text:"Mochi’s papers came back in a shape this record doesn’t recognise, so the keeper couldn’t be checked."});
  const keys=keyList(i.keys);
  if(!keys)lines.push({state:"unchecked",text:"Whether anyone holds a key to Mochi’s account couldn’t be checked."});
  else if(!keys.length)lines.push({state:"read",text:"No keys: no one, not you and not Familiar, can sign as Mochi’s account."});
  else lines.push({state:"finding",text:`Mochi’s account has ${plural(keys.length,"key")}, so it is not keyless.`,detail:keys.map(k=>`${shortKey(k.public_key)} ${k.permission==="FullAccess"?"FullAccess":"FunctionCall"}`).join(" · ")});
  const pinned=i.config.ok&&obj(i.config.value)&&str(i.config.value.pet_code_hash)?i.config.value.pet_code_hash:null;
  if(!account)lines.push({state:"unchecked",text:"Which code Mochi’s account runs couldn’t be checked."});
  else {
    const global=str(account.global_contract_hash)?account.global_contract_hash:null,own=account.code_hash!==ONES;
    if(own)lines.push({state:"finding",text:"Mochi’s account carries separate code, not only the harbor’s shared code.",detail:`Own code ${shortHash(account.code_hash as string)}`});
    else if(!global)lines.push({state:"finding",text:"Mochi’s account runs no code at all."});
    else if(!pinned)lines.push({state:"unchecked",text:"Mochi runs shared code, but the code the harbor pins couldn’t be checked to compare.",detail:`Shared code ${shortHash(global)}`});
    else if(global===pinned)lines.push({state:"read",text:"Runs the shared Mochi code the harbor pins; Mochi’s account carries no separate code.",detail:`Shared code ${shortHash(global)} · pinned by ${i.root}`});
    else lines.push({state:"finding",text:"Mochi runs shared code that is not the code the harbor pins.",detail:`Runs ${shortHash(global)} · pinned ${shortHash(pinned)}`});
  }
  return {kind:"self",title:"Mochi’s papers",lines};
}

export function keyRecord(i:{player:string;signerKey:string;provider:"privy"|"other";keys:Read}):HarborRecord {
  const keys=keyList(i.keys),lines:RecordLine[]=[];
  if(!keys)lines.push({state:"unchecked",text:`The keys on ${i.player} couldn’t be checked just now.`});
  else {
    const mine=keys.find(k=>k.public_key===i.signerKey);
    lines.push(mine?{state:"read",text:i.provider==="privy"?"Your harbor key lives in your Privy wallet, not with Familiar.":"The key this sign-in uses is on your account, not with Familiar."}
      :{state:"finding",text:"The key this sign-in uses isn’t on your account right now."});
    if(!keys.length)lines.push({state:"read",text:`${i.player} has no keys.`});
    for(const k of keys)lines.push({state:"read",text:`${k.public_key===i.signerKey?"This sign-in’s key":"Another key"}: ${permissionText(k)}.`,detail:shortKey(k.public_key)});
  }
  lines.push({state:"source",text:`Familiar’s signer only prepares these harbor actions: ${SIGNER_ACTIONS.map(a=>a.label).join("; ")}. That list lives in Familiar’s code; the chain enforces only the key permission above.`});
  return {kind:"key",title:"The Register’s key line",lines};
}

export function refereeRecord(i:{journey:Read;protocol:Read}):HarborRecord {
  const lines:RecordLine[]=[],j=i.journey.ok&&obj(i.journey.value)?i.journey.value:null;
  const claims=j&&Array.isArray(j.claims)&&j.claims.every(c=>obj(c)&&str(c.id)&&str(c.rules_version)&&str(c.content_version))?j.claims as {id:string;rules_version:string;content_version:string}[]:null;
  if(!claims)lines.push({state:"unchecked",text:"Your accepted returns couldn’t be checked just now."});
  else if(!claims.length)lines.push({state:"read",text:"No accepted returns yet. The Tidekeeper has nothing to stamp."});
  else {
    lines.push({state:"read",text:"The harbor replayed your steps and agreed they bring Mochi home."});
    for(const c of claims)lines.push({state:"read",text:`Accepted return ${shortHash(c.id)}`,detail:`Rules ${c.rules_version} · content ${c.content_version}`});
  }
  if(j&&count(j.shells)&&count(j.burned_shells))lines.push({state:"read",text:`Shells: ${j.shells} held, ${j.burned_shells} spent.`});
  else lines.push({state:"unchecked",text:"Your Shells couldn’t be checked just now."});
  if(j&&typeof j.commission_fulfilled==="boolean")lines.push({state:"read",text:j.commission_fulfilled?"Bram’s workshop commission is fulfilled.":"Bram’s workshop commission isn’t fulfilled yet."});
  else lines.push({state:"unchecked",text:"Bram’s workshop commission couldn’t be checked just now."});
  const p=i.protocol.ok&&obj(i.protocol.value)&&str(i.protocol.value.rules_version)&&str(i.protocol.value.content_version)?i.protocol.value:null;
  lines.push(p?{state:"read",text:`The harbor currently plays rules ${p.rules_version}, content ${p.content_version}.`}:{state:"unchecked",text:"The harbor’s current rules couldn’t be checked just now."});
  return {kind:"referee",title:"The Tidekeeper’s stamp",lines};
}

export function adminRecord(i:{root:string;items:string;rootKeys:Read;itemsKeys:Read}):HarborRecord {
  const lines:RecordLine[]=[],full:boolean[]=[];
  for(const [id,read] of [[i.root,i.rootKeys],[i.items,i.itemsKeys]] as const){
    const keys=keyList(read);
    if(!keys){lines.push({state:"unchecked",text:`The admin keys on ${id} couldn’t be checked just now.`});continue;}
    const n=keys.filter(k=>k.permission==="FullAccess").length;full.push(n>0);
    lines.push(n?{state:"finding",text:`${id} still has ${plural(n,"full-access admin key")}.`,detail:keys.filter(k=>k.permission==="FullAccess").map(k=>shortKey(k.public_key)).join(" · ")}:{state:"read",text:`${id} has no full-access keys.`});
  }
  if(full.length===2&&full.every(Boolean))lines.unshift({state:"finding",text:"Root and Items still have full-access admin keys on testnet, so the whole harbor is not immutable: their code can still be changed."});
  else if(full.some(Boolean))lines.unshift({state:"finding",text:"Part of the harbor still has a full-access admin key on testnet, so it is not immutable."});
  return {kind:"admin",title:"Who can still change the harbor",lines};
}

type Fetcher=(url:string,init:{method:string;headers:Record<string,string>;body:string})=>Promise<{ok:boolean;json():Promise<unknown>}>;
export async function rpcQuery(rpcUrl:string,params:Record<string,unknown>,fetcher:Fetcher=fetch):Promise<unknown> {
  const res=await fetcher(rpcUrl,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:"familiar-records",method:"query",params:{finality:"final",...params}})});
  if(!res.ok)throw Error("The public record did not answer.");
  const body=await res.json();
  if(!obj(body)||body.error!==undefined||!obj(body.result)||body.result.error!==undefined)throw Error("The public record returned an error.");
  return body.result;
}
const base64=(text:string)=>{let s="";for(const b of new TextEncoder().encode(text))s+=String.fromCharCode(b);return btoa(s);};
export async function viewCall(rpcUrl:string,account_id:string,method_name:string,args:object,fetcher?:Fetcher):Promise<unknown> {
  const r=await rpcQuery(rpcUrl,{request_type:"call_function",account_id,method_name,args_base64:base64(JSON.stringify(args))},fetcher) as {result?:unknown};
  if(!Array.isArray(r.result)||!r.result.every(b=>Number.isInteger(b)&&b>=0&&b<256))throw Error("The public record returned an unreadable view.");
  return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(r.result as number[])));
}
const settle=<T>(p:Promise<T>):Promise<Read<T>>=>p.then(value=>({ok:true as const,value}),()=>({ok:false as const}));

export async function loadRecords(t:RecordsTarget,fetcher?:Fetcher):Promise<HarborRecord[]> {
  const items=`items.${t.root}`,q=(params:Record<string,unknown>)=>settle(rpcQuery(t.rpcUrl,params,fetcher)),v=(m:string,a:object={})=>settle(viewCall(t.rpcUrl,t.root,m,a,fetcher));
  const keys=(account_id:string)=>q({request_type:"view_access_key_list",account_id});
  const [account,petKeys,token,config,playerKeys,journey,protocol,rootKeys,itemsKeys]=await Promise.all([
    q({request_type:"view_account",account_id:t.pet}),keys(t.pet),v("nft_token",{token_id:t.pet}),v("get_config"),
    keys(t.player),v("tidebound_journey",{account_id:t.player}),v("tidebound_protocol"),keys(t.root),keys(items),
  ]);
  return [
    selfRecord({root:t.root,player:t.player,pet:t.pet,account,keys:petKeys,token,config}),
    keyRecord({player:t.player,signerKey:t.signerKey,provider:t.provider,keys:playerKeys}),
    refereeRecord({journey,protocol}),
    adminRecord({root:t.root,items,rootKeys,itemsKeys}),
  ];
}
