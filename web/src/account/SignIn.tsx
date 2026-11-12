import { useEffect, useState } from "react";
import type { PlayerBinding } from "../tidebound/domain";
import type { RecoverableAccountAdapter } from "./adapter";

export function SignIn({adapter,onBinding,unavailableReason="Cross-device saving is not connected at this address. Your local preview is still available."}:{
  adapter:RecoverableAccountAdapter|null;
  onBinding(binding:PlayerBinding|null):void;
  unavailableReason?:string;
}) {
  const [binding,setBinding]=useState<PlayerBinding|null>(null);
  const [unbound,setUnbound]=useState(false);
  const [busy,setBusy]=useState(false);
  const [problem,setProblem]=useState("");
  useEffect(()=>{
    let live=true;
    if(adapter) { setBusy(true); adapter.restoreSession().then(restored=>{
      if(live){setBinding(restored);onBinding(restored)}
    }).catch(()=>{if(live)setProblem("The previous sign-in could not be restored. Try Google again; your local preview is still here.")}).finally(()=>{if(live)setBusy(false)}); }
    return ()=>{live=false};
  },[adapter]);
  async function run(work:()=>Promise<PlayerBinding|null>,signedIn=false) {
    setBusy(true);setProblem("");
    try {
      const result=await work();setBinding(result);setUnbound(signedIn && !result);onBinding(result);
    } catch {setProblem("Sign-in did not finish. Your local preview is still available. Retry when you are ready.")}
    finally {setBusy(false)}
  }
  return <section className="of-account" aria-label="Account and recovery">
    <h2>Keep your harbor on all your devices</h2>
    {!adapter ? <p>{unavailableReason}</p> : binding ? <>
      <p>Signed in · NEAR testnet</p>
      <p className="of-account-id">{binding.nearAccountId}</p>
      <p>Signing in restores the account. Saved progress and item ownership are confirmed separately below.</p>
      <button disabled={busy} onClick={()=>run(async()=>{await adapter.endSession();return null})}>Sign out</button>
    </> : <>
      <p>Use the same Google identity on each device. Keep your local preview while the account is checked.</p>
      {unbound ? <>
        <p>This Google identity has no player in this testnet harbor yet.</p>
        <button disabled={busy} onClick={()=>run(()=>adapter.provisionAccount())}>{busy?"Creating your account…":"Create my testnet player"}</button>
      </> : <button disabled={busy} onClick={()=>run(()=>adapter.authenticate(),true)}>{busy?"Checking Google…":"Continue with Google"}</button>}
    </>}
    {problem && <p role="alert">{problem}</p>}
  </section>;
}
