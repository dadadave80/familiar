import {expect,test} from "bun:test";
import {AccountDoesNotExistError} from "near-api-js/rpc-errors";
import type {JsonRpcProvider} from "near-api-js";
import {usernameAvailability} from "./username-availability";

const root="familiar-game.testnet";
test("username preview combines the final ledger reservation and actual account existence",async()=>{
  let reserved:unknown=true,exists=false,calls=0;
  const provider={
    async callFunction(input:any){calls++;expect(input.contractId).toBe(root);expect(input.method).toBe("player_name_available");expect(input.blockQuery).toEqual({finality:"final"});return reserved;},
    async viewAccount(input:any){calls++;expect(input.accountId).toBe(`tide_cat.${root}`);expect(input.blockQuery).toEqual({finality:"final"});if(!exists)throw new AccountDoesNotExistError(input.accountId,"11111111111111111111111111111111",100);return {};},
  } as unknown as Pick<JsonRpcProvider,"callFunction"|"viewAccount">;
  expect(await usernameAvailability(provider,root,"tide_cat")).toEqual({username:"tide_cat",accountId:`tide_cat.${root}`,root,network:"testnet",available:true});
  exists=true;expect((await usernameAvailability(provider,root,"tide_cat")).available).toBe(false);
  exists=false;reserved=false;expect((await usernameAvailability(provider,root,"tide_cat")).available).toBe(false);
  reserved="true";await expect(usernameAvailability(provider,root,"tide_cat")).rejects.toThrow("ERR_AUTH_STACK");
  const before=calls;await expect(usernameAvailability(provider,root,"items")).rejects.toThrow();expect(calls).toBe(before);
});
test("availability errors and a missing different account never masquerade as a free username",async()=>{
  const provider={async callFunction(){return true},async viewAccount(){throw new AccountDoesNotExistError(`other.${root}`,"11111111111111111111111111111111",100)}} as unknown as Pick<JsonRpcProvider,"callFunction"|"viewAccount">;
  await expect(usernameAvailability(provider,root,"tide_cat")).rejects.toThrow();
  provider.viewAccount=async()=>{throw Error("RPC unavailable")};
  await expect(usernameAvailability(provider,root,"tide_cat")).rejects.toThrow("RPC unavailable");
});
