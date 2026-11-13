import {useEffect,useRef,useState} from "react";
import type {ReturnRecord} from "../expedition/return-record";
import {noteKey,readNote,writeSealedNote,type SealedNote as Note} from "./write";
import "./sealed-note.css";

export const SEALED_LINE="Written where nobody could read over her shoulder.";
export const sealedNoteEnabled=()=>import.meta.env.VITE_SEALED_NOTE_ENABLED==="true";

type Store=Pick<Storage,"getItem"|"setItem">;
const browserStore=():Store|null=>{try{return globalThis.localStorage;}catch{return null;}};

/** Mochi's one note, attached to the newest accepted return. Only game-recorded facts are sent. */
export function SealedNote({returns,token,relayUrl=import.meta.env.VITE_RELAYER_URL??"/api",write=writeSealedNote,store=browserStore()}:{
  returns:readonly ReturnRecord[];token:()=>Promise<string|null>;relayUrl?:string;
  write?:typeof writeSealedNote;store?:Store|null;
}) {
  const latest=[...returns].reverse().find(r=>r.disposition==="accepted"&&r.acceptedClaimId);
  const key=latest&&latest.context.authority==="near-testnet"?noteKey(latest.context.root,latest.context.accountId,latest.acceptedClaimId!):null;
  const [note,setNote]=useState<Note|null>(()=>key&&store?readNote(store,key):null);
  const [busy,setBusy]=useState(false);
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{setNote(key&&store?readNote(store,key):null);},[key,store]);
  if(!latest||!key)return null;
  async function ask(){
    setBusy(true);
    let result:Note;
    try{
      const bearer=await token();
      result=bearer?await write({returns,token:bearer,relayUrl}):{state:"broken",back:{model:"",attestation:"",verifiedIn:"",reason:"Sign in again so the harbor knows who is asking."}};
    }catch{result={state:"broken",back:{model:"",attestation:"",verifiedIn:"",reason:"The note could not be opened."}};}
    if(result.state!=="broken")try{store?.setItem(key!,JSON.stringify(result));}catch{ /* The note still shows for this visit. */ }
    if(alive.current){setNote(result);setBusy(false);}
  }
  if(!note)return <section className="sn" aria-label="Mochi's note">
    <p className="sn-invite">Mochi has been chewing a pencil since the last return.</p>
    <button className="exp-primary" disabled={busy} aria-busy={busy} onClick={()=>void ask()}>{busy?"Mochi is writing…":"Ask Mochi for a note"}</button>
    <p className="sn-small">One note per harbor. Only the harbor's name and your recent accepted returns are sent.</p>
  </section>;
  const facts=note.back;
  return <section className="sn" aria-label="Mochi's note" aria-live="polite">
    <article className={`sn-paper sn-${note.state}`}>
      {note.state==="broken"?<>
        <h3>The note got wet on the way.</h3>
        <p>{facts.reason??"It could not be opened."} Nothing unreadable is shown as Mochi's.</p>
        <button disabled={busy} onClick={()=>void ask()}>{busy?"Trying again…":"Ask again"}</button>
      </>:<>
        <p className="sn-text">{note.text}</p>
        <footer className="sn-mark">
          {note.state==="sealed"?<>
            <svg className="sn-seal" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17"/><circle cx="20" cy="20" r="11.5"/><path d="M14 21.5l4 4 8-9"/></svg>
            <span><strong>Sealed.</strong> {SEALED_LINE}</span>
          </>:<span><strong>Not sealed.</strong> Mochi wrote this, but the seal could not be checked: {facts.reason}</span>}
        </footer>
      </>}
    </article>
    {facts.model&&<details className="sn-back">
      <summary>Turn the note over</summary>
      <dl>
        <dt>Written by</dt><dd>{facts.model}, inside NEAR AI's confidential computing</dd>
        <dt>Attestation</dt><dd>{facts.attestation}{facts.instances?` ${facts.instances} serving ${facts.instances===1?"instance":"instances"} checked; Intel status ${facts.tcbStatus}.`:""}</dd>
        <dt>Checked</dt><dd>{facts.verifiedIn} The message and reply were encrypted to the model key with a one-use key from this browser. Familiar's harbor only passed the sealed bytes along and added the service key.</dd>
        {facts.modelKey&&<><dt>Model key</dt><dd className="sn-code">{facts.modelKey}</dd></>}
        {facts.chatId&&<><dt>Note</dt><dd className="sn-code">{facts.chatId}</dd></>}
        <dt>What the seal means</dt><dd>The note was signed by the attested model key. NEAR AI's instances share that key, so the seal does not name one machine.</dd>
      </dl>
    </details>}
  </section>;
}
