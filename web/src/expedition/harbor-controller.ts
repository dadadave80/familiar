import type {RecoverableAccountAdapter} from "../account/adapter";
import {mochiNameForPlayer} from "../account/names";
import {RULES_VERSION,type PlayerBinding} from "../tidebound/domain";
import type {ChainSnapshot,TideboundClient} from "../tidebound/client";
import {quoteItemStorage,storageNear} from "../tidebound/storage";
import {ReturnRecords,validateRunContext,type ReturnRecord,type ReturnRecordLock} from "./return-record";
import type {HarborSession,HarborState,HomeCheckpoint,RunContext,SeasonFinal,SeasonIntent,WorldIntent,WorldReview,WorkshopModel} from "./harbor-port";
import {SEASON_STORAGE_DEPOSIT} from "../../../services/relayer/src/auth/sign";
import type {CourtState,BankedItem} from "./types";

export type HarborClient=Pick<TideboundClient,"root"|"itemsContract"|"snapshot"|"pending"|"verifyStack"|"send"|"resumeNative"|"reconcileNative"|"resolveExpiredNative"|"view">&{lastFinal?:TideboundClient["lastFinal"]};
export interface HarborConnection {adapter:RecoverableAccountAdapter;client:HarborClient;accountExists(accountId:string):Promise<void>}
type Prepared={review:WorldReview;epoch:number;binding:PlayerBinding;revision:number;checkpointHash:string;method:string;args:Record<string,unknown>;options?:{receiver:string;deposit:bigint};record?:ReturnRecord};
const blankWorkshop:WorkshopModel={authority:"local-preview",motifs:[],creditAvailable:false,items:[],placement:null,shells:0,commissionAvailable:false};
function check(value:unknown,message:string):asserts value {if(!value)throw Error(message);}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const bindingMatches=(a:PlayerBinding|null,b:PlayerBinding)=>a?.nearAccountId===b.nearAccountId&&a.signerPublicKey===b.signerPublicKey&&a.network===b.network&&a.signerBindingId===b.signerBindingId;
export function canonicalWorkshop(snapshot:ChainSnapshot):WorkshopModel {
  const j=snapshot.journey;
  return {authority:"near-testnet",motifs:[...(j.lens_claim?["crest" as const]:[]),...(j.moth_claim?["moth" as const]:[])],creditAvailable:j.credit==="available",items:snapshot.items,placement:j.placement,shells:j.shells,commissionAvailable:j.workshop_salvage===1&&!j.commission_fulfilled};
}
async function claimHash(record:ReturnRecord) {
  const c=record.context;check(c.authority==="near-testnet","This return is a private memory.");
  const bytes=new TextEncoder().encode(JSON.stringify(["familiar.claim.v1","testnet",c.root,c.accountId,c.companionId,record.operationId,c.revision,c.checkpointHash,RULES_VERSION,record.contentVersion,record.tool,record.commands,record.area]));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(n=>n.toString(16).padStart(2,"0")).join("");
}
/** One instance per game. It holds no player private key and exposes no arbitrary signing method. */
export class HarborController implements HarborSession {
  private value:HarborState={mode:"preview",binding:null,snapshot:null,busy:false,message:"",pending:null,review:null,courtSupported:false,returns:[],workshop:blankWorkshop};
  private listeners=new Set<()=>void>();private epoch=0;private live=true;private active:RunContext|null=null;private prepared:Prepared|null=null;
  readonly records:ReturnRecords;
  constructor(private readonly connection:HarborConnection|null,private readonly store:Pick<Storage,"getItem"|"setItem">,recordLock?:ReturnRecordLock){this.records=new ReturnRecords(store,recordLock);}
  get state(){return this.value;}
  get configured(){return !!this.connection;}
  get root(){return this.connection?.client.root??null;}
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  private update(next:Partial<HarborState>) {
    const value={...this.value,...next};
    value.workshop=value.mode==="saved"&&value.snapshot?canonicalWorkshop(value.snapshot):blankWorkshop;
    try{value.pending=value.binding&&this.connection?this.connection.client.pending(value.binding):null;}catch{value.message="The original pending request could not be read. Preserve this browser data.";}
    this.value=value;for(const listener of this.listeners)listener();
  }
  private guard(epoch:number,binding?:PlayerBinding) {check(this.live&&epoch===this.epoch&&(!binding||bindingMatches(this.value.binding,binding)),"The signed-in harbor changed. Its original request and return are preserved.");}
  open(){this.live=true;void this.restore();}
  close(){this.live=false;this.epoch++;this.prepared=null;this.update({binding:null,snapshot:null,review:null,busy:false,mode:"preview"});}
  private context(snapshot:ChainSnapshot):RunContext {
    check(this.connection&&snapshot.pets[0],"Bring Mochi home before starting a saved expedition.");
    return {authority:"near-testnet",network:"testnet",root:this.connection.client.root,accountId:snapshot.binding.nearAccountId,publicKey:snapshot.binding.signerPublicKey,companionId:snapshot.pets[0].token_id,revision:snapshot.journey.revision,checkpointHash:snapshot.checkpointHash,banked:[...snapshot.journey.banked] as BankedItem[],lit:snapshot.journey.lit,signaled:snapshot.journey.signaled};
  }
  private recordsFor(snapshot:ChainSnapshot|null) {
    if(this.value.mode==="saved"&&snapshot&&snapshot.pets.length)return this.records.read(this.context(snapshot));
    return this.records.read({authority:"local-preview",banked:[],lit:false,signaled:false});
  }
  private async load(binding:PlayerBinding,epoch:number) {
    const snapshot=await this.connection!.client.snapshot(binding);this.guard(epoch,binding);
    check(bindingMatches(snapshot.binding,binding),"The snapshot belongs to another signed-in harbor. Keep the original context.");
    let courtSupported=false;try{await this.connection!.client.verifyStack("first_light_v2");this.guard(epoch,binding);courtSupported=true;}catch{this.guard(epoch,binding);}
    this.update({snapshot,courtSupported,returns:this.recordsFor(snapshot)});return snapshot;
  }
  private choiceKey(binding:PlayerBinding){return `familiar.expedition.authority.v2:testnet:${this.connection!.client.root}:${binding.nearAccountId}`;}
  private choice(binding:PlayerBinding,mode:"saved"|"preview") {const key=this.choiceKey(binding);this.store.setItem(key,mode);check(this.store.getItem(key)===mode,"This harbor choice could not be saved. The earlier preview is preserved.");}
  exportReturns(){return JSON.stringify({schemaVersion:1,kind:"expedition-return-memories",authority:this.value.mode,records:this.recordsFor(this.value.snapshot)},null,2);}
  async setBinding(binding:PlayerBinding|null) {
    this.guard(this.epoch);
    const epoch=++this.epoch;this.prepared=null;this.update({binding,snapshot:null,mode:"preview",review:null,busy:!!binding,message:""});
    try{if(binding){await this.load(binding,epoch);this.guard(epoch,binding);
      const activeMatches=!this.active||this.active.authority==="near-testnet"&&this.active.accountId===binding.nearAccountId&&this.active.publicKey===binding.signerPublicKey;
      if(this.value.courtSupported&&activeMatches&&this.store.getItem(this.choiceKey(binding))==="saved"){this.update({mode:"saved"});this.update({returns:this.recordsFor(this.value.snapshot)});}
    }}catch(error){if(epoch===this.epoch)this.update({message:error instanceof Error?error.message:"The saved harbor could not be read."});}
    finally{if(epoch===this.epoch)this.update({busy:false});}
  }
  async restore(){this.guard(this.epoch);if(!this.connection)return;const epoch=++this.epoch;try{const binding=await this.connection.adapter.restoreSession();this.guard(epoch);await this.setBinding(binding);}catch{if(this.live&&epoch===this.epoch)this.update({message:"Sign in with the same identity to check the saved harbor."});}}
  private async enter(work:()=>Promise<PlayerBinding|null>) {this.guard(this.epoch);check(!this.value.busy,"The original account action is still being checked.");const epoch=++this.epoch;this.update({busy:true,review:null});try{const binding=await work();this.guard(epoch);await this.setBinding(binding);return binding;}finally{if(this.live&&epoch===this.epoch)this.update({busy:false});}}
  async authenticate(){check(this.connection,"Recoverable sign-in is not configured at this address.");return this.enter(()=>this.connection!.adapter.authenticate());}
  async checkUsername(username:string){this.guard(this.epoch);check(this.connection&&!this.value.busy,"Recoverable sign-in is unavailable or busy.");const epoch=this.epoch,result=await this.connection.adapter.checkUsername(username);this.guard(epoch);return result;}
  async provisionPlayer(username:string){check(this.connection,"Recoverable sign-in is unavailable.");return this.enter(()=>this.connection!.adapter.provisionAccount(username));}
  async noteToken(){const adapter=this.connection?.adapter as {accessToken?():Promise<string|null>}|undefined;return this.value.mode==="saved"&&this.value.binding&&adapter?.accessToken?adapter.accessToken():null;}
  async signOut(){this.guard(this.epoch);const epoch=++this.epoch;this.prepared=null;this.update({binding:null,snapshot:null,mode:"preview",review:null,busy:true,message:"Your device previews and original requests are preserved."});try{await this.connection?.adapter.endSession();}finally{if(this.live&&epoch===this.epoch)this.update({busy:false});}}
  async refresh(){const binding=this.value.binding;check(binding&&this.connection,"Sign in to check the saved harbor.");return this.work(()=>this.load(binding,this.epoch));}
  private async work(task:()=>Promise<unknown>,report=true) {
    check(this.live&&!this.value.busy,"The original harbor action is still being checked.");const epoch=this.epoch;this.update({busy:true,message:""});
    try{await task();}catch(error){if(report&&epoch===this.epoch)this.update({message:error instanceof Error?error.message:"The original request is still being checked."});throw error;}
    finally{if(epoch===this.epoch)this.update({busy:false});}
  }
  async selectSaved(){check(!this.active,"Finish this outing before choosing another harbor.");await this.refresh();check(this.value.courtSupported,"The new court is a private preview until both contracts support it. Your existing Mochi and earned progress are preserved.");check(this.value.binding,"Sign in before selecting this harbor.");this.choice(this.value.binding,"saved");this.update({mode:"saved"});this.update({returns:this.recordsFor(this.value.snapshot)});}
  selectPreview(){check(!this.active&&!this.value.busy,"Finish this outing before choosing another harbor.");if(this.value.binding)this.choice(this.value.binding,"preview");this.prepared=null;this.update({mode:"preview",review:null,returns:this.recordsFor(null)});}
  runContext(preview:HomeCheckpoint):RunContext {
    this.guard(this.epoch);
    check(!this.value.review&&(this.value.mode==="preview"||!this.value.busy&&!this.value.pending),"Resolve the original request before setting out from this harbor.");
    const context=this.value.mode==="saved"?(check(this.value.snapshot&&this.value.courtSupported,"The saved expedition is not ready."),this.context(this.value.snapshot)):{authority:"local-preview" as const,...structuredClone(preview)};
    return structuredClone(context);
  }
  setActiveRun(context:RunContext|null){if(context)validateRunContext(context);this.active=context?structuredClone(context):null;}
  async captureReturn(state:CourtState,context:RunContext) {const epoch=this.epoch,record=await this.records.capture(state,context);if(this.live&&epoch===this.epoch)this.update({returns:this.recordsFor(this.value.snapshot)});return record;}
  cancelReview(){check(!this.value.busy,"The original request is still being checked.");this.prepared=null;this.update({review:null});}
  private requireSaved() {const binding=this.value.binding;check(this.connection&&binding,"Sign in with the original identity first.");check(this.value.mode==="saved","Choose the saved harbor explicitly. Local memories are never merged on sign-in.");check(this.value.courtSupported,"Both contracts must support the new court before a saved world action. Your original state is preserved.");check(!this.active,"Bring Mochi home before this harbor interaction.");check(!this.connection.client.pending(binding),"Check the original request before preparing another action.");return binding;}
  private async storage(recipient:string) {const [bounds,balance]=await Promise.all([this.connection!.client.view(this.connection!.client.itemsContract,"storage_balance_bounds"),this.connection!.client.view(this.connection!.client.itemsContract,"storage_balance_of",{account_id:recipient})]);return quoteItemStorage(bounds,balance);}
  async review(intent:WorldIntent) {
    return this.work(async()=>{
      this.prepared=null;this.update({review:null});
      const binding=this.requireSaved(),epoch=this.epoch,snapshot=await this.load(binding,epoch),j=snapshot.journey;
      let method="",args:Record<string,unknown>={},options:Prepared["options"],record:ReturnRecord|undefined;
      let title="",description="",costs=["Network gas paid by this saved testnet account."],confirmLabel="Confirm";
      const item=(id:string)=>{const found=snapshot.items.find(i=>i.mint.token_id===id);check(found,"This account no longer holds that lantern. Check its current ownership.");return found;};
      if(intent.kind==="adopt") {check(!snapshot.pets.length,"Mochi is already home. No new adoption is needed.");method="adopt";args={name:await mochiNameForPlayer(binding.nearAccountId,this.connection!.client.root)};title="Bring Mochi home";description="One keyless companion for this saved harbor.";confirmLabel="Adopt Mochi";}
      if(intent.kind==="unpack") {
        record=this.recordsFor(snapshot).find(r=>r.id===intent.returnId);check(record&&record.context.authority==="near-testnet","This return stays a private memory. Start an expedition from the saved harbor to record a discovery.");
        const c=record.context;check(c.accountId===binding.nearAccountId&&c.publicKey===binding.signerPublicKey&&c.root===this.connection!.client.root,"This return belongs to a different saved harbor.");
        const hash=await claimHash(record);this.guard(epoch,binding);const claims=(j as typeof j&{claims?:{operation_id:string;id:string;input_hash:string}[]}).claims;
        const accepted=claims?.find(claim=>claim.operation_id===record!.operationId);
        if(accepted){check(accepted.input_hash===hash,"The original accepted return has different inputs.");await this.records.mark(c,record.id,"accepted",accepted.id);this.guard(epoch,binding);this.update({returns:this.recordsFor(snapshot),message:"These finds are already safely recorded."});return;}
        check(record.outcome==="returned"&&record.cargo.length>0,"No carried discovery needs recording. This outing remains a memory.");
        check(c.revision===j.revision&&c.checkpointHash===snapshot.checkpointHash&&same(c.banked,j.banked),"The saved checkpoint changed. Keep this return as a memory; do not merge it into another outing.");
        await this.connection!.client.verifyStack(record.contentVersion);this.guard(epoch,binding);
        method="tidebound_claim";args={token_id:c.companionId,operation_id:record.operationId,expected_revision:c.revision,initial_checkpoint_hash:c.checkpointHash,rules_version:RULES_VERSION,content_version:record.contentVersion,tool:record.tool,commands:[...record.commands],area:record.area};
        title="Unpack with Bram";description=`Record ${record.cargo.join(", ")} from this exact returned expedition in ${binding.nearAccountId}.`;confirmLabel="Keep these finds";
      }
      if(intent.kind==="restore") {check(intent.restoration==="beacon"?!!j.lens_claim&&!j.lit:j.lit&&j.banked.includes("vane")&&!j.signaled,"This repair is unavailable or already complete.");method="tidebound_restore";args={restoration:intent.restoration};title=intent.restoration==="beacon"?"Fit the Beacon Lens":"Fit the Signal Vane";description="Restore the harbor using its confirmed discovery.";confirmLabel="Make the repair";}
      if(intent.kind==="commission") {check(j.workshop_salvage===1&&!j.commission_fulfilled,"Bram’s personal commission is already complete or unavailable.");method="tidebound_commission";title="Bram’s lantern frame";description="Give Bram the one new workshop salvage for 12 bound Shells. The protected craft credit stays yours.";costs.unshift("1 workshop salvage → 12 bound Shells. No cash redemption.");confirmLabel="Give Bram the salvage";}
      if(["check-item","retry-original-item","resolve-original-polish"].includes(intent.kind)) {
        const waiting=(state:string|undefined)=>state==="reserved"||state==="recovery-required";
        check(intent.kind==="resolve-original-polish"?waiting(j.polish?.state):waiting(j.craft?.state)||waiting(j.polish?.state),"Bram’s original job is already settled or no reserved job exists. The saved state was checked without another payment.");
        method=intent.kind==="check-item"?"tidebound_reconcile":intent.kind==="retry-original-item"?"tidebound_retry_operation":"tidebound_cancel_polish";
        title=intent.kind==="check-item"?"Ask Bram about the original job":intent.kind==="retry-original-item"?"Retry the original lantern job":"Resolve the original polish";
        description=intent.kind==="resolve-original-polish"?"Check or fence the original finish. Shells return only after the contract proves cancellation; an already finished token keeps its used finish and payment.":"Use only the operation already reserved in the saved ledger. Its identity, maker and held resources stay unchanged; a timeout never grants another lantern or payment.";
        costs.unshift("No new craft credit, Shell allocation or attached native deposit. Only network gas.");confirmLabel=intent.kind==="check-item"?"Ask Bram to check":intent.kind==="retry-original-item"?"Retry that same job":"Check or fence that polish";
      }
      if(intent.kind==="craft") {const claim=intent.motif==="crest"?j.lens_claim:j.moth_claim;check(j.credit==="available"&&claim&&snapshot.pets[0],"This saved account has not earned an available credit and that motif.");method="tidebound_craft";args={token_id:snapshot.pets[0].token_id,motif:intent.motif,origin_claim_id:claim};title="Make the First Light lantern";description=`Keep the earned ${intent.motif} motif and the maker’s actual accepted origin. One lantern per entitlement.`;costs.unshift("1 protected First Light craft credit. No Shell cost.");confirmLabel="Make my lantern";}
      if(intent.kind==="place") {item(intent.itemId);method="tidebound_place";args={item_id:intent.itemId,socket:intent.socket,expected_revision:j.revision};title=`Light the ${intent.socket}`;description="Place this held lantern. Ownership is checked again by Items.";confirmLabel="Place the lantern";}
      if(intent.kind==="polish") {const held=item(intent.itemId);check(!held.finish_used&&j.shells===12,"This finish is already used or 12 bound Shells are unavailable.");method="tidebound_polish";args={item_id:intent.itemId,expected_appearance:held.appearance_version};title="Harbor polish";description="A sea-glass rim and warmer light. Motif, maker and origin stay the same.";costs.unshift("12 bound Shells, once for this token.");confirmLabel="Polish · 12 Shells";}
      if(intent.kind==="gift"||intent.kind==="storage") {
        check(/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(intent.recipient)&&intent.recipient.length<=64&&intent.recipient!==binding.nearAccountId,"Choose a different existing testnet recipient.");
        await this.connection!.accountExists(intent.recipient);this.guard(epoch,binding);
        if(intent.kind==="gift")item(intent.itemId);const storage=await this.storage(intent.recipient);
        if(intent.kind==="storage"||!storage.ready) {check(storage.deposit>0n,"Storage credit is already sufficient. Review the gift separately.");method="storage_deposit";args={account_id:intent.recipient,registration_only:false};options={receiver:this.connection!.client.itemsContract,deposit:storage.deposit};title="Prepare the recipient’s storage";description=`This credit belongs to ${intent.recipient}. It does not give the lantern. Review the gift separately after its receipt.`;costs.unshift(`${storageNear(storage.deposit)} test NEAR toward ${storageNear(storage.target)} available storage credit.`);confirmLabel=`Fund storage · ${storageNear(storage.deposit)} test NEAR`;}
        else {method="mt_transfer";args={receiver_id:intent.recipient,token_id:intent.itemId,amount:"1",approval:null,memo:null};options={receiver:this.connection!.client.itemsContract,deposit:1n};title="Give the lantern";description=`Give the existing lantern to ${intent.recipient}. Usable placement leaves your harbor. The maker’s achievement stays with its maker.`;costs.unshift("1 yoctoNEAR attached deposit. The existing item changes holder.");confirmLabel="Give this lantern";}
      }
      this.guard(epoch,binding);check(method,"This world interaction is unavailable.");
      const review:WorldReview={id:crypto.randomUUID(),intent:structuredClone(intent),title,description,costs,confirmLabel};
      this.prepared={review:structuredClone(review),epoch,binding:structuredClone(binding),revision:j.revision,checkpointHash:snapshot.checkpointHash,method,args:structuredClone(args),options,record:record?structuredClone(record):undefined};this.update({review});
    });
  }
  async confirm(reviewId:string) {return this.work(async()=>{
    const p=this.prepared;check(p&&p.review.id===reviewId,"Review this interaction again before confirming.");this.guard(p.epoch,p.binding);this.requireSaved();
    const fresh=await this.load(p.binding,p.epoch);check(fresh.journey.revision===p.revision&&fresh.checkpointHash===p.checkpointHash,"The saved harbor changed. Review the interaction again; no new payment was prepared.");
    this.requireSaved();
    if(p.method==="adopt")check(!fresh.pets.length,"Mochi is already home. No new adoption is needed.");
    if(["tidebound_craft","tidebound_claim"].includes(p.method))check(fresh.pets.some(pet=>pet.token_id===p.args.token_id),"The original companion is no longer held by this account.");
    if(["tidebound_place","tidebound_polish","mt_transfer"].includes(p.method))check(fresh.items.some(item=>item.mint.token_id===(p.args.item_id??p.args.token_id)),"This account no longer holds that lantern.");
    if(p.method==="storage_deposit"){const quote=await this.storage(p.args.account_id as string);check(quote.deposit===p.options?.deposit&&!quote.ready,"The recipient’s storage credit changed. Review the gift again before paying.");}
    if(p.method==="mt_transfer")check((await this.storage(p.args.receiver_id as string)).ready,"The recipient’s storage credit changed. Review the gift again.");
    this.guard(p.epoch,p.binding);const receipt=await this.connection!.client.send(p.binding,p.method,p.args,p.options);this.guard(p.epoch,p.binding);
    this.prepared=null;this.update({review:null});await this.load(p.binding,p.epoch);
    if(p.record)await this.acceptReturn(p.record,p.epoch,p.binding);this.guard(p.epoch,p.binding);
    if(p.method==="storage_deposit"){const credit=await this.storage(p.args.account_id as string);this.guard(p.epoch,p.binding);check(credit.ready,"The original receipt finalized, but usable storage credit is not confirmed. Check it before any further payment.");}
    if(p.method==="mt_transfer"){
      const recipient=await this.connection!.client.view<string>(this.connection!.client.itemsContract,"mt_balance_of",{account_id:p.args.receiver_id,token_id:p.args.token_id});this.guard(p.epoch,p.binding);
      check(recipient==="1"&&!this.value.snapshot?.items.some(item=>item.mint.token_id===p.args.token_id),"The original gift receipt finalized, but its current destination has not been confirmed. Keep the receipt; do not send another item.");
    }
    if(p.method==="adopt")check(this.value.snapshot?.pets.some(pet=>pet.token_id===`${p.args.name}.${this.connection!.client.root}`),"The original adoption receipt finalized, but Mochi’s current ownership still needs checking. Keep the original receipt.");
    if(["tidebound_craft","tidebound_retry_operation","tidebound_reconcile","tidebound_cancel_polish","tidebound_polish"].includes(p.method)) {
      const j=this.value.snapshot!.journey,polishPending=j.polish&&["reserved","recovery-required","failed-safe"].includes(j.polish.state),operation=p.method==="tidebound_polish"||p.method==="tidebound_cancel_polish"||polishPending?j.polish:j.craft;
      if(operation?.state==="reserved"||operation?.state==="recovery-required"){this.update({message:"Bram is still checking the original job. Its resources remain reserved; ask about that same job before another action."});return;}
      if(operation?.state==="failed-safe"){this.update({message:"The original job did not complete. The contract’s reconciled resources and current item are shown; no timeout refund was assumed."});return;}
    }
    this.update({message:p.method==="storage_deposit"?"Storage credit confirmed. Review the gift separately; nothing was given.":typeof receipt==="string"?receipt:"The original request finalized. The saved harbor was read again."});
  });}
  private async acceptReturn(record:ReturnRecord,epoch:number,binding:PlayerBinding) {
    const hash=await claimHash(record);this.guard(epoch,binding);const claims=(this.value.snapshot?.journey as {claims?:{operation_id:string;input_hash:string;id:string}[]}|undefined)?.claims,accepted=claims?.find(c=>c.operation_id===record.operationId);
    check(accepted&&accepted.input_hash===hash,"The transaction finalized, but its accepted return still needs checking. Keep the original memory.");await this.records.mark(record.context,record.id,"accepted",accepted.id);this.guard(epoch,binding);this.update({returns:this.recordsFor(this.value.snapshot)});
  }
  /** Season 2: one typed call on season.<root>, sent through the same pending-action path. Returns the final outcome only. */
  async seasonAct(intent:SeasonIntent):Promise<SeasonFinal|null> {
    let final:SeasonFinal|null=null;
    await this.work(async()=>{
      const binding=this.requireSaved(),epoch=this.epoch,client=this.connection!.client,season=`season.${client.root}`;
      let method:string,args:Record<string,unknown>,deposit=0n;
      switch(intent.kind){
        case "register": {
          const minimum=await client.view<string>(season,"storage_minimum");this.guard(epoch,binding);
          check(BigInt(minimum)===SEASON_STORAGE_DEPOSIT,"Bram’s ledger changed its page size. Nothing was sent.");
          method="storage_deposit";args={};deposit=SEASON_STORAGE_DEPOSIT;break;
        }
        case "claim": method="claim_daily";args={rules_version:RULES_VERSION,content_version:intent.contentVersion,tool:intent.tool,area:"beacon",commands:[...intent.commands]};break;
        case "buy": method="buy";args={good:intent.good,qty:intent.qty,max_price:intent.maxPrice};break;
        case "sell": method="sell";args={good:intent.good,qty:intent.qty,min_price:intent.minPrice};break;
        case "set-wish": case "cancel-wish": {
          const pet=this.value.snapshot?.pets[0]?.token_id;check(pet,"Bring Mochi home before setting a wish.");
          method=intent.kind==="set-wish"?"set_wish":"cancel_wish";args=intent.kind==="set-wish"?{pet,good:intent.good,limit:intent.limit,qty:intent.qty}:{pet};break;
        }
      }
      this.guard(epoch,binding);client.lastFinal=null;
      await client.send(binding,method,args,{receiver:season,deposit});this.guard(epoch,binding);
      const last=client.lastFinal as TideboundClient["lastFinal"]|undefined;
      final=last&&last.method===method&&last.receiver===season?{failed:last.failed,outcome:last.outcome}:null;
    },false);
    return final;
  }
  private async original(kind:"resume"|"check"|"expiry") {return this.work(async()=>{
    const binding=this.value.binding,epoch=this.epoch;check(binding&&this.connection,"Sign in with the original identity to check this request.");
    const result=kind==="resume"?await this.connection.client.resumeNative(binding):kind==="check"?await this.connection.client.reconcileNative(binding):await this.connection.client.resolveExpiredNative(binding);
    this.guard(epoch,binding);this.prepared=null;this.update({review:null,message:result});await this.load(binding,epoch);
  });}
  resumeOriginal(){return this.original("resume");}checkOriginal(){return this.original("check");}resolveExpired(){return this.original("expiry");}
}
