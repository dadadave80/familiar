# Reproducible claims

## Tidebound candidate — November 12, 2026

**Status: local/sandbox candidate; H1 live recovery/ownership gates remain blocked.** The recovery-only HTTPS check was explicitly approved and published; the game candidate remains local and no source push or submission occurred. “Tidebound” remains a proposed subtitle. The public game has the earlier Beacon build.

### Reproduce the current work

Install with `bun install --frozen-lockfile`. Use Bun1.4.4 and the existing Rust/NEAR toolchain; the existing React/Vite/Phaser and Rust stack is preserved. The optional Privy route adds pinned SDK dependencies.

| Action | Expected result | Evidence boundary |
| --- | --- | --- |
| `bun --no-env-file run dev`, open `/outing/` | Full-screen world, custom coastal navigation/controls, existing characters/art, Beacon and already implemented Wind Gate | Local browser game; no account needed |
| Choose Rope; Move Left → Wait → Move Center → Reel Lens → Return; restore beacon | Five-action dry lens return; Crest eligibility; deliberate restoration | Pure reducer replay and device save, not chain authority |
| Open Workshop, preview one lantern, choose porch/dock, view origin | Same lantern moves; Moth locked until an actual personal wind-moth return; static illustration labelled truthfully | Local preview, not transferable |
| Choose two-shell challenge or Wind Gate | A different goal using the existing mechanics | Human understanding/voluntary continuation unmeasured |
| `bun run test:tidebound-browser` | Responsive local Storycraft/reload/migration/failure checks | Chromium emulation; no device recovery |
| `bun --no-env-file scripts/test-tidebound-account-browser.ts` | Explicit provisioning, finite commission/craft/finish, placement, stale-signout rejection | Clearly labelled synthetic provider/UI fixtures |
| `bun run test:privy-lifecycle-browser` | Closing the actual React bridge rejects delayed login/refresh/token/sign results and preserves pending bytes | Synthetic SDK, zero external requests |
| `bun run build:contracts`; `bun run test:tidebound-sandbox` | Complete fresh mutually configured root/pet/items/bakery/market stack; claim, commission, canonical concurrent craft, polish, standard transfer and cancellation fence | Actual disposable local NEAR chain; not live testnet |
| `bun run test:sandbox` after build | Existing care/trade/staking/resale loop still works | Local sandbox/mock pool; not real yield |
| `bun --no-env-file run test`; `cargo test --manifest-path contracts/Cargo.toml --workspace`; `bun --no-env-file run build` | All test/type/build gates pass | Default Rust command intentionally ignores the two separately invoked sandbox tests |
| `cargo fmt --manifest-path contracts/Cargo.toml --all -- --check`; `cargo clippy --manifest-path contracts/Cargo.toml --workspace --all-targets -- -D warnings` | Formatting and strict lint pass | Source checks |

### Authority and exact economy

New authority is the root Tidebound ledger keyed by authorized NEAR predecessor/current companion holder. `common::expedition::replay` validates at most 15 known commands against the canonical initial checkpoint and known content/rules versions. Browser and Rust agree on every intermediate state and legal-action list in 406 pinned routes. Legal replay is not proof of personhood or elapsed labor.

First lens return creates one protected craft credit, one **new** workshop salvage and one personal 12-Shell Bram allocation. `tidebound_commission` atomically consumes salvage and moves 12 from Bram to the player once; it never spends the credit. `tidebound_craft` resolves a canonical account/chapter operation and mints one player-held supply-one MT lantern. Items records the maker’s actual accepted claim and immutable mint evidence in the same receipt. A later rescue unlocks Moth without more materials or currency. Legacy salvage IDs/uses are unchanged.

`harbor_polish` costs 12 Shells once per token, preserving maker, origin, motif and token ID. Items checks the current holder and appearance revision at mutation. Lost results are queried/retried under the original operation. Cancellation returns Shells only after an authenticated items cancellation fence or consumes them on existing success; old generations cannot mutate after the fence. Standard transfer moves the original item. Recipient inventory is read from current balances, and receiving it never grants the maker’s achievement. The scene filters saved placement through current inventory.

Shared standard transfer hooks reject self-transfers across direct/batch/transfer-call paths. This fixes a reproduced pinned-library balance duplication in the new Items build. **Already-deployed legacy bytecode is unchanged.**

