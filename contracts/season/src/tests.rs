#![allow(clippy::too_many_arguments, clippy::needless_range_loop)]
use super::*;
use near_sdk::{PromiseResult, test_utils::VMContextBuilder, testing_env};

const SEASON: &str = "season.familiar-game.testnet";
const ROOT: &str = "familiar-game.testnet";
/// An even day (first_light_v1) a little after midnight.
const DAY0: u64 = 20_400;

fn id(s: &str) -> AccountId {
    s.parse().unwrap()
}
fn ctx(who: &str, day: u64, deposit: u128) -> VMContextBuilder {
    let mut b = VMContextBuilder::new();
    b.current_account_id(id(SEASON))
        .predecessor_account_id(id(who))
        .signer_account_id(id(who))
        .block_timestamp(day * DAY_NS + 1_000)
        .attached_deposit(NearToken::from_yoctonear(deposit))
        .prepaid_gas(Gas::from_tgas(300))
        .account_balance(NearToken::from_near(100));
    b
}
fn at(who: &str, day: u64) {
    testing_env!(ctx(who, day, 0).build());
}
fn callback(day: u64, result: PromiseResult) {
    testing_env!(
        ctx(SEASON, day, 0).build(),
        near_sdk::test_vm_config(),
        near_sdk::RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}
fn owner_is(who: &str) -> PromiseResult {
    PromiseResult::Successful(
        serde_json::to_vec(&json!({"token_id": "mochi", "owner_id": who, "metadata": null}))
            .unwrap(),
    )
}
fn strings(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| (*s).into()).collect()
}
fn setup() -> Season {
    near_sdk::mock::with_mocked_blockchain(|b| {
        b.take_storage();
    });
    at(SEASON, DAY0);
    Season::new(id(ROOT))
}
fn register(c: &mut Season, who: &str, day: u64) {
    testing_env!(ctx(who, day, min_storage_deposit().as_yoctonear()).build());
    c.storage_deposit();
}
/// lens + chart on the v1 lantern route (Season 1 golden fixture).
fn v1_lantern() -> Vec<String> {
    strings(&[
        "wait",
        "wait",
        "lure:left",
        "take:chart",
        "move:left",
        "take:lens",
        "move:center",
        "return",
    ])
}
fn claim(c: &mut Season, who: &str, day: u64, tool: &str, commands: Vec<String>) -> Mint {
    at(who, day);
    c.claim_daily(
        storycraft::RULES_VERSION.into(),
        COURTS[court_of(day)].into(),
        tool.into(),
        COURT_AREA.into(),
        commands,
    )
}
fn wish(
    c: &mut Season,
    who: &str,
    day: u64,
    pet: &str,
    good: &str,
    limit: u64,
    qty: u8,
    owner: &str,
) -> WishResult {
    at(who, day);
    let _ = c.set_wish(pet.into(), good.into(), limit, qty);
    callback(day, owner_is(owner));
    c.on_wish_owner(id(who), pet.into(), good.into(), limit, qty)
}

impl Season {
    fn credit(&mut self, who: &str, goods: [u64; 2]) {
        let a = self.accounts.get_mut(&id(who)).unwrap();
        for g in 0..2 {
            a.goods[g] += goods[g];
            self.goods_minted[g] += goods[g];
        }
    }
    fn assert_conserved(&self, accounts: &[&str]) {
        let mut shells = self.till;
        let mut goods = [self.shelf[0].stock, self.shelf[1].stock];
        for who in accounts {
            if let Some(a) = self.accounts.get(&id(who)) {
                shells += a.shells;
                goods[0] += a.goods[0];
                goods[1] += a.goods[1];
            }
        }
        let mut queued = 0;
        for q in &self.queues {
            for pet in q {
                let w = self.wishes.get(pet).expect("queued wish exists");
                assert!(w.purse <= PURSE_MAX);
                shells += w.purse;
                queued += 1;
            }
        }
        assert!(queued <= 2 * WISH_QUEUE_CAP);
        assert_eq!(shells, self.shells_minted, "Shells conserved");
        assert_eq!(goods, self.goods_minted, "goods conserved");
    }
    fn shells(&self, who: &str) -> u64 {
        self.accounts.get(&id(who)).map_or(0, |a| a.shells)
    }
    fn goods(&self, who: &str) -> [u64; 2] {
        self.accounts.get(&id(who)).map_or([0, 0], |a| a.goods)
    }
}

// ---------- daily court ----------

#[test]
fn daily_court_alternates_and_mints_docked_cargo_once() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    let m = claim(&mut c, "alice.testnet", DAY0, "lantern", v1_lantern());
    assert_eq!(m.content_version, "first_light_v1");
    assert_eq!(m.goods, [1, 1]);
    // At start prices: 8 + 4 = 12 against the best haul 8 + 2×4 = 16.
    assert_eq!(m.value_fp, 12 * S as u64);
    assert_eq!(m.best_fp, 16 * S as u64);
    assert_eq!(m.score_bp, 7_500);
    assert_eq!(c.goods("alice.testnet"), [1, 1]);
    // Next day is first_light_v2.
    at("alice.testnet", DAY0 + 1);
    assert_eq!(c.get_today(None).content_version, "first_light_v2");
    c.assert_conserved(&["alice.testnet"]);
}

