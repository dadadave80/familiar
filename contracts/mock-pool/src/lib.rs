use familiar_common::{call, promise_succeeded, rules::UNBOND_EPOCHS};
use near_sdk::{
    AccountId, NearToken, PanicOnDefault, Promise, env,
    json_types::{U64, U128},
    near, require,
    store::LookupMap,
};
#[derive(Default, Clone)]
#[near(serializers=[borsh,json])]
struct Balance {
    staked: u128,
    unstaked: u128,
    available_epoch: u64,
}
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    owner: AccountId,
    epoch: u64,
    fail: bool,
    balances: LookupMap<AccountId, Balance>,
    paying: LookupMap<AccountId, u128>,
}
#[near]
impl Contract {
    #[init]
    pub fn new(owner: AccountId) -> Self {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "ERR_INIT_AUTH"
        );
        Self {
            owner,
            epoch: 0,
            fail: false,
            balances: LookupMap::new(b"b"),
            paying: LookupMap::new(b"p"),
        }
    }
    pub fn advance_epochs(&mut self, epochs: u64) {
        require!(env::predecessor_account_id() == self.owner, "ERR_OWNER");
        self.epoch = self.epoch.saturating_add(epochs);
    }
    pub fn set_fail(&mut self, fail: bool) {
        require!(env::predecessor_account_id() == self.owner, "ERR_OWNER");
        self.fail = fail;
    }
    #[payable]
    pub fn deposit_and_stake(&mut self) {
        require!(!self.fail, "ERR_MOCK_POOL");
        let id = env::predecessor_account_id();
        let mut b = self.balances.get(&id).cloned().unwrap_or_default();
        b.staked = b
            .staked
            .checked_add(env::attached_deposit().as_yoctonear())
            .expect("ERR_OVERFLOW");
        self.balances.insert(id, b);
    }
    pub fn unstake(&mut self, amount: U128) {
        self.do_unstake(amount.0);
    }
    pub fn unstake_all(&mut self) {
        let id = env::predecessor_account_id();
        let amount = self.balances.get(&id).map_or(0, |b| b.staked);
        self.do_unstake(amount);
    }
    pub fn withdraw_all(&mut self) -> Promise {
        require!(!self.fail, "ERR_MOCK_POOL");
        let id = env::predecessor_account_id();
        let mut b = self.balances.get(&id).cloned().unwrap_or_default();
        require!(self.current_epoch() >= b.available_epoch, "ERR_UNBONDING");
        let amount = b.unstaked;
        require!(amount > 0, "ERR_BALANCE");
        b.unstaked = 0;
        self.balances.insert(id.clone(), b);
        self.paying.insert(id.clone(), amount);
        Promise::new(id.clone())
            .transfer(NearToken::from_yoctonear(amount))
            .then(call(
                env::current_account_id(),
                "on_withdraw",
                near_sdk::serde_json::json!({"account":id,"amount":U128(amount)}),
                0,
                15,
            ))
    }
    #[private]
    pub fn on_withdraw(&mut self, account: AccountId, amount: U128) -> bool {
        if self.paying.get(&account) != Some(&amount.0) {
            return false;
        }
        self.paying.remove(&account);
        if !promise_succeeded() {
            let mut balance = self.balances.get(&account).cloned().unwrap_or_default();
            balance.unstaked = balance.unstaked.saturating_add(amount.0);
            self.balances.insert(account, balance);
            return false;
        }
        true
    }
    pub fn nft_on_transfer(
        &self,
        sender_id: AccountId,
        previous_owner_id: AccountId,
        token_id: String,
        msg: String,
    ) -> bool {
        let _ = (sender_id, previous_owner_id, token_id);
        msg != "accept"
    }
    pub fn get_account_staked_balance(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).map_or(0, |b| b.staked))
    }
    pub fn get_account_unstaked_balance(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).map_or(0, |b| b.unstaked))
    }
    pub fn get_epoch(&self) -> U64 {
        U64(self.current_epoch())
    }
}
impl Contract {
    fn current_epoch(&self) -> u64 {
        self.epoch.saturating_add(env::epoch_height())
    }
    fn do_unstake(&mut self, amount: u128) {
        require!(!self.fail, "ERR_MOCK_POOL");
        let id = env::predecessor_account_id();
        let mut b = self.balances.get(&id).cloned().unwrap_or_default();
        require!(amount > 0 && amount <= b.staked, "ERR_BALANCE");
        b.staked -= amount;
        b.unstaked = b.unstaked.checked_add(amount).expect("ERR_OVERFLOW");
        b.available_epoch = self.current_epoch().saturating_add(UNBOND_EPOCHS);
        self.balances.insert(id, b);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{PromiseResult, test_utils::VMContextBuilder, testing_env};
    #[test]
    fn failed_withdrawal_keeps_recoverable_pool_balance() {
        let pool: AccountId = "pool.testnet".parse().unwrap();
        let pet: AccountId = "mochi.root.testnet".parse().unwrap();
        let mut b = VMContextBuilder::new();
        b.current_account_id(pool.clone())
            .predecessor_account_id(pool.clone())
            .account_balance(NearToken::from_near(1));
        testing_env!(b.build());
        let mut c = Contract::new(pool);
        c.balances.insert(
            pet.clone(),
            Balance {
                staked: 0,
                unstaked: 0,
                available_epoch: 4,
            },
        );
        c.paying.insert(pet.clone(), 123);
        testing_env!(
            b.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Failed]
        );
        assert!(!c.on_withdraw(pet.clone(), U128(123)));
        assert_eq!(c.get_account_unstaked_balance(pet.clone()), U128(123));
        assert!(!c.on_withdraw(pet.clone(), U128(123)));
        assert_eq!(c.get_account_unstaked_balance(pet), U128(123));
    }
}
