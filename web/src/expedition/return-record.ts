import {PublicKey,KeyType} from "near-api-js";
import {isPlayerAccount} from "../account/names";
import {replayOuting} from "../compatibility/return-rules";
import {replayCourt} from "./engine";
import {CONTENT_VERSION,type CourtState,type BankedItem} from "./types";
import type {RunContext} from "./harbor-port";

export interface ReturnRecord {
  schemaVersion:1;id:string;operationId:string;contentVersion:"first_light_v1"|typeof CONTENT_VERSION;
  context:RunContext;area:"beacon"|"wind";tool:"rope"|"lantern";banked:readonly BankedItem[];commands:readonly string[];
  outcome:"returned"|"rescued";cargo:readonly BankedItem[];disposition:"staged"|"accepted"|"private-memory"|"conflict";acceptedClaimId?:string;
}
type Store=Pick<Storage,"getItem"|"setItem">;
export type ReturnRecordLock=<T>(name:string,work:()=>T|Promise<T>)=>Promise<T>;
const browserLock:ReturnRecordLock=async(name,work)=>{check(globalThis.navigator?.locks,"This browser cannot safely coordinate saved returns across tabs. Keep the expedition open; Web Locks support is required.");return navigator.locks.request(name,work);};
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function check(value:unknown,message="The original return record could not be verified. Keep this browser data."):asserts value {if(!value)throw Error(message);}
function bank(value:unknown):value is BankedItem[] {return Array.isArray(value)&&value.length<=5&&new Set(value).size===value.length&&value.every(item=>["lens","moth","vane","chart","salvage"].includes(item));}
export function validateRunContext(value:unknown):asserts value is RunContext {
  const c=value as RunContext;check(c&&bank(c.banked)&&typeof c.lit==="boolean"&&typeof c.signaled==="boolean"&&(!c.signaled||c.lit));
  check(c.authority==="local-preview"||c.authority==="near-testnet");
  if(c.authority==="near-testnet") {
    check(c.network==="testnet"&&typeof c.root==="string"&&isPlayerAccount(c.accountId,c.root)&&isPlayerAccount(c.companionId,c.root)&&Number.isSafeInteger(c.revision)&&c.revision>=0&&/^[a-f0-9]{64}$/.test(c.checkpointHash));
    check(PublicKey.fromString(c.publicKey).keyType===KeyType.ED25519);
  }
}
export function decodeReturnRecord(value:unknown):ReturnRecord {
  const r=value as ReturnRecord;check(r&&r.schemaVersion===1&&/^[A-Za-z0-9_-]{1,57}$/.test(r.id)&&r.operationId===`return:${r.id}`);
  validateRunContext(r.context);check(bank(r.banked)&&same(r.banked,r.context.banked)&&bank(r.cargo)&&["returned","rescued"].includes(r.outcome)&&["staged","accepted","private-memory","conflict"].includes(r.disposition));
  check(r.area==="beacon"||r.area==="wind");check(r.tool==="rope"||r.tool==="lantern");
  check(Array.isArray(r.commands)&&r.commands.every(command=>typeof command==="string"&&command.length<=24));
  const run=r.contentVersion===CONTENT_VERSION?replayCourt({area:r.area,tool:r.tool,banked:r.banked},r.commands)
    :r.contentVersion==="first_light_v1"?replayOuting(r.tool,[...r.banked],r.commands,r.area):null;
  check(run&&run.outcome===r.outcome&&same(run.cargo,r.cargo));
  check(r.disposition!=="accepted"||r.context.authority==="near-testnet"&&typeof r.acceptedClaimId==="string"&&/^[a-f0-9]{64}$/.test(r.acceptedClaimId));
  return structuredClone(r);
}
function recordScope(context:RunContext) {return context.authority==="near-testnet"?`${context.network}:${context.root}:${context.accountId}`:"preview";}
export function returnRecordKey(context:RunContext) {validateRunContext(context);return `familiar.expedition.returns.v2:${recordScope(context)}`;}
export class ReturnRecords {
  constructor(private readonly store:Store,private readonly lock:ReturnRecordLock=browserLock) {}
  read(context:RunContext):ReturnRecord[] {
    const raw=this.store.getItem(returnRecordKey(context));if(raw===null)return [];
    check(raw.length<=4_000_000);const value:unknown=JSON.parse(raw);check(Array.isArray(value));
    const records=value.map(decodeReturnRecord);check(records.every(r=>recordScope(r.context)===recordScope(context))&&new Set(records.map(r=>r.id)).size===records.length);return records;
  }
  private write(context:RunContext,records:ReturnRecord[]) {
    const key=returnRecordKey(context),raw=JSON.stringify(records);check(raw.length<=4_000_000,"The browser’s return-memory limit was reached. Keep the expedition open; earlier memories are preserved.");this.store.setItem(key,raw);
    check(this.store.getItem(key)===raw,"The returned outing could not be saved. Keep the expedition open and retry saving before leaving.");
  }
  async capture(state:CourtState,context:RunContext):Promise<ReturnRecord> {
    validateRunContext(context);check(same(state.banked,context.banked));
    const replay=replayCourt({area:state.area,tool:state.tool,banked:state.banked},state.commands);
    check(replay&&state.outcome!=="active"&&same(replay,state));
    const frozenState=structuredClone(state),frozenContext=structuredClone(context);
    return this.lock(returnRecordKey(frozenContext),()=>this.captureLocked(frozenState,frozenContext));
  }
  private captureLocked(state:CourtState,context:RunContext):ReturnRecord {
    const records=this.read(context);
    const prior=records.find(r=>r.contentVersion===CONTENT_VERSION&&same(r.context,context)&&r.area===state.area&&r.tool===state.tool&&same(r.commands,state.commands));
    if(prior)return prior;
    const id=crypto.randomUUID();
    const record=decodeReturnRecord({schemaVersion:1,id,operationId:`return:${id}`,contentVersion:CONTENT_VERSION,context,area:state.area,tool:state.tool,banked:[...state.banked],commands:[...state.commands],outcome:state.outcome,cargo:[...state.cargo],disposition:context.authority==="near-testnet"?"staged":"private-memory"});
    this.write(context,[...records,record]);return record;
  }
  async mark(context:RunContext,id:string,disposition:ReturnRecord["disposition"],acceptedClaimId?:string) {
    const frozen=structuredClone(context);validateRunContext(frozen);
    return this.lock(returnRecordKey(frozen),()=>this.markLocked(frozen,id,disposition,acceptedClaimId));
  }
  private markLocked(context:RunContext,id:string,disposition:ReturnRecord["disposition"],acceptedClaimId?:string) {
    const records=this.read(context),record=records.find(r=>r.id===id);check(record);
    check(record.disposition!=="accepted"||disposition==="accepted"&&record.acceptedClaimId===acceptedClaimId);
    Object.assign(record,{disposition,...(acceptedClaimId?{acceptedClaimId}:{})});decodeReturnRecord(record);this.write(context,records);return record;
  }
}
