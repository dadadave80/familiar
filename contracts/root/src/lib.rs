use familiar_common::{Action, call, emit, promise_bool, promise_succeeded, rules::*};
use near_contract_standards::non_fungible_token::{
    NonFungibleToken, Token, TokenId,
    approval::NonFungibleTokenApproval,
    core::{NonFungibleTokenCore, NonFungibleTokenResolver},
    enumeration::NonFungibleTokenEnumeration,
    events::NftMint,
    metadata::{NFTContractMetadata, TokenMetadata},
};
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, PublicKey, env,
    json_types::{Base58CryptoHash, U64, U128},
    near, require,
    serde_json::json,
    store::{LookupMap, LookupSet},
};
use std::collections::HashMap;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Config {
    pub relayer: AccountId,
    pub pet_code_hash: Base58CryptoHash,
    pub items: AccountId,
    pub bakery: AccountId,
    pub market: AccountId,
    pub pool: AccountId,
}
#[near(serializers = [borsh, json])]
#[derive(Clone)]
struct Adoption {
    owner: AccountId,
    created: bool,
    registration_inflight: bool,
    storage_reserve: u128,
}

#[near(serializers=[borsh])]
#[derive(Clone)]
struct PendingPlayer {
    account_id: AccountId,
    storage_reserve: u128,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    tokens: NonFungibleToken,
    config: Config,
    players: LookupMap<String, AccountId>,
    pending_players: LookupMap<String, PendingPlayer>,
    player_ids: LookupSet<AccountId>,
    adopted_players: LookupSet<AccountId>,
    counter: u64,
    adoptions: LookupMap<AccountId, Adoption>,
    busy: LookupSet<TokenId>,
    pet_dens: LookupMap<TokenId, u8>,
    den_bread: [u128; 4],
    budget_day: u64,
    guests_today: u16,
    adoptions_today: u16,
    registrations_today: u16,
    reserved_storage: u128,
}

