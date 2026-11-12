#[tokio::test]
#[ignore = "requires optimized WASM and near-sandbox; run with --ignored"]
async fn tidebound_finite_quest_on_an_isolated_compatible_stack()
-> Result<(), Box<dyn std::error::Error>> {
    use near_workspaces::types::{KeyType, NearToken, SecretKey};
    let worker = near_workspaces::sandbox().await?;
    let key = SecretKey::from_seed(KeyType::ED25519, "disposable-tidebound-testnet-root");
    let testnet = worker
        .create_tla("testnet".parse()?, key)
        .await?
        .into_result()?;
    worker
        .root_account()?
        .transfer_near(testnet.id(), NearToken::from_near(500))
        .await?
        .into_result()?;
    let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let status = std::process::Command::new("bun")
        .arg("--no-env-file")
        .arg("contracts/root/tests/tidebound.ts")
        .current_dir(project)
        .env("SANDBOX_RPC", worker.rpc_addr())
        .env("SANDBOX_ROOT", testnet.id().as_str())
        .env("SANDBOX_SECRET", testnet.secret_key().to_string())
        .status()?;
    assert!(
        status.success(),
        "Tidebound sandbox checks failed; see child output"
    );
    Ok(())
}
