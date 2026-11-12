use crate::{Contract, ContractExt};
use familiar_common::{emit, rules::ITEM_STORAGE_FUND, storycraft::*};
use near_sdk::{NearToken, Promise, env, near, require, serde_json::json};
use near_sdk_contract_tools::mt::{
    BaseMetadata, MetadataController, Nep145Controller, Nep245Controller, Nep245Mint, TokenMetadata,
};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CraftItem {
    pub mint: MintEvidence,
    pub finish: String,
    pub appearance_version: u32,
    pub finish_used: bool,
}
#[near]
impl Contract {
    pub fn craft_protocol(&self) -> near_sdk::serde_json::Value {
        require!(
            env::current_account_id().as_str().ends_with(".testnet")
                && self.registry.as_str().ends_with(".testnet"),
            "ERR_TESTNET_ONLY"
        );
        json!({"network":"testnet","rules_version":RULES_VERSION,"content_version":CONTENT_VERSION,"registry":self.registry})
    }
    #[payable]
    pub fn craft_mint(&mut self, operation: MintEvidence) -> MintEvidence {
        self.craft_authority();
        if let Some(existing) = self.mint_operations.get(&operation.id) {
            require!(existing == &operation, "ERR_OPERATION_CONFLICT");
            if env::attached_deposit().as_yoctonear() > 0 {
                Promise::new(self.registry.clone())
                    .transfer(env::attached_deposit())
                    .detach();
            }
            return existing.clone();
        }
        require!(
            operation.origin_claim_id.len() == 64
                && matches!(operation.motif.as_str(), "crest" | "moth"),
            "ERR_CRAFT_INPUT"
        );
        let expected = mint_evidence(
            &env::current_account_id(),
            &self.registry,
            &operation.maker,
            &operation.origin_claim_id,
            &operation.motif,
        );
        require!(operation == expected, "ERR_CRAFT_INPUT");
        require!(
            env::attached_deposit().as_yoctonear() == CRAFT_STORAGE_FUND,
            "ERR_STORAGE_DEPOSIT"
        );
        require!(!self.token_exists(&operation.token_id), "ERR_ITEM_EXISTS");
        let before = env::storage_usage();
        self.deposit_to_storage_account(
            &operation.maker,
            NearToken::from_yoctonear(ITEM_STORAGE_FUND),
        )
        .expect("ERR_STORAGE");
        self.create_token(operation.token_id.clone())
            .expect("ERR_TOKEN");
        if self.base_metadata(RECIPE).is_none() {
            self.create_base_metadata(BaseMetadata::new("First Light lantern", RECIPE))
                .expect("ERR_METADATA");
        }
        let item = CraftItem {
            mint: operation.clone(),
            finish: "original".into(),
            appearance_version: 0,
            finish_used: false,
        };
        self.write_craft_metadata(&item);
        self.mint(&Nep245Mint::single(
            operation.token_id.as_str(),
            1,
            &*operation.maker,
        ))
        .expect("ERR_MINT");
        self.crafts.insert(operation.token_id.clone(), item);
        self.craft_ids.push(operation.token_id.clone());
        self.craft_ids.flush();
        self.mint_operations
            .insert(operation.id.clone(), operation.clone());
        self.crafts.flush();
        self.mint_operations.flush();
        let growth_cost = u128::from(env::storage_usage().saturating_sub(before))
            * env::storage_byte_cost().as_yoctonear();
        require!(
            growth_cost
                + ITEM_STORAGE_FUND
                + u128::from(POLISH_STORAGE_RESERVE_BYTES)
                    * env::storage_byte_cost().as_yoctonear()
                <= CRAFT_STORAGE_FUND,
            "ERR_CRAFT_STORAGE"
        );
        emit("storycrafted", json!(&operation));
        operation
    }
    pub fn craft_mint_operation(&self, operation_id: String) -> Option<MintEvidence> {
        self.mint_operations.get(&operation_id).cloned()
    }
    pub fn craft_item(&self, token_id: String) -> Option<CraftItem> {
        self.crafts.get(&token_id).cloned()
    }
    pub fn craft_inventory(
        &self,
        account_id: near_sdk::AccountId,
        from_index: u32,
        limit: u32,
    ) -> near_sdk::serde_json::Value {
        require!((1..=32).contains(&limit), "ERR_PAGE_LIMIT");
        let end = from_index.saturating_add(limit).min(self.craft_ids.len());
        let items: Vec<_> = (from_index..end)
            .filter_map(|index| {
                let id = self.craft_ids.get(index)?;
                if self.balance_of(id, &account_id) != 1 {
                    return None;
                }
                self.crafts.get(id).cloned()
            })
            .collect();
        json!({"items":items,"next_index":if end < self.craft_ids.len() { Some(end) } else { None }})
    }
    pub fn craft_polish(&mut self, operation: PolishEvidence) -> PolishEvidence {
        self.craft_authority();
        if let Some(existing) = self.polish_operations.get(&operation.id) {
            require!(existing == &operation, "ERR_OPERATION_CONFLICT");
            return existing.clone();
        }
        let expected = polish_evidence(
            &env::current_account_id(),
            &self.registry,
            &operation.expected_holder,
            &operation.token_id,
            operation.expected_appearance,
            operation.generation,
        );
        require!(operation == expected, "ERR_FINISH_INPUT");
        let fence_id = polish_fence_id(&env::current_account_id(), &self.registry, &operation);
        require!(
            !self
                .polish_fences
                .get(&fence_id)
                .is_some_and(|generation| operation.generation <= *generation),
            "ERR_FINISH_CANCELLED"
        );
        let mut item = self
            .crafts
            .get(&operation.token_id)
            .cloned()
            .expect("ERR_ITEM");
        require!(
            self.balance_of(&operation.token_id, &operation.expected_holder) == 1,
            "ERR_NOT_HOLDER"
        );
        require!(
            !item.finish_used && item.appearance_version == operation.expected_appearance,
            "ERR_APPEARANCE"
        );
        // All standard transfer paths update this same balance before a competing finish can run.
        let before = env::storage_usage();
        item.finish = "harbor_polish".into();
        item.appearance_version = 1;
        item.finish_used = true;
        self.write_craft_metadata(&item);
        self.crafts.insert(operation.token_id.clone(), item);
        self.polish_operations
            .insert(operation.id.clone(), operation.clone());
        self.crafts.flush();
        self.polish_operations.flush();
        require!(
            env::storage_usage().saturating_sub(before) <= POLISH_STORAGE_RESERVE_BYTES,
            "ERR_FINISH_STORAGE"
        );
        emit("lantern_polished", json!(&operation));
        operation
    }
    #[payable]
    pub fn craft_cancel_polish(&mut self, operation: PolishEvidence) -> PolishCancellation {
        self.craft_authority();
        let expected = polish_evidence(
            &env::current_account_id(),
            &self.registry,
            &operation.expected_holder,
            &operation.token_id,
            operation.expected_appearance,
            operation.generation,
        );
        require!(
            operation == expected
                && operation.token_id.len() == 72
                && operation.token_id.starts_with("lantern:"),
            "ERR_FINISH_INPUT"
        );
        require!(
            env::attached_deposit().as_yoctonear() == POLISH_CANCEL_STORAGE_FUND,
            "ERR_STORAGE_DEPOSIT"
        );
        if let Some(success) = self.polish_operations.get(&operation.id) {
            require!(success == &operation, "ERR_OPERATION_CONFLICT");
            Promise::new(self.registry.clone())
                .transfer(env::attached_deposit())
                .detach();
            return PolishCancellation {
                status: "confirmed".into(),
                operation,
            };
        }
        let fence_id = polish_fence_id(&env::current_account_id(), &self.registry, &operation);
        if let Some(previous) = self.polish_fences.get(&fence_id).copied() {
            if previous < operation.generation {
                self.polish_fences.insert(fence_id, operation.generation);
            }
            Promise::new(self.registry.clone())
                .transfer(env::attached_deposit())
                .detach();
        } else {
            let before = env::storage_usage();
            self.polish_fences.insert(fence_id, operation.generation);
            self.polish_fences.flush();
            require!(
                u128::from(env::storage_usage().saturating_sub(before))
                    * env::storage_byte_cost().as_yoctonear()
                    <= POLISH_CANCEL_STORAGE_FUND,
                "ERR_FENCE_STORAGE"
            );
        }
        PolishCancellation {
            status: "cancelled".into(),
            operation,
        }
    }
    pub fn craft_polish_operation(&self, operation_id: String) -> Option<PolishEvidence> {
        self.polish_operations.get(&operation_id).cloned()
    }
}
impl Contract {
    fn craft_authority(&self) {
        require!(
            env::current_account_id().as_str().ends_with(".testnet")
                && self.registry.as_str().ends_with(".testnet"),
            "ERR_TESTNET_ONLY"
        );
        require!(
            env::predecessor_account_id() == self.registry,
            "ERR_REGISTRY_ONLY"
        );
    }
    fn write_craft_metadata(&mut self, item: &CraftItem) {
        self.set_token_metadata(&item.mint.token_id, RECIPE.to_owned(), TokenMetadata::new()
            .title("First Light lantern".to_owned())
            .description("A common introductory Storycraft lantern. The maker's achievement stays with its maker.".to_owned())
            .extra(near_sdk::serde_json::to_string(item).expect("ERR_METADATA")))
            .expect("ERR_METADATA");
    }
}

