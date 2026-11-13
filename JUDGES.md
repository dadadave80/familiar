# Reproducible claims

Current Familiar has one playable Phaser edition. The introduction stays first; Play opens `/outing/`. The latest source cleanup is local, not a new public deployment. See [PROGRESS.md](PROGRESS.md) for the last measured checks and [archived reports](docs/ARCHIVED-REPORTS.md) for older records.

| Claim | Reproduce | Boundary |
| --- | --- | --- |
| Deterministic court, passage, account and recovery rules | `make test` | Unit tests; default Rust command ignores two Wasm integrations |
| Current browser build and types compile | `make build` | Existing Phaser chunk-size warning remains |
| Introduction, retired links, account boundary and original saves | `make browser` | Chromium/WebKit desktop/touch emulation |
| Beacon/Wind journeys, save retry, art failure and lantern origin | `bun scripts/test-expedition-browser.ts --only=390` | Local browser checks, no account or chain action |
| Bell/Reed services, later discovery and companion interaction | `bun scripts/test-passage-browser.ts` | Prepared guest harbors; no human enjoyment claim |
| Recorded 15 transaction signatures/hashes and 58 connected receipts | `make evidence` | Captured dated testnet evidence, verified offline; not a current ledger query |
| TypeScript/Rust spatial transitions agree | `make test` | Shared fixture, solver and replay tests |
| Actual contract compatibility and original-operation invariants | `bun run build:contracts`, then `bun run test:tidebound-sandbox` | Separate same-layout local-chain test; deployed-byte upgrade mode additionally requires all five frozen original Wasm artifacts |

Only two report JSON files remain:

- [FAMILIAR-GAMEPLAY.json](docs/FAMILIAR-GAMEPLAY.json): captured canonical signatures, calls and receipt graphs consumed by the verifier and regression tests.
- [TESTNET-DEPLOYMENT.json](docs/TESTNET-DEPLOYMENT.json): original deployment identifiers consumed by setup/deployment/preflight isolation guards.

Old earned returns retain their content/rules IDs, accepted hashes and original operations. Canonical progress and current-holder checks remain authoritative. Receiving a lantern does not inherit its maker's achievement. Browser previews and side discoveries are separate from ledger progress.

Physical-phone sound/performance, same earned state recovered across two physical devices, independent human enjoyment and production security/load validation are unpassed or unmeasured. Earlier live adoption/operator evidence is dated and narrower. No mainnet, retention, valuation or immutable-whole-stack claim is made. Private admin keys, journals and raw credentials are never publication material.