#[test]
fn v2_days_replay_the_spatial_court() {
    let mut c = setup();
    let day = DAY0 + 1;
    register(&mut c, "alice.testnet", day);
    // Dry rope lens route on the spatial court.
    let commands = strings(&[
        "step:north",
        "step:north",
        "step:west",
        "wait",
        "wait",
        "step:east",
        "reel:lens",
        "step:west",
        "step:east",
        "step:west",
        "step:south",
        "step:south",
        "step:east",
        "return",
    ]);
    let run = court::replay("rope", &[], &commands, "beacon").unwrap();
    assert_eq!(
        (run.outcome.as_str(), run.cargo.clone()),
        ("returned", strings(&["lens"]))
    );
    let m = claim(&mut c, "alice.testnet", day, "rope", commands);
    assert_eq!(m.goods, [1, 0]);
    // The best v2 haul is lens + moth: 8 / (8 + 4) at opening prices.
    assert_eq!(m.score_bp, 6_666);
    // The rope rescue route docks lens and moth: glass + reed, the full score.
    register(&mut c, "bob.testnet", day);
    let rescue = strings(&[
        "step:north",
        "step:north",
        "step:west",
        "wait",
        "wait",
        "step:east",
        "reel:lens",
        "step:east",
        "step:west",
        "step:east",
        "take:moth",
        "step:west",
        "step:east",
        "step:south",
        "step:west",
        "step:south",
        "return",
    ]);
    let m = claim(&mut c, "bob.testnet", day, "rope", rescue);
    assert_eq!(m.goods, [1, 1]);
    assert_eq!(m.score_bp, 10_000);
}

#[test]
fn minted_cargo_never_exceeds_the_best_haul() {
    // Every random legal outing that docks mints a haul dominated by BEST_HAUL.
    for (court_index, day) in [(0usize, DAY0), (1, DAY0 + 1)] {
        for (t, tool) in TOOLS.iter().enumerate() {
            let mut seed: u32 = 7 + t as u32;
            for _ in 0..300 {
                let mut commands: Vec<String> = vec![];
                loop {
                    let legal = if court_index == 0 {
                        let r = historical_returns::replay(tool, &[], &commands, "beacon").unwrap();
                        if r.outcome != "active" {
                            break;
                        }
                        historical_returns::legal_actions(&r)
                    } else {
                        let r = court::replay(tool, &[], &commands, "beacon").unwrap();
                        if r.outcome != "active" {
                            break;
                        }
                        court::legal_actions(&r)
                    };
                    if legal.is_empty() {
                        break;
                    }
                    seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                    commands.push(legal[(seed >> 8) as usize % legal.len()].clone());
                }
                let cargo = if court_index == 0 {
                    let r = historical_returns::replay(tool, &[], &commands, "beacon").unwrap();
                    (r.outcome == "returned").then_some(r.cargo)
                } else {
                    let r = court::replay(tool, &[], &commands, "beacon").unwrap();
                    (r.outcome == "returned").then_some(r.cargo)
                };
                if let Some(cargo) = cargo {
                    let g = cargo_goods(&cargo);
                    assert!(
                        BEST_HAUL[court_index][t]
                            .iter()
                            .any(|b| g[0] <= b.0 && g[1] <= b.1),
                        "{tool} {commands:?}"
                    );
                    if g[0] + g[1] > 0 {
                        let mut c = setup();
                        register(&mut c, "p.testnet", day);
                        let m = claim(&mut c, "p.testnet", day, tool, commands);
                        assert!(m.score_bp <= 10_000 && m.value_fp <= m.best_fp);
                    }
                }
            }
        }
    }
}

#[test]
fn best_haul_constants_match_the_generated_fixture_and_the_authoritative_replay() {
    let fixture: Value = serde_json::from_str(include_str!("../fixtures/best-haul.json")).unwrap();
    for (ci, court_entry) in fixture.as_array().unwrap().iter().enumerate() {
        assert_eq!(court_entry["content_version"], COURTS[ci]);
        for (ti, tool) in court_entry["tools"].as_array().unwrap().iter().enumerate() {
            assert_eq!(tool["tool"], TOOLS[ti]);
            let hauls: Vec<(u64, u64)> = tool["hauls"]
                .as_array()
                .unwrap()
                .iter()
                .map(|h| (h[0].as_u64().unwrap(), h[1].as_u64().unwrap()))
                .collect();
            assert_eq!(hauls, BEST_HAUL[ci][ti]);
        }
    }
    // Exhaustive search over the contract's own replay, independent of the TypeScript solver.
    for ci in 0..2 {
        for (ti, tool) in TOOLS.iter().enumerate() {
            let mut found = std::collections::HashSet::new();
            let mut seen = std::collections::HashSet::new();
            let mut queue: Vec<Vec<String>> = vec![vec![]];
            let mut i = 0;
            while i < queue.len() {
                let commands = queue[i].clone();
                i += 1;
                let (legal, key) = if ci == 0 {
                    let r = historical_returns::replay(tool, &[], &commands, "beacon").unwrap();
                    if r.outcome == "returned" {
                        let g = cargo_goods(&r.cargo);
                        found.insert((g[0], g[1]));
                    }
                    if r.outcome != "active" {
                        continue;
                    }
                    let mut opened = r.opened.clone();
                    opened.sort();
                    let mut cargo = r.cargo.clone();
                    cargo.sort();
                    let key = format!(
                        "{}/{}/{}/{}/{}/{:?}/{:?}/{:?}",
                        r.lane,
                        r.turn % 3,
                        r.resolve,
                        r.uses,
                        r.orientation,
                        r.locked,
                        opened,
                        cargo
                    );
                    (historical_returns::legal_actions(&r), key)
                } else {
                    let r = court::replay(tool, &[], &commands, "beacon").unwrap();
                    if r.outcome == "returned" {
                        let g = cargo_goods(&r.cargo);
                        found.insert((g[0], g[1]));
                    }
                    if r.outcome != "active" {
                        continue;
                    }
                    let mut opened = r.opened.clone();
                    opened.sort();
                    let mut cargo = r.cargo.clone();
                    cargo.sort();
                    let key = format!(
                        "{:?}/{}/{}/{}/{}/{:?}/{}/{:?}/{:?}",
                        r.position,
                        r.turn % 3,
                        r.resolve,
                        r.uses,
                        r.orientation,
                        r.locked,
                        r.bridge,
                        opened,
                        cargo
                    );
                    (court::legal_actions(&r), key)
                };
                if !seen.insert(key) {
                    continue;
                }
                for a in legal {
                    let mut next = commands.clone();
                    next.push(a);
                    queue.push(next);
                }
            }
            let mut pareto: Vec<(u64, u64)> = found
                .iter()
                .copied()
                .filter(|&(g, r)| {
                    !found
                        .iter()
                        .any(|&(g2, r2)| g2 >= g && r2 >= r && (g2, r2) != (g, r))
                })
                .collect();
            pareto.sort_by(|a, b| b.cmp(a));
            assert_eq!(pareto, BEST_HAUL[ci][ti], "court {ci} tool {tool}");
        }
    }
}

