#[tokio::test]
#[ignore = "requires built WASM and the near-sandbox binary; run with --ignored"]
async fn complete_game_with_real_delegate_actions() -> Result<(), Box<dyn std::error::Error>> {
    let worker = near_workspaces::sandbox().await?;
    let root = worker.root_account()?;
    let project = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap();
    let status = std::process::Command::new("bun")
        .arg("contracts/root/tests/sandbox.ts")
        .current_dir(project)
        .env("SANDBOX_RPC", worker.rpc_addr())
        .env("SANDBOX_ROOT", root.id().as_str())
        .env("SANDBOX_SECRET", root.secret_key().to_string())
        .status()?;
    assert!(
        status.success(),
        "Sandbox gameplay failed; see child output above"
    );
    Ok(())
}
