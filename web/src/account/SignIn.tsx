import { useEffect, useState } from "react";
import type { PlayerBinding } from "../tidebound/domain";
import { validName } from "../rules";
import type { RecoverableAccountAdapter } from "./adapter";
import { UsernameError, type UsernameAvailability } from "./names";

export function SignIn({ adapter, onBinding, loginLabel="Continue with Google", providerName="Google", unavailableReason="Cross-device saving is not connected at this address. Your local preview is still available." }: {
  adapter: RecoverableAccountAdapter|null;
  onBinding(binding:PlayerBinding|null):void;
  loginLabel?:string;
  providerName?:string;
  unavailableReason?:string;
}) {
  const [binding,setBinding]=useState<PlayerBinding|null>(null);
  const [unbound,setUnbound]=useState(false),[busy,setBusy]=useState(false);
  const [problem,setProblem]=useState(""),[notice,setNotice]=useState("");
  const [username,setUsername]=useState("");
  const [availability,setAvailability]=useState<UsernameAvailability|null>(null);
  useEffect(()=>{
    let live=true;
    if(adapter) {
      setBusy(true);
      adapter.restoreSession().then(restored=>{if(live){setBinding(restored);onBinding(restored)}})
        .catch(()=>{if(live)setProblem("The previous sign-in could not be restored. Sign in again; your local preview is still here.")})
        .finally(()=>{if(live)setBusy(false)});
    }
    return ()=>{live=false};
  },[adapter]);
  async function run(work:()=>Promise<PlayerBinding|null>,signedIn=false,requestedAccount?:string) {
    setBusy(true);setProblem("");setNotice("");
    if(signedIn)setAvailability(null);
    try {
      const result=await work();setBinding(result);setUnbound(signedIn&&!result);onBinding(result);
      if(result && requestedAccount && result.nearAccountId!==requestedAccount)
        setNotice(`This identity already belongs to ${result.nearAccountId}. That account was restored; no new name was created.`);
    } catch(error) {
      setProblem(error instanceof UsernameError ? error.message:"Sign-in did not finish. Your local preview is still available. Retry when you are ready.");
      if(error instanceof UsernameError)setAvailability(null);
    } finally {setBusy(false)}
  }
  async function checkName() {
    if(!adapter)return;
    setBusy(true);setProblem("");setAvailability(null);
    try {setAvailability(await adapter.checkUsername(username));}
    catch(error){setProblem(error instanceof UsernameError ? error.message:"The username could not be checked. No account was created. Try again shortly.");}
    finally{setBusy(false)}
  }
  const checked=availability?.username===username && availability.available;
  return <section className="of-account" aria-label="Account and recovery">
    <h2>Keep your harbor on all your devices</h2>
    {!adapter ? <p>{unavailableReason}</p> : binding ? <>
      <p>Signed in · NEAR testnet</p>
      <p className="of-account-id">{binding.nearAccountId}</p>
      <p>Signing in restores the account. Saved progress and item ownership are confirmed separately below.</p>
      <button disabled={busy} onClick={()=>run(async()=>{await adapter.endSession();return null})}>Sign out</button>
    </> : <>
      <p>Use the same {providerName} identity on each device. Keep your local preview while the account is checked.</p>
      {unbound ? <form onSubmit={event=>{
        event.preventDefault();
        if(!checked || !availability){setProblem("Check this username’s availability before creating your player.");return;}
        void run(()=>adapter.provisionAccount(username),false,availability.accountId);
      }}>
        <label htmlFor="familiar-player-username">Choose a username</label>
        <input id="familiar-player-username" value={username} disabled={busy} minLength={2} maxLength={24} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} aria-describedby="familiar-username-help" onChange={event=>{setUsername(event.target.value);setAvailability(null);setProblem("");setNotice("")}} required/>
        <p id="familiar-username-help">2–24 lowercase letters or numbers, with single hyphens or underscores. Harbor service names are reserved.</p>
        <p className="of-account-id">Requested address: {username||"your-name"}.{adapter.accountRoot}</p>
        <button type="button" disabled={busy||!validName(username)} onClick={()=>void checkName()}>{busy?"Checking…":"Check availability"}</button>
        {availability && <p role="status">{availability.accountId} {availability.available?"is available now. The name is reserved only when creation succeeds.":"is unavailable. Choose another username."}</p>}
        <button disabled={busy||!checked}>{busy?"Creating your account…":"Create my testnet player"}</button>
        {problem && <button type="button" disabled={busy} onClick={()=>void run(()=>adapter.authenticate(),true)}>Check existing account</button>}
        <button type="button" disabled={busy} onClick={()=>void run(async()=>{await adapter.endSession();return null})}>Sign out</button>
      </form> : <button disabled={busy} onClick={()=>void run(()=>adapter.authenticate(),true)}>{busy?"Checking sign-in…":loginLabel}</button>}
    </>}
    {notice && <p role="status">{notice}</p>}
    {problem && <p role="alert">{problem}</p>}
  </section>;
}
