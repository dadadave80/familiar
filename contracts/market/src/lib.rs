use familiar_common::{Quote, call, emit, promise_bool, promise_succeeded, rules::*};
use near_sdk::{
    AccountId, NearToken, PanicOnDefault, Promise, PromiseOrValue, env,
    json_types::{U64, U128},
    near, require,
    serde_json::json,
    store::{IterableMap, LookupMap},
};

#[near(serializers=[borsh,json])]
#[derive(Clone)]
pub struct Listing {
    pub token_id: String,
    pub seller: AccountId,
    pub price: U128,
    pub approval_id: u64,
    pub den: Option<u8>,
}
#[near(serializers=[borsh,json])]
#[derive(Clone)]
struct Sale {
    listing: Listing,
    buyer: AccountId,
    transferred: bool,
    reserved_bytes: u64,
}
#[near(serializers=[borsh,json])]
#[derive(Clone)]
struct Trade {
    pet: AccountId,
    item: String,
    quantity: U128,
    gross: U128,
    buy: bool,
    den: Option<u8>,
    reserved_bytes: u64,
}
#[near(serializers=[borsh,json])]
#[derive(Clone)]
pub struct TradeRecord {
    pub pet: AccountId,
    pub item: String,
    pub quantity: U128,
    pub price: U128,
    pub side: String,
    pub timestamp: U64,
}
#[near(serializers=[json])]
pub struct NpcQuote {
    pub item: String,
    pub bid: U128,
    pub ask: U128,
    pub max_qty: U128,
    pub stock: U128,
    pub last: U128,
}
#[near(serializers=[json])]
pub struct NpcState {
    pub quotes: Vec<NpcQuote>,
    pub balance: U128,
    pub recent_trades: Vec<TradeRecord>,
    pub dens: [AccountId; 4],
    pub den_fees: [U128; 4],
    pub week: U64,
    pub weekly_fees: [U128; 4],
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    registry: AccountId,
    items: AccountId,
    npc: AccountId,
    dens: [AccountId; 4],
    quotes: Vec<Quote>,
    stock: [u128; 7],
    last: [u128; 7],
    npc_near_balance: u128,
    active_trades: u32,
    syncing: bool,
    storage_budget_bytes: u64,
    reserved_storage_bytes: u64,
    listings: IterableMap<String, Listing>,
    sales: LookupMap<String, Sale>,
    trades: LookupMap<AccountId, Trade>,
    claims: LookupMap<AccountId, u128>,
    paying: LookupMap<AccountId, u128>,
    recent_trades: Vec<TradeRecord>,
    den_fees: [u128; 4],
    fees_week: u64,
    weekly_fees: [u128; 4],
}
#[near]
impl Contract {
    #[init]
    pub fn new(
        registry: AccountId,
        items: AccountId,
        npc: AccountId,
        dens: [AccountId; 4],
    ) -> Self {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "ERR_INIT_AUTH"
        );
        // shortcut: only bootstrap funds back storage; add explicit operating-fund top-ups if capacity must grow.
        let storage_budget_bytes = ((env::account_balance()
            .as_yoctonear()
            .saturating_sub(PET_RESERVE))
            / env::storage_byte_cost().as_yoctonear())
        .min(u128::from(u64::MAX)) as u64;
        require!(
            env::storage_usage().saturating_add(MARKET_OPERATION_STORAGE_BYTES)
                <= storage_budget_bytes,
            "ERR_MARKET_STORAGE"
        );
        let last = std::array::from_fn(|i| if i == 3 { YOCTO * 3 / 100 } else { YOCTO / 100 });
        let quotes = ITEMS
            .iter()
            .enumerate()
            .map(|(i, item)| Quote {
                item: (*item).into(),
                bid: U128(last[i] / 2),
                ask: U128(last[i]),
                max_qty: U128(20),
            })
            .collect();
        Self {
            registry,
            items,
            npc,
            dens,
            quotes,
            stock: [0; 7],
            last,
            npc_near_balance: 0,
            active_trades: 0,
            syncing: false,
            storage_budget_bytes,
            reserved_storage_bytes: 0,
            listings: IterableMap::new(b"l"),
            sales: LookupMap::new(b"s"),
            trades: LookupMap::new(b"t"),
            claims: LookupMap::new(b"c"),
            paying: LookupMap::new(b"p"),
            recent_trades: vec![],
            den_fees: [0; 4],
            fees_week: week_at(env::block_timestamp() / 1_000_000_000),
            weekly_fees: [0; 4],
        }
    }
    #[payable]
    pub fn npc_deposit(&mut self) -> U128 {
        require!(env::predecessor_account_id() == self.npc, "ERR_NPC_ONLY");
        let amount = env::attached_deposit().as_yoctonear();
        require!(amount > 0 && amount <= YOCTO * 100, "ERR_DEPOSIT");
        self.npc_near_balance = self
            .npc_near_balance
            .checked_add(amount)
            .expect("ERR_OVERFLOW");
        U128(self.npc_near_balance)
    }
    pub fn set_quotes(&mut self, quotes: Vec<Quote>) -> Promise {
        require!(
            env::prepaid_gas() >= near_sdk::Gas::from_tgas(45),
            "ERR_GAS"
        );
        require!(env::predecessor_account_id() == self.npc, "ERR_NPC_ONLY");
        require!(quotes.len() == 7, "ERR_QUOTES");
        let mut seen = [false; 7];
        for q in &quotes {
            let i = self.index(&q.item);
            require!(!seen[i], "ERR_QUOTES");
            seen[i] = true;
            require!(
                q.bid.0 > 0
                    && q.ask.0 <= YOCTO
                    && q.bid.0 <= q.ask.0
                    && q.bid.0 >= self.last[i] / 2
                    && q.ask.0 <= self.last[i] * 3 / 2
                    && q.max_qty.0 > 0
                    && q.max_qty.0 <= 100,
                "ERR_QUOTE_BOUNDS"
            );
        }
        // shortcut: a busy desk retries on the next tick; queue quote updates if sustained traffic prevents an idle tick.
        require!(
            self.active_trades == 0 && !self.syncing,
            "ERR_TRADE_PENDING"
        );
        self.syncing = true;
        call(
            self.items.clone(),
            "mt_batch_balance_of",
            json!({"account_id":env::current_account_id(),"token_ids":ITEMS}),
            0,
            15,
        )
        .then(call(
            env::current_account_id(),
            "on_stock",
            json!({"quotes":quotes}),
            0,
            15,
        ))
    }
    #[private]
    pub fn on_stock(&mut self, quotes: Vec<Quote>) -> bool {
        if !self.syncing {
            return false;
        }
        self.syncing = false;
        if env::promise_results_count() != 1 {
            return false;
        }
        let Some(values) = env::promise_result_checked(0, 4096)
            .ok()
            .and_then(|bytes| near_sdk::serde_json::from_slice::<Vec<U128>>(&bytes).ok())
        else {
            return false;
        };
        let Ok(values): Result<[U128; 7], _> = values.try_into() else {
            return false;
        };
        self.stock = values.map(|v| v.0);
        self.quotes = quotes;
        true
    }
    pub fn mt_on_transfer(
        &mut self,
        sender_id: AccountId,
        previous_owner_ids: Vec<AccountId>,
        token_ids: Vec<String>,
        amounts: Vec<U128>,
        msg: String,
    ) -> Vec<U128> {
        require!(
            env::predecessor_account_id() == self.items,
            "ERR_ITEMS_ONLY"
        );
        let _ = (sender_id, previous_owner_ids, token_ids, msg);
        vec![U128(0); amounts.len()]
    }
    pub fn get_npc(&self) -> NpcState {
        let week = week_at(env::block_timestamp() / 1_000_000_000);
        NpcState {
            quotes: self
                .quotes
                .iter()
                .map(|q| {
                    let i = self.index(&q.item);
                    NpcQuote {
                        item: q.item.clone(),
                        bid: q.bid,
                        ask: q.ask,
                        max_qty: q.max_qty,
                        stock: U128(self.stock[i]),
                        last: U128(self.last[i]),
                    }
                })
                .collect(),
            balance: U128(self.npc_near_balance),
            recent_trades: self.recent_trades.clone(),
            dens: self.dens.clone(),
            den_fees: self.den_fees.map(U128),
            week: U64(week),
            weekly_fees: if self.fees_week == week {
                self.weekly_fees.map(U128)
            } else {
                [U128(0); 4]
            },
        }
    }
    pub fn get_listings(&self) -> Vec<Listing> {
        self.listings.values().take(100).cloned().collect()
    }
    pub fn get_claim(&self, account_id: AccountId) -> U128 {
        U128(*self.claims.get(&account_id).unwrap_or(&0))
    }
    pub fn sell_to_npc(&mut self, item: String, quantity: U128, den: Option<u8>) -> Promise {
        let pet = env::predecessor_account_id();
        self.validate_trade(&pet, &item, quantity, den);
        let q = self
            .quotes
            .iter()
            .find(|q| q.item == item)
            .expect("ERR_QUOTE");
        let gross = q.bid.0.checked_mul(quantity.0).expect("ERR_OVERFLOW");
        require!(self.npc_near_balance >= gross, "ERR_BRAM_BROKE");
        let reserved_bytes = self.reserve_operation_storage();
        self.npc_near_balance -= gross;
        self.active_trades = self.active_trades.checked_add(1).expect("ERR_OVERFLOW");
        self.trades.insert(
            pet.clone(),
            Trade {
                pet: pet.clone(),
                item: item.clone(),
                quantity,
                gross: U128(gross),
                buy: false,
                den,
                reserved_bytes,
            },
        );
        call(
            self.items.clone(),
            "game_transfer",
            json!({"from":pet,"to":env::current_account_id(),"ids":[item],"amounts":[quantity]}),
            0,
            50,
        )
        .then(call(
            env::current_account_id(),
            "on_trade",
            json!({"pet":pet}),
            0,
            35,
        ))
    }
    #[payable]
    pub fn buy_from_npc(&mut self, item: String, quantity: U128, den: Option<u8>) -> Promise {
        let pet = env::predecessor_account_id();
        self.validate_trade(&pet, &item, quantity, den);
        let i = self.index(&item);
        require!(self.stock[i] >= quantity.0, "ERR_STOCK");
        let q = self
            .quotes
            .iter()
            .find(|q| q.item == item)
            .expect("ERR_QUOTE");
        let gross = q.ask.0.checked_mul(quantity.0).expect("ERR_OVERFLOW");
        require!(
            env::attached_deposit().as_yoctonear() == gross,
            "ERR_PRICE_CHANGED"
        );
        let reserved_bytes = self.reserve_operation_storage();
        self.stock[i] -= quantity.0;
        self.active_trades = self.active_trades.checked_add(1).expect("ERR_OVERFLOW");
        self.trades.insert(
            pet.clone(),
            Trade {
                pet: pet.clone(),
                item: item.clone(),
                quantity,
                gross: U128(gross),
                buy: true,
                den,
                reserved_bytes,
            },
        );
        call(
            self.items.clone(),
            "game_transfer",
            json!({"from":env::current_account_id(),"to":pet,"ids":[item],"amounts":[quantity]}),
            0,
            50,
        )
        .then(call(
            env::current_account_id(),
            "on_trade",
            json!({"pet":pet}),
            0,
            35,
        ))
    }
    #[private]
    pub fn on_trade(&mut self, pet: AccountId) -> bool {
        let Some(trade) = self.trades.remove(&pet) else {
            return false;
        };
        self.active_trades = self.active_trades.saturating_sub(1);
        let Some(i) = ITEMS.iter().position(|s| *s == trade.item) else {
            self.reserved_storage_bytes = self
                .reserved_storage_bytes
                .saturating_sub(trade.reserved_bytes);
            return false;
        };
        if !promise_bool() {
            if trade.buy {
                self.stock[i] = self.stock[i].saturating_add(trade.quantity.0);
                self.credit(&pet, trade.gross.0);
                self.pay(&pet);
            } else {
                self.npc_near_balance = self.npc_near_balance.saturating_add(trade.gross.0);
            }
            self.reserved_storage_bytes = self
                .reserved_storage_bytes
                .saturating_sub(trade.reserved_bytes);
            return false;
        }
        let fee = market_fee(trade.gross.0);
        if trade.buy {
            self.npc_near_balance = self.npc_near_balance.saturating_add(trade.gross.0 - fee);
        } else {
            self.stock[i] = self.stock[i].saturating_add(trade.quantity.0);
            self.credit(&pet, trade.gross.0 - fee);
            self.pay(&pet);
        }
        self.fee(trade.den, fee);
        self.last[i] = trade.gross.0 / trade.quantity.0;
        if let Some(q) = self.quotes.iter_mut().find(|q| q.item == trade.item) {
            q.bid.0 = q
                .bid
                .0
                .clamp((self.last[i] / 2).max(1), (self.last[i] * 3 / 2).min(YOCTO));
            q.ask.0 = q.ask.0.clamp(q.bid.0, (self.last[i] * 3 / 2).min(YOCTO));
        }
        self.recent_trades.push(TradeRecord {
            pet: pet.clone(),
            item: trade.item.clone(),
            quantity: trade.quantity,
            price: U128(self.last[i]),
            side: if trade.buy {
                "buy".into()
            } else {
                "sell".into()
            },
            timestamp: U64(env::block_timestamp() / 1_000_000_000),
        });
        if self.recent_trades.len() > 50 {
            self.recent_trades.remove(0);
        }
        self.reserved_storage_bytes = self
            .reserved_storage_bytes
            .saturating_sub(trade.reserved_bytes);
        emit(
            "npc_trade",
            json!({"pet":pet,"item":trade.item,"quantity":trade.quantity,"gross":trade.gross,"fee":U128(fee),"side":if trade.buy{"buy"}else{"sell"}}),
        );
        true
    }
    pub fn nft_on_approve(
        &mut self,
        token_id: String,
        owner_id: AccountId,
        approval_id: u64,
        msg: String,
    ) {
        require!(
            env::predecessor_account_id() == self.registry,
            "ERR_REGISTRY_ONLY"
        );
        require!(self.sales.get(&token_id).is_none(), "ERR_SALE_PENDING");
        require!(msg.len() <= 256, "ERR_MESSAGE");
        let data: near_sdk::serde_json::Value =
            near_sdk::serde_json::from_str(&msg).expect("ERR_LISTING");
        let price = data
            .get("price")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u128>().ok())
            .expect("ERR_PRICE");
        require!(price > 0 && price <= YOCTO * 10, "ERR_PRICE");
        let den = None; // Fee destination is read from the registry after transfer.
        require!(
            self.listings.len() < MARKET_LISTING_LIMIT || self.listings.contains_key(&token_id),
            "ERR_MARKET_FULL"
        );
        require!(
            self.has_storage_headroom(
                MARKET_LISTING_STORAGE_BYTES + MARKET_OPERATION_STORAGE_BYTES
            ),
            "ERR_MARKET_STORAGE"
        );
        self.listings.insert(
            token_id.clone(),
            Listing {
                token_id: token_id.clone(),
                seller: owner_id.clone(),
                price: U128(price),
                approval_id,
                den,
            },
        );
        emit(
            "pet_listed",
            json!({"pet":token_id,"seller":owner_id,"price":U128(price)}),
        );
    }
    pub fn cancel_listing(&mut self, token_id: String) {
        let listing = self.listings.get(&token_id).expect("ERR_LISTING");
        require!(
            listing.seller == env::predecessor_account_id(),
            "ERR_NOT_OWNER"
        );
        self.listings.remove(&token_id);
    }
    #[payable]
    pub fn buy_pet(&mut self, token_id: String) -> Promise {
        require!(
            env::prepaid_gas() >= near_sdk::Gas::from_tgas(120),
            "ERR_GAS"
        );
        require!(self.sales.get(&token_id).is_none(), "ERR_SALE_PENDING");
        let listing = self.listings.get(&token_id).cloned().expect("ERR_LISTING");
        require!(
            env::attached_deposit().as_yoctonear() == listing.price.0,
            "ERR_PRICE"
        );
        let buyer = env::predecessor_account_id();
        require!(buyer != listing.seller, "ERR_SELF_TRADE");
        let reserved_bytes = self.reserve_operation_storage();
        self.listings.remove(&token_id);
        self.sales.insert(
            token_id.clone(),
            Sale {
                listing: listing.clone(),
                buyer: buyer.clone(),
                transferred: false,
                reserved_bytes,
            },
        );
        call(self.registry.clone(),"nft_transfer",json!({"receiver_id":buyer,"token_id":token_id,"approval_id":listing.approval_id,"memo":"Familiar fixed-price sale"}),1,35)
   .then(call(env::current_account_id(),"on_pet_bought",json!({"token_id":token_id}),0,65))
    }
    #[private]
    pub fn on_pet_bought(&mut self, token_id: String) -> PromiseOrValue<bool> {
        let Some(mut sale) = self.sales.get(&token_id).cloned() else {
            return PromiseOrValue::Value(false);
        };
        if !promise_succeeded() {
            self.sales.remove(&token_id);
            self.credit(&sale.buyer, sale.listing.price.0);
            self.pay(&sale.buyer);
            self.reserved_storage_bytes = self
                .reserved_storage_bytes
                .saturating_sub(sale.reserved_bytes);
            return PromiseOrValue::Value(false);
        }
        sale.transferred = true;
        self.sales.insert(token_id.clone(), sale);
        self.sale_context(token_id).into()
    }
    pub fn settle_sale(&mut self, token_id: String) -> Promise {
        require!(
            self.sales.get(&token_id).is_some_and(|s| s.transferred),
            "ERR_SALE_NOT_TRANSFERRED"
        );
        self.sale_context(token_id)
    }
    #[private]
    pub fn on_sale_settled(&mut self, token_id: String) -> bool {
        let Some(sale) = self.sales.get(&token_id).cloned().filter(|s| s.transferred) else {
            return false;
        };
        if env::promise_results_count() != 1 {
            return false;
        }
        let den = match env::promise_result_checked(0, 32)
            .ok()
            .and_then(|bytes| near_sdk::serde_json::from_slice::<Option<u8>>(&bytes).ok())
        {
            Some(den) if den.is_none_or(|d| (1..=4).contains(&d)) => den,
            _ => return false,
        };
        self.sales.remove(&token_id);
        let fee = market_fee(sale.listing.price.0);
        self.credit(&sale.listing.seller, sale.listing.price.0 - fee);
        self.pay(&sale.listing.seller);
        self.fee(den, fee);
        self.reserved_storage_bytes = self
            .reserved_storage_bytes
            .saturating_sub(sale.reserved_bytes);
        emit(
            "pet_sold",
            json!({"pet":token_id,"buyer":sale.buyer,"seller":sale.listing.seller,"price":sale.listing.price,"fee":U128(fee),"den":den}),
        );
        true
    }
    pub fn claim(&mut self) -> PromiseOrValue<bool> {
        let account = env::predecessor_account_id();
        match self.start_payment(&account) {
            Some(p) => p.into(),
            None => PromiseOrValue::Value(false),
        }
    }
    #[private]
    pub fn on_payment(&mut self, account: AccountId, amount: U128) -> bool {
        if self.paying.get(&account) != Some(&amount.0) {
            return false;
        }
        self.paying.remove(&account);
        if !promise_succeeded() {
            self.credit(&account, amount.0);
            return false;
        }
        true
    }
}
impl Contract {
    fn has_storage_headroom(&self, additional: u64) -> bool {
        env::storage_usage()
            .checked_add(self.reserved_storage_bytes)
            .and_then(|used| used.checked_add(additional))
            .is_some_and(|needed| needed <= self.storage_budget_bytes)
    }
    fn reserve_operation_storage(&mut self) -> u64 {
        require!(
            self.has_storage_headroom(MARKET_OPERATION_STORAGE_BYTES),
            "ERR_MARKET_STORAGE"
        );
        self.reserved_storage_bytes += MARKET_OPERATION_STORAGE_BYTES;
        MARKET_OPERATION_STORAGE_BYTES
    }
    fn sale_context(&self, token_id: String) -> Promise {
        call(
            self.registry.clone(),
            "get_den",
            json!({"token_id":token_id}),
            0,
            8,
        )
        .then(call(
            env::current_account_id(),
            "on_sale_settled",
            json!({"token_id":token_id}),
            0,
            30,
        ))
    }
    fn index(&self, item: &str) -> usize {
        ITEMS.iter().position(|s| *s == item).expect("ERR_ITEM")
    }
    fn validate_trade(&self, pet: &AccountId, item: &str, quantity: U128, den: Option<u8>) {
        require!(!self.syncing, "ERR_STOCK_SYNC");
        require!(self.trades.get(pet).is_none(), "ERR_TRADE_PENDING");
        require!(den.is_none_or(|d| (1..=4).contains(&d)), "ERR_DEN");
        let quote = self
            .quotes
            .iter()
            .find(|q| q.item == item)
            .expect("ERR_ITEM");
        require!(
            quantity.0 > 0 && quantity.0 <= quote.max_qty.0,
            "ERR_QUANTITY"
        );
    }
    fn credit(&mut self, account: &AccountId, amount: u128) {
        let current = *self.claims.get(account).unwrap_or(&0);
        self.claims
            .insert(account.clone(), current.saturating_add(amount));
    }
    fn fee(&mut self, den: Option<u8>, amount: u128) {
        let i = usize::from(den.unwrap_or(1).saturating_sub(1)).min(3);
        self.den_fees[i] = self.den_fees[i].saturating_add(amount);
        let week = week_at(env::block_timestamp() / 1_000_000_000);
        if self.fees_week != week {
            self.fees_week = week;
            self.weekly_fees = [0; 4];
        }
        self.weekly_fees[i] = self.weekly_fees[i].saturating_add(amount);
        let account = self.dens[i].clone();
        self.credit(&account, amount);
        self.pay(&account);
    }
    fn pay(&mut self, account: &AccountId) {
        if let Some(p) = self.start_payment(account) {
            p.detach();
        }
    }
    fn start_payment(&mut self, account: &AccountId) -> Option<Promise> {
        if self.paying.get(account).is_some() {
            return None;
        }
        let amount = self.claims.remove(account)?;
        if amount == 0 {
            return None;
        }
        self.paying.insert(account.clone(), amount);
        Some(
            Promise::new(account.clone())
                .transfer(NearToken::from_yoctonear(amount))
                .then(call(
                    env::current_account_id(),
                    "on_payment",
                    json!({"account":account,"amount":U128(amount)}),
                    0,
                    10,
                )),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{PromiseResult, test_utils::VMContextBuilder, testing_env};
    fn id(s: &str) -> AccountId {
        s.parse().unwrap()
    }
    fn ctx(predecessor: &str, deposit: u128) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(id("market.root.testnet"))
            .predecessor_account_id(id(predecessor))
            .account_balance(NearToken::from_near(100))
            .attached_deposit(NearToken::from_yoctonear(deposit));
        b
    }
    fn contract() -> Contract {
        testing_env!(ctx("market.root.testnet", 0).build());
        Contract::new(
            id("root.testnet"),
            id("items.root.testnet"),
            id("bram.root.testnet"),
            [
                id("den-1.root.testnet"),
                id("den-2.root.testnet"),
                id("den-3.root.testnet"),
                id("den-4.root.testnet"),
            ],
        )
    }
    fn result(success: bool) {
        testing_env!(
            ctx("market.root.testnet", 0).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![if success {
                PromiseResult::Successful(b"true".to_vec())
            } else {
                PromiseResult::Failed
            }]
        );
    }
    #[test]
    #[should_panic(expected = "ERR_BRAM_BROKE")]
    fn broke_bram_rejects_before_transfer() {
        let mut c = contract();
        testing_env!(ctx("mochi.root.testnet", 0).build());
        let _ = c.sell_to_npc("bread".into(), U128(1), None);
    }
    #[test]
    #[should_panic(expected = "ERR_QUOTE_BOUNDS")]
    fn rejects_quotes_beyond_last_trade_bounds() {
        let mut c = contract();
        let mut quotes = c.quotes.clone();
        quotes[0].ask = U128(YOCTO);
        testing_env!(ctx("bram.root.testnet", 0).build());
        let _ = c.set_quotes(quotes);
    }
    #[test]
    #[should_panic(expected = "ERR_NPC_ONLY")]
    fn npc_deposit_is_owner_scoped() {
        let mut c = contract();
        testing_env!(ctx("alice.testnet", YOCTO).build());
        c.npc_deposit();
    }
    #[test]
    fn failed_item_transfer_restores_npc_reserve() {
        let mut c = contract();
        c.npc_near_balance = YOCTO;
        let gross = YOCTO / 100;
        c.npc_near_balance -= gross;
        c.trades.insert(
            id("mochi.root.testnet"),
            Trade {
                pet: id("mochi.root.testnet"),
                item: "flour".into(),
                quantity: U128(2),
                gross: U128(gross),
                buy: false,
                den: None,
                reserved_bytes: 0,
            },
        );
        result(false);
        assert!(!c.on_trade(id("mochi.root.testnet")));
        assert_eq!(c.npc_near_balance, YOCTO);
        assert_eq!(c.stock[0], 0);
        assert!(c.trades.get(&id("mochi.root.testnet")).is_none());
    }
    #[test]
    fn failed_payout_preserves_claim() {
        let mut c = contract();
        c.paying.insert(id("alice.testnet"), 123);
        result(false);
        assert!(!c.on_payment(id("alice.testnet"), U128(123)));
        assert_eq!(c.get_claim(id("alice.testnet")), U128(123));
        assert!(!c.on_payment(id("alice.testnet"), U128(123)));
        assert_eq!(c.get_claim(id("alice.testnet")), U128(123));
    }
    #[test]
    fn fee_split_conserves_every_yocto() {
        let mut c = contract();
        let gross = 101u128;
        c.trades.insert(
            id("mochi.root.testnet"),
            Trade {
                pet: id("mochi.root.testnet"),
                item: "flour".into(),
                quantity: U128(1),
                gross: U128(gross),
                buy: false,
                den: Some(3),
                reserved_bytes: 0,
            },
        );
        result(true);
        assert!(c.on_trade(id("mochi.root.testnet")));
        assert_eq!(c.paying.get(&id("mochi.root.testnet")), Some(&99));
        assert_eq!(c.paying.get(&id("den-3.root.testnet")), Some(&2));
        assert_eq!(c.stock[0], 1);
        assert_eq!(c.den_fees, [0, 0, 2, 0]);
    }
    #[test]
    fn failed_resale_refunds_buyer_without_seller_credit() {
        let mut c = contract();
        let listing = Listing {
            token_id: "mochi.root.testnet".into(),
            seller: id("alice.testnet"),
            price: U128(101),
            approval_id: 7,
            den: None,
        };
        c.sales.insert(
            listing.token_id.clone(),
            Sale {
                listing,
                buyer: id("bob.testnet"),
                transferred: false,
                reserved_bytes: 0,
            },
        );
        result(false);
        assert!(matches!(
            c.on_pet_bought("mochi.root.testnet".into()),
            PromiseOrValue::Value(false)
        ));
        assert_eq!(c.paying.get(&id("bob.testnet")), Some(&101));
        assert_eq!(c.get_claim(id("alice.testnet")), U128(0));
    }
    #[test]
    #[should_panic(expected = "ERR_REGISTRY_ONLY")]
    fn fake_nft_approval_is_rejected() {
        let mut c = contract();
        testing_env!(ctx("alice.testnet", 0).build());
        c.nft_on_approve(
            "mochi.root.testnet".into(),
            id("alice.testnet"),
            1,
            "{\"price\":\"100\"}".into(),
        );
    }
    #[test]
    fn weekly_fees_reset_only_scores_and_failed_or_duplicate_trades_add_nothing() {
        let mut c = contract();
        let den = id("den-2.root.testnet");
        let pet = id("mochi.root.testnet");
        let mut sunday = ctx("market.root.testnet", 0);
        sunday.block_timestamp(1_794_182_399 * 1_000_000_000);
        testing_env!(sunday.build());
        c.fee(Some(2), 100);
        assert_eq!(c.get_npc().weekly_fees[1], U128(100));
        assert_eq!(c.den_fees[1], 100);
        let paying = *c.paying.get(&den).unwrap();
        let old_week = c.fees_week;
        let mut monday = ctx("market.root.testnet", 0);
        monday.block_timestamp(1_794_182_400 * 1_000_000_000);
        testing_env!(monday.build());
        assert_eq!(c.get_npc().week, U64(week_at(1_794_182_400)));
        assert_eq!(c.get_npc().weekly_fees, [U128(0); 4]);
        assert_eq!(c.den_fees[1], 100);
        assert_eq!(c.fees_week, old_week);
        assert_eq!(c.paying.get(&den), Some(&paying));
        c.fee(Some(2), 50);
        assert_eq!(c.weekly_fees, [0, 50, 0, 0]);
        assert_eq!(c.den_fees[1], 150);
        assert_eq!(c.paying.get(&den), Some(&paying));
        assert_eq!(c.get_claim(den.clone()), U128(50));
        c.npc_near_balance = 898;
        c.active_trades = 1;
        c.trades.insert(
            pet.clone(),
            Trade {
                pet: pet.clone(),
                item: "flour".into(),
                quantity: U128(1),
                gross: U128(101),
                buy: false,
                den: Some(2),
                reserved_bytes: 0,
            },
        );
        testing_env!(
            monday.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Failed]
        );
        assert!(!c.on_trade(pet.clone()));
        assert_eq!(c.npc_near_balance, 999);
        assert_eq!(c.den_fees[1], 150);
        assert_eq!(c.weekly_fees[1], 50);
        c.npc_near_balance -= 101;
        c.active_trades = 1;
        c.trades.insert(
            pet.clone(),
            Trade {
                pet: pet.clone(),
                item: "flour".into(),
                quantity: U128(1),
                gross: U128(101),
                buy: false,
                den: Some(2),
                reserved_bytes: 0,
            },
        );
        testing_env!(
            monday.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Successful(b"true".to_vec())]
        );
        assert!(c.on_trade(pet.clone()));
        assert_eq!(c.den_fees[1], 152);
        assert_eq!(c.weekly_fees[1], 52);
        assert!(!c.on_trade(pet));
        assert_eq!(c.weekly_fees[1], 52);
        assert_eq!(c.paying.get(&den), Some(&paying));
    }
}

