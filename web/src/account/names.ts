import { validName } from "../rules";

export interface UsernameAvailability {
  username: string;
  accountId: string;
  available: boolean;
  root: string;
  network: "testnet";
}
export const usernameErrors = {
  ERR_USERNAME_REQUIRED: "Choose a username before creating your player.",
  ERR_USERNAME_INVALID: "Use 2–24 lowercase letters or numbers, with single hyphens or underscores. Harbor service names are reserved.",
  ERR_NAME: "That username is invalid or reserved. Choose another name.",
  ERR_USERNAME_TAKEN: "That username is no longer available. Choose another name and check again.",
  ERR_NAME_TAKEN: "That username is no longer available. Choose another name and check again.",
  ERR_USERNAME_PENDING: "Your earlier username request is still pending. Check that request before choosing another name.",
  ERR_PLAYER_PENDING: "Your player creation is still pending. Sign in again to check the same account; no second account has been requested.",
} as const;
export class UsernameError extends Error {
  constructor(readonly code: keyof typeof usernameErrors) { super(usernameErrors[code]); }
}
export function usernameAccountId(username: string, root: string): string {
  if (!validName(username)) throw new UsernameError("ERR_USERNAME_INVALID");
  const account = `${username}.${root}`;
  if (!root.endsWith(".testnet") || account.length > 64) throw new Error("ERR_AUTH_STACK");
  return account;
}
export function isPlayerAccount(account: unknown, root: string): account is string {
  if (typeof account !== "string" || account.length > 64 || !root.endsWith(".testnet") || !account.endsWith(`.${root}`)) return false;
  const username = account.slice(0, -(root.length + 1));
  return validName(username) || /^p-[0-9]+$/.test(username);
}
/** Stable first-adoption ID only. Existing pet IDs and saved native transactions take precedence. */
export async function mochiNameForPlayer(accountId:string,root:string):Promise<string> {
  if(!isPlayerAccount(accountId,root))throw Error("The saved player account could not be verified. Keep the same harbor.");
  const hash=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(accountId)));
  return `mochi-${Array.from(hash.slice(0,9),byte=>byte.toString(16).padStart(2,"0")).join("")}`;
}
