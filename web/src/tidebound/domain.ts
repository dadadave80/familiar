import { replayOuting, type Action, type Area, type Item, type Outing, type Tool } from "../outing/engine";

export const RULES_VERSION = "tidebound_h1_v1";
export const CONTENT_VERSION = "first_light_v1";
export type Network = "testnet" | "mainnet";
export type MotifId = "crest" | "moth";
export type SocketId = "porch" | "dock";
export type Authority = "local-preview" | "near-testnet" | "near-mainnet";
export interface ExpeditionTranscript { tool: Tool; banked: Item[]; actions: Action[]; area: Area }
export interface StoryEvent { id:"lens_return" | "moth_return" | "dry_crossing"; transcript:ExpeditionTranscript }
export interface LocalPreview {
  rulesVersion:string;
  contentVersion:string;
  revision:number;
  origins:Record<MotifId, ExpeditionTranscript | null>;
  lantern:{ motif:MotifId; socket:SocketId } | null;
}
export interface PlayerBinding {
  playerId:string;
  network:Network;
  nearAccountId:string;
  signerPublicKey:string;
  signerBindingId:string;
}
export interface EntitlementKey { network:Network; ledgerContract:string; nearAccountId:string; chapterId:"first_light"; rewardId:"first_light_craft_credit" }
export type OperationState = "prepared" | "reserved" | "submitted" | "confirmed" | "failed-safe" | "uncertain" | "recovery-required";
export interface OperationRecord { id:string; kind:"claim" | "craft" | "commission" | "restyle" | "transfer"; inputHash:string; state:OperationState; itemId?:string; finalReceiptIds:readonly string[] }
export interface OwnedCraft {
  itemContract:string;
  tokenId:string;
  network:Network;
  holderAccountId:string;
  originalMakerAccountId:string;
  originClaimId:string;
  rulesVersion:string;
  recipeId:"first_light_lantern_v1";
  originalMotifId:MotifId;
  finishId:"original" | "harbor_polish";
  finishUsed:boolean;
  currentAppearanceVersion:number;
  metadataHash:string;
}
export interface AccountSnapshot {
  authority:"near-testnet" | "near-mainnet";
  revision:number;
  verifiedLensReturn:boolean;
  verifiedMothReturn:boolean;
  craftState:"unclaimed" | "available" | "reserved" | "consumed";
  canonicalCraftOperationId:string | null;
  ownedCraft:OwnedCraft | null;
}
export type AdoptionPlan =
  | { kind:"claim-preview"; transcripts:ExpeditionTranscript[]; motif:MotifId | null; socket:SocketId | null; expectedRevision:number }
  | { kind:"use-authoritative"; item:OwnedCraft; transcripts:ExpeditionTranscript[]; placementConflict:boolean; expectedRevision:number }
  | { kind:"reconcile"; operationId:string }
  | { kind:"preserve-memory"; reason:string; transcripts?:ExpeditionTranscript[] };

export function newPreview(): LocalPreview {
  return { rulesVersion:RULES_VERSION, contentVersion:CONTENT_VERSION, revision:0, origins:{ crest:null, moth:null }, lantern:null };
}