### Actual networks and contracts

The only live deployed tuple remains legacy NEAR testnet root `familiar-1105-28522e.testnet`, with `items.`, `bakery.` and `market.` subaccounts. [TIDEBOUND-BASELINE.json](docs/TIDEBOUND-BASELINE.json) records current read-only account/config/code hashes; original deployment and gameplay receipts remain below. These are not Tidebound mint/finish/gift receipts.

The new sandbox uses local RPC and disposable accounts named under a synthetic `.testnet` top-level account solely to exercise the testnet-only contract boundary. Names and real local transaction execution do not make it NEAR testnet. No new live contract IDs or real-device item transfers are claimed. Fresh-stack deployment must preserve old state and use separate evidence.

### Recovery/configuration gates

Privy is the current recovery/signing spike, selected after David created an app. Pinned browser SDK3.51.3 and Node SDK0.39.0 use one email route. The existing NEAR Auth integration remains available, with its shared-client HTTPS callback restriction unresolved; it is not the selected spike. Do not combine provider bindings or auto-merge by email.

`bun run dev:privy-spike` loads the ignored `.env.privy.local` (server App ID/secret and matching public Vite App ID) and serves `http://localhost:3000/privy-spike/`. The real SDK initialized and David completed private email sign-in on the Mac. **That app-login result alone proves no wallet recovery.** Explicit wallet creation succeeded, the original wallet restored, and its real raw Ed25519 signature verified on the Mac. The exported public digest/signature was independently verified locally. No funding or broadcast occurred. Two-device restoration remains an unpassed gate. `bun run test:privy-browser` verifies real SDK startup/email-form rendering without entering identity or creating a wallet. Never commit the local secret file or use a `VITE_` secret.

The server verifies Privy JWTs with the official SDK and resolves a stable per-app/user/NEAR wallet external ID. Restore never creates. Explicit setup creates a user-owned NEAR wallet with stable idempotency; an uncertain create checks that same ID. Existing noncanonical NEAR wallets stop automatic creation. Neither server signing nor key export is exposed. Client ownership and exact raw-hash signature checks are separate. Privy provider/admin powers, email security and service liveness remain trust dependencies; independent key export/exit is not advertised.

David chose `familiar-game.testnet` after confirming he does not control `familiar.testnet`. The candidate factory atomically reserves `player1.familiar-game.testnet` for a chosen username and canonical recovered key. Returning login resolves root.get_player; it does not make a fresh player or wallet. Name/key/companion collisions, unknown results and stale callbacks preserve the original reservation. The planned root is absent in the read-only candidate, so this is not a live username issuance claim.

Mac, Android and iPad are available; **0 two-device recovery checks completed**. David approved the recovery-only HTTPS publication and reported saving the same app’s allowed origin. Second-device participation is still required. The isolated spike has no game backend, NEAR private key, broadcast, funding or purchase route. Native game gas/storage/1yocto remain player-funded; no H2 sale principal route exists.

Pending native actions retain their original canonical bytes and signature. Receipt reconciliation clears the local envelope only after the original final result. An explicit expiry check can also clear that envelope after proving protocol-defined expiry and an unused nonce at the same finalized block, then refreshing canonical state. It never releases a contract reservation, refunds Shells, signs replacement bytes or remints an item. A consumed nonce with an unknown receipt remains pending.

Runtime flags default false. An exact testnet root/items protocol tuple and approved origin must be supplied before account controls activate. Backend sponsor quotas/cache are process-local and reset on restart; contract subsidies/retry caps and spendable floors remain independent. This is not a production security audit.

### Fresh deployment candidate

Read-only preflight for `familiar-game.testnet` found the root and its items/bakery/market accounts absent. The conservative review allowance is **40.12391 testNEAR**, not an executable quote or spending approval. Root Wasm:426,354 bytes, code hash `9tLpC99keMSufRQX9bXhxVjDNw5Yys68t54ezUpZr61q`. The full five-artifact candidate is stored outside Git in David’s specifications directory. No creation, deployment or funding transaction was signed. Preserve the legacy tuple and evidence; do not mix registries.

### HTTPS recovery review package

