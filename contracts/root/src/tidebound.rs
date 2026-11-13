use crate::{Contract, ContractExt};
use familiar_common::{call, emit, historical_returns::replay, storycraft::*};
use near_sdk::{
    AccountId, Gas, PromiseError, PromiseOrValue, env, near, require, serde_json::json,
};

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AcceptedClaim {
    pub operation_id: String,
    pub id: String,
    pub input_hash: String,
    pub lens: bool,
    pub moth: bool,
    pub rules_version: String,
    pub content_version: String,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CraftOperation {
    pub evidence: MintEvidence,
    pub pet_id: String,
    pub state: String,
    pub attempt: u32,
    pub uncertain_prior: bool,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PolishOperation {
    pub evidence: PolishEvidence,
    pub state: String,
    pub attempt: u32,
    pub uncertain_prior: bool,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Placement {
    pub item_id: String,
    pub socket: String,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Journey {
    pub revision: u32,
    pub banked: Vec<String>,
    pub lit: bool,
    pub signaled: bool,
    pub lens_claim: Option<String>,
    pub moth_claim: Option<String>,
    pub credit: String,
    pub workshop_salvage: u8,
    pub bram_budget: u8,
    pub shells: u8,
    pub burned_shells: u8,
    pub commission_fulfilled: bool,
    pub craft: Option<CraftOperation>,
    pub polish: Option<PolishOperation>,
    pub placement: Option<Placement>,
    pub claims: Vec<AcceptedClaim>,
}
impl Journey {
    fn empty() -> Self {
        Self {
            credit: "unclaimed".into(),
            ..Self::default()
        }
    }
}

#[near]
impl Contract {
    pub fn tidebound_journey(&self, account_id: AccountId) -> Journey {
        self.journeys
            .get(&account_id)
            .cloned()
            .unwrap_or_else(Journey::empty)
    }
    pub fn tidebound_checkpoint_hash(&self, account_id: AccountId) -> String {
        let journey = self.tidebound_journey(account_id.clone());
        hash(&(
            "familiar.checkpoint.v1",
            "testnet",
            env::current_account_id(),
            account_id,
            journey.revision,
            &journey.banked,
            journey.lit,
            journey.signaled,
        ))
    }
    pub fn tidebound_schema_version(&self) -> String {
        RULES_VERSION.into()
    }
    pub fn tidebound_protocol(&self) -> near_sdk::serde_json::Value {
        self.tidebound_network();
        json!({"network":"testnet","rules_version":RULES_VERSION,"content_version":CONTENT_VERSION,"supported_content_versions":SUPPORTED_CONTENT_VERSIONS,"items":self.config.items,"registry":env::current_account_id()})
    }
    #[allow(clippy::too_many_arguments)]
    pub fn tidebound_claim(
        &mut self,
        token_id: String,
        operation_id: String,
        expected_revision: u32,
        initial_checkpoint_hash: String,
        rules_version: String,
        content_version: String,
        tool: String,
        commands: Vec<String>,
        area: String,
    ) -> Journey {
        self.tidebound_holder(&token_id);
        require!(
            operation_id.len() <= 64
                && !operation_id.is_empty()
                && initial_checkpoint_hash.len() == 64,
            "ERR_CLAIM_INPUT"
        );
        require!(
            rules_version == RULES_VERSION && supported_content_version(&content_version),
            "ERR_RULES_VERSION"
        );
        require!(
            commands.len()
                <= if content_version == CONTENT_VERSION {
                    15
                } else {
                    24
                }
                && commands.iter().all(|s| s.len() <= 24),
            "ERR_COMMAND_BOUND"
        );
        require!(
            matches!(tool.as_str(), "rope" | "lantern")
                && matches!(area.as_str(), "beacon" | "wind"),
            "ERR_REPLAY_CONTEXT"
        );
        let account = env::predecessor_account_id();
        let mut journey = self.tidebound_journey(account.clone());
        let input_hash = hash(&(
            "familiar.claim.v1",
            "testnet",
            env::current_account_id(),
            &account,
            &token_id,
            &operation_id,
            expected_revision,
            &initial_checkpoint_hash,
            &rules_version,
            &content_version,
            &tool,
            &commands,
            &area,
        ));
        // A response-loss retry resolves before the old checkpoint is rejected.
        if let Some(accepted) = journey
            .claims
            .iter()
            .find(|c| c.operation_id == operation_id)
        {
            require!(accepted.input_hash == input_hash, "ERR_OPERATION_CONFLICT");
            return journey;
        }
        require!(!self.busy.contains(&token_id), "ERR_PET_BUSY");
        require!(
            journey.revision == expected_revision
                && self.tidebound_checkpoint_hash(account.clone()) == initial_checkpoint_hash,
            "ERR_CHECKPOINT_CONFLICT"
        );
        require!(area != "wind" || journey.lit, "ERR_BEACON_REQUIRED");
        let (cargo, outcome) = if content_version == CONTENT_VERSION {
            let run = replay(&tool, &journey.banked, &commands, &area)
                .unwrap_or_else(|_| env::panic_str("ERR_REPLAY"));
            (run.cargo, run.outcome)
        } else {
            let run = familiar_common::court::replay(&tool, &journey.banked, &commands, &area)
                .unwrap_or_else(|_| env::panic_str("ERR_REPLAY"));
            (run.cargo, run.outcome)
        };
        require!(outcome == "returned", "ERR_RETURN_REQUIRED");
        let lens = area == "beacon" && cargo.iter().any(|i| i == "lens");
        let moth = area == "beacon" && cargo.iter().any(|i| i == "moth");
        require!(!cargo.is_empty(), "ERR_NO_DISCOVERY");
        require!(journey.claims.len() < 5, "ERR_CLAIM_BOUND");
        if !self.journeys.contains_key(&account) {
            let reserve = self.storage_reserve(JOURNEY_STORAGE_BYTES);
            require!(self.spendable() >= reserve, "ERR_STAMPS");
            // Retain worst-case future growth headroom, including pending callback records.
            self.reserved_storage += reserve;
        }
        let id = hash(&("familiar.accepted-claim.v1", &input_hash));
        if lens && journey.lens_claim.is_none() {
            journey.lens_claim = Some(id.clone());
            journey.credit = "available".into();
            journey.workshop_salvage = 1;
            journey.bram_budget = 12;
        }
        if moth && journey.moth_claim.is_none() {
            journey.moth_claim = Some(id.clone());
        }
        for item in cargo {
            if !journey.banked.contains(&item) {
                journey.banked.push(item);
            }
        }
        journey.claims.push(AcceptedClaim {
            operation_id,
            id,
            input_hash,
            lens,
            moth,
            rules_version,
            content_version,
        });
        journey.revision += 1;
        self.journeys.insert(account.clone(), journey.clone());
        emit(
            "expedition_accepted",
            json!({"player":account,"claim":journey.claims.last()}),
        );
        journey
    }
    pub fn tidebound_restore(&mut self, restoration: String) -> Journey {
        self.tidebound_network();
        let account = env::predecessor_account_id();
        let mut journey = self.tidebound_journey(account.clone());
        match restoration.as_str() {
            "beacon" => {
                require!(journey.lens_claim.is_some(), "ERR_LENS_REQUIRED");
                if journey.lit {
                    return journey;
                }
                journey.lit = true;
            }
            "signal" => {
                require!(
                    journey.lit && journey.banked.iter().any(|i| i == "vane"),
                    "ERR_VANE_REQUIRED"
                );
                if journey.signaled {
                    return journey;
                }
                journey.signaled = true;
            }
            _ => env::panic_str("ERR_RESTORATION"),
        }
        journey.revision += 1;
        self.journeys.insert(account, journey.clone());
        journey
    }
    pub fn tidebound_commission(&mut self) -> Journey {
        self.tidebound_network();
        let account = env::predecessor_account_id();
        let mut journey = self.tidebound_journey(account.clone());
        if journey.commission_fulfilled {
            return journey;
        }
        require!(
            journey.workshop_salvage == 1 && journey.bram_budget == 12 && journey.shells == 0,
            "ERR_COMMISSION_UNAVAILABLE"
        );
        journey.workshop_salvage = 0;
        journey.bram_budget = 0;
        journey.shells = 12;
        journey.commission_fulfilled = true;
        journey.revision += 1;
        self.journeys.insert(account.clone(), journey.clone());
        emit(
            "bram_commission",
            json!({"player":account,"shells":12,"resource":"workshop_salvage"}),
        );
        journey
    }
    pub fn tidebound_craft(
        &mut self,
        token_id: String,
        motif: String,
        origin_claim_id: String,
    ) -> PromiseOrValue<Journey> {
        self.tidebound_holder(&token_id);
        let account = env::predecessor_account_id();
        let mut journey = self.tidebound_journey(account.clone());
        if let Some(op) = &journey.craft {
            require!(
                op.evidence.motif == motif && op.evidence.origin_claim_id == origin_claim_id,
                "ERR_CRAFT_CONFLICT"
            );
            if op.state != "failed-safe" {
                return PromiseOrValue::Value(journey);
            }
        }
        self.tidebound_owner(&token_id);
        let origin = match motif.as_str() {
            "crest" => &journey.lens_claim,
            "moth" => &journey.moth_claim,
            _ => env::panic_str("ERR_MOTIF"),
        };
        require!(
            origin.as_ref() == Some(&origin_claim_id),
            "ERR_ORIGIN_CLAIM"
        );
        require!(
            journey.lens_claim.is_some() && journey.credit == "available",
            "ERR_CRAFT_CREDIT"
        );
        require!(env::prepaid_gas() >= Gas::from_tgas(100), "ERR_GAS");
        require!(self.spendable() >= CRAFT_STORAGE_FUND, "ERR_STAMPS");
        let origin_content = journey
            .claims
            .iter()
            .find(|claim| {
                claim.id == origin_claim_id
                    && claim.rules_version == RULES_VERSION
                    && supported_content_version(&claim.content_version)
                    && if motif == "crest" {
                        claim.lens
                    } else {
                        claim.moth
                    }
            })
            .map(|claim| claim.content_version.as_str())
            .unwrap_or_else(|| env::panic_str("ERR_ORIGIN_CLAIM"));
        let evidence = mint_evidence_for_content(
            &self.config.items,
            &env::current_account_id(),
            &account,
            &origin_claim_id,
            &motif,
            origin_content,
        )
        .unwrap_or_else(|| env::panic_str("ERR_ORIGIN_CLAIM"));
        let attempt = journey
            .craft
            .as_ref()
            .map_or(1, |op| op.attempt.saturating_add(1));
        let op = CraftOperation {
            evidence: evidence.clone(),
            pet_id: token_id.clone(),
            state: "reserved".into(),
            attempt,
            uncertain_prior: false,
        };
        journey.craft = Some(op);
        journey.credit = "reserved".into();
        journey.revision += 1;
        self.busy.insert(token_id);
        self.journeys.insert(account.clone(), journey);
        call(
            self.config.items.clone(),
            "craft_mint",
            json!({"operation":evidence}),
            CRAFT_STORAGE_FUND,
            65,
        )
        .then(call(
            env::current_account_id(),
            "on_tidebound_mint",
            json!({"account_id":account,"operation_id":evidence.id,"attempt":attempt}),
            0,
            20,
        ))
        .into()
    }
    #[private]
    pub fn on_tidebound_mint(
        &mut self,
        account_id: AccountId,
        operation_id: String,
        attempt: u32,
    ) -> Journey {
        self.settle_craft(account_id, operation_id, attempt, false)
    }
    pub fn tidebound_polish(
        &mut self,
        item_id: String,
        expected_appearance: u32,
    ) -> PromiseOrValue<Journey> {
        self.tidebound_network();
        require!(
            item_id.len() == 72 && item_id.starts_with("lantern:") && expected_appearance == 0,
            "ERR_ITEM"
        );
        require!(env::prepaid_gas() >= Gas::from_tgas(80), "ERR_GAS");
        let account = env::predecessor_account_id();
        let mut journey = self.tidebound_journey(account.clone());
        if let Some(op) = &journey.polish
            && op.state != "failed-safe"
        {
            require!(
                op.evidence.token_id == item_id
                    && op.evidence.expected_appearance == expected_appearance,
                "ERR_FINISH_CONFLICT"
            );
            return PromiseOrValue::Value(journey);
        }
        let evidence = polish_evidence(
            &self.config.items,
            &env::current_account_id(),
            &account,
            &item_id,
            expected_appearance,
            journey.revision,
        );
        require!(journey.shells == 12, "ERR_SHELLS");
        let attempt = journey
            .polish
            .as_ref()
            .map_or(1, |op| op.attempt.saturating_add(1));
        journey.shells = 0;
        journey.polish = Some(PolishOperation {
            evidence: evidence.clone(),
            state: "reserved".into(),
            attempt,
            uncertain_prior: false,
        });
        journey.revision += 1;
        self.journeys.insert(account.clone(), journey);
        call(
            self.config.items.clone(),
            "craft_polish",
            json!({"operation":evidence}),
            0,
            40,
        )
        .then(call(
            env::current_account_id(),
            "on_tidebound_polish",
            json!({"account_id":account,"operation_id":evidence.id,"attempt":attempt}),
            0,
            20,
        ))
        .into()
    }
    #[private]
    pub fn on_tidebound_polish(
        &mut self,
        account_id: AccountId,
        operation_id: String,
        attempt: u32,
    ) -> Journey {
        self.settle_polish(account_id, operation_id, attempt, false)
    }
    pub fn tidebound_cancel_polish(&mut self) -> PromiseOrValue<Journey> {
        self.tidebound_network();
        require!(env::prepaid_gas() >= Gas::from_tgas(85), "ERR_GAS");
        let account = env::predecessor_account_id();
        let mut journey = self.tidebound_journey(account.clone());
        let Some(op) = journey.polish.as_mut().filter(|op| pending(&op.state)) else {
            return PromiseOrValue::Value(journey);
        };
        self.refresh_day();
        require!(self.tidebound_retries_today < 25, "ERR_RETRY_BUDGET");
        require!(self.spendable() >= POLISH_CANCEL_STORAGE_FUND, "ERR_STAMPS");
        op.attempt = op.attempt.checked_add(1).expect("ERR_ATTEMPT_LIMIT");
        op.uncertain_prior = true;
        op.state = "recovery-required".into();
        let evidence = op.evidence.clone();
        let attempt = op.attempt;
        journey.revision += 1;
        self.tidebound_retries_today += 1;
        self.journeys.insert(account.clone(), journey);
        call(
            self.config.items.clone(),
            "craft_cancel_polish",
            json!({"operation":evidence}),
            POLISH_CANCEL_STORAGE_FUND,
            40,
        )
        .then(call(
            env::current_account_id(),
            "on_tidebound_cancel_polish",
            json!({"account_id":account,"operation_id":evidence.id,"attempt":attempt}),
            0,
            20,
        ))
        .into()
    }
    #[private]
    pub fn on_tidebound_cancel_polish(
        &mut self,
        account_id: AccountId,
        operation_id: String,
        attempt: u32,
    ) -> Journey {
        let mut journey = self.tidebound_journey(account_id.clone());
        let Some(mut op) = journey.polish.clone().filter(|op| {
            op.evidence.id == operation_id && op.attempt == attempt && pending(&op.state)
        }) else {
            return journey;
        };
        let Some(fence) = callback_bytes()
            .and_then(|bytes| near_sdk::serde_json::from_slice::<PolishCancellation>(&bytes).ok())
        else {
            return journey;
        };
        if fence.operation != op.evidence {
            return journey;
        }
        match fence.status.as_str() {
            "confirmed" => {
                op.state = "confirmed".into();
                journey.burned_shells = 12;
            }
            "cancelled" => {
                op.state = "failed-safe".into();
                journey.shells = 12;
            }
            _ => return journey,
        }
        journey.polish = Some(op);
        journey.revision = journey.revision.saturating_add(1);
        self.journeys.insert(account_id, journey.clone());
        journey
    }
    pub fn tidebound_reconcile(&mut self) -> PromiseOrValue<Journey> {
        self.tidebound_network();
        require!(env::prepaid_gas() >= Gas::from_tgas(55), "ERR_GAS");
        let account = env::predecessor_account_id();
        let journey = self.tidebound_journey(account.clone());
        if let Some(op) = journey.craft.as_ref().filter(|op| pending(&op.state)) {
            return call(
                self.config.items.clone(),
                "craft_mint_operation",
                json!({"operation_id":op.evidence.id}),
                0,
                15,
            )
            .then(call(
                env::current_account_id(),
                "on_tidebound_mint_evidence",
                json!({"account_id":account,"operation_id":op.evidence.id,"attempt":op.attempt}),
                0,
                25,
            ))
            .into();
        }
        if let Some(op) = journey.polish.as_ref().filter(|op| pending(&op.state)) {
            return call(
                self.config.items.clone(),
                "craft_polish_operation",
                json!({"operation_id":op.evidence.id}),
                0,
                15,
            )
            .then(call(
                env::current_account_id(),
                "on_tidebound_polish_evidence",
                json!({"account_id":account,"operation_id":op.evidence.id,"attempt":op.attempt}),
                0,
                25,
            ))
            .into();
        }
        PromiseOrValue::Value(journey)
    }
    pub fn tidebound_retry_operation(&mut self) -> PromiseOrValue<Journey> {
        self.tidebound_network();
        require!(env::prepaid_gas() >= Gas::from_tgas(100), "ERR_GAS");
        let account = env::predecessor_account_id();
        let mut journey = self.tidebound_journey(account.clone());
        let craft_pending = journey.craft.as_ref().is_some_and(|op| pending(&op.state));
        let polish_pending = journey.polish.as_ref().is_some_and(|op| pending(&op.state));
        if !craft_pending && !polish_pending {
            return PromiseOrValue::Value(journey);
        }
        self.refresh_day();
        require!(self.tidebound_retries_today < 25, "ERR_RETRY_BUDGET");
        if craft_pending {
            require!(self.spendable() >= CRAFT_STORAGE_FUND, "ERR_STAMPS");
            let op = journey.craft.as_mut().expect("ERR_CRAFT_OPERATION");
            op.attempt = op.attempt.checked_add(1).expect("ERR_ATTEMPT_LIMIT");
            op.uncertain_prior = true;
            let evidence = op.evidence.clone();
            let attempt = op.attempt;
            journey.revision += 1;
            self.tidebound_retries_today += 1;
            self.journeys.insert(account.clone(), journey);
            return call(
                self.config.items.clone(),
                "craft_mint",
                json!({"operation":evidence}),
                CRAFT_STORAGE_FUND,
                65,
            )
            .then(call(
                env::current_account_id(),
                "on_tidebound_mint",
                json!({"account_id":account,"operation_id":evidence.id,"attempt":attempt}),
                0,
                20,
            ))
            .into();
        }
        let op = journey.polish.as_mut().expect("ERR_FINISH_OPERATION");
        op.attempt = op.attempt.checked_add(1).expect("ERR_ATTEMPT_LIMIT");
        op.uncertain_prior = true;
        let evidence = op.evidence.clone();
        let attempt = op.attempt;
        journey.revision += 1;
        self.tidebound_retries_today += 1;
        self.journeys.insert(account.clone(), journey);
        call(
            self.config.items.clone(),
            "craft_polish",
            json!({"operation":evidence}),
            0,
            40,
        )
        .then(call(
            env::current_account_id(),
            "on_tidebound_polish",
            json!({"account_id":account,"operation_id":evidence.id,"attempt":attempt}),
            0,
            20,
        ))
        .into()
    }
    #[private]
    pub fn on_tidebound_mint_evidence(
        &mut self,
        account_id: AccountId,
        operation_id: String,
        attempt: u32,
    ) -> Journey {
        self.settle_craft(account_id, operation_id, attempt, true)
    }
    #[private]
    pub fn on_tidebound_polish_evidence(
        &mut self,
        account_id: AccountId,
        operation_id: String,
        attempt: u32,
    ) -> Journey {
        self.settle_polish(account_id, operation_id, attempt, true)
    }
    pub fn tidebound_place(
        &mut self,
        item_id: String,
        socket: String,
        expected_revision: u32,
    ) -> PromiseOrValue<Journey> {
        self.tidebound_network();
        require!(
            item_id.len() == 72
                && item_id.starts_with("lantern:")
                && matches!(socket.as_str(), "porch" | "dock"),
            "ERR_PLACEMENT"
        );
        require!(env::prepaid_gas() >= Gas::from_tgas(55), "ERR_GAS");
        let account = env::predecessor_account_id();
        let journey = self.tidebound_journey(account.clone());
        require!(self.player_ids.contains(&account), "ERR_PLAYER");
        require!(
            journey.revision == expected_revision,
            "ERR_CHECKPOINT_CONFLICT"
        );
        call(self.config.items.clone(), "mt_balance_of", json!({"account_id":account,"token_id":item_id}), 0, 15)
            .then(call(env::current_account_id(), "on_tidebound_place", json!({"account_id":account,"item_id":item_id,"socket":socket,"expected_revision":expected_revision}), 0, 25)).into()
    }
    #[private]
    pub fn on_tidebound_place(
        &mut self,
        account_id: AccountId,
        item_id: String,
        socket: String,
        expected_revision: u32,
    ) -> Journey {
        let mut journey = self.tidebound_journey(account_id.clone());
        if journey.revision != expected_revision || !matches!(socket.as_str(), "porch" | "dock") {
            return journey;
        }
        let holder = callback_bytes()
            .and_then(|bytes| {
                near_sdk::serde_json::from_slice::<near_sdk::json_types::U128>(&bytes).ok()
            })
            .is_some_and(|amount| amount.0 == 1);
        if holder {
            if !self.journeys.contains_key(&account_id) {
                let reserve = self.storage_reserve(JOURNEY_STORAGE_BYTES);
                if self.spendable() < reserve {
                    return journey;
                }
                self.reserved_storage = self.reserved_storage.saturating_add(reserve);
            }
            journey.placement = Some(Placement { item_id, socket });
            journey.revision = journey.revision.saturating_add(1);
            self.journeys.insert(account_id, journey.clone());
        }
        journey
    }
}
impl Contract {
    fn tidebound_network(&self) {
        require!(
            env::current_account_id().as_str().ends_with(".testnet")
                && self.config.items.as_str().ends_with(".testnet"),
            "ERR_TESTNET_ONLY"
        );
    }
    fn tidebound_holder(&self, token_id: &String) {
        self.tidebound_network();
        require!(
            self.tokens.owner_by_id.get(token_id) == Some(env::predecessor_account_id()),
            "ERR_NOT_OWNER"
        );
    }
    fn tidebound_owner(&self, token_id: &String) {
        self.tidebound_holder(token_id);
        require!(!self.busy.contains(token_id), "ERR_PET_BUSY");
    }
    fn settle_craft(
        &mut self,
        account: AccountId,
        operation_id: String,
        attempt: u32,
        queried: bool,
    ) -> Journey {
        let mut journey = self.tidebound_journey(account.clone());
        let Some(mut op) = journey.craft.clone().filter(|op| {
            op.evidence.id == operation_id && op.attempt == attempt && pending(&op.state)
        }) else {
            return journey;
        };
        let result = if env::promise_results_count() == 1 {
            Some(env::promise_result_checked(0, 4096))
        } else {
            None
        };
        let evidence = result
            .as_ref()
            .and_then(|r| r.as_ref().ok())
            .and_then(|bytes| {
                if queried {
                    near_sdk::serde_json::from_slice::<Option<MintEvidence>>(bytes)
                        .ok()
                        .flatten()
                } else {
                    near_sdk::serde_json::from_slice::<MintEvidence>(bytes).ok()
                }
            });
        if evidence.as_ref() == Some(&op.evidence) {
            op.state = "confirmed".into();
            journey.credit = "consumed".into();
            self.busy.remove(&op.pet_id);
        } else if !queried
            && !op.uncertain_prior
            && matches!(result, Some(Err(PromiseError::Failed)))
        {
            op.state = "failed-safe".into();
            journey.credit = "available".into();
            self.busy.remove(&op.pet_id);
        } else if op.state != "recovery-required" {
            // Unknown evidence never releases the credit or the companion lock.
            op.state = "recovery-required".into();
        } else {
            return journey;
        }
        journey.craft = Some(op);
        journey.revision = journey.revision.saturating_add(1);
        self.journeys.insert(account, journey.clone());
        journey
    }
    fn settle_polish(
        &mut self,
        account: AccountId,
        operation_id: String,
        attempt: u32,
        queried: bool,
    ) -> Journey {
        let mut journey = self.tidebound_journey(account.clone());
        let Some(mut op) = journey.polish.clone().filter(|op| {
            op.evidence.id == operation_id && op.attempt == attempt && pending(&op.state)
        }) else {
            return journey;
        };
        let result = if env::promise_results_count() == 1 {
            Some(env::promise_result_checked(0, 4096))
        } else {
            None
        };
        let evidence = result
            .as_ref()
            .and_then(|r| r.as_ref().ok())
            .and_then(|bytes| {
                if queried {
                    near_sdk::serde_json::from_slice::<Option<PolishEvidence>>(bytes)
                        .ok()
                        .flatten()
                } else {
                    near_sdk::serde_json::from_slice::<PolishEvidence>(bytes).ok()
                }
            });
        if evidence.as_ref() == Some(&op.evidence) {
            op.state = "confirmed".into();
            journey.burned_shells = 12;
        } else if !queried
            && !op.uncertain_prior
            && matches!(result, Some(Err(PromiseError::Failed)))
        {
            op.state = "failed-safe".into();
            journey.shells = 12;
        } else if op.state != "recovery-required" {
            // A failed retry cannot rule out an older successful finish.
            op.state = "recovery-required".into();
        } else {
            return journey;
        }
        journey.polish = Some(op);
        journey.revision = journey.revision.saturating_add(1);
        self.journeys.insert(account, journey.clone());
        journey
    }
}
fn pending(state: &str) -> bool {
    matches!(state, "reserved" | "recovery-required")
}
fn callback_bytes() -> Option<Vec<u8>> {
    if env::promise_results_count() != 1 {
        return None;
    }
    env::promise_result_checked(0, 4096).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_contract_standards::non_fungible_token::metadata::TokenMetadata;
    use near_sdk::{NearToken, PromiseResult, test_utils::VMContextBuilder, testing_env};
    fn id(s: &str) -> AccountId {
        s.parse().unwrap()
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
        let mut c = Contract::new(
            id("relayer.testnet"),
            [1; 32].into(),
            id("items.root.testnet"),
            id("bakery.root.testnet"),
            id("market.root.testnet"),
            id("pool.testnet"),
        );
        c.tokens.internal_mint_with_refund(
            "mochi.root.testnet".into(),
            id("alice.testnet"),
            Some(TokenMetadata::default()),
            None,
        );
        c.tokens.internal_mint_with_refund(
            "bramble.root.testnet".into(),
            id("bob.testnet"),
            Some(TokenMetadata::default()),
            None,
        );
        c.player_ids.insert(id("alice.testnet"));
        c.player_ids.insert(id("bob.testnet"));
        c
    }
    fn dry() -> Vec<String> {
        ["move:left", "wait", "move:center", "reel:lens", "return"]
            .map(String::from)
            .to_vec()
    }
    fn claim(c: &mut Contract, who: &str, pet: &str, op: &str, commands: Vec<String>) -> Journey {
        ctx(who);
        let current = c.tidebound_journey(id(who));
        c.tidebound_claim(
            pet.into(),
            op.into(),
            current.revision,
            c.tidebound_checkpoint_hash(id(who)),
            RULES_VERSION.into(),
            CONTENT_VERSION.into(),
            "rope".into(),
            commands,
            "beacon".into(),
        )
    }
    fn ready() -> Contract {
        let mut c = contract();
        claim(
            &mut c,
            "alice.testnet",
            "mochi.root.testnet",
            "first",
            dry(),
        );
        c
    }
    fn spatial_lens() -> Vec<String> {
        [
            "step:north",
            "step:north",
            "step:west",
            "wait",
            "wait",
            "step:east",
            "wait",
            "step:west",
            "step:east",
            "wait",
            "step:west",
            "step:east",
            "reel:lens",
            "step:west",
            "step:east",
            "step:west",
            "step:south",
            "step:east",
            "step:south",
            "return",
        ]
        .map(String::from)
        .to_vec()
    }
    fn claim_court(
        c: &mut Contract,
        who: &str,
        pet: &str,
        op: &str,
        commands: Vec<String>,
    ) -> Journey {
        ctx(who);
        let current = c.tidebound_journey(id(who));
        c.tidebound_claim(
            pet.into(),
            op.into(),
            current.revision,
            c.tidebound_checkpoint_hash(id(who)),
            RULES_VERSION.into(),
            COURT_CONTENT_VERSION.into(),
            "rope".into(),
            commands,
            "beacon".into(),
        )
    }
    fn spatial_moth() -> Vec<String> {
        [
            "step:north",
            "step:north",
            "step:north",
            "step:north",
            "step:east",
            "step:west",
            "step:east",
            "take:moth",
            "step:west",
            "step:east",
            "step:south",
            "step:south",
            "step:west",
            "return",
        ]
        .map(String::from)
        .to_vec()
    }
    #[test]
    fn spatial_claims_and_historical_origins_share_one_finite_personal_entitlement() {
        let mut c = contract();
        let old = claim(
            &mut c,
            "alice.testnet",
            "mochi.root.testnet",
            "old-lens",
            dry(),
        );
        let new = claim_court(
            &mut c,
            "bob.testnet",
            "bramble.root.testnet",
            "spatial-lens",
            spatial_lens(),
        );
        assert_eq!(new.claims[0].content_version, COURT_CONTENT_VERSION);
        assert_eq!(
            (new.credit.as_str(), new.workshop_salvage, new.bram_budget),
            ("available", 1, 12)
        );
        ctx("bob.testnet");
        std::mem::forget(c.tidebound_craft(
            "bramble.root.testnet".into(),
            "crest".into(),
            new.lens_claim.unwrap(),
        ));
        let crafted = c.tidebound_journey(id("bob.testnet")).craft.unwrap();
        assert_eq!(crafted.evidence.content_version, COURT_CONTENT_VERSION);
        let mixed = claim_court(
            &mut c,
            "alice.testnet",
            "mochi.root.testnet",
            "new-moth",
            spatial_moth(),
        );
        assert_eq!(mixed.lens_claim, old.lens_claim);
        assert_eq!(mixed.claims[0].content_version, CONTENT_VERSION);
        assert_eq!(mixed.claims[1].content_version, COURT_CONTENT_VERSION);
        assert_eq!(
            (
                mixed.credit.as_str(),
                mixed.workshop_salvage,
                mixed.bram_budget
            ),
            ("available", 1, 12)
        );
        ctx("alice.testnet");
        std::mem::forget(c.tidebound_craft(
            "mochi.root.testnet".into(),
            "moth".into(),
            mixed.moth_claim.clone().unwrap(),
        ));
        let actual = c
            .tidebound_journey(id("alice.testnet"))
            .craft
            .unwrap()
            .evidence;
        assert_eq!(actual.content_version, COURT_CONTENT_VERSION);
        assert_eq!(actual.origin_claim_id, mixed.moth_claim.unwrap());
        assert_eq!(
            actual.id,
            craft_id(&id("root.testnet"), &id("alice.testnet"))
        );
    }
    #[test]
    fn old_confirmed_craft_is_never_rewritten_or_reminted_by_current_content() {
        let mut c = ready();
        let old = c.tidebound_journey(id("alice.testnet"));
        ctx("alice.testnet");
        std::mem::forget(c.tidebound_craft(
            "mochi.root.testnet".into(),
            "crest".into(),
            old.lens_claim.clone().unwrap(),
        ));
        let op = c.tidebound_journey(id("alice.testnet")).craft.unwrap();
        callback(PromiseResult::Successful(
            near_sdk::serde_json::to_vec(&op.evidence).unwrap(),
        ));
        let confirmed =
            c.on_tidebound_mint(id("alice.testnet"), op.evidence.id.clone(), op.attempt);
        assert_eq!(op.evidence.content_version, CONTENT_VERSION);
        let updated = claim_court(
            &mut c,
            "alice.testnet",
            "mochi.root.testnet",
            "later-v2-moth",
            spatial_moth(),
        );
        assert!(updated.moth_claim.is_some());
        assert_eq!(
            updated.claims.last().unwrap().content_version,
            COURT_CONTENT_VERSION
        );
        assert_eq!(updated.credit, "consumed");
        assert_eq!(updated.craft, confirmed.craft);
        assert_eq!(updated.bram_budget, confirmed.bram_budget);
        assert_eq!(updated.workshop_salvage, confirmed.workshop_salvage);
        ctx("alice.testnet");
        match c.tidebound_craft(
            "mochi.root.testnet".into(),
            "crest".into(),
            old.lens_claim.unwrap(),
        ) {
            PromiseOrValue::Value(actual) => assert_eq!(actual, updated),
            _ => panic!("a confirmed item must not mint again"),
        }
        assert_eq!(
            c.tidebound_journey(id("alice.testnet"))
                .craft
                .unwrap()
                .evidence,
            op.evidence
        );
    }
    #[test]
    #[should_panic(expected = "ERR_ORIGIN_CLAIM")]
    fn an_origin_flag_without_its_actual_accepted_claim_cannot_choose_content_version() {
        let mut c = ready();
        let mut j = c.tidebound_journey(id("alice.testnet"));
        let origin = j.lens_claim.clone().unwrap();
        j.claims.clear();
        c.journeys.insert(id("alice.testnet"), j);
        ctx("alice.testnet");
        std::mem::forget(c.tidebound_craft("mochi.root.testnet".into(), "crest".into(), origin));
    }
    #[test]
    fn protocol_exposes_only_the_exact_fresh_testnet_registry() {
        let c = contract();
        assert_eq!(
            c.tidebound_protocol(),
            json!({"network":"testnet","rules_version":RULES_VERSION,"content_version":CONTENT_VERSION,"supported_content_versions":SUPPORTED_CONTENT_VERSIONS,"items":"items.root.testnet","registry":"root.testnet"})
        );
    }
    #[test]
    fn finite_claim_retry_and_later_rescue_preserve_the_personal_allocation() {
        let mut c = contract();
        ctx("alice.testnet");
        let hash = c.tidebound_checkpoint_hash(id("alice.testnet"));
        let first = claim(
            &mut c,
            "alice.testnet",
            "mochi.root.testnet",
            "first",
            dry(),
        );
        assert_eq!(
            (
                first.credit.as_str(),
                first.workshop_salvage,
                first.bram_budget,
                first.shells
            ),
            ("available", 1, 12, 0)
        );
        assert_eq!(first.claims.len(), 1);
        let retry = c.tidebound_claim(
            "mochi.root.testnet".into(),
            "first".into(),
            0,
            hash,
            RULES_VERSION.into(),
            CONTENT_VERSION.into(),
            "rope".into(),
            dry(),
            "beacon".into(),
        );
        assert_eq!(retry, first);
        let commission = c.tidebound_commission();
        assert_eq!(
            (
                commission.credit.as_str(),
                commission.workshop_salvage,
                commission.bram_budget,
                commission.shells
            ),
            ("available", 0, 0, 12)
        );
        assert_eq!(c.tidebound_commission(), commission);
        let rescue = claim(
            &mut c,
            "alice.testnet",
            "mochi.root.testnet",
            "rescue",
            [
                "wait",
                "move:right",
                "move:center",
                "move:right",
                "take:moth",
                "move:center",
                "return",
            ]
            .map(String::from)
            .to_vec(),
        );
        assert!(rescue.moth_claim.is_some());
        assert_eq!(
            (rescue.workshop_salvage, rescue.bram_budget, rescue.shells),
            (0, 0, 12)
        );
        assert_eq!(rescue.claims.len(), 2);
        let bob = claim(
            &mut c,
            "bob.testnet",
            "bramble.root.testnet",
            "first",
            dry(),
        );
        assert_eq!(
            (bob.workshop_salvage, bob.bram_budget, bob.shells),
            (1, 12, 0)
        );
    }
    #[test]
    #[should_panic(expected = "ERR_OPERATION_CONFLICT")]
    fn accepted_operation_id_cannot_change_bytes() {
        let mut c = contract();
        ctx("alice.testnet");
        let initial = c.tidebound_checkpoint_hash(id("alice.testnet"));
        claim(
            &mut c,
            "alice.testnet",
            "mochi.root.testnet",
            "first",
            dry(),
        );
        c.tidebound_claim(
            "mochi.root.testnet".into(),
            "first".into(),
            0,
            initial,
            RULES_VERSION.into(),
            CONTENT_VERSION.into(),
            "rope".into(),
            vec!["return".into()],
            "beacon".into(),
        );
    }
    #[test]
    #[should_panic(expected = "ERR_NOT_OWNER")]
    fn relay_signer_cannot_claim_for_current_pet_holder() {
        let mut c = contract();
        claim(
            &mut c,
            "relayer.testnet",
            "mochi.root.testnet",
            "first",
            dry(),
        );
    }
    #[test]
    #[should_panic(expected = "ERR_CHECKPOINT_CONFLICT")]
    fn stale_second_device_cannot_overwrite_progress() {
        let mut c = ready();
        ctx("alice.testnet");
        c.tidebound_claim(
            "mochi.root.testnet".into(),
            "second-device".into(),
            0,
            "a".repeat(64),
            RULES_VERSION.into(),
            CONTENT_VERSION.into(),
            "rope".into(),
            dry(),
            "beacon".into(),
        );
    }
    #[test]
    fn craft_converges_and_unknown_or_absent_receipt_never_unlocks_credit() {
        let mut c = ready();
        ctx("alice.testnet");
        let origin = c.tidebound_journey(id("alice.testnet")).lens_claim.unwrap();
        let scheduled =
            c.tidebound_craft("mochi.root.testnet".into(), "crest".into(), origin.clone());
        std::mem::forget(scheduled);
        let pending = c.tidebound_journey(id("alice.testnet"));
        let op = pending.craft.clone().unwrap();
        assert_eq!(pending.credit, "reserved");
        assert!(c.is_busy("mochi.root.testnet".into()));
        assert!(
            matches!(c.tidebound_craft("mochi.root.testnet".into(),"crest".into(),origin.clone()),PromiseOrValue::Value(j) if j==pending)
        );
        callback(PromiseResult::Successful(b"malformed".to_vec()));
        let uncertain = c.on_tidebound_mint(id("alice.testnet"), op.evidence.id.clone(), 1);
        assert_eq!(uncertain.credit, "reserved");
        assert_eq!(uncertain.craft.as_ref().unwrap().state, "recovery-required");
        callback(PromiseResult::Successful(b"null".to_vec()));
        assert_eq!(
            c.on_tidebound_mint_evidence(id("alice.testnet"), op.evidence.id.clone(), 1),
            uncertain
        );
        callback(PromiseResult::Failed);
        assert_eq!(
            c.on_tidebound_mint_evidence(id("alice.testnet"), op.evidence.id.clone(), 1),
            uncertain
        );
        callback(PromiseResult::Successful(
            near_sdk::serde_json::to_vec(&Some(&op.evidence)).unwrap(),
        ));
        let confirmed =
            c.on_tidebound_mint_evidence(id("alice.testnet"), op.evidence.id.clone(), 1);
        assert_eq!(confirmed.credit, "consumed");
        assert!(!c.is_busy("mochi.root.testnet".into()));
        ctx("alice.testnet");
        assert!(
            matches!(c.tidebound_craft("mochi.root.testnet".into(),"crest".into(),origin),PromiseOrValue::Value(j) if j==confirmed)
        );
        assert_eq!(confirmed.craft.unwrap().evidence, op.evidence);
    }
    #[test]
    fn definitive_failure_allows_same_canonical_retry_and_old_callback_cannot_settle_it() {
        let mut c = ready();
        ctx("alice.testnet");
        let origin = c.tidebound_journey(id("alice.testnet")).lens_claim.unwrap();
        std::mem::forget(c.tidebound_craft(
            "mochi.root.testnet".into(),
            "crest".into(),
            origin.clone(),
        ));
        let op = c.tidebound_journey(id("alice.testnet")).craft.unwrap();
        callback(PromiseResult::Failed);
        assert_eq!(
            c.on_tidebound_mint(id("alice.testnet"), op.evidence.id.clone(), 1)
                .credit,
            "available"
        );
        ctx("alice.testnet");
        std::mem::forget(c.tidebound_craft("mochi.root.testnet".into(), "crest".into(), origin));
        let pending = c.tidebound_journey(id("alice.testnet"));
        assert_eq!(pending.craft.as_ref().unwrap().attempt, 2);
        callback(PromiseResult::Failed);
        assert_eq!(
            c.on_tidebound_mint(id("alice.testnet"), op.evidence.id.clone(), 1),
            pending
        );
        callback(PromiseResult::Successful(
            near_sdk::serde_json::to_vec(&op.evidence).unwrap(),
        ));
        assert_eq!(
            c.on_tidebound_mint(id("alice.testnet"), op.evidence.id, 2)
                .credit,
            "consumed"
        );
    }
    #[test]
    fn polish_reserves_shells_and_refunds_only_a_definitive_mutation_failure() {
        let mut c = ready();
        ctx("alice.testnet");
        c.tidebound_commission();
        let token = format!("lantern:{}", "a".repeat(64));
        std::mem::forget(c.tidebound_polish(token.clone(), 0));
        let pending = c.tidebound_journey(id("alice.testnet"));
        let op = pending.polish.clone().unwrap();
        assert_eq!(pending.shells, 0);
        callback(PromiseResult::Successful(b"null".to_vec()));
        let uncertain =
            c.on_tidebound_polish_evidence(id("alice.testnet"), op.evidence.id.clone(), 1);
        assert_eq!(uncertain.shells, 0);
        assert_eq!(
            uncertain.polish.as_ref().unwrap().state,
            "recovery-required"
        );
        callback(PromiseResult::Failed);
        assert_eq!(
            c.on_tidebound_polish(id("alice.testnet"), op.evidence.id.clone(), 1)
                .shells,
            12
        );
        ctx("alice.testnet");
        std::mem::forget(c.tidebound_polish(token, 0));
        let next = c.tidebound_journey(id("alice.testnet")).polish.unwrap();
        callback(PromiseResult::Failed);
        assert_eq!(
            c.on_tidebound_polish(id("alice.testnet"), op.evidence.id.clone(), 1)
                .shells,
            0
        );
        callback(PromiseResult::Successful(
            near_sdk::serde_json::to_vec(&next.evidence).unwrap(),
        ));
        let done = c.on_tidebound_polish(id("alice.testnet"), next.evidence.id.clone(), 2);
        assert_eq!((done.shells, done.burned_shells), (0, 12));
        assert_eq!(
            c.on_tidebound_polish(id("alice.testnet"), next.evidence.id, 2),
            done
        );
    }
    #[test]
    fn restoration_is_independent_from_the_movable_item_and_placement_is_revision_checked() {
        let mut c = ready();
        ctx("alice.testnet");
        let lit = c.tidebound_restore("beacon".into());
        assert!(lit.lit);
        assert!(lit.craft.is_none());
        let token = format!("lantern:{}", "a".repeat(64));
        std::mem::forget(c.tidebound_place(token.clone(), "porch".into(), lit.revision));
        callback(PromiseResult::Successful(b"\"1\"".to_vec()));
        let placed = c.on_tidebound_place(
            id("alice.testnet"),
            token.clone(),
            "porch".into(),
            lit.revision,
        );
        assert_eq!(placed.placement.as_ref().unwrap().socket, "porch");
        assert_eq!(
            c.on_tidebound_place(id("alice.testnet"), token, "dock".into(), lit.revision),
            placed
        );
    }
    #[test]
    fn maximum_personal_record_fits_the_reserved_storage_floor() {
        let mut c = ready();
        c.journeys.flush();
        let before = env::storage_usage();
        let account = id(&"a".repeat(64));
        let mint = mint_evidence(
            &id("items.root.testnet"),
            &id("root.testnet"),
            &account,
            &"a".repeat(64),
            "moth",
        );
        let polish = polish_evidence(
            &id("items.root.testnet"),
            &id("root.testnet"),
            &account,
            &mint.token_id,
            0,
            0,
        );
        let mut j = Journey::empty();
        j.banked = ["lens", "moth", "chart", "salvage", "vane"]
            .map(String::from)
            .to_vec();
        j.claims = (0..5)
            .map(|_| AcceptedClaim {
                operation_id: "a".repeat(64),
                id: "a".repeat(64),
                input_hash: "a".repeat(64),
                lens: true,
                moth: true,
                rules_version: RULES_VERSION.into(),
                content_version: CONTENT_VERSION.into(),
            })
            .collect();
        j.lens_claim = Some("a".repeat(64));
        j.moth_claim = Some("a".repeat(64));
        j.craft = Some(CraftOperation {
            evidence: mint.clone(),
            pet_id: "a".repeat(64),
            state: "failed-safe".into(),
            attempt: u32::MAX,
            uncertain_prior: true,
        });
        j.polish = Some(PolishOperation {
            evidence: polish,
            state: "failed-safe".into(),
            attempt: u32::MAX,
            uncertain_prior: true,
        });
        j.placement = Some(Placement {
            item_id: mint.token_id,
            socket: "porch".into(),
        });
        c.journeys.insert(account, j);
        c.journeys.flush();
        let used = env::storage_usage().saturating_sub(before);
        assert!(
            used <= JOURNEY_STORAGE_BYTES,
            "personal record uses {used} bytes"
        );
        println!(
            "Tidebound maximum personal record: {used} bytes; reserved {JOURNEY_STORAGE_BYTES}"
        );
    }
    #[test]
    #[should_panic(expected = "ERR_ORIGIN_CLAIM")]
    fn lens_provenance_cannot_forge_a_moth_lantern() {
        let mut c = ready();
        ctx("alice.testnet");
        let origin = c.tidebound_journey(id("alice.testnet")).lens_claim.unwrap();
        let _ = c.tidebound_craft("mochi.root.testnet".into(), "moth".into(), origin);
    }
    #[test]
    fn lost_mint_callback_can_retry_only_the_same_operation_without_unsafe_release() {
        let mut c = ready();
        ctx("alice.testnet");
        let origin = c.tidebound_journey(id("alice.testnet")).lens_claim.unwrap();
        std::mem::forget(c.tidebound_craft("mochi.root.testnet".into(), "crest".into(), origin));
        let first = c.tidebound_journey(id("alice.testnet")).craft.unwrap();
        callback(PromiseResult::Successful(b"null".to_vec()));
        assert_eq!(
            c.on_tidebound_mint_evidence(id("alice.testnet"), first.evidence.id.clone(), 1)
                .credit,
            "reserved"
        );
        ctx("alice.testnet");
        std::mem::forget(c.tidebound_retry_operation());
        let retry = c.tidebound_journey(id("alice.testnet"));
        let op = retry.craft.clone().unwrap();
        assert_eq!(op.evidence, first.evidence);
        assert_eq!(op.attempt, 2);
        assert!(op.uncertain_prior);
        callback(PromiseResult::Failed);
        assert_eq!(
            c.on_tidebound_mint(id("alice.testnet"), op.evidence.id.clone(), 2),
            retry
        );
        callback(PromiseResult::Successful(
            near_sdk::serde_json::to_vec(&op.evidence).unwrap(),
        ));
        assert_eq!(
            c.on_tidebound_mint(id("alice.testnet"), op.evidence.id.clone(), 1),
            retry
        );
        assert_eq!(
            c.on_tidebound_mint(id("alice.testnet"), op.evidence.id, 2)
                .credit,
            "consumed"
        );
    }
    #[test]
    fn lost_polish_callback_retries_without_a_second_shell_debit_or_ambiguous_refund() {
        let mut c = ready();
        ctx("alice.testnet");
        c.tidebound_commission();
        std::mem::forget(c.tidebound_polish(format!("lantern:{}", "a".repeat(64)), 0));
        let first = c.tidebound_journey(id("alice.testnet")).polish.unwrap();
        std::mem::forget(c.tidebound_retry_operation());
        let pending = c.tidebound_journey(id("alice.testnet"));
        assert_eq!(pending.shells, 0);
        let op = pending.polish.clone().unwrap();
        assert_eq!(op.evidence, first.evidence);
        callback(PromiseResult::Failed);
        let uncertain = c.on_tidebound_polish(id("alice.testnet"), op.evidence.id.clone(), 2);
        assert_eq!(uncertain.shells, 0);
        assert_eq!(
            uncertain.polish.as_ref().unwrap().state,
            "recovery-required"
        );
        callback(PromiseResult::Successful(
            near_sdk::serde_json::to_vec(&Some(&op.evidence)).unwrap(),
        ));
        let confirmed = c.on_tidebound_polish_evidence(id("alice.testnet"), op.evidence.id, 2);
        assert_eq!((confirmed.shells, confirmed.burned_shells), (0, 12));
    }
    #[test]
    fn uncertain_retry_subsidy_has_a_global_operating_cap() {
        let mut c = ready();
        ctx("alice.testnet");
        let origin = c.tidebound_journey(id("alice.testnet")).lens_claim.unwrap();
        std::mem::forget(c.tidebound_craft("mochi.root.testnet".into(), "crest".into(), origin));
        let before = c.tidebound_journey(id("alice.testnet"));
        c.tidebound_retries_today = 25;
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(
                || c.tidebound_retry_operation()
            ))
            .is_err()
        );
        assert_eq!(c.tidebound_journey(id("alice.testnet")), before);
    }
    #[test]
    fn polish_fence_recovers_shells_after_lost_failure_without_trusting_absence_or_time() {
        let mut c = ready();
        ctx("alice.testnet");
        c.tidebound_commission();
        let token = format!("lantern:{}", "a".repeat(64));
        std::mem::forget(c.tidebound_polish(token.clone(), 0));
        let first = c.tidebound_journey(id("alice.testnet")).polish.unwrap();
        callback(PromiseResult::Successful(b"null".to_vec()));
        let unknown =
            c.on_tidebound_polish_evidence(id("alice.testnet"), first.evidence.id.clone(), 1);
        assert_eq!(unknown.shells, 0);
        ctx("alice.testnet");
        std::mem::forget(c.tidebound_cancel_polish());
        let pending = c.tidebound_journey(id("alice.testnet"));
        let fenced = pending.polish.clone().unwrap();
        callback(PromiseResult::Failed);
        assert_eq!(
            c.on_tidebound_cancel_polish(id("alice.testnet"), fenced.evidence.id.clone(), 2),
            pending
        );
        callback(PromiseResult::Successful(
            near_sdk::serde_json::to_vec(&PolishCancellation {
                status: "cancelled".into(),
                operation: fenced.evidence.clone(),
            })
            .unwrap(),
        ));
        let refunded =
            c.on_tidebound_cancel_polish(id("alice.testnet"), fenced.evidence.id.clone(), 2);
        assert_eq!((refunded.shells, refunded.burned_shells), (12, 0));
        assert_eq!(refunded.polish.as_ref().unwrap().state, "failed-safe");
        assert_eq!(
            c.on_tidebound_cancel_polish(id("alice.testnet"), fenced.evidence.id.clone(), 2),
            refunded
        );
        ctx("alice.testnet");
        std::mem::forget(c.tidebound_polish(token, 0));
        let next = c.tidebound_journey(id("alice.testnet"));
        let current = next.polish.clone().unwrap();
        assert!(current.evidence.generation > first.evidence.generation);
        assert_ne!(current.evidence.id, first.evidence.id);
        callback(PromiseResult::Successful(
            near_sdk::serde_json::to_vec(&first.evidence).unwrap(),
        ));
        assert_eq!(
            c.on_tidebound_polish(id("alice.testnet"), first.evidence.id, 1),
            next
        );
        callback(PromiseResult::Successful(
            near_sdk::serde_json::to_vec(&current.evidence).unwrap(),
        ));
        let done = c.on_tidebound_polish(id("alice.testnet"), current.evidence.id, current.attempt);
        assert_eq!((done.shells, done.burned_shells), (0, 12));
    }
    #[test]
    fn cancellation_after_a_successful_mutation_confirms_instead_of_refunding() {
        let mut c = ready();
        ctx("alice.testnet");
        c.tidebound_commission();
        std::mem::forget(c.tidebound_polish(format!("lantern:{}", "a".repeat(64)), 0));
        std::mem::forget(c.tidebound_cancel_polish());
        let op = c.tidebound_journey(id("alice.testnet")).polish.unwrap();
        callback(PromiseResult::Successful(
            near_sdk::serde_json::to_vec(&PolishCancellation {
                status: "confirmed".into(),
                operation: op.evidence.clone(),
            })
            .unwrap(),
        ));
        let done =
            c.on_tidebound_cancel_polish(id("alice.testnet"), op.evidence.id.clone(), op.attempt);
        assert_eq!((done.shells, done.burned_shells), (0, 12));
        assert_eq!(done.polish.as_ref().unwrap().state, "confirmed");
        callback(PromiseResult::Failed);
        assert_eq!(
            c.on_tidebound_polish(id("alice.testnet"), op.evidence.id, 1),
            done
        );
    }
}
