export function assertQuoteKey(permission: unknown, market: string) {
  if (
    !permission ||
    typeof permission !== "object" ||
    !("FunctionCall" in permission)
  )
    throw new Error("Bram key must be a function-call key.");
  const fc = permission.FunctionCall;
  if (
    !fc ||
    typeof fc !== "object" ||
    !("receiver_id" in fc) ||
    fc.receiver_id !== market ||
    !("method_names" in fc) ||
    !Array.isArray(fc.method_names) ||
    fc.method_names.length !== 1 ||
    fc.method_names[0] !== "set_quotes" ||
    !("allowance" in fc) ||
    typeof fc.allowance !== "string" ||
    !/^\d+$/.test(fc.allowance) ||
    BigInt(fc.allowance) <= 0n ||
    BigInt(fc.allowance) > 10n ** 24n
  )
    throw new Error(
      "Bram key scope or allowance does not match the quote-only policy.",
    );
}

export function assertIsolatedTidebound(root:unknown,legacy:string,explicit:boolean) {
  if(!explicit || typeof root!=="string" || root===legacy || root.length>39 || !root.endsWith(".testnet"))
    throw Error("This build changes initialized state. Use --tidebound with a separate fresh testnet root; legacy deployment is forbidden.");
}
export function assertTideboundProtocol(root:string,protocol:unknown,items:unknown) {
  const p=protocol as Record<string,unknown>|null,i=items as Record<string,unknown>|null;
  if(p?.registry!==root || p?.items!==`items.${root}` || p?.network!=="testnet" || p?.rules_version!=="tidebound_h1_v1" || p?.content_version!=="first_light_v1" || i?.registry!==root)
    throw Error("Initialized contracts do not form the compatible Tidebound tuple. No upgrade or migration will be attempted.");
}