#[cfg(test)]
mod tests {
    use crate::*;
    use familiar_common::storycraft::{CRAFT_STORAGE_FUND, MintEvidence, mint_evidence};
    use near_sdk::{test_utils::VMContextBuilder, testing_env};
    use near_sdk_contract_tools::mt::Nep245;

    fn id(value: &str) -> AccountId {
        value.parse().unwrap()
    }
    fn ctx(predecessor: &str, deposit: u128) {
        let mut b = VMContextBuilder::new();
        b.current_account_id(id("items.root.testnet"))
            .predecessor_account_id(id(predecessor))
            .signer_account_id(id("relayer.testnet"))
            .account_balance(NearToken::from_near(100))
            .attached_deposit(NearToken::from_yoctonear(deposit));
        testing_env!(b.build());
    }
    fn contract() -> Contract {
        ctx("items.root.testnet", 0);
        Contract::new(
            id("root.testnet"),
            id("bakery.root.testnet"),
            id("market.root.testnet"),
        )
    }
    fn evidence() -> MintEvidence {
        mint_evidence(
            &id("items.root.testnet"),
            &id("root.testnet"),
            &id("alice.testnet"),
            &"a".repeat(64),
            "crest",
        )
    }
    #[test]
    fn mint_receipt_is_atomic_idempotent_and_survives_standard_transfer() {
        let mut c = contract();
        let input = evidence();
        ctx("root.testnet", CRAFT_STORAGE_FUND);
        assert_eq!(c.craft_mint(input.clone()), input);
        assert_eq!(c.supply(&input.token_id), Some(1));
        ctx("root.testnet", 0);
        assert_eq!(c.craft_mint(input.clone()), input);
        assert_eq!(c.supply(&input.token_id), Some(1));
        ctx("bob.testnet", ITEM_STORAGE_FUND);
        c.deposit_to_storage_account(
            &id("bob.testnet"),
            NearToken::from_yoctonear(ITEM_STORAGE_FUND),
        )
        .unwrap();
        ctx("alice.testnet", 1);
        c.mt_transfer(
            id("bob.testnet"),
            input.token_id.clone(),
            U128(1),
            None,
            None,
        );
        assert_eq!(
            c.mt_balance_of(id("alice.testnet"), input.token_id.clone()),
            U128(0)
        );
        assert_eq!(
            c.mt_balance_of(id("bob.testnet"), input.token_id.clone()),
            U128(1)
        );
        assert_eq!(
            c.craft_mint_operation(input.id.clone()),
            Some(input.clone())
        );
        ctx("root.testnet", 0);
        assert_eq!(c.craft_mint(input.clone()), input);
        assert_eq!(c.supply(&input.token_id), Some(1));
    }
    #[test]
    #[should_panic(expected = "ERR_REGISTRY_ONLY")]
    fn maker_cannot_mint_without_ledger_authority() {
        let mut c = contract();
        ctx("alice.testnet", CRAFT_STORAGE_FUND);
        c.craft_mint(evidence());
    }
    #[test]
    #[should_panic(expected = "ERR_OPERATION_CONFLICT")]
    fn matching_operation_cannot_change_its_provenance() {
        let mut c = contract();
        let mut input = evidence();
        ctx("root.testnet", CRAFT_STORAGE_FUND);
        c.craft_mint(input.clone());
        input.origin_claim_id = "different-claim".into();
        ctx("root.testnet", 0);
        c.craft_mint(input);
    }
}

