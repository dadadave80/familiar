import { base64Decode } from "near-api-js";

export const AUTH_ISSUER = "https://login.testnet.fast-auth.com/";
export type AuthIdentity = { userId:string; publicKey:string; clientId:string };
function check(value:unknown): asserts value { if (!value) throw new Error("ERR_AUTH_REQUEST"); }
function bytesEqual(a:unknown,b:Uint8Array) { return (Array.isArray(a) || a instanceof Uint8Array) && a.length === b.length && b.every((n,i) => a[i] === n); }
function jwtPart(part:string) {
  check(/^[A-Za-z0-9_-]+$/.test(part));
  const base64 = part.replace(/-/g,"+").replace(/_/g,"/");
  return JSON.parse(new TextDecoder("utf-8",{ fatal:true }).decode(base64Decode(base64.padEnd(Math.ceil(base64.length/4)*4,"="))));
}
/** The on-chain guard verifies RSA. These checks bind its claims to the exact native payload. */
export function validateAuthRequest(value:unknown,bytes:Uint8Array,session:AuthIdentity) {
  check(value && typeof value === "object");
  const response = value as { user?:{userId?:unknown}; publicKey?:unknown; signatureRequest?:{guardId?:unknown;verifyPayload?:unknown;signPayload?:unknown} };
  const request = response.signatureRequest;
  check(response.user?.userId === session.userId && response.publicKey === session.publicKey);
  check(/^google-oauth2\|[^#]{1,240}$/.test(session.userId));
  check(request?.guardId === `jwt#${AUTH_ISSUER}` && typeof request.verifyPayload === "string" && request.verifyPayload.length <= 16384 && bytesEqual(request.signPayload,bytes));
  const parts = request.verifyPayload.split(".");
  check(parts.length === 3);
  const header = jwtPart(parts[0]!); const claims = jwtPart(parts[1]!); const now = Math.floor(Date.now()/1000);
  check(header.alg === "RS256" && typeof header.kid === "string");
  check(claims.iss === AUTH_ISSUER && claims.sub === session.userId && claims.azp === session.clientId);
  check(claims.aud === "auth0.jwt.fast-auth.testnet" || (Array.isArray(claims.aud) && claims.aud.includes("auth0.jwt.fast-auth.testnet")));
  check(Number.isSafeInteger(claims.exp) && claims.exp > now && Number.isSafeInteger(claims.iat) && claims.iat <= now+60 && (claims.nbf === undefined || (Number.isSafeInteger(claims.nbf) && claims.nbf <= now)));
  check(typeof claims.scope === "string" && claims.scope.split(" ").includes("transaction:sign") && bytesEqual(claims.fatxn,bytes));
  return { guard_id:request.guardId, verify_payload:request.verifyPayload, sign_payload:[...bytes], algorithm:"eddsa" as const };
}
