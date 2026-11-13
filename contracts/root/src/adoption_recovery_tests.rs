use super::*;
use near_sdk::{
    PromiseResult,
    mock::MockAction,
    test_utils::{VMContextBuilder, get_created_receipts},
    testing_env,
};

fn id(value: &str) -> AccountId {
    value.parse().unwrap()
}
fn context(predecessor: &str) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(id("root.testnet"))
        .predecessor_account_id(id(predecessor))
        .account_balance(NearToken::from_near(100));
    b
}
fn callback(result: PromiseResult) {
    testing_env!(
        context("root.testnet").build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}
fn pending(created: bool, inflight: bool) -> Contract {
    testing_env!(context("root.testnet").build());
    let mut c = Contract::new(
        id("relayer.testnet"),
        [1; 32].into(),
        id("items.root.testnet"),
        id("bakery.root.testnet"),
        id("market.root.testnet"),
        id("pool.testnet"),
    );
    let owner = id("alice.testnet");
    let pet = id("mochi.root.testnet");
    let reserve = c.storage_reserve(NFT_STORAGE_RESERVE_BYTES);
    c.player_ids.insert(owner.clone());
    c.adopted_players.insert(owner.clone());
    c.reserved_storage = reserve;
    c.adoptions.insert(
        pet,
        Adoption {
            owner,
            created,
            registration_inflight: inflight,
            storage_reserve: reserve,
        },
    );
    c
}

#[test]
fn lost_registration_callback_retry_queries_authoritative_items_without_another_deposit() {
    let mut c = pending(true, true);
    testing_env!(context("alice.testnet").build());
    let retry = c.adopt("mochi".into());
    assert!(
        matches!(retry, PromiseOrValue::Promise(_)),
        "F07: an already-created companion must query the original Items registration rather than remain stuck"
    );
    drop(retry);
    let receipts = get_created_receipts();
    let mut queries = 0;
    for receipt in receipts {
        for action in receipt.actions {
            match action {
                MockAction::FunctionCallWeight {
                    method_name,
                    attached_deposit,
                    ..
                } => {
                    assert_eq!(attached_deposit.as_yoctonear(), 0);
                    if receipt.receiver_id == id("items.root.testnet") {
                        assert_eq!(method_name, b"is_pet");
                        queries += 1;
                    }
                }
                MockAction::Transfer { .. } | MockAction::CreateAccount { .. } => {
                    panic!("Recovery must not fund or create anything")
                }
                _ => {}
            }
        }
    }
    assert_eq!(queries, 1);
    assert!(
        c.adoptions
            .get(&id("mochi.root.testnet"))
            .unwrap()
            .registration_inflight
    );
    assert!(c.nft_token("mochi.root.testnet".into()).is_none());
}

#[test]
fn positive_registration_evidence_mints_original_nft_once_and_late_original_callback_is_harmless() {
    let mut c = pending(true, true);
    let pet = id("mochi.root.testnet");
    let owner = id("alice.testnet");
    let reserve = c.reserved_storage;
    assert!(reserve > 0);
    callback(PromiseResult::Successful(b"true".to_vec()));
    assert_eq!(
        c.on_adoption_registration_evidence(pet.clone(), owner.clone()),
        Some(pet.clone())
    );
    assert_eq!(c.get_owner(pet.to_string()), Some(owner.clone()));
    assert_eq!(c.nft_total_supply().0, 1);
    assert_eq!(c.reserved_storage, 0);
    assert!(c.adoptions.get(&pet).is_none());
    callback(PromiseResult::Successful(b"true".to_vec()));
    assert_eq!(c.on_adopted(pet.clone()), None);
    assert_eq!(
        c.on_adoption_registration_evidence(pet, owner.clone()),
        None
    );
    assert_eq!(c.nft_total_supply().0, 1);
    assert_eq!(c.reserved_storage, 0);
    let journey = c.tidebound_journey(owner);
    assert!(journey.claims.is_empty());
    assert_eq!(journey.credit, "unclaimed");
}

#[test]
fn unknown_false_failed_or_malformed_registration_evidence_never_unlocks_or_repays() {
    let mut c = pending(true, true);
    let pet = id("mochi.root.testnet");
    let owner = id("alice.testnet");
    let reserve = c.reserved_storage;
    let before = near_sdk::borsh::to_vec(&c).unwrap();
    for result in [
        PromiseResult::Failed,
        PromiseResult::Successful(b"false".to_vec()),
        PromiseResult::Successful(b"null".to_vec()),
        PromiseResult::Successful(br#""true""#.to_vec()),
        PromiseResult::Successful(b"true?".to_vec()),
        PromiseResult::Successful(vec![]),
    ] {
        callback(result);
        assert_eq!(
            c.on_adoption_registration_evidence(pet.clone(), owner.clone()),
            None
        );
        assert_eq!(c.reserved_storage, reserve);
        assert!(c.adoptions.get(&pet).unwrap().registration_inflight);
        assert!(c.nft_token(pet.to_string()).is_none());
        assert!(get_created_receipts().is_empty());
        assert_eq!(near_sdk::borsh::to_vec(&c).unwrap(), before);
    }
    testing_env!(context("root.testnet").build());
    assert_eq!(c.on_adoption_registration_evidence(pet, owner), None);
    assert_eq!(c.reserved_storage, reserve);
}

#[test]
fn registration_proof_is_bound_to_the_pending_owner_and_proven_creation() {
    let mut c = pending(false, true);
    let pet = id("mochi.root.testnet");
    let reserve = c.reserved_storage;
    callback(PromiseResult::Successful(b"true".to_vec()));
    assert_eq!(
        c.on_adoption_registration_evidence(pet.clone(), id("alice.testnet")),
        None
    );
    assert_eq!(c.reserved_storage, reserve);
    assert!(c.nft_token(pet.to_string()).is_none());
    c.adoptions.get_mut(&pet).unwrap().created = true;
    callback(PromiseResult::Successful(b"true".to_vec()));
    assert_eq!(
        c.on_adoption_registration_evidence(pet.clone(), id("mallory.testnet")),
        None
    );
    assert_eq!(c.reserved_storage, reserve);
    assert!(c.nft_token(pet.to_string()).is_none());
}

#[test]
fn original_registration_callback_winning_the_race_cannot_be_minted_again_by_recovery() {
    let mut c = pending(true, true);
    let pet = id("mochi.root.testnet");
    callback(PromiseResult::Successful(b"true".to_vec()));
    assert_eq!(c.on_adopted(pet.clone()), Some(pet.clone()));
    callback(PromiseResult::Successful(b"true".to_vec()));
    assert_eq!(
        c.on_adoption_registration_evidence(pet, id("alice.testnet")),
        None
    );
    assert_eq!(c.nft_total_supply().0, 1);
    assert_eq!(c.reserved_storage, 0);
}

#[test]
#[should_panic(expected = "ERR_ADOPTION_PENDING")]
fn unproven_creation_stays_blocked_instead_of_trusting_a_preexisting_account() {
    let mut c = pending(false, false);
    testing_env!(context("alice.testnet").build());
    drop(c.adopt("mochi".into()));
}
