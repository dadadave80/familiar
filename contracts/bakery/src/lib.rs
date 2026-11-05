use familiar_common::call;
use near_sdk::{AccountId, PanicOnDefault, Promise, env, near, require, serde_json::json};
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    items: AccountId,
}
#[near]
impl Contract {
    #[init]
    pub fn new(items: AccountId) -> Self {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "ERR_INIT_AUTH"
        );
        Self { items }
    }
    pub fn forage(&self, spot: String) -> Promise {
        let item = match spot.as_str() {
            "mill" => "flour",
            "well" => "water",
            "orchard" => "berries",
            _ => env::panic_str("ERR_SPOT"),
        };
        call(
            self.items.clone(),
            "game_mint",
            json!({"to":env::predecessor_account_id(),"ids":[item],"amounts":["2"]}),
            0,
            45,
        )
    }
    pub fn craft(&self) -> Promise {
        call(
            self.items.clone(),
            "game_exchange",
            json!({"account":env::predecessor_account_id(),"burn_ids":["flour","water"],"burn_amounts":["1","1"],"mint_ids":["bread"],"mint_amounts":["1"]}),
            0,
            55,
        )
    }
    pub fn get_recipe(&self) -> near_sdk::serde_json::Value {
        json!({"inputs":{"flour":"1","water":"1"},"output":{"bread":"1"}})
    }
}
