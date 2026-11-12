import type {JsonRpcProvider} from "near-api-js";
import {AccountDoesNotExistError} from "near-api-js/rpc-errors";
import {usernameAccountId,type UsernameAvailability} from "./names";

/** A final public preview; the registry still reserves the name atomically on creation. */
export async function usernameAvailability(provider:Pick<JsonRpcProvider,"callFunction"|"viewAccount">,root:string,username:string):Promise<UsernameAvailability> {
  const accountId=usernameAccountId(username,root);
  const available=await provider.callFunction<boolean>({contractId:root,method:"player_name_available",args:{username},blockQuery:{finality:"final"}});
  if(typeof available!=="boolean")throw Error("ERR_AUTH_STACK");
  let exists=true;
  try{await provider.viewAccount({accountId,blockQuery:{finality:"final"}});}
  catch(error){if(error instanceof AccountDoesNotExistError && error.accountId===accountId)exists=false;else throw error;}
  return {username,accountId,available:available&&!exists,root,network:"testnet"};
}
