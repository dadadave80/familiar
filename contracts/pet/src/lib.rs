use familiar_common::{Action, Event, call, emit, promise_bool, promise_succeeded, rules::*};
use near_sdk::{
    AccountId, PanicOnDefault, PromiseOrValue, env,
    json_types::{U64, U128},
    near, require,
    serde_json::json,
};

#[near(serializers=[json])]
pub struct State {
    pub registry: AccountId,
    pub items: AccountId,
    pub bakery: AccountId,
    pub market: AccountId,
    pub pool: AccountId,
    pub mood: u8,
    pub energy: u8,
    pub xp: u32,
    pub level: u8,
    pub streak: u32,
    pub freeze_available: bool,
    pub sleeping: bool,
    pub staked: U128,
    pub unstaking_epoch: Option<U64>,
    pub unstaking_amount: U128,
    pub den: Option<u8>,
    pub pending: Option<Action>,
    pub recent: Vec<Event>,
    pub balance: U128,
    pub spendable: U128,
}
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    registry: AccountId,
    items: AccountId,
    bakery: AccountId,
    market: AccountId,
    pool: AccountId,
    mood: u8,
    last_mood: u64,
    last_fed: u64,
    energy: u8,
    last_energy: u64,
    xp: u32,
    streak: u32,
    last_action_day: Option<u32>,
    freeze_available: bool,
    staked: u128,
    unstaking_amount: u128,
    unstaking_epoch: Option<u64>,
    sleeping: bool,
    den: Option<u8>,
    pending: Option<Action>,
    recent: Vec<Event>,
}
#[near]
impl Contract {
    #[init]
    pub fn new(
        registry: AccountId,
        items: AccountId,
        bakery: AccountId,
        market: AccountId,
        pool: AccountId,
    ) -> Self {
        require!(
            env::predecessor_account_id() == registry,
            "ERR_REGISTRY_ONLY"
        );
        let now = env::block_timestamp() / 1_000_000_000;
        Self {
            registry,
            items,
            bakery,
            market,
            pool,
            mood: 70,
            last_mood: now,
            last_fed: 0,
            energy: ENERGY_MAX,
            last_energy: now,
            xp: 0,
            streak: 0,
            last_action_day: None,
            freeze_available: true,
            staked: 0,
            unstaking_amount: 0,
            unstaking_epoch: None,
            sleeping: false,
            den: None,
            pending: None,
            recent: vec![],
        }
    }
    pub fn get_state(&self) -> State {
        let now = env::block_timestamp() / 1_000_000_000;
        State {
            registry: self.registry.clone(),
            items: self.items.clone(),
            bakery: self.bakery.clone(),
            market: self.market.clone(),
            pool: self.pool.clone(),
            mood: mood_at(self.mood, self.last_mood, now),
            energy: energy_at(self.energy, self.last_energy, now),
            xp: self.xp,
            level: level(self.xp),
            streak: self.streak,
            freeze_available: self.freeze_available,
            sleeping: self.sleeping,
            staked: U128(self.staked),
            unstaking_epoch: self.unstaking_epoch.map(U64),
            unstaking_amount: U128(self.unstaking_amount),
            den: self.den,
            pending: self.pending.clone(),
            recent: self.recent.clone(),
            balance: U128(env::account_balance().as_yoctonear()),
            spendable: U128(self.spendable()),
        }
    }
    pub fn execute(&mut self, action: Action) -> PromiseOrValue<bool> {
        require!(
            env::predecessor_account_id() == self.registry,
            "ERR_REGISTRY_ONLY"
        );
        require!(self.pending.is_none(), "ERR_PET_BUSY");
        self.refresh();
        if self.sleeping {
            require!(
                matches!(
                    action,
                    Action::Wake | Action::Withdraw | Action::ClaimMarket
                ),
                "ERR_SLEEPING"
            );
        }
        match action.clone() {
            Action::Feed => {
                require!(
                    self.last_fed == 0 || self.now().saturating_sub(self.last_fed) >= 30,
                    "ERR_FEED_COOLDOWN"
                );
                self.mood = self.mood.saturating_add(FEED_MOOD).min(MOOD_MAX);
                self.last_fed = self.now();
                self.complete("pet_fed", json!({}));
                PromiseOrValue::Value(true)
            }
            Action::JoinDen { den } => {
                self.unlocked(6);
                require!((1..=4).contains(&den), "ERR_DEN");
                require!(self.den.is_none(), "ERR_DEN_CHOSEN");
                self.den = Some(den);
                self.complete("den_joined", json!({"den":den}));
                PromiseOrValue::Value(true)
            }
            Action::Forage { spot } => {
                require!(self.energy > 0, "ERR_ENERGY");
                require!(
                    ["mill", "well", "orchard"].contains(&spot.as_str()),
                    "ERR_SPOT"
                );
                self.pending = Some(action);
                call(self.bakery.clone(), "forage", json!({"spot":spot}), 0, 95)
                    .then(call(
                        env::current_account_id(),
                        "on_building",
                        json!({}),
                        0,
                        20,
                    ))
                    .into()
            }
            Action::Craft => {
                self.unlocked(4);
                self.pending = Some(action);
                call(self.bakery.clone(), "craft", json!({}), 0, 95)
                    .then(call(
                        env::current_account_id(),
                        "on_building",
                        json!({}),
                        0,
                        20,
                    ))
                    .into()
            }
            Action::Sleep { amount } => {
                self.unlocked(2);
                require!(
                    !self.sleeping && self.unstaking_epoch.is_none(),
                    "ERR_STAKING_BUSY"
                );
                require!(self.mood >= 20, "ERR_MOOD");
                require!(amount.0 > 0 && amount.0 <= self.spendable(), "ERR_RESERVE");
                self.pending = Some(action);
                call(
                    self.pool.clone(),
                    "deposit_and_stake",
                    json!({}),
                    amount.0,
                    70,
                )
                .then(call(env::current_account_id(), "on_pool", json!({}), 0, 20))
                .into()
            }
            Action::Wake => {
                require!(self.sleeping && self.staked > 0, "ERR_NOT_SLEEPING");
                self.pending = Some(action);
                call(self.pool.clone(), "unstake_all", json!({}), 0, 70)
                    .then(call(env::current_account_id(), "on_pool", json!({}), 0, 20))
                    .into()
            }
            Action::Withdraw => {
                require!(
                    self.unstaking_epoch
                        .is_some_and(|e| env::epoch_height() >= e),
                    "ERR_UNBONDING"
                );
                self.pending = Some(action);
                call(self.pool.clone(), "withdraw_all", json!({}), 0, 70)
                    .then(call(env::current_account_id(), "on_pool", json!({}), 0, 20))
                    .into()
            }
            Action::SellToNpc { item, quantity } => {
                self.unlocked(3);
                require!(
                    ITEMS.contains(&item.as_str()) && quantity.0 > 0 && quantity.0 <= 100,
                    "ERR_TRADE"
                );
                self.pending = Some(action);
                call(
                    self.market.clone(),
                    "sell_to_npc",
                    json!({"item":item,"quantity":quantity,"den":self.den}),
                    0,
                    120,
                )
                .then(call(
                    env::current_account_id(),
                    "on_building",
                    json!({}),
                    0,
                    20,
                ))
                .into()
            }
            Action::BuyFromNpc {
                item,
                quantity,
                amount,
            } => {
                self.unlocked(5);
                require!(
                    ITEMS.contains(&item.as_str()) && quantity.0 > 0 && quantity.0 <= 100,
                    "ERR_TRADE"
                );
                require!(amount.0 > 0 && amount.0 <= self.spendable(), "ERR_RESERVE");
                self.pending = Some(action);
                call(
                    self.market.clone(),
                    "buy_from_npc",
                    json!({"item":item,"quantity":quantity,"den":self.den}),
                    amount.0,
                    120,
                )
                .then(call(
                    env::current_account_id(),
                    "on_building",
                    json!({}),
                    0,
                    20,
                ))
                .into()
            }
            Action::ClaimMarket => {
                self.pending = Some(action);
                call(self.market.clone(), "claim", json!({}), 0, 60)
                    .then(call(
                        env::current_account_id(),
                        "on_building",
                        json!({}),
                        0,
                        20,
                    ))
                    .into()
            }
        }
    }
    #[private]
    pub fn on_building(&mut self) -> bool {
        let Some(action) = self.pending.take() else {
            return false;
        };
        if !promise_bool() {
            return false;
        }
        match action {
            Action::Forage { spot } => {
                self.refresh();
                self.energy = self.energy.saturating_sub(1);
                self.complete("errand", json!({"spot":spot}));
            }
            Action::Craft => self.complete("crafted", json!({"item":"bread","quantity":"1"})),
            Action::SellToNpc { item, quantity } | Action::BuyFromNpc { item, quantity, .. } => {
                self.complete("npc_trade", json!({"item":item,"quantity":quantity}))
            }
            Action::ClaimMarket => {}
            _ => return false,
        }
        true
    }
    #[private]
    pub fn on_pool(&mut self) -> bool {
        let Some(action) = self.pending.take() else {
            return false;
        };
        if !promise_succeeded() {
            return false;
        }
        match action {
            Action::Sleep { amount } => {
                self.staked = self.staked.saturating_add(amount.0);
                self.sleeping = true;
                self.complete("slept", json!({"amount":amount}));
            }
            Action::Wake => {
                self.unstaking_amount = self.staked;
                self.staked = 0;
                self.sleeping = false;
                self.unstaking_epoch = Some(env::epoch_height().saturating_add(UNBOND_EPOCHS));
                self.complete("woke", json!({"available_epoch":self.unstaking_epoch}));
            }
            Action::Withdraw => {
                self.unstaking_amount = 0;
                self.unstaking_epoch = None;
                self.complete("withdrawn", json!({}));
            }
            _ => return false,
        }
        true
    }
}
impl Contract {
    fn now(&self) -> u64 {
        env::block_timestamp() / 1_000_000_000
    }
    fn unlocked(&self, min: u8) {
        require!(level(self.xp) >= min, "ERR_LEVEL");
    }
    fn spendable(&self) -> u128 {
        // Leave space for the pending action and its receipt before enforcing the reserve.
        env::account_balance()
            .as_yoctonear()
            .saturating_sub(
                env::storage_byte_cost()
                    .as_yoctonear()
                    .saturating_mul(env::storage_usage().saturating_add(1024) as u128),
            )
            .saturating_sub(PET_RESERVE)
    }
    fn refresh(&mut self) {
        let now = self.now();
        let elapsed = now.saturating_sub(self.last_energy) / ENERGY_REFILL_SECS;
        self.energy = energy_at(self.energy, self.last_energy, now);
        self.last_energy = if self.energy == ENERGY_MAX {
            now
        } else {
            self.last_energy
                .saturating_add(elapsed.saturating_mul(ENERGY_REFILL_SECS))
        };
        let hours = now.saturating_sub(self.last_mood) / 3600;
        self.mood = mood_at(self.mood, self.last_mood, now);
        self.last_mood = self.last_mood.saturating_add(hours.saturating_mul(3600));
    }
    fn complete(&mut self, event: &str, data: near_sdk::serde_json::Value) {
        self.xp = self.xp.saturating_add(1);
        let day = (self.now() / 86_400) as u32;
        (self.streak, self.freeze_available) = streak_at(
            self.streak,
            self.last_action_day,
            day,
            self.freeze_available,
        );
        self.last_action_day = Some(day);
        emit(
            event,
            json!({"pet":env::current_account_id(),"details":data}),
        );
        self.recent.push(Event {
            event: event.into(),
            timestamp: self.now(),
            data: data.to_string(),
        });
        if self.recent.len() > 20 {
            self.recent.remove(0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{NearToken, PromiseResult, test_utils::VMContextBuilder, testing_env};
    fn id(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn context(predecessor: &str, seconds: u64) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(id("mochi.root.testnet"))
            .predecessor_account_id(id(predecessor))
            .signer_account_id(id("relay.testnet"))
            .block_timestamp(seconds * 1_000_000_000)
            .account_balance(NearToken::from_near(1));
        b
    }
    fn contract() -> Contract {
        testing_env!(context("root.testnet", 1_000_000).build());
        Contract::new(
            id("root.testnet"),
            id("items.root.testnet"),
            id("bakery.root.testnet"),
            id("market.root.testnet"),
            id("pool.testnet"),
        )
    }
    fn result(seconds: u64, result: PromiseResult) {
        testing_env!(
            context("mochi.root.testnet", seconds).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![result]
        );
    }
    #[test]
    fn feed_caps_mood_and_history() {
        let mut c = contract();
        for n in 0..25 {
            testing_env!(context("root.testnet", 1_000_000 + n * 30).build());
            assert!(matches!(
                c.execute(Action::Feed),
                PromiseOrValue::Value(true)
            ));
        }
        assert_eq!(c.get_state().mood, 100);
        assert_eq!(c.recent.len(), 20);
        assert_eq!(c.xp, 25);
    }
    #[test]
    #[should_panic(expected = "ERR_REGISTRY_ONLY")]
    fn direct_cached_owner_cannot_act() {
        let mut c = contract();
        testing_env!(context("alice.testnet", 1_000_000).build());
        let _ = c.execute(Action::Feed);
    }
    #[test]
    #[should_panic(expected = "ERR_LEVEL")]
    fn sleep_requires_progression() {
        let mut c = contract();
        let _ = c.execute(Action::Sleep {
            amount: U128(YOCTO / 100),
        });
    }
    #[test]
    fn failed_building_preserves_energy_and_clears_pending() {
        let mut c = contract();
        c.pending = Some(Action::Forage {
            spot: "mill".into(),
        });
        result(1_000_001, PromiseResult::Failed);
        assert!(!c.on_building());
        assert_eq!(c.energy, 3);
        assert!(c.pending.is_none());
        assert_eq!(c.xp, 0);
    }
    #[test]
    fn successful_building_charges_exactly_once() {
        let mut c = contract();
        c.pending = Some(Action::Forage {
            spot: "mill".into(),
        });
        result(1_000_001, PromiseResult::Successful(b"true".to_vec()));
        assert!(c.on_building());
        assert_eq!(c.energy, 2);
        assert!(!c.on_building());
        assert_eq!(c.energy, 2);
        assert_eq!(c.xp, 1);
    }
    #[test]
    fn failed_pool_does_not_credit_stake() {
        let mut c = contract();
        c.pending = Some(Action::Sleep {
            amount: U128(YOCTO / 100),
        });
        result(1_000_001, PromiseResult::Failed);
        assert!(!c.on_pool());
        assert_eq!(c.staked, 0);
        assert!(!c.sleeping);
    }
    #[test]
    fn stake_and_unstake_bookkeeping_waits_for_pool() {
        let mut c = contract();
        c.pending = Some(Action::Sleep {
            amount: U128(YOCTO / 100),
        });
        result(1_000_001, PromiseResult::Successful(vec![]));
        assert!(c.on_pool());
        assert!(c.sleeping);
        assert_eq!(c.staked, YOCTO / 100);
        c.pending = Some(Action::Wake);
        result(1_000_002, PromiseResult::Successful(vec![]));
        assert!(c.on_pool());
        assert!(!c.sleeping);
        assert_eq!(c.staked, 0);
        assert_eq!(c.unstaking_amount, YOCTO / 100);
        assert_eq!(c.unstaking_epoch, Some(4));
    }
    #[test]
    fn refill_remainder_and_single_streak_freeze() {
        let mut c = contract();
        c.energy = 0;
        c.last_energy = 1_000_000;
        testing_env!(context("root.testnet", 1_000_000 + ENERGY_REFILL_SECS + 500).build());
        c.refresh();
        assert_eq!(c.energy, 1);
        assert_eq!(c.last_energy, 1_000_000 + ENERGY_REFILL_SECS);
        assert_eq!(streak_at(4, Some(1), 3, true), (5, false));
        assert_eq!(streak_at(5, Some(3), 5, false), (1, false));
    }
}
