import { JsonRpcProvider } from "near-api-js";
import { NearAuthAccountAdapter, recoverableOriginAvailable, type RecoverableAccountAdapter } from "./adapter";

export interface AccountConnection { adapter:RecoverableAccountAdapter; provider:JsonRpcProvider }
import { UsernameError, usernameErrors, type UsernameAvailability } from "./names";
import { assertTideboundProtocol } from "../tidebound/protocol";

export interface RecoverableAccountConfig { root:string; items:string; rpcUrl:string; relayerUrl:string; clientId:string; approvedOrigin:string }
/** Call only with the deployment tuple from build configuration, never query parameters. */
export function createRecoverableAccountConnection(config:RecoverableAccountConfig) {
  const origin=globalThis.location.origin;
  if(!recoverableOriginAvailable({...config,origin}) || !config.root.endsWith(".testnet") || config.items!==`items.${config.root}`) return null;
  const provider=new JsonRpcProvider({url:config.rpcUrl});
  const base=config.relayerUrl.replace(/\/$/,"");
  async function responseValue<T>(response:Response):Promise<T> {
    const value=await response.json().catch(()=>null);
    if(!response.ok){
      const code=value?.code;
      if(typeof code==="string" && Object.hasOwn(usernameErrors,code))throw new UsernameError(code as keyof typeof usernameErrors);
      throw new Error("The account service could not finish this request. Keep the original operation and check its status.");
    }
    return value as T;
  }
  async function post<T>(path:string,body:unknown):Promise<T> {
    return responseValue(await fetch(`${base}${path}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)}));
  }
  const adapter=new NearAuthAccountAdapter({...config,origin,provider,storage:globalThis.localStorage,
    async openSession(mode) {
      const {openRecoverableGoogleSession}=await import("../auth-sdk");
      return openRecoverableGoogleSession(config.rpcUrl,config.clientId,mode);
    },
    availability:async username=>responseValue<UsernameAvailability>(await fetch(`${base}/v1/player-name/${encodeURIComponent(username)}`,{signal:AbortSignal.timeout(15000)})),
    provision:async (publicKey,username)=>{
      if(await provider.getNetworkId()!=="testnet")throw Error("A testnet connection is required.");
      const protocol=await provider.callFunction<Record<string,string>>({contractId:config.root,method:"tidebound_protocol",args:{},blockQuery:{finality:"final"}});
      const items=await provider.callFunction<Record<string,string>>({contractId:config.items,method:"craft_protocol",args:{},blockQuery:{finality:"final"}});
      assertTideboundProtocol(config.root,protocol,items,"These contracts are not the compatible Tidebound stack. No player was created.");
      return post("/v1/guest",{publicKey,username});
    },
    sponsor:body=>post("/v1/auth/sign",body),
  });
  return {adapter,provider};
}