#[test]
fn break_second_mint_same_day() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    claim(&mut c, "alice.testnet", DAY0, "lantern", v1_lantern());
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        claim(&mut c, "alice.testnet", DAY0, "lantern", v1_lantern())
    }));
    assert!(r.is_err());
    // Two days later (v1 again) the same route mints again.
    claim(&mut c, "alice.testnet", DAY0 + 2, "lantern", v1_lantern());
    assert_eq!(c.goods("alice.testnet"), [2, 2]);
}

#[test]
#[should_panic(expected = "ERR_ALREADY_MINTED")]
fn break_second_mint_same_day_refused_by_contract() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    claim(&mut c, "alice.testnet", DAY0, "lantern", v1_lantern());
    claim(
        &mut c,
        "alice.testnet",
        DAY0,
        "rope",
        strings(&["move:left", "wait", "move:center", "reel:lens", "return"]),
    );
}

#[test]
#[should_panic(expected = "ERR_REPLAY")]
fn break_doctored_court_illegal_command() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    // Takes the lens before any wave opened its lane.
    claim(
        &mut c,
        "alice.testnet",
        DAY0,
        "rope",
        strings(&["move:left", "take:lens", "move:center", "return"]),
    );
}

#[test]
#[should_panic(expected = "ERR_RETURN_REQUIRED")]
fn break_doctored_court_without_return() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    claim(
        &mut c,
        "alice.testnet",
        DAY0,
        "rope",
        strings(&["move:left", "wait", "move:center", "reel:lens"]),
    );
}

#[test]
#[should_panic(expected = "ERR_WRONG_COURT")]
fn break_doctored_court_wrong_day_version() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    at("alice.testnet", DAY0);
    c.claim_daily(
        storycraft::RULES_VERSION.into(),
        "first_light_v2".into(),
        "lantern".into(),
        "beacon".into(),
        v1_lantern(),
    );
}

#[test]
#[should_panic(expected = "ERR_REPLAY_CONTEXT")]
fn break_doctored_court_other_area() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    at("alice.testnet", DAY0);
    c.claim_daily(
        storycraft::RULES_VERSION.into(),
        "first_light_v1".into(),
        "rope".into(),
        "wind".into(),
        vec![],
    );
}

#[test]
#[should_panic(expected = "ERR_COMMAND_BOUND")]
fn break_doctored_court_overlong_commands() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    at("alice.testnet", DAY0);
    c.claim_daily(
        storycraft::RULES_VERSION.into(),
        "first_light_v1".into(),
        "rope".into(),
        "beacon".into(),
        vec!["wait".into(); 16],
    );
}

#[test]
#[should_panic(expected = "ERR_RULES_VERSION")]
fn break_doctored_court_rules_version() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    at("alice.testnet", DAY0);
    c.claim_daily(
        "tidebound_h2".into(),
        "first_light_v1".into(),
        "rope".into(),
        "beacon".into(),
        v1_lantern(),
    );
}

#[test]
#[should_panic(expected = "ERR_NO_GOODS")]
fn break_return_with_nothing_mappable_keeps_the_day() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    claim(&mut c, "alice.testnet", DAY0, "rope", strings(&["return"]));
}

#[test]
#[should_panic(expected = "ERR_NOT_REGISTERED")]
fn break_unregistered_mint() {
    let mut c = setup();
    claim(&mut c, "alice.testnet", DAY0, "lantern", v1_lantern());
}

#[test]
fn day_boundary_is_exact() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    claim(&mut c, "alice.testnet", DAY0, "lantern", v1_lantern());
    // Last nanosecond of the same day is still refused.
    let mut b = ctx("alice.testnet", DAY0, 0);
    b.block_timestamp((DAY0 + 1) * DAY_NS - 1);
    testing_env!(b.build());
    assert_eq!(c.get_today(None).day, DAY0);
    // First nanosecond of the next day is the other court.
    let mut b = ctx("alice.testnet", DAY0, 0);
    b.block_timestamp((DAY0 + 1) * DAY_NS);
    testing_env!(b.build());
    assert_eq!(c.get_today(None).day, DAY0 + 1);
    assert_eq!(c.get_today(None).content_version, "first_light_v2");
}