#[near]
impl Contract {
    #[init]
    pub fn new(
        relayer: AccountId,
        pet_code_hash: Base58CryptoHash,
        items: AccountId,
        bakery: AccountId,
        market: AccountId,
        pool: AccountId,
    ) -> Self {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "ERR_INIT_AUTH"
        );
        require!(
            env::current_account_id().as_str().len() <= 39,
            "ERR_ROOT_TOO_LONG"
        );
        Self {
            tokens: NonFungibleToken::new(
                b"t",
                env::current_account_id(),
                Some(b"m"),
                Some(b"e"),
                Some(b"a"),
            ),
            config: Config {
                relayer,
                pet_code_hash,
                items,
                bakery,
                market,
                pool,
            },
            players: LookupMap::new(b"players".as_slice()),
            pending_players: LookupMap::new(b"pendingplayers".as_slice()),
            player_ids: LookupSet::new(b"playerids".as_slice()),
            adopted_players: LookupSet::new(b"adopted".as_slice()),
            counter: 0,
            adoptions: LookupMap::new(b"adoptions".as_slice()),
            busy: LookupSet::new(b"busy".as_slice()),
            pet_dens: LookupMap::new(b"dens".as_slice()),
            den_bread: [0; 4],
            budget_day: 0,
            guests_today: 0,
            adoptions_today: 0,
            registrations_today: 0,
            reserved_storage: 0,
        }
    }
    pub fn get_epoch(&self) -> U64 {
        U64(env::epoch_height())
    }
    pub fn get_den(&self, token_id: TokenId) -> Option<u8> {
        self.pet_dens.get(&token_id).copied()
    }
    pub fn get_dens(&self) -> near_sdk::serde_json::Value {
        json!(
            (1u8..=4)
                .map(|den| json!({"den":den,"bread":U128(self.den_bread[usize::from(den-1)])}))
                .collect::<Vec<_>>()
        )
    }
    pub fn get_config(&self) -> Config {
        self.config.clone()
    }
    pub fn get_player(&self, public_key: PublicKey) -> Option<AccountId> {
        self.players.get(&public_key.to_string()).cloned()
    }
    pub fn is_pet(&self, account_id: AccountId) -> bool {
        self.tokens
            .owner_by_id
            .get(&account_id.to_string())
            .is_some()
    }
    pub fn is_busy(&self, token_id: TokenId) -> bool {
        self.busy.contains(&token_id)
    }
    pub fn create_player(&mut self, public_key: PublicKey) -> PromiseOrValue<Option<AccountId>> {
        require!(
            env::predecessor_account_id() == self.config.relayer,
            "ERR_RELAYER_ONLY"
        );
        require!(
            public_key.curve_type() == near_sdk::CurveType::ED25519,
            "ERR_PUBLIC_KEY"
        );
        let key = public_key.to_string();
        if let Some(id) = self.players.get(&key) {
            return PromiseOrValue::Value(Some(id.clone()));
        }
        require!(
            self.pending_players.get(&key).is_none(),
            "ERR_PLAYER_PENDING"
        );
        self.refresh_day();
        require!(self.guests_today < 200, "ERR_DAILY_BUDGET");
        self.guests_today += 1;
        let storage_reserve = self.storage_reserve(PLAYER_STORAGE_RESERVE_BYTES);
        require!(
            self.spendable() >= PLAYER_FUND + ADOPT_FUND + ITEM_STORAGE_FUND + storage_reserve,
            "ERR_STAMPS"
        );
        self.counter += 1;
        let id: AccountId = format!("p-{}.{}", self.counter, env::current_account_id())
            .parse()
            .expect("ERR_ROOT_TOO_LONG");
        self.reserved_storage = self
            .reserved_storage
            .checked_add(storage_reserve)
            .expect("ERR_STORAGE_BUDGET");
        self.pending_players.insert(
            key.clone(),
            PendingPlayer {
                account_id: id.clone(),
                storage_reserve,
            },
        );
        Promise::new(id.clone())
            .create_account()
            .transfer(NearToken::from_yoctonear(PLAYER_FUND))
            .add_full_access_key(public_key)
            .then(call(
                env::current_account_id(),
                "on_player",
                json!({"key":key,"account_id":id}),
                0,
                15,
            ))
            .into()
    }
    #[private]
    pub fn on_player(&mut self, key: String, account_id: AccountId) -> Option<AccountId> {
        let pending = self.pending_players.get(&key).cloned()?;
        if pending.account_id != account_id {
            return None;
        }
        self.pending_players.remove(&key);
        if !promise_succeeded() {
            self.reserved_storage = self
                .reserved_storage
                .saturating_sub(pending.storage_reserve);
            return None;
        }
        self.players.insert(key, account_id.clone());
        self.player_ids.insert(account_id.clone());
        self.reserved_storage = self
            .reserved_storage
            .saturating_sub(pending.storage_reserve);
        Some(account_id)
    }
    pub fn adopt(&mut self, name: String) -> PromiseOrValue<Option<AccountId>> {
        require!(env::prepaid_gas() >= Gas::from_tgas(150), "ERR_GAS");
        require!(valid_name(&name), "ERR_NAME");
        let owner = env::predecessor_account_id();
        require!(self.player_ids.contains(&owner), "ERR_PLAYER");
        let pet: AccountId = format!("{name}.{}", env::current_account_id())
            .parse()
            .expect("ERR_NAME");
        require!(
            self.tokens.owner_by_id.get(&pet.to_string()).is_none(),
            "ERR_NAME_TAKEN"
        );
        if let Some(pending) = self.adoptions.get(&pet) {
            require!(
                pending.owner == owner && pending.created,
                "ERR_ADOPTION_PENDING"
            );
            return self
                .register_pet(pet)
                .map_or(PromiseOrValue::Value(None), Into::into);
        }
        require!(
            !self.adopted_players.contains(&owner),
            "ERR_ALREADY_ADOPTED"
        );
        self.refresh_day();
        require!(self.adoptions_today < 100, "ERR_DAILY_BUDGET");
        let storage_reserve = self.storage_reserve(NFT_STORAGE_RESERVE_BYTES);
        require!(
            self.spendable() >= ADOPT_FUND + ITEM_STORAGE_FUND + storage_reserve,
            "ERR_STAMPS"
        );
        self.reserved_storage = self
            .reserved_storage
            .checked_add(storage_reserve)
            .expect("ERR_STORAGE_BUDGET");
        self.adoptions_today += 1;
        self.adopted_players.insert(owner.clone());
        self.adoptions.insert(
            pet.clone(),
            Adoption {
                owner,
                created: false,
                registration_inflight: false,
                storage_reserve,
            },
        );
        Promise::new(pet.clone()).create_account().transfer(NearToken::from_yoctonear(ADOPT_FUND))
            .use_global_contract(self.config.pet_code_hash)
            .function_call("new",near_sdk::serde_json::to_vec(&json!({"registry":env::current_account_id(),"items":self.config.items,"bakery":self.config.bakery,"market":self.config.market,"pool":self.config.pool})).unwrap_or_default(),NearToken::from_yoctonear(0),Gas::from_tgas(20))
            .then(call(env::current_account_id(),"on_pet_created",json!({"pet":pet}),0,65)).into()
    }
    #[private]
    pub fn on_pet_created(&mut self, pet: AccountId) -> PromiseOrValue<Option<AccountId>> {
        let Some(mut pending) = self.adoptions.get(&pet).cloned() else {
            return PromiseOrValue::Value(None);
        };
        if !promise_succeeded() {
            self.adopted_players.remove(&pending.owner);
            self.adoptions.remove(&pet);
            self.reserved_storage = self
                .reserved_storage
                .saturating_sub(pending.storage_reserve);
            return PromiseOrValue::Value(None);
        }
        pending.created = true;
        self.adoptions.insert(pet.clone(), pending);
        self.register_pet(pet)
            .map_or(PromiseOrValue::Value(None), Into::into)
    }
    #[private]
    pub fn on_adopted(&mut self, pet: AccountId) -> Option<AccountId> {
        let mut pending = self.adoptions.get(&pet).cloned()?;
        if !pending.registration_inflight {
            return None;
        }
        pending.registration_inflight = false;
        self.adoptions.insert(pet.clone(), pending.clone());
        if !promise_bool() {
            return None;
        }
        if self.tokens.owner_by_id.get(&pet.to_string()).is_some() {
            self.adoptions.remove(&pet);
            self.reserved_storage = self
                .reserved_storage
                .saturating_sub(pending.storage_reserve);
            return Some(pet);
        }
        let token_id = pet.to_string();
        self.tokens.internal_mint_with_refund(
            token_id.clone(),
            pending.owner.clone(),
            Some(TokenMetadata {
                title: Some(pet.to_string()),
                description: Some(
                    "A keyless Familiar pet account. Inventory and savings stay with this account."
                        .into(),
                ),
                copies: Some(1),
                ..Default::default()
            }),
            None,
        );
        NftMint {
            owner_id: &pending.owner,
            token_ids: &[&token_id],
            memo: None,
        }
        .emit();
        self.adoptions.remove(&pet);
        self.reserved_storage = self
            .reserved_storage
            .saturating_sub(pending.storage_reserve);
        emit("pet_adopted", json!({"pet":pet,"owner":pending.owner}));
        Some(pet)
    }
    pub fn act(&mut self, token_id: TokenId, action: Action) -> Promise {
        require!(env::prepaid_gas() >= Gas::from_tgas(240), "ERR_GAS");
        require!(
            self.tokens.owner_by_id.get(&token_id) == Some(env::predecessor_account_id()),
            "ERR_NOT_OWNER"
        );
        require!(!self.busy.contains(&token_id), "ERR_PET_BUSY");
        let pet: AccountId = token_id.parse().expect("ERR_PET");
        self.busy.insert(token_id.clone());
        let den = if let Action::JoinDen { den } = &action {
            Some(*den)
        } else {
            None
        };
        let crafted = matches!(&action, Action::Craft);
        call(pet, "execute", json!({"action":action}), 0, 210).then(call(
            env::current_account_id(),
            "on_action",
            json!({"token_id":token_id,"den":den,"crafted":crafted}),
            0,
            12,
        ))
    }
    #[private]
    pub fn on_action(&mut self, token_id: TokenId, den: Option<u8>, crafted: bool) -> bool {
        if !self.busy.remove(&token_id) {
            return false;
        }
        let success = promise_bool();
        if success {
            if let Some(d) = den.filter(|d| (1..=4).contains(d)) {
                self.pet_dens.insert(token_id.clone(), d);
            }
            if crafted && let Some(d) = self.pet_dens.get(&token_id) {
                let i = usize::from(d.saturating_sub(1)).min(3);
                self.den_bread[i] = self.den_bread[i].saturating_add(1);
            }
        }
        success
    }
    pub fn get_owner(&self, token_id: TokenId) -> Option<AccountId> {
        self.tokens.owner_by_id.get(&token_id)
    }
    #[payable]
    pub fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        require!(!self.busy.contains(&token_id), "ERR_PET_BUSY");
        self.tokens
            .nft_transfer(receiver_id.clone(), token_id.clone(), approval_id, memo);
        emit(
            "pet_transferred",
            json!({"pet":token_id,"owner":receiver_id}),
        );
    }
    #[payable]
    pub fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        require!(env::prepaid_gas() >= Gas::from_tgas(80), "ERR_GAS");
        require!(!self.busy.contains(&token_id), "ERR_PET_BUSY");
        self.busy.insert(token_id.clone());
        self.tokens
            .nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }
    #[private]
    pub fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.busy.remove(&token_id);
        self.tokens.nft_resolve_transfer(
            previous_owner_id,
            receiver_id,
            token_id,
            approved_account_ids,
        )
    }
    pub fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        self.tokens.nft_token(token_id)
    }
    #[payable]
    pub fn nft_approve(
        &mut self,
        token_id: TokenId,
        account_id: AccountId,
        msg: Option<String>,
    ) -> Option<Promise> {
        require!(!self.busy.contains(&token_id), "ERR_PET_BUSY");
        self.tokens.nft_approve(token_id, account_id, msg)
    }
    #[payable]
    pub fn nft_revoke(&mut self, token_id: TokenId, account_id: AccountId) {
        self.tokens.nft_revoke(token_id, account_id)
    }
    #[payable]
    pub fn nft_revoke_all(&mut self, token_id: TokenId) {
        self.tokens.nft_revoke_all(token_id)
    }
    pub fn nft_is_approved(
        &self,
        token_id: TokenId,
        approved_account_id: AccountId,
        approval_id: Option<u64>,
    ) -> bool {
        self.tokens
            .nft_is_approved(token_id, approved_account_id, approval_id)
    }
    pub fn nft_total_supply(&self) -> U128 {
        self.tokens.nft_total_supply()
    }
    pub fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.tokens
            .nft_tokens(from_index, limit.map(|v| v.min(100)))
    }
    pub fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.tokens.nft_supply_for_owner(account_id)
    }
    pub fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.tokens
            .nft_tokens_for_owner(account_id, from_index, limit.map(|v| v.min(100)))
    }
    pub fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: "nft-1.0.0".into(),
            name: "Familiar".into(),
            symbol: "PET".into(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
    pub fn auth_context(&self) -> near_sdk::serde_json::Value {
        json!({"predecessor":env::predecessor_account_id(),"signer":env::signer_account_id(),"epoch":U64(env::epoch_height())})
    }
}
impl Contract {
    fn refresh_day(&mut self) {
        let day = env::block_timestamp() / 1_000_000_000 / 86_400;
        if day != self.budget_day {
            self.budget_day = day;
            self.guests_today = 0;
            self.adoptions_today = 0;
            self.registrations_today = 0;
        }
    }
    fn spendable(&self) -> u128 {
        env::account_balance()
            .as_yoctonear()
            .saturating_sub(
                env::storage_byte_cost()
                    .as_yoctonear()
                    .saturating_mul(env::storage_usage() as u128),
            )
            .saturating_sub(PET_RESERVE)
            .saturating_sub(self.reserved_storage)
    }
    fn storage_reserve(&self, bytes: u64) -> u128 {
        env::storage_byte_cost()
            .as_yoctonear()
            .saturating_mul(u128::from(bytes))
    }
    fn register_pet(&mut self, pet: AccountId) -> Option<Promise> {
        self.refresh_day();
        let mut pending = self.adoptions.get(&pet).cloned()?;
        if !pending.created
            || pending.registration_inflight
            || self.registrations_today >= 200
            || self.spendable() < ITEM_STORAGE_FUND
        {
            return None;
        }
        pending.registration_inflight = true;
        self.adoptions.insert(pet.clone(), pending);
        self.registrations_today += 1;
        Some(
            call(
                self.config.items.clone(),
                "register_pet",
                json!({"account_id":pet}),
                ITEM_STORAGE_FUND,
                20,
            )
            .then(call(
                env::current_account_id(),
                "on_adopted",
                json!({"pet":pet}),
                0,
                25,
            )),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{test_utils::VMContextBuilder, testing_env};
    fn id(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn context(predecessor: &str, deposit: u128) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(id("root.testnet"))
            .predecessor_account_id(id(predecessor))
            .signer_account_id(id("relayer.testnet"))
            .account_balance(NearToken::from_near(100))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(1_000_000_000_000_000);
        b
    }
    fn contract() -> Contract {
        testing_env!(context("root.testnet", 0).build());
        Contract::new(
            id("relayer.testnet"),
            [1; 32].into(),
            id("items.root.testnet"),
            id("bakery.root.testnet"),
            id("market.root.testnet"),
            id("pool.testnet"),
        )
    }
    fn mint(c: &mut Contract) {
        c.tokens.internal_mint_with_refund(
            "mochi.root.testnet".into(),
            id("alice.testnet"),
            Some(TokenMetadata::default()),
            None,
        );
    }
    #[test]
    fn predecessor_authorizes_even_when_signer_is_relayer() {
        let mut c = contract();
        mint(&mut c);
        testing_env!(context("alice.testnet", 0).build());
        let p = c.act("mochi.root.testnet".into(), Action::Feed);
        assert!(c.is_busy("mochi.root.testnet".into()));
        std::mem::forget(p);
    }
    #[test]
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn relayer_cannot_impersonate_owner() {
        let mut c = contract();
        mint(&mut c);
        testing_env!(context("relayer.testnet", 0).build());
        let _ = c.act("mochi.root.testnet".into(), Action::Feed);
    }
    #[test]
    #[should_panic(expected = "ERR_PET_BUSY")]
    fn transfer_rejects_inflight_action() {
        let mut c = contract();
        mint(&mut c);
        c.busy.insert("mochi.root.testnet".into());
        testing_env!(context("alice.testnet", 1).build());
        c.nft_transfer(id("bob.testnet"), "mochi.root.testnet".into(), None, None);
    }
    #[test]
    fn old_owner_loses_authority_on_standard_transfer() {
        let mut c = contract();
        mint(&mut c);
        testing_env!(context("alice.testnet", 1).build());
        c.nft_transfer(id("bob.testnet"), "mochi.root.testnet".into(), None, None);
        assert_eq!(
            c.get_owner("mochi.root.testnet".into()),
            Some(id("bob.testnet"))
        );
    }
    #[test]
    #[should_panic(expected = "ERR_RELAYER_ONLY")]
    fn funded_guest_creation_is_relayer_only() {
        let mut c = contract();
        testing_env!(context("alice.testnet", 0).build());
        let _ = c.create_player("ed25519:11111111111111111111111111111111".parse().unwrap());
    }
    #[test]
    #[should_panic(expected = "ERR_DAILY_BUDGET")]
    fn daily_guest_subsidy_is_bounded() {
        let mut c = contract();
        c.refresh_day();
        c.guests_today = 200;
        testing_env!(context("relayer.testnet", 0).build());
        let _ = c.create_player("ed25519:11111111111111111111111111111111".parse().unwrap());
    }
    #[test]
    fn registration_retries_are_serialized_and_budgeted() {
        let mut c = contract();
        let pet = id("mochi.root.testnet");
        c.adoptions.insert(
            pet.clone(),
            Adoption {
                owner: id("alice.testnet"),
                created: true,
                registration_inflight: false,
                storage_reserve: 0,
            },
        );
        let first = c.register_pet(pet.clone()).unwrap();
        std::mem::forget(first);
        assert!(c.register_pet(pet.clone()).is_none());
        assert_eq!(c.registrations_today, 1);
        testing_env!(
            context("root.testnet", 0).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![near_sdk::PromiseResult::Failed]
        );
        assert!(c.on_adopted(pet.clone()).is_none());
        assert!(!c.adoptions.get(&pet).unwrap().registration_inflight);
        let retry = c.register_pet(pet.clone()).unwrap();
        std::mem::forget(retry);
        assert_eq!(c.registrations_today, 2);
        c.adoptions.get_mut(&pet).unwrap().registration_inflight = false;
        c.registrations_today = 200;
        assert!(c.register_pet(pet.clone()).is_none());
        c.registrations_today = 0;
        let mut low = context("root.testnet", 0);
        low.account_balance(NearToken::from_yoctonear(PET_RESERVE));
        testing_env!(low.build());
        assert!(c.register_pet(pet).is_none());
        assert_eq!(c.registrations_today, 0);
    }
    #[test]
    fn callback_floor_exhaustion_keeps_created_pet_recoverable() {
        let mut c = contract();
        let pet = id("mochi.root.testnet");
        c.adoptions.insert(
            pet.clone(),
            Adoption {
                owner: id("alice.testnet"),
                created: false,
                registration_inflight: false,
                storage_reserve: 0,
            },
        );
        let mut low = context("root.testnet", 0);
        low.account_balance(NearToken::from_yoctonear(PET_RESERVE));
        testing_env!(
            low.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![near_sdk::PromiseResult::Successful(vec![])]
        );
        assert!(matches!(
            c.on_pet_created(pet.clone()),
            PromiseOrValue::Value(None)
        ));
        let pending = c.adoptions.get(&pet).unwrap();
        assert!(pending.created);
        assert!(!pending.registration_inflight);
        testing_env!(context("root.testnet", 0).build());
        let resumed = c.register_pet(pet).unwrap();
        std::mem::forget(resumed);
    }
    #[test]
    fn parallel_adoptions_keep_future_nft_storage_out_of_spendable_balance() {
        let mut c = contract();
        let reserve = c.storage_reserve(NFT_STORAGE_RESERVE_BYTES);
        c.player_ids.insert(id("alice.testnet"));
        c.player_ids.insert(id("bob.testnet"));
        let overhead = env::storage_byte_cost().as_yoctonear() * u128::from(env::storage_usage())
            + PET_RESERVE;
        let mut funded = context("alice.testnet", 0);
        funded.account_balance(NearToken::from_yoctonear(overhead + YOCTO * 7 / 10));
        testing_env!(funded.build());
        let scheduled = c.adopt("mochi".into());
        std::mem::forget(scheduled);
        assert_eq!(c.reserved_storage, reserve);
        let mut after_transfer = context("bob.testnet", 0);
        after_transfer.account_balance(NearToken::from_yoctonear(overhead + YOCTO * 4 / 10));
        testing_env!(after_transfer.build());
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.adopt("bean".into())))
                .is_err()
        );
        assert_eq!(c.reserved_storage, reserve);
        assert!(c.adoptions.get(&id("bean.root.testnet")).is_none());
    }
    #[test]
    fn nft_storage_reservation_converts_to_measured_mint_storage() {
        let mut c = contract();
        let reserve = c.storage_reserve(NFT_STORAGE_RESERVE_BYTES);
        let pet = id(&"m".repeat(64));
        let owner = id(&"p".repeat(64));
        c.reserved_storage = reserve * 2;
        c.adoptions.insert(
            pet.clone(),
            Adoption {
                owner: owner.clone(),
                created: true,
                registration_inflight: true,
                storage_reserve: reserve,
            },
        );
        let failed = id("bean.root.testnet");
        c.adoptions.insert(
            failed.clone(),
            Adoption {
                owner: id("alice.testnet"),
                created: false,
                registration_inflight: false,
                storage_reserve: reserve,
            },
        );
        c.adoptions.flush();
        let before = env::storage_usage();
        let mut callback = context("root.testnet", 0);
        callback.storage_usage(before);
        testing_env!(
            callback.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![near_sdk::PromiseResult::Successful(b"true".to_vec())]
        );
        assert_eq!(c.on_adopted(pet.clone()), Some(pet.clone()));
        c.adoptions.flush();
        let minted_bytes = env::storage_usage().saturating_sub(before);
        assert!(c.tokens.extra_storage_in_bytes_per_token <= NFT_STORAGE_RESERVE_BYTES);
        assert!(minted_bytes <= NFT_STORAGE_RESERVE_BYTES);
        assert_eq!(c.reserved_storage, reserve);
        assert_eq!(c.get_owner(pet.to_string()), Some(owner));
        println!(
            "NFT storage: SDK estimate={} bytes; max-ID callback growth={} bytes; reserved={} bytes",
            c.tokens.extra_storage_in_bytes_per_token, minted_bytes, NFT_STORAGE_RESERVE_BYTES
        );
        testing_env!(
            context("root.testnet", 0).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![near_sdk::PromiseResult::Failed]
        );
        assert!(matches!(
            c.on_pet_created(failed),
            PromiseOrValue::Value(None)
        ));
        assert_eq!(c.reserved_storage, 0);
    }
    #[test]
    fn guest_storage_reservation_converts_only_after_player_maps_are_written() {
        let mut c = contract();
        let guest = c.storage_reserve(PLAYER_STORAGE_RESERVE_BYTES);
        let nft = c.storage_reserve(NFT_STORAGE_RESERVE_BYTES);
        let account = id(&format!("p-{}.{}", u64::MAX, "r".repeat(39)));
        let key = format!("ed25519:{}", "z".repeat(44));
        c.reserved_storage = guest + nft;
        c.pending_players.insert(
            key.clone(),
            PendingPlayer {
                account_id: account.clone(),
                storage_reserve: guest,
            },
        );
        c.pending_players.flush();
        let before = env::storage_usage();
        let mut callback = context("root.testnet", 0);
        callback.storage_usage(before);
        testing_env!(
            callback.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![near_sdk::PromiseResult::Successful(vec![])]
        );
        assert_eq!(
            c.on_player(key.clone(), account.clone()),
            Some(account.clone())
        );
        c.players.flush();
        c.pending_players.flush();
        assert_eq!(c.reserved_storage, nft);
        assert_eq!(c.players.get(&key), Some(&account));
        assert!(c.player_ids.contains(&account));
        assert!(env::storage_usage().saturating_sub(before) <= PLAYER_STORAGE_RESERVE_BYTES);
    }
    #[test]
    fn failed_inventory_registration_retains_future_nft_storage_reservation() {
        let mut c = contract();
        let reserve = c.storage_reserve(NFT_STORAGE_RESERVE_BYTES);
        let pet = id("mochi.root.testnet");
        c.reserved_storage = reserve;
        c.adoptions.insert(
            pet.clone(),
            Adoption {
                owner: id("alice.testnet"),
                created: true,
                registration_inflight: true,
                storage_reserve: reserve,
            },
        );
        testing_env!(
            context("root.testnet", 0).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![near_sdk::PromiseResult::Failed]
        );
        assert!(c.on_adopted(pet.clone()).is_none());
        assert_eq!(c.reserved_storage, reserve);
        assert!(!c.adoptions.get(&pet).unwrap().registration_inflight);
    }
}

