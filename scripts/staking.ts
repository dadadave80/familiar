export function assertStakedPrincipal(account: unknown, expected: bigint) {
  if (typeof expected !== "bigint" || expected <= 0n)
    throw new Error("Expected principal must be a positive bigint.");
  if (
    !account ||
    typeof account !== "object" ||
    Array.isArray(account) ||
    !("staked_balance" in account) ||
    typeof account.staked_balance !== "string" ||
    !/^\d+$/.test(account.staked_balance) ||
    !("unstaked_balance" in account) ||
    typeof account.unstaked_balance !== "string" ||
    !/^\d+$/.test(account.unstaked_balance)
  )
    throw new Error("Pool RPC must return decimal staked and unstaked balances.");
  const staked = BigInt(account.staked_balance);
  if (staked === 0n) throw new Error("Pool must hold a positive stake.");
  // Pool share rounding can leave part of the principal unstaked.
  if (staked + BigInt(account.unstaked_balance) < expected)
    throw new Error("Pool balances must preserve the requested principal.");
}