#[cfg(test)]
mod finish_tests {
    use crate::*;
    use familiar_common::storycraft::*;
    use near_sdk::{PromiseResult, test_utils::VMContextBuilder, testing_env};
    use near_sdk_contract_tools::mt::{Nep245, Nep245Resolver};
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
    fn minted() -> (Contract, MintEvidence) {
        ctx("items.root.testnet", 0);
        let mut c = Contract::new(
            id("root.testnet"),
            id("bakery.root.testnet"),
            id("market.root.testnet"),
        );
        let e = mint_evidence(
            &id("items.root.testnet"),
            &id("root.testnet"),
            &id("alice.testnet"),
            &"a".repeat(64),
            "crest",
        );
        ctx("root.testnet", CRAFT_STORAGE_FUND);
        c.craft_mint(e.clone());
        c.deposit_to_storage_account(
            &id("bob.testnet"),
            NearToken::from_yoctonear(ITEM_STORAGE_FUND),
        )
        .unwrap();
        (c, e)
    }
    #[test]
    fn polish_changes_the_same_item_once_without_rewriting_maker_or_motif() {
        let (mut c, mint) = minted();
        let e = polish_evidence(
            &id("items.root.testnet"),
            &id("root.testnet"),
            &id("alice.testnet"),
            &mint.token_id,
            0,
            0,
        );
        ctx("root.testnet", 0);
        assert_eq!(c.craft_polish(e.clone()), e);
        assert_eq!(c.craft_polish(e.clone()), e);
        let item = c.craft_item(mint.token_id.clone()).unwrap();
        assert_eq!(item.mint, mint);
        assert_eq!(
            (
                item.finish.as_str(),
                item.finish_used,
                item.appearance_version
            ),
            ("harbor_polish", true, 1)
        );
        assert_eq!(c.supply(&mint.token_id), Some(1));
        ctx("alice.testnet", 1);
        c.mt_transfer(
            id("bob.testnet"),
            mint.token_id.clone(),
            U128(1),
            None,
            None,
        );
        let bob = polish_evidence(
            &id("items.root.testnet"),
            &id("root.testnet"),
            &id("bob.testnet"),
            &mint.token_id,
            0,
            0,
        );
        ctx("root.testnet", 0);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.craft_polish(bob))).is_err()
        );
        assert_eq!(c.craft_item(mint.token_id).unwrap(), item);
    }
    #[test]
    fn transfer_between_reservation_and_mutation_rejects_the_former_holder() {
        let (mut c, mint) = minted();
        let e = polish_evidence(
            &id("items.root.testnet"),
            &id("root.testnet"),
            &id("alice.testnet"),
            &mint.token_id,
            0,
            0,
        );
        ctx("alice.testnet", 1);
        c.mt_batch_transfer(
            id("bob.testnet"),
            vec![mint.token_id.clone()],
            vec![U128(1)],
            None,
            None,
        );
        ctx("root.testnet", 0);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.craft_polish(e.clone())))
                .is_err()
        );
        assert!(c.craft_polish_operation(e.id).is_none());
        let bob = polish_evidence(
            &id("items.root.testnet"),
            &id("root.testnet"),
            &id("bob.testnet"),
            &mint.token_id,
            0,
            0,
        );
        assert_eq!(c.craft_polish(bob.clone()), bob);
    }
    #[test]
    fn legacy_building_extension_cannot_burn_or_mint_supply_one_crafts() {
        let (mut c, mint) = minted();
        ctx("root.testnet", ITEM_STORAGE_FUND);
        c.register_pet(id("alice.testnet"));
        ctx("bakery.root.testnet", 0);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.game_mint(
                id("alice.testnet"),
                vec![mint.token_id.clone()],
                vec![U128(1)]
            )))
            .is_err()
        );
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.game_burn(
                id("alice.testnet"),
                vec![mint.token_id.clone()],
                vec![U128(1)]
            )))
            .is_err()
        );
        assert_eq!(c.supply(&mint.token_id), Some(1));
    }
    #[test]
    fn transfer_call_and_resolver_use_the_same_atomic_holder_check() {
        let (mut c, mint) = minted();
        let e = polish_evidence(
            &id("items.root.testnet"),
            &id("root.testnet"),
            &id("alice.testnet"),
            &mint.token_id,
            0,
            0,
        );
        ctx("alice.testnet", 1);
        std::mem::forget(c.mt_transfer_call(
            id("bob.testnet"),
            mint.token_id.clone(),
            U128(1),
            None,
            None,
            "reject".into(),
        ));
        ctx("root.testnet", 0);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.craft_polish(e.clone())))
                .is_err()
        );
        let mut b = VMContextBuilder::new();
        b.current_account_id(id("items.root.testnet"))
            .predecessor_account_id(id("items.root.testnet"))
            .account_balance(NearToken::from_near(100));
        testing_env!(
            b.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Failed]
        );
        assert_eq!(
            c.mt_resolve_transfer(
                id("alice.testnet"),
                id("bob.testnet"),
                vec![mint.token_id.clone()],
                vec![U128(1)]
            ),
            vec![U128(0)]
        );
        ctx("root.testnet", 0);
        assert_eq!(c.craft_polish(e.clone()), e);
        assert_eq!(c.supply(&mint.token_id), Some(1));
    }
    #[test]
    fn standard_self_transfer_cannot_duplicate_a_supply_one_lantern() {
        let (mut c, mint) = minted();
        ctx("alice.testnet", 1);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.mt_transfer(
                id("alice.testnet"),
                mint.token_id.clone(),
                U128(1),
                None,
                None
            )))
            .is_err()
        );
        assert_eq!(c.balance_of(&mint.token_id, &id("alice.testnet")), 1);
        assert_eq!(c.supply(&mint.token_id), Some(1));
    }

    #[test]
    fn all_standard_self_transfer_paths_reject_before_any_balance_mutation() {
        let (mut c, mint) = minted();
        for path in 0..4 {
            ctx("alice.testnet", 1);
            assert!(
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| match path {
                    0 => c.mt_transfer(
                        id("alice.testnet"),
                        mint.token_id.clone(),
                        U128(1),
                        None,
                        None
                    ),
                    1 => c.mt_batch_transfer(
                        id("alice.testnet"),
                        vec![mint.token_id.clone()],
                        vec![U128(1)],
                        None,
                        None
                    ),
                    2 => std::mem::forget(c.mt_transfer_call(
                        id("alice.testnet"),
                        mint.token_id.clone(),
                        U128(1),
                        None,
                        None,
                        "".into()
                    )),
                    _ => std::mem::forget(c.mt_batch_transfer_call(
                        id("alice.testnet"),
                        vec![mint.token_id.clone()],
                        vec![U128(1)],
                        None,
                        None,
                        "".into()
                    )),
                }))
                .is_err()
            );
            assert_eq!(c.balance_of(&mint.token_id, &id("alice.testnet")), 1);
            assert_eq!(c.supply(&mint.token_id), Some(1));
        }
    }
    #[test]
    fn duplicate_mint_with_storage_funding_returns_the_same_receipt_and_refunds_its_extra_funding()
    {
        let (mut c, mint) = minted();
        ctx("root.testnet", CRAFT_STORAGE_FUND);
        assert_eq!(c.craft_mint(mint.clone()), mint);
        assert_eq!(c.supply(&mint.token_id), Some(1));
        let receipts = near_sdk::test_utils::get_created_receipts();
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].receiver_id, id("root.testnet"));
        assert!(
            matches!(receipts[0].actions.as_slice(),[near_sdk::mock::MockAction::Transfer{deposit,..}] if deposit.as_yoctonear()==CRAFT_STORAGE_FUND)
        );
    }
    #[test]
    fn cancellation_fences_late_mutation_and_a_new_generation_can_finish_only_once() {
        let (mut c, mint) = minted();
        let old = polish_evidence(
            &id("items.root.testnet"),
            &id("root.testnet"),
            &id("alice.testnet"),
            &mint.token_id,
            0,
            0,
        );
        ctx("root.testnet", POLISH_CANCEL_STORAGE_FUND);
        assert_eq!(c.craft_cancel_polish(old.clone()).status, "cancelled");
        ctx("root.testnet", 0);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.craft_polish(old.clone())))
                .is_err()
        );
        assert!(c.craft_polish_operation(old.id.clone()).is_none());
        let next = polish_evidence(
            &id("items.root.testnet"),
            &id("root.testnet"),
            &id("alice.testnet"),
            &mint.token_id,
            0,
            1,
        );
        assert_eq!(c.craft_polish(next.clone()), next);
        ctx("root.testnet", POLISH_CANCEL_STORAGE_FUND);
        assert_eq!(c.craft_cancel_polish(next.clone()).status, "confirmed");
        ctx("root.testnet", 0);
        let third = polish_evidence(
            &id("items.root.testnet"),
            &id("root.testnet"),
            &id("alice.testnet"),
            &mint.token_id,
            0,
            2,
        );
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.craft_polish(third)))
                .is_err()
        );
        assert_eq!(c.supply(&mint.token_id), Some(1));
        assert!(c.craft_item(mint.token_id).unwrap().finish_used);
    }
    #[test]
    fn transferred_away_item_can_fence_its_failed_former_holder_operation() {
        let (mut c, mint) = minted();
        let alice = polish_evidence(
            &id("items.root.testnet"),
            &id("root.testnet"),
            &id("alice.testnet"),
            &mint.token_id,
            0,
            0,
        );
        ctx("alice.testnet", 1);
        c.mt_transfer(
            id("bob.testnet"),
            mint.token_id.clone(),
            U128(1),
            None,
            None,
        );
        ctx("root.testnet", 0);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                || c.craft_polish(alice.clone())
            ))
            .is_err()
        );
        ctx("root.testnet", POLISH_CANCEL_STORAGE_FUND);
        assert_eq!(
            c.craft_cancel_polish(alice.clone()),
            PolishCancellation {
                status: "cancelled".into(),
                operation: alice.clone()
            }
        );
        ctx("root.testnet", 0);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.craft_polish(alice)))
                .is_err()
        );
        let bob = polish_evidence(
            &id("items.root.testnet"),
            &id("root.testnet"),
            &id("bob.testnet"),
            &mint.token_id,
            0,
            0,
        );
        assert_eq!(c.craft_polish(bob.clone()), bob);
    }
}
