use super::*;
use near_sdk::{
    PromiseResult,
    mock::MockAction,
    test_utils::{VMContextBuilder, get_created_receipts},
    testing_env,
};

fn id(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn key(byte: u8) -> PublicKey {
    PublicKey::from_parts(near_sdk::CurveType::ED25519, vec![byte; 32]).unwrap()
}
fn context(predecessor: &str) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(id("root.testnet"))
        .predecessor_account_id(id(predecessor))
        .signer_account_id(id("relayer.testnet"))
        .account_balance(NearToken::from_near(100));
    b
}
fn ctx(predecessor: &str) {
    testing_env!(context(predecessor).build());
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
fn contract() -> Contract {
    ctx("root.testnet");
    Contract::new(
        id("relayer.testnet"),
        [1; 32].into(),
        id("items.root.testnet"),
        id("bakery.root.testnet"),
        id("market.root.testnet"),
        id("pool.testnet"),
    )
}
fn reserve(c: &mut Contract, public_key: PublicKey, name: &str) -> PendingPlayer {
    ctx("relayer.testnet");
    std::mem::forget(c.create_named_player(public_key.clone(), name.into()));
    c.pending_players
        .get(&public_key.to_string())
        .unwrap()
        .clone()
}

#[test]
fn named_native_signers_receive_a_quarter_near_and_legacy_automatic_players_keep_their_endowment() {
    let mut c = contract();
    ctx("relayer.testnet");
    drop(c.create_named_player(key(1), "alice".into()));
    let named: Vec<_> = get_created_receipts()
        .into_iter()
        .filter(|r| r.receiver_id == id("alice.root.testnet"))
        .flat_map(|r| r.actions)
        .filter_map(|a| match a {
            MockAction::Transfer { deposit, .. } => Some(deposit.as_yoctonear()),
            _ => None,
        })
        .collect();
    assert_eq!(named, vec![YOCTO / 4]);

    ctx("relayer.testnet");
    drop(c.create_player(key(2)));
    let legacy: Vec<_> = get_created_receipts()
        .into_iter()
        .filter(|r| r.receiver_id == id("p-2.root.testnet"))
        .flat_map(|r| r.actions)
        .filter_map(|a| match a {
            MockAction::Transfer { deposit, .. } => Some(deposit.as_yoctonear()),
            _ => None,
        })
        .collect();
    assert_eq!(legacy, vec![PLAYER_FUND]);
    assert_eq!(PLAYER_FUND, YOCTO / 20);
}

#[test]
fn named_player_precheck_reserves_the_larger_endowment_before_any_async_creation() {
    let mut c = contract();
    let overhead =
        PET_RESERVE + env::storage_byte_cost().as_yoctonear() * u128::from(env::storage_usage());
    let reserve = c.storage_reserve(PLAYER_STORAGE_RESERVE_BYTES);
    let mut low = context("relayer.testnet");
    low.storage_usage(env::storage_usage())
        .account_balance(NearToken::from_yoctonear(
            overhead + PLAYER_FUND + ADOPT_FUND + ITEM_STORAGE_FUND + reserve,
        ));
    testing_env!(low.build());
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(
            || c.create_named_player(key(1), "alice".into())
        ))
        .is_err()
    );
    assert!(c.pending_players.get(&key(1).to_string()).is_none());
    assert!(
        c.pending_player_names
            .get(&id("alice.root.testnet"))
            .is_none()
    );
    assert_eq!((c.counter, c.guests_today, c.reserved_storage), (0, 0, 0));
    assert!(get_created_receipts().is_empty());
    drop(c.create_player(key(2)));
    assert!(c.pending_players.get(&key(2).to_string()).is_some());
}

#[test]
fn named_player_is_the_exact_child_and_stable_key_binding_wins_changed_name_retry() {
    let mut c = contract();
    let pk = key(1);
    let pending = reserve(&mut c, pk.clone(), "alice");
    assert_eq!(pending.account_id, id("alice.root.testnet"));
    assert!(!c.player_name_available("alice".into()));
    callback(PromiseResult::Successful(vec![]));
    assert_eq!(
        c.on_player(
            pk.to_string(),
            pending.account_id.clone(),
            U64(pending.operation_id)
        ),
        Some(id("alice.root.testnet"))
    );
    ctx("relayer.testnet");
    assert!(
        matches!(c.create_named_player(pk.clone(),"different".into()),PromiseOrValue::Value(Some(account)) if account==id("alice.root.testnet"))
    );
    assert!(
        matches!(c.create_player(pk),PromiseOrValue::Value(Some(account)) if account==id("alice.root.testnet"))
    );
    assert!(c.player_name_available("different".into()));
    assert!(
        get_created_receipts().is_empty(),
        "Returning sign-in must never issue another endowment."
    );
}

