pub mod expedition;
pub mod rules;
pub mod storycraft;
use near_sdk::{
    AccountId, Gas, NearToken, Promise, env,
    json_types::U128,
    near,
    serde_json::{self, Value},
};

#[derive(Clone, Debug)]
#[near(serializers = [borsh, json])]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Action {
    Feed,
    Forage {
        spot: String,
    },
    Craft,
    Sleep {
        amount: U128,
    },
    Wake,
    Withdraw,
    SellToNpc {
        item: String,
        quantity: U128,
    },
    BuyFromNpc {
        item: String,
        quantity: U128,
        amount: U128,
    },
    JoinDen {
        den: u8,
    },
    ClaimMarket,
}

#[derive(Clone, Debug)]
#[near(serializers = [borsh, json])]
pub struct Event {
    pub event: String,
    pub timestamp: u64,
    pub data: String,
}

#[derive(Clone, Debug)]
#[near(serializers = [borsh, json])]
pub struct Quote {
    pub item: String,
    pub bid: U128,
    pub ask: U128,
    pub max_qty: U128,
}

pub fn call(to: AccountId, method: &str, args: Value, deposit: u128, gas: u64) -> Promise {
    Promise::new(to).function_call(
        method.to_owned(),
        serde_json::to_vec(&args).unwrap_or_default(),
        NearToken::from_yoctonear(deposit),
        Gas::from_tgas(gas),
    )
}

pub fn emit(event: &str, data: Value) {
    env::log_str(&format!(
        "EVENT_JSON:{}",
        serde_json::json!({"standard":"familiar","version":"1.0.0","event":event,"data":[data]})
    ));
}

pub fn promise_succeeded() -> bool {
    env::promise_results_count() == 1
        && env::promise_result_checked(0, 4096).is_ok_and(|bytes| bytes != b"false")
}

pub fn promise_bool() -> bool {
    if env::promise_results_count() != 1 {
        return false;
    }
    match env::promise_result_checked(0, 64) {
        Ok(bytes) => serde_json::from_slice::<bool>(&bytes).unwrap_or(false),
        _ => false,
    }
}