#[cfg(test)]
mod settlement_tests {
    use super::*;
    use near_sdk::{PromiseResult, test_utils::VMContextBuilder, testing_env};
    #[test]
    fn failed_den_lookup_keeps_escrow_and_retry_pays_actual_den() {
        let root: AccountId = "market.root.testnet".parse().unwrap();
        let mut b = VMContextBuilder::new();
        b.current_account_id(root.clone())
            .predecessor_account_id(root)
            .account_balance(NearToken::from_near(100));
        testing_env!(b.build());
        let mut c = Contract::new(
            "root.testnet".parse().unwrap(),
            "items.root.testnet".parse().unwrap(),
            "bram.root.testnet".parse().unwrap(),
            [
                "den-1.root.testnet".parse().unwrap(),
                "den-2.root.testnet".parse().unwrap(),
                "den-3.root.testnet".parse().unwrap(),
                "den-4.root.testnet".parse().unwrap(),
            ],
        );
        let token_id = "mochi.root.testnet".to_string();
        c.sales.insert(
            token_id.clone(),
            Sale {
                listing: Listing {
                    token_id: token_id.clone(),
                    seller: "alice.testnet".parse().unwrap(),
                    price: U128(101),
                    approval_id: 0,
                    den: Some(4),
                },
                buyer: "bob.testnet".parse().unwrap(),
                transferred: true,
                reserved_bytes: 0,
            },
        );
        testing_env!(
            b.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Failed]
        );
        assert!(!c.on_sale_settled(token_id.clone()));
        assert!(c.sales.contains_key(&token_id));
        testing_env!(
            b.build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Successful(b"2".to_vec())]
        );
        assert!(c.on_sale_settled(token_id.clone()));
        assert_eq!(c.den_fees, [0, 2, 0, 0]);
        assert!(!c.on_sale_settled(token_id));
    }
}

