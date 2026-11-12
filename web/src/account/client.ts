import { JsonRpcProvider } from "near-api-js";
import { NearAuthAccountAdapter, recoverableOriginAvailable } from "./adapter";

export interface RecoverableAccountConfig { root:string; items:string; rpcUrl:string; relayerUrl:string; clientId:string; approvedOrigin:string }
/** Call only with the deployment tuple from build configuration, never query parameters. */
export function createRecoverableAccountConnection(config:RecoverableAccountConfig) {
  const origin=globalThis.location.origin;
  if(!recoverableOriginAvailable({...config,origin}) || !config.root.endsWith(".testnet") || config.items!==`items.${config.root}`) return null;
  const provider=new JsonRpcProvider({url:config.rpcUrl});
  const base=config.relayerUrl.replace(/\/$/,"");
  async function post<T>(path:string,body:unknown):Promise<T> {
    const response=await fetch(`${base}${path}`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
    if(!response.ok) throw new Error("The account service could not finish this request. Keep the original operation and check its status.");
    return await response.json() as T;
  }
  const adapter=new NearAuthAccountAdapter({...config,origin,provider,storage:globalThis.localStorage,
    async openSession(mode) {
      const {openRecoverableGoogleSession}=await import("../auth-sdk");
      return openRecoverableGoogleSession(config.rpcUrl,config.clientId,mode);
    },
    provision:async publicKey=>{
      if(await provider.getNetworkId()!=="testnet")throw Error("A testnet connection is required.");
      const protocol=await provider.callFunction<{registry:string;items:string;rules_version:string}>({contractId:config.root,method:"tidebound_protocol",args:{},blockQuery:{finality:"final"}});
      const items=await provider.callFunction<{registry:string}>({contractId:config.items,method:"craft_protocol",args:{},blockQuery:{finality:"final"}});
      if(protocol?.registry!==config.root || protocol.items!==config.items || protocol.rules_version!=="tidebound_h1_v1" || items?.registry!==config.root)throw Error("These contracts are not the compatible Tidebound stack. No player was created.");
      return post("/v1/guest",{publicKey});
    },
    sponsor:body=>post("/v1/auth/sign",body),
  });
  return {adapter,provider};
}