#[test]
fn invalid_reserved_and_nested_names_cannot_reserve_the_player_namespace() {
    let mut c = contract();
    for name in [
        "a",
        "Alice",
        "items",
        "market",
        "bram",
        "p-1",
        "den-east",
        "seat-one",
        "two.words",
        "-alice",
        "alice-",
        "a__b",
        "a".repeat(25).as_str(),
    ] {
        ctx("relayer.testnet");
        assert!(!c.player_name_available(name.into()));
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                || c.create_named_player(key(1), name.into())
            ))
            .is_err()
        );
        assert!(c.pending_players.get(&key(1).to_string()).is_none());
    }
    assert_eq!(c.reserved_storage, 0);
}

#[test]
fn concurrent_key_and_name_requests_cannot_create_a_second_player() {
    let mut c = contract();
    reserve(&mut c, key(1), "alice");
    let reserved = c.reserved_storage;
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(
            || c.create_named_player(key(1), "another".into())
        ))
        .is_err()
    );
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(
            || c.create_named_player(key(2), "alice".into())
        ))
        .is_err()
    );
    assert_eq!(c.reserved_storage, reserved);
    assert!(c.pending_players.get(&key(2).to_string()).is_none());
    assert_eq!(
        c.pending_player_names.get(&id("alice.root.testnet")),
        Some(&key(1).to_string())
    );
}

#[test]
fn named_factory_rejects_current_and_pending_pet_accounts() {
    let mut c = contract();
    c.tokens.internal_mint_with_refund(
        "mochi.root.testnet".into(),
        id("owner.testnet"),
        Some(TokenMetadata::default()),
        None,
    );
    c.adoptions.insert(
        id("luna.root.testnet"),
        Adoption {
            owner: id("owner.testnet"),
            created: false,
            registration_inflight: false,
            storage_reserve: 0,
        },
    );
    for name in ["mochi", "luna"] {
        ctx("relayer.testnet");
        assert!(!c.player_name_available(name.into()));
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                || c.create_named_player(key(1), name.into())
            ))
            .is_err()
        );
    }
}

#[test]
fn adoption_rejects_pending_and_completed_player_accounts() {
    let mut c = contract();
    c.player_ids.insert(id("owner.testnet"));
    let pending = reserve(&mut c, key(1), "alice");
    ctx("owner.testnet");
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.adopt("alice".into()))).is_err()
    );
    callback(PromiseResult::Successful(vec![]));
    c.on_player(
        key(1).to_string(),
        pending.account_id,
        U64(pending.operation_id),
    );
    ctx("owner.testnet");
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.adopt("alice".into()))).is_err()
    );
    assert!(c.adoptions.get(&id("alice.root.testnet")).is_none());
}

#[test]
fn unknown_and_stale_create_callbacks_never_release_another_name_reservation() {
    let mut c = contract();
    let first = reserve(&mut c, key(1), "alice");
    ctx("root.testnet");
    assert!(
        c.on_player(
            key(1).to_string(),
            first.account_id.clone(),
            U64(first.operation_id)
        )
        .is_none()
    );
    assert!(!c.player_name_available("alice".into()));
    callback(PromiseResult::Successful(b"unrecognized".to_vec()));
    assert!(
        c.on_player(
            key(1).to_string(),
            first.account_id.clone(),
            U64(first.operation_id)
        )
        .is_none()
    );
    callback(PromiseResult::Failed);
    assert!(
        c.on_player(
            key(1).to_string(),
            first.account_id.clone(),
            U64(first.operation_id)
        )
        .is_none()
    );
    assert!(c.player_name_available("alice".into()));
    let second = reserve(&mut c, key(1), "alice");
    assert_ne!(first.operation_id, second.operation_id);
    callback(PromiseResult::Successful(vec![]));
    assert!(
        c.on_player(
            key(1).to_string(),
            first.account_id.clone(),
            U64(first.operation_id)
        )
        .is_none()
    );
    assert_eq!(
        c.pending_players
            .get(&key(1).to_string())
            .unwrap()
            .operation_id,
        second.operation_id
    );
    assert_eq!(
        c.pending_player_names.get(&second.account_id),
        Some(&key(1).to_string())
    );
    assert_eq!(
        c.on_player(
            key(1).to_string(),
            second.account_id.clone(),
            U64(second.operation_id)
        ),
        Some(second.account_id.clone())
    );
    callback(PromiseResult::Failed);
    assert!(
        c.on_player(
            key(1).to_string(),
            second.account_id.clone(),
            U64(second.operation_id)
        )
        .is_none()
    );
    assert_eq!(c.get_player(key(1)), Some(second.account_id));
    assert_eq!(c.reserved_storage, 0);
}

