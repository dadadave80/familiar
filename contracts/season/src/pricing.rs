//! Bram's integer pricing. Mirrored exactly by `web/src/season/pricing.ts` (BigInt).
//!
//! Every quantity carrying `_fp` is fixed point with scale `S = 1_000_000`.
//! Rounding rule: every division floors (all operands are unsigned). Converting a
//! price to whole Shells rounds in the till's favour: a player buys a unit for
//! `ceil(price_fp / S)` and sells a unit for `floor(buyback_fp / S)`.
//!
//! price(g)   = base × clamp((target / max(stock, 1))^0.7, 0.5, 3.0) × (1 + 0.15 × heat)
//! buyback(g) = 0.8 × price(g)
//! heat       = heat_units / target, where heat_units halves at each day boundary
//! commission = clamp(12 × price(glass) / base_glass, 6, 36)
//!
//! x^0.7 = x^(1/2) × x^(1/5), computed as floor roots of scaled integers:
//! pow07(X) = floor(isqrt(X × S) × iroot5(X × S^4) / S), with X clamped to
//! [RATIO_MIN, RATIO_MAX] first so every intermediate fits in u128 (≤ 5e30).

pub const S: u128 = 1_000_000;
/// Ratios outside this range are clamped before the power; 0.3^0.7 < 0.5 and 5^0.7 > 3,
/// so the output clamp still decides the result at both ends.
pub const RATIO_MIN: u128 = 300_000;
pub const RATIO_MAX: u128 = 5_000_000;
pub const POW_MIN: u128 = 500_000;
pub const POW_MAX: u128 = 3_000_000;
/// After this many halvings any reachable heat is zero; also keeps the shift in range.
pub const HEAT_HALVINGS_CAP: u64 = 64;

pub fn isqrt(n: u128) -> u128 {
    let (mut lo, mut hi) = (0u128, 1u128 << 64);
    // Invariant: lo^2 <= n < hi^2.
    while hi - lo > 1 {
        let mid = lo + (hi - lo) / 2;
        if mid * mid <= n { lo = mid } else { hi = mid }
    }
    lo
}

pub fn iroot5(n: u128) -> u128 {
    // 2^25^5 = 2^125 < 2^128, and every n here is below 2^103.
    let (mut lo, mut hi) = (0u128, 1u128 << 25);
    while hi - lo > 1 {
        let mid = lo + (hi - lo) / 2;
        if mid * mid * mid * mid * mid <= n {
            lo = mid
        } else {
            hi = mid
        }
    }
    lo
}

/// x^0.7 for a fixed-point ratio, already clamped to [POW_MIN, POW_MAX].
pub fn pow07(ratio_fp: u128) -> u128 {
    let x = ratio_fp.clamp(RATIO_MIN, RATIO_MAX);
    let half = isqrt(x * S);
    let fifth = iroot5(x * S * S * S * S);
    (half * fifth / S).clamp(POW_MIN, POW_MAX)
}

/// Heat units (fixed point) after `days` day boundaries of halving.
pub fn decay_heat(heat_units_fp: u128, days: u64) -> u128 {
    if days >= HEAT_HALVINGS_CAP {
        0
    } else {
        heat_units_fp >> days
    }
}

pub fn price_fp(base: u128, target: u128, stock: u128, heat_units_fp: u128) -> u128 {
    let ratio = target * S / stock.max(1);
    let heat_fp = heat_units_fp / target;
    let mult = S + heat_fp * 3 / 20;
    base * pow07(ratio) * mult / S
}

pub fn buyback_fp(price_fp: u128) -> u128 {
    price_fp * 4 / 5
}

/// Whole Shells a player pays for one unit.
pub fn buy_shells(price_fp: u128) -> u128 {
    price_fp.div_ceil(S)
}

/// Whole Shells Bram pays for one unit.
pub fn sell_shells(price_fp: u128) -> u128 {
    buyback_fp(price_fp) / S
}

pub fn commission(glass_price_fp: u128, glass_base: u128) -> u128 {
    (12 * glass_price_fp / (glass_base * S)).clamp(6, 36)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roots_are_exact_floors() {
        for n in [0u128, 1, 2, 3, 4, 15, 16, 17, 1 << 40, u64::MAX as u128] {
            let r = isqrt(n);
            assert!(r * r <= n && (r + 1) * (r + 1) > n);
        }
        for n in [0u128, 1, 31, 32, 33, 243, 5_000_000 * S * S * S * S] {
            let r = iroot5(n);
            assert!(r.pow(5) <= n && (r + 1).pow(5) > n);
        }
    }

    #[test]
    fn power_matches_the_formula_closely_and_clamps() {
        assert_eq!(pow07(S), S);
        // 2^0.7 = 1.6245, 0.5^0.7 = 0.6156.
        assert!(pow07(2 * S).abs_diff(1_624_504) <= 3);
        assert!(pow07(S / 2).abs_diff(615_572) <= 3);
        assert_eq!(pow07(0), POW_MIN);
        assert_eq!(pow07(u64::MAX as u128), POW_MAX);
        let mut last = 0;
        for x in (0..6_000_000).step_by(997) {
            let p = pow07(x);
            assert!(p >= last, "monotone at {x}");
            last = p;
        }
    }

    #[test]
    fn start_prices_and_commission() {
        assert_eq!(price_fp(8, 40, 40, 0), 8 * S);
        assert_eq!(price_fp(4, 40, 40, 0), 4 * S);
        assert_eq!(buy_shells(8 * S), 8);
        assert_eq!(sell_shells(8 * S), 6);
        assert_eq!(sell_shells(4 * S), 3);
        assert_eq!(commission(8 * S, 8), 12);
        assert_eq!(commission(price_fp(8, 40, 1, 0), 8), 36);
        assert_eq!(commission(price_fp(8, 40, 10_000, 0), 8), 6);
        // 40 recent units on a target of 40: heat 1 adds 15%.
        assert_eq!(price_fp(8, 40, 40, 40 * S), 9_200_000);
        assert_eq!(decay_heat(40 * S, 1), 20 * S);
        assert_eq!(decay_heat(u128::MAX, 200), 0);
    }
}
