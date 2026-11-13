import type { PlayerBinding, MotifId, SocketId } from "../tidebound/domain";
import type { ChainSnapshot, CraftItem, PendingNative } from "../tidebound/client";
import type { BankedItem, CourtState } from "./types";
import type { ReturnRecord } from "./return-record";

export interface HomeCheckpoint {banked:readonly BankedItem[];lit:boolean;signaled:boolean}
export type RunContext = HomeCheckpoint & ({authority:"local-preview"}|{
  authority:"near-testnet";network:"testnet";root:string;accountId:string;publicKey:string;companionId:string;revision:number;checkpointHash:string;
});
export type WorldIntent =
  | {kind:"adopt"}
  | {kind:"unpack";returnId:string}
  | {kind:"restore";restoration:"beacon"|"signal"}
  | {kind:"commission"}
  | {kind:"check-item"}|{kind:"retry-original-item"}|{kind:"resolve-original-polish"}
  | {kind:"craft";motif:MotifId}
  | {kind:"place";itemId:string;socket:SocketId}
  | {kind:"polish";itemId:string}
  | {kind:"gift";itemId:string;recipient:string}
  | {kind:"storage";recipient:string};
/** Season 2 calls on season.<root>. Each maps to exactly one allowlisted method. */
export type SeasonIntent =
  | {kind:"register"}
  | {kind:"claim";contentVersion:"first_light_v1"|"first_light_v2";tool:"rope"|"lantern";commands:readonly string[]}
  | {kind:"buy";good:"glass"|"reed";qty:number;maxPrice:number}
  | {kind:"sell";good:"glass"|"reed";qty:number;minPrice:number}
  | {kind:"set-wish";good:"glass"|"reed";limit:number;qty:number}
  | {kind:"cancel-wish"};
export interface SeasonFinal {failed:boolean;outcome:unknown}
export interface WorldReview {id:string;intent:WorldIntent;title:string;description:string;costs:readonly string[];confirmLabel:string}
export interface WorkshopModel {
  authority:"local-preview"|"near-testnet";motifs:readonly MotifId[];creditAvailable:boolean;
  items:readonly CraftItem[];placement:ChainSnapshot["journey"]["placement"];shells:number;commissionAvailable:boolean;
}
export interface HarborState {
  mode:"preview"|"saved";binding:PlayerBinding|null;snapshot:ChainSnapshot|null;busy:boolean;message:string;
  pending:PendingNative|null;review:WorldReview|null;courtSupported:boolean;returns:readonly ReturnRecord[];workshop:WorkshopModel;
}
export interface HarborSession {
  readonly state:HarborState;
  runContext(preview:HomeCheckpoint):RunContext;
  setActiveRun(context:RunContext|null):void;
  captureReturn(state:CourtState,context:RunContext):Promise<ReturnRecord>;
  selectSaved():Promise<void>;selectPreview():void;
  review(intent:WorldIntent):Promise<void>;confirm(reviewId:string):Promise<void>;cancelReview():void;
  seasonAct?(intent:SeasonIntent):Promise<SeasonFinal|null>;
  refresh():Promise<void>;resumeOriginal():Promise<void>;checkOriginal():Promise<void>;resolveExpired():Promise<void>;
  /** Short-lived session proof for the sealed-note relay; absent when the account provider cannot supply one. */
  noteToken?():Promise<string|null>;
}