#[test]
fn failed_name_can_be_reserved_by_another_key_without_stale_callback_interference() {
    let mut c = contract();
    let first = reserve(&mut c, key(1), "alice");
    callback(PromiseResult::Failed);
    c.on_player(
        key(1).to_string(),
        first.account_id.clone(),
        U64(first.operation_id),
    );
    let second = reserve(&mut c, key(2), "alice");
    callback(PromiseResult::Failed);
    c.on_player(
        key(1).to_string(),
        first.account_id,
        U64(first.operation_id),
    );
    assert_eq!(
        c.pending_player_names.get(&second.account_id),
        Some(&key(2).to_string())
    );
    assert_eq!(
        c.pending_players
            .get(&key(2).to_string())
            .unwrap()
            .operation_id,
        second.operation_id
    );
}

#[test]
fn a_chosen_username_authorizes_gameplay_by_current_predecessor() {
    let mut c = contract();
    let pending = reserve(&mut c, key(1), "alice");
    callback(PromiseResult::Successful(vec![]));
    c.on_player(
        key(1).to_string(),
        pending.account_id.clone(),
        U64(pending.operation_id),
    );
    c.tokens.internal_mint_with_refund(
        "mochi.root.testnet".into(),
        pending.account_id,
        Some(TokenMetadata::default()),
        None,
    );
    ctx("alice.root.testnet");
    std::mem::forget(c.act("mochi.root.testnet".into(), Action::Feed));
    assert!(c.is_busy("mochi.root.testnet".into()));
}

#[test]
fn maximum_named_player_pending_and_final_storage_fit_the_existing_reservation() {
    let root = id(&format!("{}.testnet", "r".repeat(31)));
    let mut initial = VMContextBuilder::new();
    initial
        .current_account_id(root.clone())
        .predecessor_account_id(root.clone())
        .account_balance(NearToken::from_near(100));
    testing_env!(initial.build());
    let mut c = Contract::new(
        id("relayer.testnet"),
        [1; 32].into(),
        id(&format!("items.{root}")),
        id(&format!("bakery.{root}")),
        id(&format!("market.{root}")),
        id("pool.testnet"),
    );
    let before = env::storage_usage();
    let mut request = initial.clone();
    request.predecessor_account_id(id("relayer.testnet"));
    testing_env!(request.build());
    std::mem::forget(c.create_named_player(key(1), "u".repeat(24)));
    let pending = c.pending_players.get(&key(1).to_string()).unwrap().clone();
    assert_eq!(pending.account_id.as_str().len(), 64);
    c.pending_players.flush();
    c.pending_player_names.flush();
    let pending_bytes = env::storage_usage().saturating_sub(before);
    assert!(pending_bytes <= PLAYER_STORAGE_RESERVE_BYTES);
    assert_eq!(
        c.reserved_storage,
        c.storage_reserve(PLAYER_STORAGE_RESERVE_BYTES)
    );
    let mut done = initial;
    done.storage_usage(env::storage_usage());
    testing_env!(
        done.build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![PromiseResult::Successful(vec![])]
    );
    assert_eq!(
        c.on_player(
            key(1).to_string(),
            pending.account_id.clone(),
            U64(pending.operation_id)
        ),
        Some(pending.account_id)
    );
    c.pending_players.flush();
    c.pending_player_names.flush();
    c.players.flush();
    let final_bytes = env::storage_usage().saturating_sub(before);
    assert!(final_bytes <= PLAYER_STORAGE_RESERVE_BYTES);
    assert_eq!(c.reserved_storage, 0);
    println!(
        "Maximum named-player storage: pending={pending_bytes} bytes; final={final_bytes}; reserved={PLAYER_STORAGE_RESERVE_BYTES}"
    );
}