#[cfg(test)]
mod den_tests {
    use super::*;
    use near_sdk::{PromiseResult, test_utils::VMContextBuilder, testing_env};
    #[test]
    fn successful_den_and_bread_callbacks_are_idempotent() {
        let root: AccountId = "root.testnet".parse().unwrap();
        let mut b = VMContextBuilder::new();
        b.current_account_id(root.clone())
            .predecessor_account_id(root)
            .account_balance(NearToken::from_near(100));
        testing_env!(b.build());
        let mut c = Contract::new(
            "relayer.testnet".parse().unwrap(),
            [1; 32].into(),
            "items.root.testnet".parse().unwrap(),
            "bakery.root.testnet".parse().unwrap(),
            "market.root.testnet".parse().unwrap(),
            "pool.testnet".parse().unwrap(),
        );
        let pet = "mochi.root.testnet".to_string();
        c.busy.insert(pet.clone());
        testing_env!(
            b.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Successful(b"true".to_vec())]
        );
        assert!(c.on_action(pet.clone(), Some(2), false));
        assert_eq!(c.get_den(pet.clone()), Some(2));
        c.busy.insert(pet.clone());
        assert!(c.on_action(pet.clone(), None, true));
        assert_eq!(c.den_bread, [0, 1, 0, 0]);
        assert!(!c.on_action(pet, None, true));
        assert_eq!(c.den_bread, [0, 1, 0, 0]);
    }
}