/** Recompute before deriving events. This proves game legality, never human effort or economic authority. */
export function deriveStoryEvents(candidate: Outing): StoryEvent[] {
  const run = replayOuting(candidate.tool, candidate.banked, candidate.actions, candidate.area);
  if (!run || run.outcome !== "returned" || !Array.isArray(candidate.waves) || candidate.waves.some(w=>!w || typeof w!=="object")) return [];
  const record=(r:Outing)=>[r.area,r.orientation,r.tool,r.lane,r.turn,r.resolve,r.uses,r.locked,r.opened,r.banked,r.cargo,r.actions,r.waves.map(w=>[w.turn,w.source,w.lane,w.hit,w.opened]),r.outcome];
  if(JSON.stringify(record(run))!==JSON.stringify(record(candidate)))return [];
  const transcript:ExpeditionTranscript = { tool:run.tool, banked:[...run.banked], actions:[...run.actions], area:run.area };
  const events:StoryEvent[] = [];
  if (run.area === "beacon" && run.cargo.includes("lens")) events.push({ id:"lens_return", transcript });
  if (run.area === "beacon" && run.cargo.includes("moth")) events.push({ id:"moth_return", transcript });
  if (run.waves.length > 0 && !run.waves.some(w => w.hit)) events.push({ id:"dry_crossing", transcript });
  return events;
}
export function eligibleMotifs(checkpoint:Pick<AccountSnapshot,"verifiedLensReturn" | "verifiedMothReturn">): MotifId[] {
  return [...(checkpoint.verifiedLensReturn ? ["crest" as const] : []), ...(checkpoint.verifiedMothReturn ? ["moth" as const] : [])];
}
export function previewMotifs(preview:LocalPreview): MotifId[] {
  return (["crest", "moth"] as const).filter(motif => {
    const origin = preview.origins[motif];
    if (!origin || origin.area !== "beacon") return false;
    const run = replayOuting(origin.tool, origin.banked, origin.actions, origin.area);
    return !!run && deriveStoryEvents(run).some(e => e.id === (motif === "crest" ? "lens_return" : "moth_return"));
  });
}
export function rememberRun(preview:LocalPreview, run:Outing): LocalPreview {
  const origins = { ...preview.origins };
  for (const event of deriveStoryEvents(run)) {
    if (event.id === "lens_return" && !origins.crest) origins.crest = event.transcript;
    if (event.id === "moth_return" && !origins.moth) origins.moth = event.transcript;
  }
  return origins.crest === preview.origins.crest && origins.moth === preview.origins.moth
    ? preview : { ...preview, origins, revision:preview.revision + 1 };
}
export function prepareAdoption(local:LocalPreview, remote:AccountSnapshot): AdoptionPlan {
  if (local.rulesVersion !== RULES_VERSION || local.contentVersion !== CONTENT_VERSION)
    return { kind:"preserve-memory", reason:"This preview uses incompatible rules. Keep its export; the saved harbor takes priority." };
  const motifs = previewMotifs(local);
  if (local.lantern && !motifs.includes(local.lantern.motif))
    return { kind:"preserve-memory", reason:"The selected motif has no legal returned origin." };
  const transcripts = motifs.filter(m => m === "crest" ? !remote.verifiedLensReturn : !remote.verifiedMothReturn).map(m => local.origins[m]!);
  if (remote.craftState === "reserved") return remote.canonicalCraftOperationId
    ? { kind:"reconcile", operationId:remote.canonicalCraftOperationId }
    : { kind:"preserve-memory", reason:"The existing craft needs reconciliation before adoption." };
  if (remote.ownedCraft) return {
    kind:"use-authoritative", item:remote.ownedCraft, transcripts,
    placementConflict:local.lantern !== null, expectedRevision:remote.revision,
  };
  if (remote.craftState === "consumed") return { kind:"preserve-memory", transcripts, reason:"The first lantern was already crafted. This preview stays a private memory; it cannot mint a replacement." };
  return { kind:"claim-preview", transcripts, motif:local.lantern?.motif ?? null, socket:local.lantern?.socket ?? null, expectedRevision:remote.revision };
}
export function applyPlacement(preview:LocalPreview, socket:unknown, expectedRevision:number):
  { ok:true; preview:LocalPreview } | { ok:false; reason:"conflict" | "invalid-socket" | "missing-lantern" } {
  if (expectedRevision !== preview.revision) return { ok:false, reason:"conflict" };
  if (socket !== "porch" && socket !== "dock") return { ok:false, reason:"invalid-socket" };
  if (!preview.lantern) return { ok:false, reason:"missing-lantern" };
  return { ok:true, preview:{ ...preview, revision:preview.revision + 1, lantern:{ ...preview.lantern, socket } } };
}
