import { lazy, Suspense } from "react";
import { AccountHarbor, type AccountHarborProps } from "../tidebound/AccountHarbor";

const PrivyAccountProvider=lazy(()=>import("./PrivyProvider").then(module=>({default:module.PrivyAccountProvider})));

export function HarborAccount(props:AccountHarborProps) {
  if(import.meta.env.VITE_TIDEBOUND_ENABLED!=="true")return <AccountHarbor {...props} explicitConnection={null}/>;
  if(import.meta.env.VITE_ACCOUNT_PROVIDER!=="privy")return <AccountHarbor {...props}/>;
  return <Suspense fallback={<p>Opening recoverable sign-in…</p>}>
    <PrivyAccountProvider>{connection=><AccountHarbor {...props} explicitConnection={connection} loginLabel="Continue with email" providerName="Privy"/>}</PrivyAccountProvider>
  </Suspense>;
}