#[cfg(test)]
mod stock_tests {
    use super::*;
    use near_sdk::{PromiseResult, test_utils::VMContextBuilder, testing_env};
    fn context(predecessor: &str) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id("market.root.testnet".parse().unwrap())
            .predecessor_account_id(predecessor.parse().unwrap())
            .account_balance(NearToken::from_near(10));
        b
    }
    fn contract() -> Contract {
        testing_env!(context("market.root.testnet").build());
        Contract::new(
            "root.testnet".parse().unwrap(),
            "items.root.testnet".parse().unwrap(),
            "bram.root.testnet".parse().unwrap(),
            [
                "den-1.root.testnet".parse().unwrap(),
                "den-2.root.testnet".parse().unwrap(),
                "den-3.root.testnet".parse().unwrap(),
                "den-4.root.testnet".parse().unwrap(),
            ],
        )
    }
    #[test]
    fn failed_stock_read_releases_sync_without_changing_quotes_or_stock() {
        let mut c = contract();
        let old = c.quotes[0].ask;
        c.stock[0] = 3;
        c.syncing = true;
        let quotes = c.quotes.clone();
        testing_env!(
            context("market.root.testnet").build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Failed]
        );
        assert!(!c.on_stock(quotes));
        assert!(!c.syncing);
        assert_eq!(c.stock[0], 3);
        assert_eq!(c.quotes[0].ask, old);
    }
    #[test]
    fn stock_snapshot_accepts_exact_seven_item_balances() {
        let mut c = contract();
        c.syncing = true;
        let quotes = c.quotes.clone();
        testing_env!(
            context("market.root.testnet").build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![PromiseResult::Successful(
                br#"["1","2","3","4","5","6","7"]"#.to_vec()
            )]
        );
        assert!(c.on_stock(quotes));
        assert_eq!(c.stock, [1, 2, 3, 4, 5, 6, 7]);
        assert!(!c.syncing);
    }
    #[test]
    #[should_panic(expected = "ERR_TRADE_PENDING")]
    fn stock_sync_cannot_replace_active_trade_reservations() {
        let mut c = contract();
        c.active_trades = 1;
        let quotes = c.quotes.clone();
        testing_env!(context("bram.root.testnet").build());
        let _ = c.set_quotes(quotes);
    }
    #[test]
    #[should_panic(expected = "ERR_ITEMS_ONLY")]
    fn fake_standard_delivery_cannot_change_market() {
        let mut c = contract();
        testing_env!(context("alice.testnet").build());
        c.mt_on_transfer(
            "alice.testnet".parse().unwrap(),
            vec![],
            vec![],
            vec![U128(1)],
            String::new(),
        );
    }
}

