use near_sdk::{AccountId, env, near, serde::Serialize, serde_json};

pub const RULES_VERSION: &str = "tidebound_h1_v1";
pub const CONTENT_VERSION: &str = "first_light_v1";
pub const RECIPE: &str = "first_light_lantern_v1";
pub const CRAFT_STORAGE_FUND: u128 = crate::rules::YOCTO * 8 / 100;
pub const JOURNEY_STORAGE_BYTES: u64 = 8_192;
pub const POLISH_STORAGE_RESERVE_BYTES: u64 = 1_024;
pub const POLISH_CANCEL_STORAGE_FUND: u128 = crate::rules::YOCTO / 100;

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MintEvidence {
    pub id: String,
    pub token_id: String,
    pub maker: AccountId,
    pub origin_claim_id: String,
    pub motif: String,
    pub input_hash: String,
    pub rules_version: String,
    pub content_version: String,
}
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PolishEvidence {
    pub id: String,
    pub token_id: String,
    pub expected_holder: AccountId,
    pub expected_appearance: u32,
    pub generation: u32,
    pub input_hash: String,
}

pub fn hash<T: Serialize>(value: &T) -> String {
    env::sha256(serde_json::to_vec(value).expect("ERR_CANONICAL_INPUT"))
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
pub fn craft_id(root: &AccountId, maker: &AccountId) -> String {
    hash(&(
        "familiar.craft.v1",
        "testnet",
        root,
        maker,
        "first_light",
        "first_light_craft_credit",
    ))
}
pub fn mint_evidence(
    items: &AccountId,
    root: &AccountId,
    maker: &AccountId,
    origin_claim_id: &str,
    motif: &str,
) -> MintEvidence {
    let id = craft_id(root, maker);
    let token_id = format!(
        "lantern:{}",
        hash(&("familiar.item.v1", "testnet", items, root, maker, &id))
    );
    let input_hash = hash(&(
        "familiar.mint.v1",
        "testnet",
        items,
        root,
        maker,
        &id,
        &token_id,
        origin_claim_id,
        RECIPE,
        motif,
        RULES_VERSION,
        CONTENT_VERSION,
    ));
    MintEvidence {
        id,
        token_id,
        maker: maker.clone(),
        origin_claim_id: origin_claim_id.into(),
        motif: motif.into(),
        input_hash,
        rules_version: RULES_VERSION.into(),
        content_version: CONTENT_VERSION.into(),
    }
}
pub fn polish_evidence(
    items: &AccountId,
    root: &AccountId,
    holder: &AccountId,
    token_id: &str,
    expected_appearance: u32,
    generation: u32,
) -> PolishEvidence {
    let id = hash(&(
        "familiar.polish.v1",
        "testnet",
        items,
        root,
        holder,
        token_id,
        expected_appearance,
        generation,
    ));
    let input_hash = hash(&(
        "familiar.finish.v1",
        "testnet",
        items,
        root,
        &id,
        holder,
        token_id,
        expected_appearance,
        generation,
        "harbor_polish",
        12u8,
    ));
    PolishEvidence {
        id,
        token_id: token_id.into(),
        expected_holder: holder.clone(),
        expected_appearance,
        generation,
        input_hash,
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PolishCancellation {
    pub status: String,
    pub operation: PolishEvidence,
}
pub fn polish_fence_id(items: &AccountId, root: &AccountId, operation: &PolishEvidence) -> String {
    hash(&(
        "familiar.finish-fence.v1",
        "testnet",
        items,
        root,
        &operation.expected_holder,
        &operation.token_id,
        operation.expected_appearance,
    ))
}