`bun run package:privy-review <existing-rendered-release-directory>` prepares a local Vercel overlay for the existing Familiar project. It preserves all98 original static files byte-for-byte, adds the recovery-only page and one private572,516-byte Node24 wallet endpoint, and refuses a static path collision. It does not release the new game UI. `bun run test:privy-review-browser <prepared-release-directory>` checks the compiled recovery page and preserved site in local Chromium; the serverless function is checked separately through actual local Node HTTP. No upload, environment mutation or publication is performed by either command.

The endpoint defaults off and accepts only the exact wallet URL, configured origin, bounded authenticated body and POST/OPTIONS. It has no game backend, NEAR key, signing/export or broadcast route. Runtime credentials were privately configured after David’s explicit approval, with App ID/secret stored as sensitive production variables; no secret value occurs in the artifact. Instance quotas are process-local. Actual cloud anonymous origin/auth/method checks and the public browser startup passed; authenticated HTTPS device recovery is still pending. [PRIVY-RECOVERY-DEPLOYMENT.json](docs/PRIVY-RECOVERY-DEPLOYMENT.json) records the actual production deployment, HTTP results and all98 preserved public file hashes. The page is [live here](https://familiar-two.vercel.app/privy-spike/). The external `VERCEL-RECOVERY-REVIEW.md` retains the reviewed action and scoped approval.

### Playtest and performance limits

Human formative study: **0/8 participants tested**, so causality, home-change, voluntary second outing and personal-choice gates are not scored. No retention, attachment, broad accessibility or revenue result is claimed. Physical Android/iPad/Mac recovery and mobile Safari behavior remain untested. Asset inventory contains 10 used raster files totalling 3,272,400 encoded bytes; Storycraft adds 0 raster bytes. See [TIDEBOUND-ASSETS.json](docs/TIDEBOUND-ASSETS.json) for hashes, dimensions, provenance and unresolved art-rights/availability limits. These byte totals exclude scripts/fonts/HTTP overhead. Local Vite startup numbers in browser logs are machine measurements, not production/device performance.

### Short demo script

0:00 — Open the local game and identify Mochi, the next wave and the lens goal. Make the five legal decisions and point to the wave opening the shell.

0:40 — Return, restore the beacon, open Workshop, preview Crest and move the same lantern from porch to dock. Show its actual-return origin and Moth’s earned condition.

1:20 — Show the second goal. State that this browser visit is a local preview.

1:40 — In a separate terminal, show the local Tidebound sandbox assertions for one credit, commission, same-token finish/gift and former-holder rejection. Label the network **local sandbox**.

2:20 — Show the Privy sign-only check and disabled game issuance, with the exact remaining wallet/device/contract gates. Do not narrate a successful live account recovery, mainnet settlement or full game release. Identify the published recovery-only page separately. After those gates really pass, replace this disclosure with the measured real-device/receipt evidence.

### Baseline-to-candidate disclosure

Task baseline: `4d8cb2e` (existing game, art, landing, Wind Gate, legacy contracts and Auth groundwork). Candidate work is on `feat/tidebound-h1`. Use `git diff --stat 4d8cb2e HEAD`, `git diff 4d8cb2e HEAD`, and `git log --oneline 4d8cb2e..HEAD` after the local commit. There is no submission commit or public repository URL yet. Earlier repository history begins November5; reused EVM/Sui lineage has not been imported. Final exact check results are recorded in PROGRESS.md.

### Gate disposition

| Plan tasks | Current result | Remaining gate |
| --- | --- | --- |
| T0 | Source, dependencies, baseline, authority and minimum cutline recorded | None for source inspection |
| T2 / T4 | Pure event/adoption rules and complete local lantern homecoming | Confirmed ownership remains separate |
| T3 | Scene-led local game and responsive browser checks | Physical-device performance/readability and human comprehension unmeasured |
| T1 / T5 / T8 | Account adapter, exact-byte signing, canonical snapshot and conflict handling implemented and locally checked | Restore the same Privy wallet on a second device; named-account live binding |
| T6 / T7 / T9 | Replay, finite ledger, idempotent mint, polish and transfer execute in the real local sandbox | Fresh compatible live testnet deployment and end-to-end receipts |
| T10 | Existing second goals preserved and machine-playable |0/8 formative study participants; voluntary continuation unmeasured |
| T11 / T12 | Cut from minimum H1; no Intents route or payment support claimed | H2 prerequisites, current route proof and explicit authorization/budget |
| T13 | Local failure/retry, export and browser checks implemented | Real-device/provider outage behavior, production capacity and recovery remain unverified |
| T14 | Reproducibility guide, honest demo, evidence and baseline diff prepared locally | Full game release, video and submission not authorized or completed; recovery-only page published with approval |

H1 remains incomplete until its live/device/human gates pass. Dynamic merchants, extra recipes/arenas/replays and P2P listing are cut. No every-chain support, dry-quote execution, cash redemption or prize claim.

## Historical legacy evidence — November5

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
| Service/client trust boundaries are checked | `bun run test` | 37 tests / 288 assertions pass | Signatures, receiver/gas/deposit/expiry policies, quotas/dedup, inner receipts, bigint prices, AI parsing, key scopes, Google proof/backup boundaries, retired-RPC and real stake-rounding regressions |
| Google recovery cannot grant an unproven key or silently replace a guest | `bun test web/src/auth.test.ts web/src/near.test.ts` | Payload/session/signature/nonce/owner/read-back/retry and storage-failure checks pass | Local fixtures only. Actual Google sign-in and funded Auth/MPC recovery not claimed; shared client's localhost:3000 callback policy checked |
| The built Google SDK loads in a real browser | `bun run test:auth-browser` | `PASS production Auth SDK` | Loads the production legacy SDK island; no OAuth, signing or funding attempted |
| Mobile and desktop interactions remain usable | `bun run test:browser` | Two viewport PASS lines; panel and recovery `*-fixture.png` captures | Explicit RPC/relayer fixtures exercise real browser signer; not chain evidence |
| Public preview is reachable | Open preview at phone and desktop widths | Town/fonts render; “Post Office resting”; adoption disabled | HTTP 200 and Chromium checks at 390×844 / 1280×800; `*-public-preview.png` |
| Frontend and Rust lint compile cleanly | `bun run build`; `cargo fmt --manifest-path contracts/Cargo.toml --all -- --check`; `cargo clippy --manifest-path contracts/Cargo.toml --workspace --all-targets -- -D warnings` | All succeed | Lazy Phaser size warning disclosed; no container reproducibility claim |
| Contracts and global pet code are deployed on testnet | Open the transactions in [TESTNET-DEPLOYMENT.json](docs/TESTNET-DEPLOYMENT.json) | All 16 finalized successfully; four code hashes match local optimized Wasm | Root configuration and quote-only NPC key read back independently through RPC |
| Real browser actions reach NEAR testnet | Open receipts in [TESTNET-GAMEPLAY.json](docs/TESTNET-GAMEPLAY.json) | Adoption, feed, forage, sleep and wake return success | Local Bun services and actual browser, no RPC fixtures; keyless pet and two flour checked |
| A real testnet pool holds the pet's nap funds | Open [stake](https://testnet.nearblocks.io/txns/DVyQfkbEfW8qj2zuFHwYgu4r1HG4YocnGyACCR1QcE8d) and [unstake](https://testnet.nearblocks.io/txns/E52wenyYDqfkKPf8wtGFgzg5PMrbrcHV4G4VJYfBxSs3) receipts | 0.01 testnet NEAR staked; release requested at epoch 5420 | Actual `kiln.pool.f863973.m0`; withdrawal and yield unverified |
| Stake verification preserves principal through share rounding | `bun test scripts/staking.test.ts`; pool snapshots in gameplay JSON | Positive stake plus the unstaked remainder cover the entire principal | Actual 2-yocto remainder accepted; even 1 yocto of missing principal rejected; one consistent `get_account` snapshot |
| Live testing fails honestly until connected | `bun run e2e:testnet` | Clear missing-public-relayer failure; no fixture fallback | Prepared, not passed live. Independently verifies hashes through RPC when configured; `--stake` / later `--withdraw` cover real epochs |

Not claimed: public backend hosting, live Google recovery, real staking rewards/withdrawal, two measured epochs, cosmetic loot, offline installation, 24-hour hosted stability, video, DAO-seat or postcard stretches. General callback-trap recovery is unfinished; see [THREAT-MODEL.md](docs/THREAT-MODEL.md). Oracle hosting access is pending.

No mainnet calls, Git pushes, public repository, social posts or submission. [PROGRESS.md](PROGRESS.md) records discrepancies and evidence in more detail.