// ---------- Bram ----------

#[test]
fn buy_and_sell_move_shells_through_the_till_and_conserve() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    c.credit("alice.testnet", [10, 10]);
    at("alice.testnet", DAY0);
    let t = c.sell("reed".into(), 10, 0);
    // Stock 41..50: post-unit prices floor(0.8 × price).
    assert_eq!(t.unit_prices.len(), 10);
    assert_eq!(t.unit_prices[0], 3);
    assert_eq!(t.total, t.unit_prices.iter().sum::<u64>());
    assert_eq!(c.shells("alice.testnet"), t.total);
    assert_eq!(c.till, TILL_START - t.total);
    let b = c.buy("glass".into(), 1, 100);
    assert_eq!(b.unit_prices[0], 8);
    c.assert_conserved(&["alice.testnet"]);
}

#[test]
fn round_trips_never_profit() {
    for (g, good) in GOODS.iter().enumerate() {
        for n in 1..=20u32 {
            let mut c = setup();
            register(&mut c, "alice.testnet", DAY0);
            register(&mut c, "bob.testnet", DAY0);
            // Move 250 Shells from the till to Bob so he can buy up to 20 units.
            c.till -= 250;
            c.accounts.get_mut(&id("bob.testnet")).unwrap().shells += 250;
            at("bob.testnet", DAY0 + 1);
            let bought = c.buy((*good).into(), n, 1_000).total;
            // Sold back by another account in the same day.
            c.accounts.get_mut(&id("bob.testnet")).unwrap().goods[g] -= u64::from(n);
            c.accounts.get_mut(&id("alice.testnet")).unwrap().goods[g] += u64::from(n);
            at("alice.testnet", DAY0 + 1);
            let back = c.sell((*good).into(), n, 0).total;
            assert!(back <= bought, "{good} n={n}: bought {bought} sold {back}");
            c.assert_conserved(&["alice.testnet", "bob.testnet"]);
        }
    }
}

#[test]
fn till_refills_lazily_to_the_cap_and_never_underflows() {
    let mut c = setup();
    let mut names = vec![];
    for i in 0..30 {
        let who = format!("s{i}.testnet");
        register(&mut c, &who, DAY0);
        c.credit(&who, [20, 0]);
        at(&who, DAY0);
        let till = c.till;
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.sell("glass".into(), 20, 0)
        }));
        names.push(who);
        if r.is_err() {
            assert_eq!(c.till, till, "refused sale leaves the till");
            break;
        }
    }
    let till = c.till;
    assert!(till < 60);
    at("s0.testnet", DAY0 + 1);
    assert_eq!(c.get_shelf().till, till + 60);
    at("s0.testnet", DAY0 + 1000);
    assert_eq!(c.get_shelf().till, TILL_CAP);
    c.buy("reed".into(), 1, 100);
    assert_eq!(c.till, TILL_CAP + 4);
    let refs: Vec<&str> = names.iter().map(String::as_str).collect();
    c.assert_conserved(&refs);
}

#[test]
#[should_panic(expected = "ERR_TILL_EMPTY")]
fn break_sell_into_an_empty_till() {
    let mut c = setup();
    for i in 0..30 {
        let who = format!("s{i}.testnet");
        register(&mut c, &who, DAY0);
        c.credit(&who, [20, 0]);
        at(&who, DAY0);
        c.sell("glass".into(), 20, 0);
    }
}

#[test]
fn empty_till_reopens_when_someone_buys() {
    let mut c = setup();
    let mut sellers = vec![];
    let mut i = 0;
    loop {
        let who = format!("s{i}.testnet");
        register(&mut c, &who, DAY0);
        c.credit(&who, [20, 0]);
        at(&who, DAY0);
        sellers.push(who.clone());
        if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            c.sell("glass".into(), 20, 0)
        }))
        .is_err()
        {
            break;
        }
        i += 1;
    }
    let till = c.till;
    let last = sellers.last().unwrap().clone();
    let pay = c.get_shelf().goods[GLASS].sell_price;
    assert!(till < pay * 20);
    // A buyer refills the till by the purchase price.
    let buyer = sellers[0].clone();
    at(&buyer, DAY0);
    let bought = c.buy("reed".into(), 5, 100).total;
    assert_eq!(c.till, till + bought);
    at(&last, DAY0);
    c.sell("glass".into(), 1, 0);
    let names: Vec<&str> = sellers.iter().map(String::as_str).collect();
    c.assert_conserved(&names);
}

#[test]
#[should_panic(expected = "ERR_MAX_PRICE")]
fn break_buy_above_max_price() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    c.credit("alice.testnet", [0, 20]);
    at("alice.testnet", DAY0);
    c.sell("reed".into(), 20, 0);
    // Units get dearer as stock falls: the second glass unit costs 9.
    c.buy("glass".into(), 2, 8);
}

#[test]
#[should_panic(expected = "ERR_MIN_PRICE")]
fn break_sell_below_min_price() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    c.credit("alice.testnet", [20, 0]);
    at("alice.testnet", DAY0);
    c.sell("glass".into(), 20, 6);
}

#[test]
#[should_panic(expected = "ERR_DAILY_LIMIT")]
fn break_over_daily_limit() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    c.credit("alice.testnet", [21, 0]);
    at("alice.testnet", DAY0);
    c.sell("glass".into(), 15, 0);
    c.sell("glass".into(), 6, 0);
}

