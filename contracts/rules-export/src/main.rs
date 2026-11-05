#[path = "../../common/src/rules.rs"]
#[allow(dead_code)]
mod rules;
fn main() {
    use rules::*;
    println!(
        "{}",
        serde_json::json!({"ENERGY_MAX":ENERGY_MAX,"ENERGY_REFILL_SECS":ENERGY_REFILL_SECS,"MOOD_MAX":MOOD_MAX,"MOOD_DECAY_PER_HOUR":MOOD_DECAY_PER_HOUR,"FEED_MOOD":FEED_MOOD,"STREAK_FREEZES":STREAK_FREEZES,"PET_RESERVE":PET_RESERVE.to_string(),"ADOPT_FUND":ADOPT_FUND.to_string(),"MARKET_FEE_BPS":MARKET_FEE_BPS,"LEVEL_XP":LEVEL_XP,"UNBOND_EPOCHS":UNBOND_EPOCHS})
    );
}
