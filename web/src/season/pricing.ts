/**
 * Bram's integer pricing, identical to contracts/season/src/pricing.rs.
 * Fixed point scale S = 1e6; every division floors (all values are non-negative BigInt).
 * A unit bought costs ceil(price / S) Shells; a unit sold pays floor(0.8 × price / S).
 */
export const S = 1_000_000n;
export const RATIO_MIN = 300_000n;
export const RATIO_MAX = 5_000_000n;
export const POW_MIN = 500_000n;
export const POW_MAX = 3_000_000n;
export const HEAT_HALVINGS_CAP = 64n;
export const GOODS = ["glass", "reed"] as const;
export type Good = typeof GOODS[number];
export const BASE: Record<Good, bigint> = { glass: 8n, reed: 4n };
export const TARGET: Record<Good, bigint> = { glass: 40n, reed: 40n };

const clamp = (x: bigint, lo: bigint, hi: bigint) => x < lo ? lo : x > hi ? hi : x;
const max = (a: bigint, b: bigint) => a > b ? a : b;

export function isqrt(n: bigint): bigint {
  let lo = 0n, hi = 1n << 64n;
  while (hi - lo > 1n) { const mid = lo + (hi - lo) / 2n; if (mid * mid <= n) lo = mid; else hi = mid; }
  return lo;
}
export function iroot5(n: bigint): bigint {
  let lo = 0n, hi = 1n << 25n;
  while (hi - lo > 1n) { const mid = lo + (hi - lo) / 2n; if (mid ** 5n <= n) lo = mid; else hi = mid; }
  return lo;
}
export function pow07(ratioFp: bigint): bigint {
  const x = clamp(ratioFp, RATIO_MIN, RATIO_MAX);
  return clamp(isqrt(x * S) * iroot5(x * S ** 4n) / S, POW_MIN, POW_MAX);
}
export function decayHeat(heatUnitsFp: bigint, days: bigint): bigint {
  return days >= HEAT_HALVINGS_CAP ? 0n : heatUnitsFp >> days;
}
export function priceFp(base: bigint, target: bigint, stock: bigint, heatUnitsFp: bigint): bigint {
  const ratio = target * S / max(stock, 1n);
  const heatFp = heatUnitsFp / target;
  return base * pow07(ratio) * (S + heatFp * 3n / 20n) / S;
}
export const buybackFp = (price: bigint) => price * 4n / 5n;
export const buyShells = (price: bigint) => (price + S - 1n) / S;
export const sellShells = (price: bigint) => buybackFp(price) / S;
export const commission = (glassPriceFp: bigint, glassBase = BASE.glass) => clamp(12n * glassPriceFp / (glassBase * S), 6n, 36n);
export const goodPriceFp = (good: Good, stock: bigint, heatUnitsFp: bigint) => priceFp(BASE[good], TARGET[good], stock, heatUnitsFp);