#[test]
fn daily_limit_resets_at_the_day_boundary_and_counts_both_sides() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    c.credit("alice.testnet", [40, 0]);
    at("alice.testnet", DAY0);
    c.sell("glass".into(), 15, 0);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.buy(
            "glass".into(),
            6,
            100
        )))
        .is_err()
    );
    at("alice.testnet", DAY0 + 1);
    c.sell("glass".into(), 20, 0);
}

#[test]
#[should_panic(expected = "ERR_TRADE_QTY")]
fn break_over_trade_quantity() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    at("alice.testnet", DAY0);
    c.buy("glass".into(), 21, 1_000);
}

#[test]
#[should_panic(expected = "ERR_SHELLS")]
fn break_buy_without_shells() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    at("alice.testnet", DAY0);
    c.buy("glass".into(), 1, 1_000);
}

#[test]
#[should_panic(expected = "ERR_GOODS")]
fn break_sell_goods_not_held() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    at("alice.testnet", DAY0);
    c.sell("glass".into(), 1, 0);
}

#[test]
#[should_panic(expected = "ERR_GOOD")]
fn break_unknown_good() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    at("alice.testnet", DAY0);
    c.sell("pearl".into(), 1, 0);
}

#[test]
fn heat_halves_lazily_each_day() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    c.credit("alice.testnet", [20, 0]);
    at("alice.testnet", DAY0);
    c.sell("glass".into(), 20, 0);
    at("alice.testnet", DAY0 + 1);
    c.buy("glass".into(), 8, 1_000);
    assert_eq!(c.shelf[GLASS].heat_fp, 8 * S as u64);
    at("alice.testnet", DAY0 + 2);
    assert_eq!(c.get_shelf().goods[GLASS].heat_fp, 4 * S as u64);
    at("alice.testnet", DAY0 + 4);
    assert_eq!(c.get_shelf().goods[GLASS].heat_fp, S as u64);
    at("alice.testnet", DAY0 + 500);
    assert_eq!(c.get_shelf().goods[GLASS].heat_fp, 0);
}

// ---------- Mochi's wish ----------

fn funded(c: &mut Season, who: &str, day: u64) {
    testing_env!(ctx(who, day, NearToken::from_near(1).as_yoctonear()).build());
    c.storage_deposit();
    c.credit(who, [0, 20]);
    at(who, day);
    c.sell("reed".into(), 20, 0);
}

#[test]
fn wish_fills_at_once_when_the_price_is_there() {
    let mut c = setup();
    funded(&mut c, "alice.testnet", DAY0);
    let before = c.shells("alice.testnet");
    let r = wish(
        &mut c,
        "alice.testnet",
        DAY0,
        "mochi",
        "reed",
        12,
        2,
        "alice.testnet",
    );
    assert_eq!(r.status, "filled");
    let card = c.get_postcard("mochi".into()).unwrap();
    assert_eq!(card.reason, "FILLED_ON_SET");
    assert!(card.unit_prices.iter().all(|p| *p <= 12));
    assert_eq!(card.paid + card.refunded, 24);
    assert_eq!(c.shells("alice.testnet"), before - card.paid);
    assert_eq!(c.goods("alice.testnet")[REED], 2);
    assert!(c.get_wish("mochi".into()).is_none());
    c.assert_conserved(&["alice.testnet"]);
}

#[test]
fn wish_waits_then_a_sale_that_reaches_the_limit_fills_it() {
    let mut c = setup();
    funded(&mut c, "alice.testnet", DAY0);
    register(&mut c, "bob.testnet", DAY0);
    c.credit("bob.testnet", [20, 0]);
    // Glass is 8 now; wish at 7.
    let r = wish(
        &mut c,
        "alice.testnet",
        DAY0,
        "mochi",
        "glass",
        7,
        1,
        "alice.testnet",
    );
    assert_eq!(r.status, "waiting");
    assert_eq!(c.get_wish("mochi".into()).unwrap().purse, 7);
    c.assert_conserved(&["alice.testnet", "bob.testnet"]);
    at("bob.testnet", DAY0);
    let mut fills = vec![];
    for _ in 0..20 {
        let t = c.sell("glass".into(), 1, 0);
        if !t.fills.is_empty() {
            fills = t.fills;
            break;
        }
    }
    assert_eq!(fills.len(), 1);
    let card = c.get_postcard("mochi".into()).unwrap();
    assert_eq!(card.reason, "FILLED_BY_TRADE");
    assert!(card.unit_prices[0] <= 7);
    let trig = card.trigger.unwrap();
    assert_eq!(trig.account, id("bob.testnet"));
    assert_eq!(trig.side, "sell");
    c.assert_conserved(&["alice.testnet", "bob.testnet"]);
}

#[test]
fn at_most_three_wishes_fill_per_trade_first_come() {
    let mut c = setup();
    funded(&mut c, "alice.testnet", DAY0);
    funded(&mut c, "carol.testnet", DAY0);
    register(&mut c, "bob.testnet", DAY0);
    c.credit("bob.testnet", [20, 0]);
    for (i, who) in [
        "alice.testnet",
        "carol.testnet",
        "alice.testnet",
        "carol.testnet",
        "alice.testnet",
    ]
    .iter()
    .enumerate()
    {
        let r = wish(&mut c, who, DAY0, &format!("pet{i}"), "glass", 7, 1, who);
        assert_eq!(r.status, "waiting");
    }
    let accounts = ["alice.testnet", "carol.testnet", "bob.testnet"];
    at("bob.testnet", DAY0);
    // One large sale brings glass to 7 and keeps it there across three fills.
    let first = c.sell("glass".into(), 20, 0).fills;
    assert_eq!(first.len(), FILLS_PER_TX);
    assert_eq!(
        first.iter().map(|p| p.pet.as_str()).collect::<Vec<_>>(),
        ["pet0", "pet1", "pet2"]
    );
    assert_eq!(c.get_wish_queue("glass".into()), strings(&["pet3", "pet4"]));
    for p in &first {
        assert!(p.unit_prices.iter().all(|u| *u <= p.limit));
    }
    c.assert_conserved(&accounts);
}

