pub const ENERGY_MAX: u8 = 3;
pub const ENERGY_REFILL_SECS: u64 = 8 * 3600;
pub const MOOD_MAX: u8 = 100;
pub const MOOD_DECAY_PER_HOUR: u8 = 2;
pub const FEED_MOOD: u8 = 30;
pub const STREAK_FREEZES: u8 = 1;
pub const YOCTO: u128 = 1_000_000_000_000_000_000_000_000;
pub const PET_RESERVE: u128 = YOCTO / 10;
pub const ADOPT_FUND: u128 = YOCTO * 3 / 10;
pub const PLAYER_FUND: u128 = YOCTO / 20;
pub const ITEM_STORAGE_FUND: u128 = YOCTO / 50;
pub const NFT_STORAGE_RESERVE_BYTES: u64 = 5_000;
pub const PLAYER_STORAGE_RESERVE_BYTES: u64 = 1_024;
pub const MARKET_OPERATION_STORAGE_BYTES: u64 = 2_048;
pub const MARKET_LISTING_STORAGE_BYTES: u64 = 1_024;
pub const MARKET_LISTING_LIMIT: u32 = 100;
pub const MARKET_FEE_BPS: u128 = 200;
pub const LEVEL_XP: [u32; 6] = [0, 2, 4, 7, 11, 16];
pub const UNBOND_EPOCHS: u64 = 4;
pub const ITEMS: [&str; 7] = [
    "flour", "water", "berries", "bread", "hat", "scarf", "lantern",
];
pub fn energy_at(energy: u8, last: u64, now: u64) -> u8 {
    (energy as u64 + now.saturating_sub(last) / ENERGY_REFILL_SECS).min(ENERGY_MAX as u64) as u8
}
pub fn mood_at(mood: u8, last: u64, now: u64) -> u8 {
    (mood as u64)
        .saturating_sub(
            (now.saturating_sub(last) / 3600).saturating_mul(MOOD_DECAY_PER_HOUR as u64),
        )
        .min(MOOD_MAX as u64) as u8
}
pub fn market_fee(gross: u128) -> u128 {
    gross / 50
}
pub fn level(xp: u32) -> u8 {
    LEVEL_XP.iter().take_while(|n| xp >= **n).count() as u8
}
pub fn valid_name(name: &str) -> bool {
    if !(2..=24).contains(&name.len())
        || ["items", "bakery", "market", "relayer", "bram", "jar"].contains(&name)
        || ["den-", "p-", "seat-"].iter().any(|p| name.starts_with(p))
    {
        return false;
    }
    let mut separator = true;
    for c in name.bytes() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            separator = false;
        } else if (c == b'-' || c == b'_') && !separator {
            separator = true;
        } else {
            return false;
        }
    }
    !separator
}
pub fn week_at(timestamp_secs: u64) -> u64 {
    // The Unix epoch was a Thursday; shift three days to start weeks on Monday.
    (timestamp_secs / 86_400 + 3) / 7
}
pub fn streak_at(streak: u32, last: Option<u32>, day: u32, freeze: bool) -> (u32, bool) {
    match last {
        None => (1, freeze),
        Some(d) if day <= d => (streak, freeze),
        Some(d) if day == d.saturating_add(1) => (streak.saturating_add(1), freeze),
        Some(d) if day == d.saturating_add(2) && freeze => (streak.saturating_add(1), false),
        _ => (1, freeze),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn weeks_change_at_monday_midnight_utc() {
        assert_eq!(week_at(1_794_182_399) + 1, week_at(1_794_182_400));
        assert_eq!(
            week_at(1_794_182_400),
            week_at(1_794_182_400 + 7 * 86_400 - 1)
        );
        assert_eq!(week_at(4 * 86_400 - 1), 0);
        assert_eq!(week_at(4 * 86_400), 1);
    }
    #[test]
    fn refill_preserves_partial_time() {
        assert_eq!(energy_at(0, 0, 28_799), 0);
        assert_eq!(energy_at(0, 0, 28_800), 1);
        assert_eq!(energy_at(2, 0, 288_000), 3);
        assert_eq!(energy_at(2, 100, 0), 2);
    }
    #[test]
    fn safe_mood_and_fee() {
        assert_eq!(mood_at(100, 0, 3_600), 98);
        assert_eq!(mood_at(10, 0, u64::MAX), 0);
        assert_eq!(market_fee(101), 2);
        assert_eq!(market_fee(u128::MAX), u128::MAX / 50);
    }
    #[test]
    fn reserved_and_invalid_names() {
        for s in [
            "a",
            "Items",
            "items",
            "den-hill",
            "p-1",
            "seat-three",
            "two.words",
            "-hi",
            "hi-",
            "a__b",
        ] {
            assert!(!valid_name(s), "{s}");
        }
        for s in ["mochi", "bean-2", "ab"] {
            assert!(valid_name(s), "{s}");
        }
    }
    #[test]
    fn levels_match_unlocks() {
        assert_eq!(level(0), 1);
        assert_eq!(level(2), 2);
        assert_eq!(level(7), 4);
        assert_eq!(level(16), 6);
    }
}
