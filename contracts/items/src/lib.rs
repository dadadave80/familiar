use familiar_common::rules::{ITEM_STORAGE_FUND, ITEMS};
use near_sdk::{
    AccountId, NearToken, PanicOnDefault, Promise, env, json_types::U128, near, require,
    store::LookupSet,
};
use near_sdk_contract_tools::{
    MultiToken,
    mt::{
        BaseMetadata, ContractMetadata, MetadataController, Nep145Controller, Nep245Burn,
        Nep245Controller, Nep245Mint, Nep245Transfer, TokenMetadata,
    },
};

#[derive(MultiToken, PanicOnDefault)]
#[near(contract_state)]
pub struct Contract {
    registry: AccountId,
    buildings: LookupSet<AccountId>,
    pets: LookupSet<AccountId>,
}

#[near]
impl Contract {
    #[init]
    pub fn new(registry: AccountId, bakery: AccountId, market: AccountId) -> Self {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "ERR_INIT_AUTH"
        );
        let mut this = Self {
            registry,
            buildings: LookupSet::new(b"buildings".as_slice()),
            pets: LookupSet::new(b"pets".as_slice()),
        };
        this.buildings.insert(bakery);
        this.buildings.insert(market.clone());
        this.set_contract_metadata(&ContractMetadata::new("Familiar inventory"));
        for item in ITEMS {
            this.create_token(item.to_owned()).expect("ERR_TOKEN");
            this.create_base_metadata(BaseMetadata::new(item, item))
                .expect("ERR_METADATA");
            this.set_token_metadata(
                item,
                item.to_owned(),
                TokenMetadata::new().title(item.to_owned()),
            )
            .expect("ERR_METADATA");
        }
        this.deposit_to_storage_account(&market, NearToken::from_yoctonear(ITEM_STORAGE_FUND))
            .expect("ERR_STORAGE");
        this
    }
    pub fn register_building(&mut self, account: AccountId) {
        require!(
            env::predecessor_account_id() == self.registry,
            "ERR_REGISTRY_ONLY"
        );
        self.buildings.insert(account);
    }
    #[payable]
    pub fn register_pet(&mut self, account_id: AccountId) -> bool {
        require!(
            env::predecessor_account_id() == self.registry,
            "ERR_REGISTRY_ONLY"
        );
        require!(
            env::attached_deposit().as_yoctonear() >= ITEM_STORAGE_FUND,
            "ERR_STORAGE_DEPOSIT"
        );
        if !self.pets.contains(&account_id) {
            self.deposit_to_storage_account(&account_id, env::attached_deposit())
                .expect("ERR_STORAGE");
            self.pets.insert(account_id);
        } else {
            Promise::new(env::predecessor_account_id())
                .transfer(env::attached_deposit())
                .detach();
        }
        true
    }
    pub fn is_pet(&self, account_id: AccountId) -> bool {
        self.pets.contains(&account_id)
    }
    pub fn game_mint(&mut self, to: AccountId, ids: Vec<String>, amounts: Vec<U128>) -> bool {
        self.building();
        self.registered(&to);
        self.batch(&ids, &amounts);
        for (id, amount) in ids.iter().zip(amounts) {
            self.mint(&Nep245Mint::single(id.as_str(), amount.0, &*to))
                .expect("ERR_MINT");
        }
        true
    }
    pub fn game_burn(&mut self, from: AccountId, ids: Vec<String>, amounts: Vec<U128>) -> bool {
        self.building();
        self.registered(&from);
        self.batch(&ids, &amounts);
        for (id, amount) in ids.iter().zip(amounts) {
            self.burn(&Nep245Burn::single(id.as_str(), amount.0, &*from))
                .expect("ERR_BALANCE");
        }
        true
    }
    pub fn game_transfer(
        &mut self,
        from: AccountId,
        to: AccountId,
        ids: Vec<String>,
        amounts: Vec<U128>,
    ) -> bool {
        self.building();
        self.registered(&from);
        self.registered(&to);
        self.batch(&ids, &amounts);
        for (id, amount) in ids.iter().zip(amounts) {
            self.transfer(&Nep245Transfer::single(
                &*from,
                &*to,
                id.as_str(),
                amount.0,
                None::<&str>,
            ))
            .expect("ERR_BALANCE");
        }
        true
    }
    pub fn game_exchange(
        &mut self,
        account: AccountId,
        burn_ids: Vec<String>,
        burn_amounts: Vec<U128>,
        mint_ids: Vec<String>,
        mint_amounts: Vec<U128>,
    ) -> bool {
        self.building();
        self.registered(&account);
        self.batch(&burn_ids, &burn_amounts);
        self.batch(&mint_ids, &mint_amounts);
        for (id, amount) in burn_ids.iter().zip(&burn_amounts) {
            require!(self.balance_of(id, &account) >= amount.0, "ERR_INGREDIENTS");
        }
        for (id, amount) in burn_ids.iter().zip(burn_amounts) {
            self.burn(&Nep245Burn::single(id.as_str(), amount.0, &*account))
                .expect("ERR_BALANCE");
        }
        for (id, amount) in mint_ids.iter().zip(mint_amounts) {
            self.mint(&Nep245Mint::single(id.as_str(), amount.0, &*account))
                .expect("ERR_MINT");
        }
        true
    }
}
impl Contract {
    fn building(&self) {
        require!(
            self.buildings.contains(&env::predecessor_account_id()),
            "ERR_BUILDING_ONLY"
        );
    }
    fn registered(&self, account: &AccountId) {
        require!(
            self.pets.contains(account) || self.buildings.contains(account),
            "ERR_UNREGISTERED_PET"
        );
    }
    fn batch(&self, ids: &[String], amounts: &[U128]) {
        require!(
            !ids.is_empty() && ids.len() == amounts.len() && ids.len() <= 7,
            "ERR_BATCH"
        );
        let mut seen = std::collections::HashSet::new();
        for (id, amount) in ids.iter().zip(amounts) {
            require!(
                ITEMS.contains(&id.as_str())
                    && seen.insert(id)
                    && amount.0 > 0
                    && amount.0 <= 1_000_000,
                "ERR_ITEM"
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env};
    use near_sdk_contract_tools::mt::Nep245;
    fn id(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(predecessor: &str, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(id("items.root.testnet"))
            .predecessor_account_id(id(predecessor))
            .account_balance(NearToken::from_near(100))
            .attached_deposit(NearToken::from_yoctonear(deposit));
        testing_env!(b.build());
    }
    fn contract() -> Contract {
        ctx("items.root.testnet", 0);
        let mut c = Contract::new(
            id("root.testnet"),
            id("bakery.root.testnet"),
            id("market.root.testnet"),
        );
        ctx("root.testnet", ITEM_STORAGE_FUND);
        assert!(c.register_pet(id("mochi.root.testnet")));
        c
    }
    #[test]
    fn repeated_registration_refunds_the_entire_duplicate_deposit() {
        let mut c = contract();
        ctx("root.testnet", ITEM_STORAGE_FUND);
        let before = c.get_storage_balance(&id("mochi.root.testnet")).unwrap();
        assert!(c.register_pet(id("mochi.root.testnet")));
        assert_eq!(
            c.get_storage_balance(&id("mochi.root.testnet")).unwrap(),
            before
        );
        let receipts = near_sdk::test_utils::get_created_receipts();
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].receiver_id, id("root.testnet"));
        assert!(
            matches!(receipts[0].actions.as_slice(),[near_sdk::mock::MockAction::Transfer{deposit,..}] if deposit.as_yoctonear()==ITEM_STORAGE_FUND)
        );
    }
    #[test]
    fn game_inventory_and_atomic_recipe() {
        let mut c = contract();
        ctx("bakery.root.testnet", 0);
        assert!(c.game_mint(
            id("mochi.root.testnet"),
            vec!["flour".into(), "water".into()],
            vec![U128(2), U128(2)]
        ));
        assert!(c.game_exchange(
            id("mochi.root.testnet"),
            vec!["flour".into(), "water".into()],
            vec![U128(1), U128(1)],
            vec!["bread".into()],
            vec![U128(1)]
        ));
        assert_eq!(
            c.mt_batch_balance_of(
                id("mochi.root.testnet"),
                vec!["flour".into(), "water".into(), "bread".into()]
            ),
            vec![U128(1), U128(1), U128(1)]
        );
    }
    #[test]
    #[should_panic(expected = "ERR_BUILDING_ONLY")]
    fn random_account_cannot_mint() {
        let mut c = contract();
        ctx("alice.testnet", 0);
        c.game_mint(
            id("mochi.root.testnet"),
            vec!["bread".into()],
            vec![U128(1)],
        );
    }
    #[test]
    #[should_panic(expected = "ERR_UNREGISTERED_PET")]
    fn suffix_does_not_make_an_authentic_pet() {
        let mut c = contract();
        ctx("bakery.root.testnet", 0);
        c.game_mint(id("fake.root.testnet"), vec!["bread".into()], vec![U128(1)]);
    }
    #[test]
    #[should_panic(expected = "ERR_ITEM")]
    fn duplicate_batch_rejected() {
        let mut c = contract();
        ctx("bakery.root.testnet", 0);
        c.game_mint(
            id("mochi.root.testnet"),
            vec!["bread".into(), "bread".into()],
            vec![U128(1), U128(1)],
        );
    }
    #[test]
    #[should_panic(expected = "ERR_INGREDIENTS")]
    fn insufficient_recipe_rejected_before_burn() {
        let mut c = contract();
        ctx("bakery.root.testnet", 0);
        c.game_exchange(
            id("mochi.root.testnet"),
            vec!["flour".into(), "water".into()],
            vec![U128(1), U128(1)],
            vec!["bread".into()],
            vec![U128(1)],
        );
    }
    #[test]
    fn standard_transfer_preserves_inventory_balances() {
        let mut c = contract();
        ctx("bakery.root.testnet", 0);
        c.game_mint(
            id("mochi.root.testnet"),
            vec!["berries".into()],
            vec![U128(2)],
        );
        ctx("mochi.root.testnet", 1);
        c.mt_transfer(
            id("market.root.testnet"),
            "berries".into(),
            U128(1),
            None,
            None,
        );
        assert_eq!(
            c.mt_balance_of(id("mochi.root.testnet"), "berries".into()),
            U128(1)
        );
        assert_eq!(
            c.mt_balance_of(id("market.root.testnet"), "berries".into()),
            U128(1)
        );
    }
}