#[test]
fn a_wish_never_fills_above_its_limit() {
    // Random trading never fills any wish above its limit and keeps every purse in 0..=24.
    let mut c = setup();
    let names = ["a.testnet", "b.testnet", "c.testnet", "d.testnet"];
    for who in names {
        funded(&mut c, who, DAY0);
        c.credit(who, [20, 20]);
    }
    let mut seed: u32 = 99;
    let mut rand = |n: u32| {
        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        (seed >> 8) % n
    };
    for step in 0..400u64 {
        let day = DAY0 + step / 40;
        let who = names[rand(4) as usize];
        let good = GOODS[rand(2) as usize];
        match rand(4) {
            0 => {
                let limit = 1 + u64::from(rand(12));
                let qty = 1 + rand(2) as u8;
                let pet = format!("pet{}", rand(6));
                let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    wish(&mut c, who, day, &pet, good, limit, qty, who)
                }));
                if let Ok(WishResult {
                    postcard: Some(p), ..
                }) = r
                {
                    assert!(p.unit_prices.iter().all(|u| *u <= limit));
                }
            }
            1 => {
                at(who, day);
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    c.cancel_wish(format!("pet{}", rand(6)))
                }));
            }
            side => {
                at(who, day);
                let qty = 1 + rand(5);
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let t = if side == 2 {
                        c.buy(good.into(), qty, 1_000)
                    } else {
                        c.sell(good.into(), qty, 0)
                    };
                    assert!(t.fills.len() <= FILLS_PER_TX);
                    for p in t.fills {
                        assert!(p.unit_prices.iter().all(|u| *u <= p.limit));
                        assert!(p.paid <= p.qty as u64 * p.limit);
                    }
                }));
            }
        }
        c.assert_conserved(&names);
    }
}

#[test]
fn cancel_wish_returns_the_purse() {
    let mut c = setup();
    funded(&mut c, "alice.testnet", DAY0);
    let before = c.shells("alice.testnet");
    wish(
        &mut c,
        "alice.testnet",
        DAY0,
        "mochi",
        "glass",
        6,
        2,
        "alice.testnet",
    );
    assert_eq!(c.shells("alice.testnet"), before - 12);
    at("alice.testnet", DAY0);
    let card = c.cancel_wish("mochi".into());
    assert_eq!(card.refunded, 12);
    assert_eq!(card.reason, "CANCELLED_BY_OWNER");
    assert_eq!(c.shells("alice.testnet"), before);
    assert!(c.get_wish_queue("glass".into()).is_empty());
    c.assert_conserved(&["alice.testnet"]);
}

#[test]
fn replacing_a_wish_refunds_the_old_purse_once() {
    let mut c = setup();
    funded(&mut c, "alice.testnet", DAY0);
    funded(&mut c, "bob.testnet", DAY0);
    let (a, b) = (c.shells("alice.testnet"), c.shells("bob.testnet"));
    wish(
        &mut c,
        "alice.testnet",
        DAY0,
        "mochi",
        "glass",
        6,
        2,
        "alice.testnet",
    );
    // Same callback replayed (double set) and then a new owner after a transfer.
    wish(
        &mut c,
        "alice.testnet",
        DAY0,
        "mochi",
        "glass",
        5,
        2,
        "alice.testnet",
    );
    assert_eq!(c.shells("alice.testnet"), a - 10);
    wish(
        &mut c,
        "bob.testnet",
        DAY0,
        "mochi",
        "glass",
        4,
        1,
        "bob.testnet",
    );
    assert_eq!(c.shells("alice.testnet"), a);
    assert_eq!(c.shells("bob.testnet"), b - 4);
    assert_eq!(c.get_wish_queue("glass".into()), strings(&["mochi"]));
    c.assert_conserved(&["alice.testnet", "bob.testnet"]);
}

#[test]
fn break_non_owner_wish_is_refused_without_holding_anything() {
    let mut c = setup();
    funded(&mut c, "mallory.testnet", DAY0);
    let before = c.shells("mallory.testnet");
    let r = wish(
        &mut c,
        "mallory.testnet",
        DAY0,
        "mochi",
        "glass",
        6,
        2,
        "alice.testnet",
    );
    assert_eq!(r.status, "refused");
    assert_eq!(r.reason, "ERR_NOT_OWNER");
    assert_eq!(c.shells("mallory.testnet"), before);
    assert!(c.get_wish("mochi".into()).is_none());
    assert!(c.get_postcard("mochi".into()).is_none());
    c.assert_conserved(&["mallory.testnet"]);
}

#[test]
fn break_failed_or_garbled_owner_lookup_holds_nothing() {
    let mut c = setup();
    funded(&mut c, "alice.testnet", DAY0);
    let before = c.shells("alice.testnet");
    for result in [
        PromiseResult::Failed,
        PromiseResult::Successful(b"null".to_vec()),
        PromiseResult::Successful(b"{not json".to_vec()),
        PromiseResult::Successful(b"{\"owner_id\":\"NOT A VALID ID!!\"}".to_vec()),
    ] {
        at("alice.testnet", DAY0);
        let _ = c.set_wish("mochi".into(), "glass".into(), 6, 2);
        callback(DAY0, result);
        let r = c.on_wish_owner(id("alice.testnet"), "mochi".into(), "glass".into(), 6, 2);
        assert_eq!(r.status, "refused");
        assert_eq!(c.shells("alice.testnet"), before);
        assert!(c.get_wish("mochi".into()).is_none());
    }
    c.assert_conserved(&["alice.testnet"]);
}