#[cfg(test)]
mod storage_tests {
    use super::*;
    use near_sdk::{PromiseResult, test_utils::VMContextBuilder, testing_env};
    fn id(c: char) -> AccountId {
        c.to_string().repeat(64).parse().unwrap()
    }
    fn ctx(predecessor: AccountId, usage: u64, deposit: u128) -> VMContextBuilder {
        let mut b = VMContextBuilder::new();
        b.current_account_id(id('h'))
            .predecessor_account_id(predecessor)
            .storage_usage(usage)
            .account_balance(NearToken::from_near(100))
            .attached_deposit(NearToken::from_yoctonear(deposit));
        b
    }
    fn contract() -> Contract {
        testing_env!(ctx(id('h'), 307_200, 0).build());
        Contract::new(
            id('a'),
            id('b'),
            id('c'),
            [id('d'), id('e'), id('f'), id('g')],
        )
    }
    fn flush(c: &mut Contract) {
        c.listings.flush();
        c.sales.flush();
        c.trades.flush();
        c.claims.flush();
        c.paying.flush();
    }
    fn footprint(c: &Contract) -> i128 {
        i128::from(env::storage_usage()) + near_sdk::borsh::to_vec(c).unwrap().len() as i128
    }
    fn result(value: PromiseResult) {
        let usage = env::storage_usage();
        testing_env!(
            ctx(id('h'), usage, 0).build(),
            near_sdk::test_vm_config(),
            near_sdk::RuntimeFeesConfig::test(),
            Default::default(),
            vec![value]
        );
    }
    #[test]
    fn bootstrap_state_and_max_identity_listing_fit_their_storage_bounds() {
        let mut c = contract();
        let initial = near_sdk::borsh::to_vec(&c).unwrap().len() as u64;
        assert!(initial <= MARKET_OPERATION_STORAGE_BYTES);
        let before = footprint(&c);
        let usage = env::storage_usage();
        testing_env!(ctx(id('a'), usage, 0).build());
        c.nft_on_approve(
            id('p').to_string(),
            id('q'),
            u64::MAX,
            "{\"price\":\"10000000000000000000000000\"}".into(),
        );
        flush(&mut c);
        let listing = footprint(&c) - before;
        assert!(listing <= i128::from(MARKET_LISTING_STORAGE_BYTES));
        println!(
            "Market storage: bootstrap state={initial} bytes; max-ID listing={listing} bytes; bounds={MARKET_OPERATION_STORAGE_BYTES}/{MARKET_LISTING_STORAGE_BYTES}"
        );
    }
    #[test]
    fn npc_money_and_buyer_deposits_never_expand_the_operating_storage_budget() {
        let mut c = contract();
        c.storage_budget_bytes = env::storage_usage() + MARKET_OPERATION_STORAGE_BYTES - 1;
        let budget = c.storage_budget_bytes;
        let usage = env::storage_usage();
        testing_env!(ctx(id('c'), usage, YOCTO * 100).build());
        c.npc_deposit();
        assert_eq!(c.storage_budget_bytes, budget);
        let held = c.npc_near_balance;
        testing_env!(ctx(id('p'), usage, 0).build());
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.sell_to_npc(
                "flour".into(),
                U128(1),
                None
            )))
            .is_err()
        );
        assert_eq!(c.npc_near_balance, held);
        assert_eq!(c.active_trades, 0);
        assert_eq!(c.reserved_storage_bytes, 0);
        c.stock[0] = 1;
        let ask = c.quotes[0].ask.0;
        testing_env!(ctx(id('p'), usage, ask).build());
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.buy_from_npc(
                "flour".into(),
                U128(1),
                None
            )))
            .is_err()
        );
        assert_eq!(c.stock[0], 1);
        assert_eq!(c.storage_budget_bytes, budget);
    }
    #[test]
    fn simultaneous_callbacks_cannot_overbook_the_same_storage_headroom() {
        let mut c = contract();
        c.storage_budget_bytes = env::storage_usage() + MARKET_OPERATION_STORAGE_BYTES * 2;
        assert_eq!(
            c.reserve_operation_storage(),
            MARKET_OPERATION_STORAGE_BYTES
        );
        assert_eq!(
            c.reserve_operation_storage(),
            MARKET_OPERATION_STORAGE_BYTES
        );
        assert!(!c.has_storage_headroom(1));
        assert_eq!(c.reserved_storage_bytes, MARKET_OPERATION_STORAGE_BYTES * 2);
    }
    fn callback_growth(existing: bool) {
        let mut c = contract();
        let pet = id('p');
        let den = id('d');
        for _ in 0..49 {
            c.recent_trades.push(TradeRecord {
                pet: id('z'),
                item: "lantern".into(),
                quantity: U128(u128::MAX),
                price: U128(u128::MAX),
                side: "sell".into(),
                timestamp: U64(u64::MAX),
            });
        }
        if existing {
            c.claims.insert(pet.clone(), 11);
            c.paying.insert(pet.clone(), 17);
            c.claims.insert(den.clone(), 13);
            c.paying.insert(den.clone(), 19);
        }
        c.trades.insert(
            pet.clone(),
            Trade {
                pet: pet.clone(),
                item: "flour".into(),
                quantity: U128(1),
                gross: U128(101),
                buy: false,
                den: Some(1),
                reserved_bytes: MARKET_OPERATION_STORAGE_BYTES,
            },
        );
        c.active_trades = 1;
        c.reserved_storage_bytes = MARKET_OPERATION_STORAGE_BYTES;
        flush(&mut c);
        let before = footprint(&c);
        result(PromiseResult::Successful(b"true".to_vec()));
        assert!(c.on_trade(pet.clone()));
        flush(&mut c);
        let growth = footprint(&c) - before;
        assert!(growth <= i128::from(MARKET_OPERATION_STORAGE_BYTES));
        assert_eq!(c.reserved_storage_bytes, 0);
        assert_eq!(c.recent_trades.len(), 50);
        let amount = *c.paying.get(&pet).unwrap();
        let before_failure = footprint(&c);
        result(PromiseResult::Failed);
        assert!(!c.on_payment(pet, U128(amount)));
        flush(&mut c);
        let failed_growth = footprint(&c) - before_failure;
        assert!(failed_growth <= i128::from(MARKET_OPERATION_STORAGE_BYTES));
        println!(
            "Market callback: existing claims+paying={existing}; ring50 growth={growth} bytes; payoutfailure growth={failed_growth} bytes; reserved={MARKET_OPERATION_STORAGE_BYTES}"
        );
    }
    #[test]
    fn callback_growth_with_full_ring_and_new_payouts_is_funded() {
        callback_growth(false);
    }
    #[test]
    fn callback_growth_with_full_ring_and_simultaneous_claims_and_paying_is_funded() {
        callback_growth(true);
    }
}
