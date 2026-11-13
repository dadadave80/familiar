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
  // Newest first. The one note stays attached to the return it was written for, even after later returns.
  const keys=[...returns].reverse().flatMap(r=>r.disposition==="accepted"&&r.acceptedClaimId&&r.context.authority==="near-testnet"?[noteKey(r.context.root,r.context.accountId,r.acceptedClaimId)]:[]);
  const key=keys[0]??null,keyList=keys.join("|");
  const stored=()=>{for(const k of keys){const found=store?readNote(store,k):null;if(found)return found;}return null;};
  const [note,setNote]=useState<Note|null>(stored);
  const [busy,setBusy]=useState(false);
  const [announcement,setAnnouncement]=useState("");
  const paper=useRef<HTMLElement>(null),focusPaper=useRef(false);
  const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{setNote(stored());},[keyList,store]);
  // The ask button goes away with the result; keep keyboard focus on the note instead of the page.
  useEffect(()=>{if(focusPaper.current&&note){focusPaper.current=false;paper.current?.focus();}},[note]);
  if(!key)return null;
  async function ask(){
    setBusy(true);setAnnouncement("Mochi is writing the note.");
    let result:Note;
    try{
      const bearer=await token();
      result=bearer?await write({returns,token:bearer,relayUrl}):{state:"broken",back:{model:"",attestation:"",verifiedIn:"",reason:"Sign in again so the harbor knows who is asking."}};
    }catch{result={state:"broken",back:{model:"",attestation:"",verifiedIn:"",reason:"The note could not be opened."}};}
    // Only finished outcomes are kept. Broken and unrecorded notes can be asked for again.
    if(result.state==="sealed"||result.state==="plain")try{store?.setItem(key!,JSON.stringify(result));}catch{ /* The note still shows for this visit. */ }
    if(alive.current){focusPaper.current=true;setNote(result);setBusy(false);setAnnouncement(ANNOUNCE[result.state]);}
  }
  const status=<p className="sn-status" role="status">{announcement}</p>;
  if(!note)return <section className="sn" aria-label="Mochi's note">
    {status}
    <p className="sn-invite">Mochi has been chewing a pencil since the last return.</p>
    <button className="exp-primary" disabled={busy} aria-busy={busy} onClick={()=>void ask()}>{busy?"Mochi is writing…":"Ask Mochi for a note"}</button>
    <p className="sn-small">One note per accepted return. Only the harbor's name and your recent accepted returns are sent.</p>
  </section>;
  const facts=note.back;
  const again=<button disabled={busy} onClick={()=>void ask()}>{busy?"Trying again…":"Ask again"}</button>;
  return <section className="sn" aria-label="Mochi's note">
    {status}
    <article ref={paper} tabIndex={-1} aria-label={LABEL[note.state]} className={`sn-paper sn-${note.state}`}>
      {note.state==="broken"?<>
        <h3>The note got wet on the way.</h3>
        <p>{facts.reason??"It could not be opened."} Nothing unreadable is shown as Mochi's.</p>
        {facts.code!=="QUOTA"&&facts.code!=="NOTE_NO_EVENT"&&again}
      </>:<>
        <p className="sn-text">{note.text}</p>
        <footer className="sn-mark">
          {note.state==="sealed"?<>
            <svg className="sn-seal" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17"/><circle cx="20" cy="20" r="11.5"/><path d="M14 21.5l4 4 8-9"/></svg>
            <span><strong>Sealed.</strong> {SEALED_LINE}</span>
          </>:note.state==="unrecorded"?<span><strong>Seal not recorded yet.</strong> NEAR AI had not stored the signature when the note arrived, so this one is not kept. Asking again writes a new note.</span>
          :<span><strong>Not sealed.</strong> {facts.reason}</span>}
        </footer>
        {note.state==="unrecorded"&&again}
      </>}
    </article>
    {facts.model&&<details className="sn-back">
      <summary>Turn the note over</summary>
      <dl>{note.state==="sealed"?<>
        <dt>Written by</dt><dd>{facts.model}, inside NEAR AI's confidential computing</dd>
        <dt>Attestation</dt><dd>{attestation(facts)}</dd>
        <dt>Checked</dt><dd>{facts.verifiedIn} The message was encrypted to the attested model key with a one-use key from this browser. The model key signed the exact request and reply bytes, so Familiar's harbor only passed the sealed bytes along and added the service key.</dd>
        {ids(facts)}
        <dt>What the seal means</dt><dd>The note was signed by the attested model key. NEAR AI's instances share that key, so the seal does not name one machine.</dd>
      </>:note.state==="broken"?<>
        <dt>Requested from</dt><dd>{facts.model}</dd>
        <dt>What happened</dt><dd>{facts.reason??"The note could not be opened."}</dd>
      </>:<>
        <dt>Requested from</dt><dd>{facts.model}</dd>
        <dt>Attestation</dt><dd>{attestation(facts)}</dd>
        <dt>Checked</dt><dd>{facts.verifiedIn} The message was encrypted to the attested model key with a one-use key from this browser, and the reply opened with that key.</dd>
        <dt>Why it is not sealed</dt><dd>{note.state==="unrecorded"?"NEAR AI had not recorded a signature for this note yet. Without it, this browser cannot tell who wrote the reply.":`${facts.reason} Without a valid model signature, this browser cannot tell who wrote the reply.`}</dd>
        {ids(facts)}
      </>}</dl>
    </details>}
  </section>;
}

const ANNOUNCE:Record<Note["state"],string>={
  sealed:"Mochi's note arrived. Sealed.",plain:"Mochi's note arrived. Not sealed.",
  unrecorded:"Mochi's note arrived. The seal is not recorded yet.",broken:"The note got wet on the way.",
};
const LABEL:Record<Note["state"],string>={sealed:"Mochi's sealed note",plain:"Mochi's note, not sealed",unrecorded:"Mochi's note, seal not recorded yet",broken:"Mochi's note could not be opened"};
const attestation=(facts:Note["back"])=>`${facts.attestation}${facts.instances?` ${facts.instances} serving ${facts.instances===1?"instance":"instances"} checked; Intel status ${facts.tcbStatus}.`:""}`;
const ids=(facts:Note["back"])=><>
  {facts.modelKey&&<><dt>Model key</dt><dd className="sn-code">{facts.modelKey}</dd></>}
  {facts.chatId&&<><dt>Note id</dt><dd className="sn-code">{facts.chatId}</dd></>}
</>;