#[test]
fn break_spent_shells_between_call_and_callback_are_rechecked() {
    let mut c = setup();
    funded(&mut c, "alice.testnet", DAY0);
    at("alice.testnet", DAY0);
    let _ = c.set_wish("mochi".into(), "glass".into(), 12, 2);
    // Alice spends almost everything before the callback lands.
    let keep = 10;
    let spend = c.shells("alice.testnet") - keep;
    c.accounts.get_mut(&id("alice.testnet")).unwrap().shells -= spend;
    c.till += spend;
    callback(DAY0, owner_is("alice.testnet"));
    let r = c.on_wish_owner(id("alice.testnet"), "mochi".into(), "glass".into(), 12, 2);
    assert_eq!(r.reason, "ERR_SHELLS");
    assert_eq!(c.shells("alice.testnet"), keep);
    c.assert_conserved(&["alice.testnet"]);
}

#[test]
#[should_panic(expected = "ERR_PURSE_LIMIT")]
fn break_purse_above_24() {
    let mut c = setup();
    funded(&mut c, "alice.testnet", DAY0);
    at("alice.testnet", DAY0);
    let _ = c.set_wish("mochi".into(), "glass".into(), 13, 2);
}

#[test]
#[should_panic(expected = "ERR_WISH_QTY")]
fn break_wish_quantity_above_two() {
    let mut c = setup();
    funded(&mut c, "alice.testnet", DAY0);
    at("alice.testnet", DAY0);
    let _ = c.set_wish("mochi".into(), "glass".into(), 2, 3);
}

#[test]
#[should_panic(expected = "ERR_NOT_WISH_OWNER")]
fn break_cancel_someone_elses_wish() {
    let mut c = setup();
    funded(&mut c, "alice.testnet", DAY0);
    register(&mut c, "mallory.testnet", DAY0);
    wish(
        &mut c,
        "alice.testnet",
        DAY0,
        "mochi",
        "glass",
        6,
        2,
        "alice.testnet",
    );
    at("mallory.testnet", DAY0);
    c.cancel_wish("mochi".into());
}

#[test]
fn wish_queue_is_capped() {
    let mut c = setup();
    funded(&mut c, "alice.testnet", DAY0);
    c.accounts
        .get_mut(&id("alice.testnet"))
        .unwrap()
        .storage_deposit = NearToken::from_near(10);
    let mut last = None;
    for i in 0..=WISH_QUEUE_CAP {
        // limit 1 never fills at today's prices; one Shell each.
        last = Some(wish(
            &mut c,
            "alice.testnet",
            DAY0,
            &format!("p{i}"),
            "glass",
            1,
            1,
            "alice.testnet",
        ));
    }
    assert_eq!(last.unwrap().reason, "ERR_WISH_QUEUE_FULL");
    assert_eq!(c.get_wish_queue("glass".into()).len(), WISH_QUEUE_CAP);
    c.assert_conserved(&["alice.testnet"]);
}

// ---------- storage ----------

#[test]
fn storage_charges_cover_actual_bytes() {
    // NEAR charges key + value + 40 bytes per record; measure the largest shapes with Borsh.
    let long = id(&format!("{}.testnet", "a".repeat(56)));
    let record = |key: usize, value: usize| (key + value + 40) as u64;
    let key = |s: &str| 1 + 4 + s.len();
    let mint = Mint {
        day: u64::MAX,
        content_version: "first_light_v1".into(),
        tool: "lantern".into(),
        goods: [u64::MAX; 2],
        value_fp: u64::MAX,
        best_fp: u64::MAX,
        score_bp: u32::MAX,
    };
    let account = Account {
        shells: u64::MAX,
        goods: [u64::MAX; 2],
        trade_day: u64::MAX,
        traded: [u32::MAX; 2],
        last_mint: Some(mint),
        storage_deposit: NearToken::from_near(1),
        storage_bytes: u64::MAX,
    };
    let account_bytes = record(
        key(long.as_str()),
        near_sdk::borsh::to_vec(&account).unwrap().len(),
    );
    assert!(
        account_bytes <= ACCOUNT_BYTES,
        "account uses {account_bytes}"
    );
    let pet = "p".repeat(PET_ID_MAX);
    let wish = Wish {
        pet: pet.clone(),
        owner: long.clone(),
        good: "glass".into(),
        limit: u64::MAX,
        qty: 2,
        purse: u64::MAX,
        seq: u64::MAX,
        day: u64::MAX,
    };
    let card = Postcard {
        pet: pet.clone(),
        owner: long.clone(),
        good: "glass".into(),
        qty: 2,
        limit: u64::MAX,
        outcome: "cancelled".into(),
        reason: "CANCELLED_BY_OWNER".into(),
        unit_prices: vec![u64::MAX; 2],
        paid: u64::MAX,
        refunded: u64::MAX,
        trigger: Some(Trigger {
            trade: u64::MAX,
            account: long.clone(),
            side: "sell".into(),
            good: "glass".into(),
        }),
        day: u64::MAX,
    };
    let pet_bytes = record(key(&pet), near_sdk::borsh::to_vec(&wish).unwrap().len())
        + record(key(&pet), near_sdk::borsh::to_vec(&card).unwrap().len())
        + (4 + pet.len()) as u64; // queue slot inside contract state
    assert!(pet_bytes <= PET_BYTES, "pet uses {pet_bytes}");
}

