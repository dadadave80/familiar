import "../browser-globals";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyAccountProvider } from "./PrivyProvider";
import { signPrivyRecoveryProof, type PrivyConnection, type PrivySessionPort, type PrivySignatureProof, type PrivyWalletBinding } from "./privy-adapter";
import "./privy-spike.css";

function RecoveryCheck({connection,session}:{connection:PrivyConnection|null;session:PrivySessionPort|null}) {
  const [wallet,setWallet]=useState<PrivyWalletBinding|null>(null);
  const [proof,setProof]=useState<PrivySignatureProof|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const [signedIn,setSignedIn]=useState(false);
  useEffect(()=>{
    let active=true;
    if(connection&&session){
      setBusy(true);
      session.waitUntilReady().then(()=>connection.adapter.canonicalWallet(false)).then(next=>{if(active){setWallet(next);setSignedIn(!!session.identity());}})
        .catch(()=>{if(active)setMessage("The existing recovery wallet could not be checked. Sign in with the same email, then check again.");})
        .finally(()=>{if(active)setBusy(false);});
    }
    return()=>{active=false};
  },[connection,session]);
  async function work(action:()=>Promise<unknown>) {
    if(busy)return;setBusy(true);setMessage("");
    try{await action();setSignedIn(!!session?.identity());}
    catch(error){setMessage(`${error instanceof Error?error.message:"This step could not be confirmed. Check the same identity and existing wallet before retrying."} No transaction was submitted.`);}
    finally{setBusy(false);}
  }
  async function copyProof() {
    if(!proof)return;
    try{await navigator.clipboard.writeText(JSON.stringify(proof,null,2));setMessage("Public signature proof copied. It contains no email, login token, or private key.");}
    catch{setMessage("Clipboard access was unavailable. Use Download public proof.");}
  }
  function downloadProof() {
    if(!proof)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(proof,null,2)+"\n"],{type:"application/json"}));
    const link=document.createElement("a");link.href=url;link.download="familiar-privy-signature-proof.json";link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
  }
  return <main className="privy-spike-root">
    <section className="privy-spike-sheet" aria-labelledby="privy-spike-title">
      <a className="privy-spike-brand" href="/outing/">familiar<span>.</span></a>
      <h1 id="privy-spike-title">Check your recovery wallet</h1>
      <p>Sign in with email, recover the same Privy NEAR wallet, and verify a real cryptographic signature. The game’s named account and Mochi are separate checks.</p>
      <p className="privy-spike-boundary">Signature only · NEAR testnet context · no transaction broadcast or funding</p>
      {!connection || !session ? <p role="status">Privy is not configured at this address. Supply the public app configuration before this check can begin.</p> : <>
        <div className="privy-spike-actions">
          {!signedIn ? <button disabled={busy} onClick={()=>work(async()=>{setWallet(await connection.adapter.authenticateWallet());setProof(null);})}>Sign in with email</button>
            : <button disabled={busy} onClick={()=>work(async()=>{await connection.adapter.endSession();setWallet(null);setProof(null);})}>Sign out</button>}
          <button disabled={busy||!signedIn} onClick={()=>work(async()=>{setWallet(await connection.adapter.canonicalWallet(false));setProof(null);})}>Check existing wallet</button>
        </div>
        {signedIn&&!wallet&&<>
          <p>No canonical NEAR recovery wallet has been confirmed for this identity. Creating one is an explicit step; signing in does not create it.</p>
          <button disabled={busy} onClick={()=>work(async()=>{setWallet(await connection.adapter.canonicalWallet(true));setProof(null);})}>Create my recovery wallet</button>
        </>}
        {wallet&&<>
          <dl className="privy-spike-wallet">
            <dt>Canonical wallet ID</dt><dd>{wallet.walletId}</dd>
            <dt>Privy’s NEAR implicit address</dt><dd>{wallet.implicitAddress}</dd>
            <dt>NEAR signing public key</dt><dd>{wallet.publicKey}</dd>
          </dl>
          <p>The next step signs SHA-256 of a canonical zero-value self-transfer payload using a final testnet block. Nonce 1 is part of this unsubmitted proof; it is not a claim that this account exists or is funded.</p>
          <button disabled={busy||!signedIn} onClick={()=>work(async()=>{setProof(await signPrivyRecoveryProof(wallet,session,connection.provider,localStorage));setMessage("The Ed25519 signature verified locally against this wallet’s NEAR key. Nothing was broadcast.");})}>Sign and verify proof only</button>
        </>}
        {proof&&<section className="privy-spike-proof" aria-label="Verified public signature proof">
          <h2>Signature verified</h2><p>Wallet ID and public key above identify the signer. This proves this signature, not recovery on another device or ownership of Mochi and items.</p>
          <dl><dt>Transaction hash</dt><dd>{proof.transactionHash}</dd><dt>Verified at</dt><dd>{proof.createdAt}</dd></dl>
          <details><summary>Inspect public proof</summary><pre className="privy-spike-public-proof">{JSON.stringify(proof,null,2)}</pre></details>
          <div className="privy-spike-actions"><button onClick={copyProof}>Copy public proof</button><button onClick={downloadProof}>Download public proof</button></div>
        </section>}
      </>}
      {busy&&<p role="status">Checking the original identity or signature…</p>}
      {message&&<p role="status">{message}</p>}
      <p className="privy-spike-limit">On a second real device, use the same email and compare the wallet ID and key before signing. No two-device recovery result is recorded by this page. Never paste credentials into the proof.</p>
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<PrivyAccountProvider>{(connection,session)=><RecoveryCheck connection={connection} session={session}/>}</PrivyAccountProvider>);
