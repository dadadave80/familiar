use near_sdk::{AccountId, env, near, serde::Serialize, serde_json};

pub const RULES_VERSION: &str = "tidebound_h1_v1";
pub const CONTENT_VERSION: &str = "first_light_v1";
pub const COURT_CONTENT_VERSION: &str = "first_light_v2";
pub const SUPPORTED_CONTENT_VERSIONS: [&str; 2] = [CONTENT_VERSION, COURT_CONTENT_VERSION];
pub fn supported_content_version(content: &str) -> bool {
    SUPPORTED_CONTENT_VERSIONS.contains(&content)
}
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
    mint_evidence_for_content(items, root, maker, origin_claim_id, motif, CONTENT_VERSION)
        .expect("fixed v1 content is supported")
}
pub fn mint_evidence_for_content(
    items: &AccountId,
    root: &AccountId,
    maker: &AccountId,
    origin_claim_id: &str,
    motif: &str,
    content_version: &str,
) -> Option<MintEvidence> {
    if !supported_content_version(content_version) {
        return None;
    }
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
        content_version,
    ));
    Some(MintEvidence {
        id,
        token_id,
        maker: maker.clone(),
        origin_claim_id: origin_claim_id.into(),
        motif: motif.into(),
        input_hash,
        rules_version: RULES_VERSION.into(),
        content_version: content_version.into(),
    })
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

#[cfg(test)]
mod content_tests {
    use super::*;
    #[test]
    fn historical_hash_stays_exact_and_spatial_content_keeps_entitlements() {
        let root: AccountId = "familiar-game.testnet".parse().unwrap();
        let items = "items.familiar-game.testnet".parse().unwrap();
        let maker = "qa-maker-h1.familiar-game.testnet".parse().unwrap();
        let origin = "8c5cbc6a02e6a0878b90723334c9e2e682e690a76758922ee445225a560072e5";
        let old = mint_evidence(&items, &root, &maker, origin, "crest");
        assert_eq!(
            old.id,
            "77dc2ef6e50ee7d57a4b6c126aefd60a269feb59e9834a9769ce5329460a386d"
        );
        assert_eq!(
            old.token_id,
            "lantern:736e2621a98076c3f125280866ee7f239380ee9733ef67b9bbc42fdd4e7d18ce"
        );
        assert_eq!(
            old.input_hash,
            "6b46b09684e496852fe4efb9cca606f0c799f4efdb61adde3acc7f54ef2203a5"
        );
        let new = mint_evidence_for_content(
            &items,
            &root,
            &maker,
            origin,
            "crest",
            COURT_CONTENT_VERSION,
        )
        .unwrap();
        assert_eq!(new.id, old.id);
        assert_eq!(new.token_id, old.token_id);
        assert_eq!(new.rules_version, old.rules_version);
        assert_ne!(new.input_hash, old.input_hash);
        assert_eq!(new.content_version, COURT_CONTENT_VERSION);
        assert!(
            mint_evidence_for_content(&items, &root, &maker, origin, "crest", "first_light_v3")
                .is_none()
        );
    }
}