#[test]
#[should_panic(expected = "ERR_STORAGE_DEPOSIT")]
fn break_registration_below_minimum() {
    let mut c = setup();
    testing_env!(
        ctx(
            "alice.testnet",
            DAY0,
            min_storage_deposit().as_yoctonear() - 1
        )
        .build()
    );
    c.storage_deposit();
}

#[test]
fn storage_withdraw_returns_only_the_unspent_part_and_restores_on_failure() {
    let mut c = setup();
    testing_env!(
        ctx(
            "alice.testnet",
            DAY0,
            min_storage_deposit().as_yoctonear() * 3
        )
        .build()
    );
    c.storage_deposit();
    let bal = c.storage_balance_of(id("alice.testnet")).unwrap();
    assert_eq!(
        bal.available.0,
        bytes_cost(PET_BYTES) + 2 * min_storage_deposit().as_yoctonear()
    );
    testing_env!(ctx("alice.testnet", DAY0, 1).build());
    let _ = c.storage_withdraw();
    assert_eq!(
        c.storage_balance_of(id("alice.testnet"))
            .unwrap()
            .available
            .0,
        0
    );
    callback(DAY0, PromiseResult::Failed);
    assert!(!c.on_storage_withdraw(id("alice.testnet"), bal.available));
    assert_eq!(
        c.storage_balance_of(id("alice.testnet")).unwrap().available,
        bal.available
    );
}

#[test]
#[should_panic(expected = "ERR_STORAGE")]
fn break_wish_without_storage_for_a_new_pet_record() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    c.credit("alice.testnet", [0, 20]);
    at("alice.testnet", DAY0);
    c.sell("reed".into(), 20, 0);
    wish(
        &mut c,
        "alice.testnet",
        DAY0,
        "pet-a",
        "glass",
        1,
        1,
        "alice.testnet",
    );
    let r = wish(
        &mut c,
        "alice.testnet",
        DAY0,
        "pet-b",
        "glass",
        1,
        1,
        "alice.testnet",
    );
    env::panic_str(&r.reason);
}

// ---------- views and events ----------

#[test]
fn views_report_the_shelf_today_and_events() {
    let mut c = setup();
    register(&mut c, "alice.testnet", DAY0);
    claim(&mut c, "alice.testnet", DAY0, "lantern", v1_lantern());
    let logs = near_sdk::test_utils::get_logs();
    assert!(logs.iter().any(|l| l.starts_with("EVENT_JSON:")
        && l.contains("\"event\":\"mint\"")
        && l.contains("\"standard\":\"familiar_season\"")));
    let shelf = c.get_shelf();
    assert_eq!(shelf.commission, 12);
    assert_eq!(shelf.goods[GLASS].buy_price, 8);
    assert_eq!(shelf.goods[REED].sell_price, 3);
    let today = c.get_today(Some(id("alice.testnet")));
    assert_eq!(today.minted_today.unwrap().goods, [1, 1]);
    assert_eq!(today.best_fp, 16 * S as u64);
    assert_eq!(today.mapping.len(), 5);
}

#[test]
#[should_panic(expected = "ERR_TESTNET_ONLY")]
fn break_mainnet_init() {
    let mut b = ctx("season.near", DAY0, 0);
    b.current_account_id(id("season.near"));
    testing_env!(b.build());
    Season::new(id(ROOT));
}

// ---------- pricing parity ----------

#[test]
fn pricing_parity_fixture_is_current() {
    let mut seed: u64 = 0x5EA5_0002;
    let mut next = |n: u64| {
        seed = seed
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        (seed >> 33) % n
    };
    let mut cases = vec![];
    for i in 0..1000 {
        let g = (i % 2) as usize;
        let stock = match next(4) {
            0 => next(5),
            1 => next(60),
            2 => next(400),
            _ => next(1_000_000),
        };
        let heat = match next(3) {
            0 => 0,
            1 => next(80) * S as u64,
            _ => next(5_000 * S as u64),
        };
        let days = next(70);
        let heat_now = pricing::decay_heat(u128::from(heat), days);
        let p = price_fp(BASE[g], TARGET[g], u128::from(stock), heat_now);
        let ratio = TARGET[g] * S / u128::from(stock.max(1));
        cases.push(json!({
            "good": GOODS[g], "stock": stock, "heat_fp": heat, "days": days,
            "heat_now_fp": heat_now.to_string(), "pow": pricing::pow07(ratio).to_string(),
            "price_fp": p.to_string(), "buyback_fp": buyback_fp(p).to_string(),
            "buy": buy_shells(p).to_string(), "sell": sell_shells(p).to_string(),
            "commission": commission(p * BASE[0] / BASE[g], BASE[0]).to_string(),
        }));
    }
    let generated = serde_json::to_string(&cases).unwrap() + "\n";
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/fixtures/pricing-cases.json");
    if std::env::var("UPDATE_SEASON_FIXTURES").is_ok() {
        std::fs::write(path, &generated).unwrap();
    }
    let committed = std::fs::read_to_string(path).expect("run with UPDATE_SEASON_FIXTURES=1");
    assert_eq!(
        committed, generated,
        "pricing fixture drifted; regenerate and rerun bun test"
    );
}
