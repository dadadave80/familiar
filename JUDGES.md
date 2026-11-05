# Reproducible claims

Verified November 5, 2026. [Public frontend preview](https://familiar-two.vercel.app) is a static interface with play paused. The complete chain loop runs in a real local NEAR sandbox with disposable accounts, without supplied secrets.

Prerequisites: Bun 1.4.4, Rust ≥1.95, the wasm32 target and Binaryen 133. Initial downloads/build take extra time; the integration run took 105.58 seconds on the development machine.

| Claim | Command | Expected observation | Evidence / scope |
| --- | --- | --- | --- |
| A judge can reproduce the contract loop without operator secrets | `bash scripts/demo.sh` | Optimized contracts build; `SANDBOX CORE LOOP PASSED` | Passed; real local chain |
| A pet is a keyless named account using immutable global code | `bun run test:sandbox` after build | `PASS keyless global pet adoption` | Access-key list and matching Wasm code hash checked |
| Signed delegates preserve player authorization | Same sandbox command | Delegate predecessor/signer check passes | Real signed delegate; forged signature rejected |
| Care and recipes execute on chain | Same sandbox command | Feed, deterministic forage and atomic bread recipe pass | Inventory/energy/XP assertions |
| Bram trades with a bounded key and independent funds | Same sandbox command | Broke rollback, scoped key, NPC sale/purchase and fee pass | Protocol denies `npc_deposit` by restricted key; standard item donations reconciled |
| Savings follow pool callbacks | Same sandbox command | Stake, unbond and withdrawal pass | Explicit controllable mock pool; no real-pool yield claim |
| Selling changes authority while preserving the account | Same sandbox command | Previous owner gets `ERR_NOT_OWNER`; new owner succeeds | Inventory, savings and keylessness unchanged |
| Future storage is reserved before dispatch | `bun run test:contracts` | Root/Market storage tests pass | Maximum identities, full trade ring, concurrent reservations, callback growth and failed payouts; 59 unit executions overall |
| Weekly scores reset without moving treasury savings | `bun run test:contracts`; `bun run test:browser` | Monday UTC boundary, stale reads and first event reset pass | Failed/duplicate callbacks do not score; UI refuses to combine two different week snapshots |
| Service/client trust boundaries are checked | `bun run test` | 31 tests / 221 assertions pass | Signatures, receiver/gas/deposit/expiry policies, quotas/dedup, inner receipts, bigint prices, AI parsing, key scopes and Google proof/backup boundaries |
| Google recovery cannot grant an unproven key or silently replace a guest | `bun test web/src/auth.test.ts web/src/near.test.ts` | Payload/session/signature/nonce/owner/read-back/retry and storage-failure checks pass | Local fixtures only. Actual Google sign-in and funded Auth/MPC recovery not claimed; shared client's localhost:3000 callback policy checked |
| The built Google SDK loads in a real browser | `bun run test:auth-browser` | `PASS production Auth SDK` | Loads the production legacy SDK island; no OAuth, signing or funding attempted |
| Mobile and desktop interactions remain usable | `bun run test:browser` | Two viewport PASS lines; panel and recovery `*-fixture.png` captures | Explicit RPC/relayer fixtures exercise real browser signer; not chain evidence |
| Public preview is reachable | Open preview at phone and desktop widths | Town/fonts render; “Post Office resting”; adoption disabled | HTTP 200 and Chromium checks at 390×844 / 1280×800; `*-public-preview.png` |
| Frontend and Rust lint compile cleanly | `bun run build`; `cargo fmt --manifest-path contracts/Cargo.toml --all -- --check`; `cargo clippy --manifest-path contracts/Cargo.toml --workspace --all-targets -- -D warnings` | All succeed | Lazy Phaser size warning disclosed; no container reproducibility claim |
| Project testnet account exists | View [creation transaction](https://testnet.nearblocks.io/txns/8xkiFrNdyr3vHgGy3VgyRYVmEJERvLJwfe1vuQJBNxNn) | `familiar-1105-28522e.testnet` created | No live game deployment |
| Live testing fails honestly until connected | `bun run e2e:testnet` | Clear missing-public-relayer failure; no fixture fallback | Prepared, not passed live. Independently verifies hashes through RPC when configured; `--stake` / later `--withdraw` cover real epochs |

Not claimed: live Google recovery, real staking rewards/withdrawal, two measured epochs, cosmetic loot, offline installation, 24-hour hosted stability, video, DAO-seat or postcard stretches. General callback-trap recovery is unfinished; see [THREAT-MODEL.md](docs/THREAT-MODEL.md). Live deployment remains on hold at David's request.

No mainnet calls, Git pushes, public repository, social posts or submission. [PROGRESS.md](PROGRESS.md) records discrepancies and evidence in more detail.
