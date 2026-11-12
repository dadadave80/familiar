import { useEffect, useMemo, useRef, useState } from "react";
import { createRecoverableAccountConnection, type AccountConnection } from "../account/client";
import { SignIn } from "../account/SignIn";
import { mochiNameForPlayer } from "../account/names";
import type { Home } from "../outing/home";
import type { Outing as Run } from "../outing/engine";
import { RULES_VERSION, prepareAdoption, type PlayerBinding, type MotifId } from "./domain";
import { claimInput, TideboundClient, type ChainSnapshot, type CraftItem } from "./client";
import { LanternArt, OriginDiorama } from "./Storycraft";
import { quoteItemStorage, storageNear, type ItemStorageQuote } from "./storage";
import "./account-harbor.css";

export interface AccountHarborProps {
  home:Home; returned:Run|null;
  onSnapshot:(snapshot:ChainSnapshot|null)=>void;
  onUseSaved:(snapshot:ChainSnapshot)=>void;
  explicitConnection?:AccountConnection|null;
  loginLabel?:string; providerName?:string;
}
export function AccountHarbor({home,returned,onSnapshot,onUseSaved,explicitConnection,loginLabel,providerName}:AccountHarborProps) {
  const [fallback]=useState(()=>{
    try {
      if(explicitConnection!==undefined)return null;
      if(import.meta.env.VITE_TIDEBOUND_ENABLED!=="true")return null;
      const root=import.meta.env.VITE_NEAR_ROOT??"";
      return createRecoverableAccountConnection({root,items:`items.${root}`,rpcUrl:import.meta.env.VITE_NEAR_RPC_URL??"https://test.rpc.fastnear.com",relayerUrl:import.meta.env.VITE_RELAYER_URL??"/api",clientId:import.meta.env.VITE_NEAR_AUTH_CLIENT_ID??"",approvedOrigin:import.meta.env.VITE_TIDEBOUND_AUTH_ORIGIN??""});
    } catch {return null;}
  });
  const source=explicitConnection===undefined?fallback:explicitConnection;
  const connection=useMemo(()=>source && {...source,client:new TideboundClient(source.adapter.accountRoot,`items.${source.adapter.accountRoot}`,source.provider,source.adapter,localStorage)},[source]);
  const [binding,setBinding]=useState<PlayerBinding|null>(null);
  const currentBinding=useRef<PlayerBinding|null>(null);
  const generation=useRef(0);
  const updateBinding=(next:PlayerBinding|null)=>{generation.current++;currentBinding.current=next;setBinding(next);};
  const [snapshot,setSnapshot]=useState<ChainSnapshot|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [motif,setMotif]=useState<MotifId>(home.storycraft.lantern?.motif??"crest");
  const [recipient,setRecipient]=useState(""),[gift,setGift]=useState<{item:CraftItem;recipient:string;storage:ItemStorageQuote}|null>(null);
  const [polish,setPolish]=useState<CraftItem|null>(null);
  const confirmation=useRef<HTMLDivElement>(null);
  const confirmationTrigger=useRef<HTMLButtonElement|null>(null);
  useEffect(()=>{
    if(home.storycraft.lantern && !snapshot?.journey.craft)setMotif(home.storycraft.lantern.motif);
  },[home.storycraft.lantern?.motif,!!snapshot?.journey.craft]);
  useEffect(()=>{
    if(!gift && !polish)return;
    confirmation.current?.focus({preventScroll:true});
    confirmation.current?.scrollIntoView({block:"start",inline:"nearest"});
  },[gift,polish]);
  function closeConfirmation() {
    setGift(null);setPolish(null);
    requestAnimationFrame(()=>{
      confirmationTrigger.current?.focus({preventScroll:true});
      confirmationTrigger.current?.scrollIntoView({block:"nearest",inline:"nearest"});
    });
  }
  function exportProgress() {
    if(!connection || !snapshot)return;
    try {
      const url=URL.createObjectURL(new Blob([connection.client.export(snapshot)],{type:"application/json"}));
      const link=document.createElement("a");link.href=url;link.download="familiar-testnet-progress.json";link.click();
      setTimeout(()=>URL.revokeObjectURL(url),0);
      setMessage("Progress export prepared. It contains no credentials.");
    } catch {setMessage("The export could not be prepared. Your saved harbor is unchanged.");}
  }
  async function refresh(account:PlayerBinding) {
    if(!connection)return;
    const next=await connection.client.snapshot(account);
    if(currentBinding.current?.nearAccountId!==account.nearAccountId || currentBinding.current?.signerPublicKey!==account.signerPublicKey)return;
    setSnapshot(next);onSnapshot(next);return next;
  }
  useEffect(()=>{
    let active=true;
    setSnapshot(null);setGift(null);setPolish(null);setMessage("");
    if(binding && connection) {
      setBusy(true);
      connection.client.snapshot(binding).then(next=>{if(active){setSnapshot(next);onSnapshot(next)}}).catch(()=>{if(active)setMessage("The compatible testnet harbor could not be read. Keep playing locally; no ownership is confirmed.")}).finally(()=>{if(active)setBusy(false)});
    } else {setBusy(false);onSnapshot(null);}
    return ()=>{active=false};
  },[binding,connection]);
  async function run(work:()=>Promise<unknown>) {
    if(busy)return;const epoch=generation.current;setBusy(true);setMessage("");setGift(null);
    try {const result=await work();if(generation.current!==epoch)return;if(typeof result==="string")setMessage(result);if(binding)await refresh(binding);}
    catch(error){if(generation.current===epoch)setMessage(error instanceof Error ? error.message:"The action could not be confirmed. Keep the original operation.");}
    finally{if(generation.current===epoch)setBusy(false)}
  }
  const send=(method:string,args:Record<string,unknown>={})=>connection!.client.send(binding!,method,args);
  async function adoptMochi() {
    const account=currentBinding.current,epoch=generation.current;
    if(!account || !connection)return;
    const fresh=await refresh(account);
    if(generation.current!==epoch || currentBinding.current!==account || !fresh)return;
    if(fresh.pets.length)return "Mochi is already home.";
    const name=await mochiNameForPlayer(account.nearAccountId,connection.adapter.accountRoot);
    if(generation.current!==epoch || currentBinding.current!==account)return;
    return connection.client.send(account,"adopt",{name});
  }
  const j=snapshot?.journey;
  let pending=null;
  try{pending=binding&&connection?connection.client.pending(binding):null;}catch{ /* Preserve malformed pending data; the next account action explains the error. */ }
  const localLantern=home.storycraft.lantern;
  const originalCraft=snapshot?.items.find(item=>item.mint.token_id===j?.craft?.evidence.token_id);
  const adoption=snapshot && binding && connection ? prepareAdoption(home.storycraft,{
    authority:"near-testnet",revision:snapshot.journey.revision,verifiedLensReturn:!!j?.lens_claim,verifiedMothReturn:!!j?.moth_claim,
    craftState:snapshot.journey.credit,canonicalCraftOperationId:j?.craft?.evidence.id??null,
    ownedCraft:originalCraft ? {itemContract:connection.client.itemsContract,tokenId:originalCraft.mint.token_id,network:"testnet",holderAccountId:binding.nearAccountId,originalMakerAccountId:originalCraft.mint.maker,originClaimId:originalCraft.mint.origin_claim_id,rulesVersion:originalCraft.mint.rules_version,recipeId:"first_light_lantern_v1",originalMotifId:originalCraft.mint.motif,finishId:originalCraft.finish,finishUsed:originalCraft.finish_used,currentAppearanceVersion:originalCraft.appearance_version,metadataHash:originalCraft.mint.input_hash}:null,
  }):null;
  const adoptionMessage=localLantern && adoption ? adoption.kind==="preserve-memory" ? adoption.reason
    : adoption.kind==="use-authoritative" ? `The saved lantern keeps its original ${adoption.item.originalMotifId=== "crest"?"Crest":"Moth"} motif. Your device preview stays a private memory; placement is a separate choice.`
    : adoption.kind==="reconcile" ? "Your first craft is already reserved. Check its original operation; the device preview remains a private memory."
    : `Your device preview chose ${localLantern.motif==="crest"?"Crest":"Moth"} at the ${localLantern.socket}. Crafting uses an accepted claim for that motif; a local preview alone cannot issue an item.` : null;
  const origin=returned?.outcome==="returned" ? {tool:returned.tool,area:returned.area,banked:returned.banked,actions:returned.actions} : home.storycraft.origins[motif];
  async function saveReturn() {
    if(!snapshot || !origin)return;
    return send("tidebound_claim",claimInput(snapshot,origin,`claim:${crypto.randomUUID()}`));
  }
  async function previewGift(item:CraftItem) {
    if(!connection || !binding)return;
    if(!/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(recipient) || recipient.length>64 || recipient===binding.nearAccountId)throw Error("Enter a different existing NEAR testnet account.");
    await connection.provider.viewAccount({accountId:recipient});
    if(await connection.client.view<string>(connection.client.itemsContract,"mt_balance_of",{account_id:binding.nearAccountId,token_id:item.mint.token_id})!=="1")throw Error("This lantern has already changed hands. Refresh its ownership.");
    const storage=await recipientStorage(recipient);
    if(currentBinding.current===binding)setGift({item,recipient,storage});
  }
  async function recipientStorage(accountId:string) {
    const [bounds,balance]=await Promise.all([
      connection!.client.view<unknown>(connection!.client.itemsContract,"storage_balance_bounds"),
      connection!.client.view<unknown>(connection!.client.itemsContract,"storage_balance_of",{account_id:accountId}),
    ]);
    return quoteItemStorage(bounds,balance);
  }
  return <section className="tb-account-harbor" aria-label="Saved harbor on NEAR testnet" tabIndex={0}>
    <SignIn adapter={connection?.adapter??null} onBinding={updateBinding} loginLabel={loginLabel} providerName={providerName}/>
    {binding && <>
      <button disabled={busy} onClick={()=>run(()=>refresh(binding))}>Check saved harbor</button>
      {pending && <div className="tb-pending"><p>Original {pending.method} · {pending.state}. Another action will not replace it.</p>
        <button disabled={busy} onClick={()=>run(()=>pending.state==="submitted"?connection!.client.reconcileNative(binding):connection!.client.resumeNative(binding))}>{pending.state==="submitted"?"Check original receipt":"Resume original action"}</button>
        <p>Only a provably expired, unused signing request can be cleared. Craft and Shell reservations are checked separately.</p>
        <button disabled={busy} onClick={()=>run(()=>connection!.client.resolveExpiredNative(binding))}>Resolve expired unexecuted request</button>
        <a href={`https://testnet.nearblocks.io/txns/${pending.hash}`} target="_blank" rel="noreferrer">View testnet receipt</a>
      </div>}
    </>}
    {snapshot && j && <>
      <p>Saved progress · NEAR testnet · revision {j.revision}. Each action’s ownership is checked again by the contracts.</p>
      <button disabled={busy || !!home.active} onClick={()=>{try{onUseSaved(snapshot)}catch{setMessage("The saved harbor could not be opened on this device. The earlier preview was preserved.")}}}>Use saved harbor for next outing</button>
      <p className="tb-account-note">Your device preview stays separate. Active outings are never merged. This chooses the confirmed starting checkpoint.</p>
      {adoptionMessage && <p className="tb-account-note">{adoptionMessage}</p>}
      {!snapshot.pets.length && <button disabled={busy || !!pending} onClick={()=>void run(adoptMochi)}>Adopt Mochi</button>}
      {snapshot.pets.length>0 && <>
        {origin && <button disabled={busy || !!pending} onClick={()=>run(saveReturn)}>Save returned outing on testnet</button>}
        {!!j.lens_claim && !j.lit && <button disabled={busy || !!pending} onClick={()=>run(()=>send("tidebound_restore",{restoration:"beacon"}))}>Confirm beacon restoration</button>}
        {j.lit && j.banked.includes("vane") && !j.signaled && <button disabled={busy || !!pending} onClick={()=>run(()=>send("tidebound_restore",{restoration:"signal"}))}>Confirm signal repair</button>}
        {j.credit==="available" && <>
          <label>Earned motif<select value={motif} onChange={e=>setMotif(e.target.value as MotifId)}><option value="crest">Crest</option><option value="moth" disabled={!j.moth_claim}>Moth{!j.moth_claim?" · rescue required":""}</option></select></label>
          <button disabled={busy || !!pending || (motif==="moth"&&!j.moth_claim)} onClick={()=>run(()=>send("tidebound_craft",{token_id:snapshot.pets[0]!.token_id,motif,origin_claim_id:motif==="crest"?j.lens_claim:j.moth_claim}))}>Craft lantern on testnet</button>
        </>}
      </>}
      {(["reserved","recovery-required"].includes(j.craft?.state??"") || ["reserved","recovery-required"].includes(j.polish?.state??"")) && <>
        <p>The original operation is reserved. Its item receipt is still being checked.</p>
        <button disabled={busy || !!pending} onClick={()=>run(()=>send("tidebound_reconcile"))}>Check item operation</button>
        <button disabled={busy || !!pending} onClick={()=>run(()=>send("tidebound_retry_operation"))}>Retry same item operation</button>
        {["reserved","recovery-required"].includes(j.polish?.state??"") && <button disabled={busy || !!pending} onClick={()=>run(()=>send("tidebound_cancel_polish"))}>Resolve or cancel original polish</button>}
      </>}
      {j.workshop_salvage===1 && <button disabled={busy || !!pending} onClick={()=>run(()=>send("tidebound_commission"))}>Fulfill Bram’s request · 1 workshop salvage → 12 Shells</button>}
      {j.commission_fulfilled && <p>Bram’s personal request completed. {j.shells} bound Shells · no cash redemption.</p>}
      {snapshot.items.map(item=><article key={item.mint.token_id} className="tb-owned-lantern">
        <LanternArt motif={item.mint.motif} polished={item.finish_used}/>
        <h3>First Light lantern · {item.mint.motif==="crest"?"Crest":"Moth"}</h3>
        <p>Owned item confirmed on NEAR testnet. Maker: {item.mint.maker}</p>
        <p>{item.finish_used?"Harbor polish · finish used":"Original finish"}. Receiving this item does not grant its maker’s achievement.</p>
        <details><summary>Origin and token</summary><OriginDiorama motif={item.mint.motif}/><p>Illustrative diorama of the maker’s accepted event, not a recorded screenshot.</p><p>{item.mint.motif==="moth"?"Wind-moth returned":"Beacon Lens returned"} · accepted claim {item.mint.origin_claim_id}</p><p>{item.mint.token_id}</p><p>Rules {RULES_VERSION}; provenance hash {item.mint.input_hash}</p></details>
        {localLantern && <p className="tb-account-note">Your device preview uses the {localLantern.socket}. You can place this confirmed lantern there; its minted motif stays unchanged.</p>}
        <div className="tb-canonical-actions">
          {(["porch","dock"] as const).map(socket=><button key={socket} disabled={busy || !!pending} onClick={()=>run(()=>send("tidebound_place",{item_id:item.mint.token_id,socket,expected_revision:j.revision}))}>Place at {socket}</button>)}
          {!item.finish_used && <button disabled={busy || !!pending || j.shells!==12} onClick={event=>{confirmationTrigger.current=event.currentTarget;setGift(null);setPolish(item)}}>Preview harbor polish · 12 Shells</button>}
        </div>
        <label>Gift to a testnet account<input value={recipient} onChange={e=>{setRecipient(e.target.value);setGift(null)}} autoCapitalize="none" spellCheck={false}/></label>
        <button disabled={busy || !!pending || !recipient} onClick={event=>{confirmationTrigger.current=event.currentTarget;setPolish(null);void run(()=>previewGift(item))}}>Review gift</button>
      </article>)}
      {polish && <div ref={confirmation} tabIndex={-1} className="tb-gift-confirm" role="region" aria-label="Preview harbor polish">
        <h3>Harbor polish</h3><div className="tb-canonical-actions"><span><LanternArt motif={polish.mint.motif}/>Original</span><span><LanternArt motif={polish.mint.motif} polished/>Sea-glass rim and warmer light</span></div>
        <p>12 bound Shells, once for this token. Its motif, maker and origin stay the same.</p>
        <button disabled={busy || !!pending} onClick={()=>{setPolish(null);void run(()=>send("tidebound_polish",{item_id:polish.mint.token_id,expected_appearance:polish.appearance_version}))}}>Confirm polish · 12 Shells</button>
        <button onClick={closeConfirmation}>Keep original finish</button>
      </div>}
      {gift && <div ref={confirmation} tabIndex={-1} role="region" aria-label="Confirm lantern gift" className="tb-gift-confirm">
        <p>Give this existing lantern to {gift.recipient} on NEAR testnet. Your usable placement will disappear after confirmation; the maker’s journey stays with the maker.</p>
        {!gift.storage.ready?<>
          <p>First deposit {storageNear(gift.storage.deposit)} test NEAR for {gift.recipient}’s item storage, plus network gas. Their available credit is {storageNear(gift.storage.available)}; the target is {storageNear(gift.storage.target)} test NEAR. This separate deposit belongs to the recipient, and does not give the lantern.</p>
          <button disabled={busy || !!pending} onClick={()=>run(async()=>{
            const fresh=await recipientStorage(gift.recipient);
            if(fresh.deposit!==gift.storage.deposit || fresh.ready)throw Error("The recipient’s storage credit changed. Review the gift again before paying.");
            return connection!.client.send(binding!,"storage_deposit",{account_id:gift.recipient,registration_only:false},{receiver:connection!.client.itemsContract,deposit:gift.storage.deposit});
          })}>Confirm storage deposit · {storageNear(gift.storage.deposit)} test NEAR</button>
          <p>After its receipt is confirmed, review the gift again. An uncertain request must keep its original receipt; it never authorizes another payment.</p>
        </>:<><p>Recipient storage credit checked. Giving the lantern is a separate action: 1 yoctoNEAR plus network gas.</p><button disabled={busy || !!pending} onClick={()=>run(async()=>{
          if(!(await recipientStorage(gift.recipient)).ready)throw Error("The recipient’s available storage changed. Review the gift again.");
          return connection!.client.send(binding!,"mt_transfer",{receiver_id:gift.recipient,token_id:gift.item.mint.token_id,amount:"1",approval:null,memo:null},{receiver:connection!.client.itemsContract,deposit:1n});
        })}>Confirm gift of this lantern</button></>}
        <button onClick={closeConfirmation}>Cancel gift</button>
      </div>}
      {snapshot.nextItemIndex!==null && <button disabled={busy} onClick={async()=>{
        if(!connection || !binding)return;const epoch=generation.current;setBusy(true);
        try{const page=await connection.client.snapshot(binding,snapshot.nextItemIndex!);if(generation.current===epoch){const next={...page,items:[...snapshot.items,...page.items]};setSnapshot(next);onSnapshot(next);}}
        catch{if(generation.current===epoch)setMessage("The next inventory page could not be read. Keep the last confirmed page.");}
        finally{if(generation.current===epoch)setBusy(false)}
      }}>Check next inventory page</button>}
      <button onClick={exportProgress}>Export progress and item references</button>
    </>}
    {message && <p role="status" className="tb-account-message">{message}</p>}
  </section>;
}
