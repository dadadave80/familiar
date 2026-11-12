/** A bounded credit budget, not a claim that registration alone funds an item transfer. */
export const ITEM_STORAGE_TARGET=2n*10n**22n;
export const ITEM_STORAGE_CAP=8n*10n**22n;
export interface ItemStorageQuote {available:bigint;target:bigint;deposit:bigint;ready:boolean}
function check(value:unknown):asserts value {if(!value)throw Error("Recipient item storage could not be safely quoted within the configured cap.");}
function amount(value:unknown):bigint {
  check(typeof value==="string" && /^(0|[1-9][0-9]{0,38})$/.test(value));
  const n=BigInt(value);check(n<(1n<<128n));return n;
}
export function quoteItemStorage(bounds:unknown,balance:unknown):ItemStorageQuote {
  check(bounds && typeof bounds==="object" && !Array.isArray(bounds));
  const b=bounds as Record<string,unknown>,min=amount(b.min),max=b.max===null?null:amount(b.max);
  check(min<=ITEM_STORAGE_CAP && (max===null || max>=min));
  let total=0n,available=0n;
  if(balance!==null) {
    check(balance && typeof balance==="object" && !Array.isArray(balance));
    const value=balance as Record<string,unknown>;total=amount(value.total);available=amount(value.available);
    check(available<=total && total>=min && (max===null || total<=max));
  }
  const deficit=available<ITEM_STORAGE_TARGET?ITEM_STORAGE_TARGET-available:0n;
  const registration=total<min?min-total:0n;
  const deposit=deficit>registration?deficit:registration;
  check(deposit<=ITEM_STORAGE_CAP && (max===null || total+deposit<=max));
  return {available,target:ITEM_STORAGE_TARGET,deposit,ready:deposit===0n};
}
export function storageNear(value:bigint):string {
  const scale=10n**24n,fraction=(value%scale).toString().padStart(24,"0").replace(/0+$/,"");
  return `${value/scale}${fraction?`.${fraction}`:""}`;
}
