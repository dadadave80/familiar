# Familiar threat model

Current source scope, November 13, 2026: browser game and supporting NEAR testnet identity, ownership and finite H1 progression. This is an implementation threat model, not a mainnet audit, load test or guarantee of service availability. Current reproducible checks are in [JUDGES.md](../JUDGES.md); dated live evidence is preserved in [archived reports](ARCHIVED-REPORTS.md).

| Boundary | Authority and protection | Remaining trust or limitation |
| --- | --- | --- |
| Browser presentation | Pure replay rules, accessible DOM actions, saved turn before animation | Compromised frontend can mislead a player; device-only saves are not ledger achievements |
| Account provider | App-scoped Privy identity and exact canonical user-owned NEAR wallet; separately configured NEAR Auth provider | Email/provider administration, session availability and SDK integrity remain dependencies |
| Account HTTP | Three exact H1 endpoints, origin/JWT/body/size/method checks, bounded setup | Process-local quotas are not durable anti-Sybil or cross-instance spending controls |
| Native transaction client | Exact canonical Borsh/signature/intent checks, durable original envelope, Web Locks, complete receipt graph | RPC outages or ambiguous consumed nonces may keep an action pending |
| Root registry/journey | Predecessor authorization, current companion ownership, checkpoint replay, accepted original input hashes | Administrative upgrade keys remain; source tests do not freeze deployed code. Court replay proves legal steps, not human play, and winning inputs are public; the commission is per account, so one pet passed between accounts can earn each account its own 12 Shells |
| Items | Current-holder checks, authenticated immutable mint evidence, one finish per token | Transferred ownership is distinct from maker achievement; stale UI alone is never ownership proof |
| Keyless Pet | Registry-only execution, fixed buildings/pool, pinned global code and no access keys | General recovery for unforeseen historical callback failure is not available |

## Identity and data

Login/restore never creates another wallet, provisions a player, adopts a companion or merges device progress. Setup requires an explicit reviewed action. Privy validation checks the configured app, canonical external wallet ID, current linked ownership, NEAR signing permission and returned Ed25519 signature. Unexpected existing wallets stop setup rather than selecting the first wallet. Original idempotent setup requests survive uncertainty. The NEAR Auth path verifies stable issuer/subject/key and configured origin; retained SDK availability is not evidence of successful current OAuth/MPC service operation.

Server credentials stay in ignored private environment files or encrypted hosting configuration. The frontend receives public VITE configuration only. Current native pending envelopes contain signed transaction material and public account/game data, not private keys or JWTs by design. Earlier guest-key browser namespaces may contain sensitive secrets; cleanup must not reinterpret, clear or export them. Downloaded return memories exclude credentials and signed requests. Public evidence should include only the proof required for the claim, not identity tokens, private journals or raw private keys.

## Uncertain outcomes and recoverable progress

Each prepared request retains its original operation, canonical bytes, hash, signature and context. A timeout, rejected browser write, stale snapshot, unknown receipt or consumed nonce never authorizes a replacement mint, payment, refund or unlock. Account/session changes fence late results. A single transaction hash or FINAL label is insufficient: receipt children must exist, be connected, have known terminal statuses and agree with the outer result.

Only proven permanent expiry with an unused nonce can clear a local envelope. That is not contract cancellation. Accepted return hashes reconcile before checkpoint conflict or another payment. Frozen old content/rules IDs, browser keys, entitlement IDs and provenance hashing domains remain exact. Mixed historical/current returns must remain readable. Device previews and side discoveries stay separate from ledger progress.

Craft and finish reserve before dispatch. Positive authenticated evidence finalizes; missing, malformed or failed callbacks retain the original recoverable reservation. Original-operation retries are idempotent. Finish cancellation must prove prior success or fence the old holder/token/appearance before any Shell refund. Late calls cannot mutate a new generation. A transferred item cannot grant its recipient the maker's achievements or allow its maker to remint.

The finite economy preserves one protected craft credit, one new salvage, one personal 12-Shell commission and one optional 12-Shell finish per token. The commission cannot consume the protected credit. No time-online rewards, dynamic merchant replacement or cash redemption is introduced by cleanup.

## Contract and infrastructure limits

Root adoption serializes account creation/registration and reserves future obligations. Positive configured-Items evidence can settle a lost registration callback only after proven account creation. Unknown evidence never authorizes a second registration payment. Authorization uses predecessor rather than transaction signer; callbacks remain private and bounded.

Historical Pet/building/market operations still have their original serialization and reserve rules. Bakery/Market/pool sources remain for initialization and compatible upgrade reproduction, not as current outings. Market terms and storage reservations precede movement; failed payouts remain claimable. The current Items transfer hook rejects self-transfers. Older deployed bytecode must be assessed by its recorded hash, not assumed to gain current fixes.

An unforeseen historical callback execution failure can still strand a pending operation, lock, trade or payment. There is no general timeout unlock or operator rescue key for immutable Pets. Keeping those limits explicit is essential; the narrower H1 reconciliation does not solve every historical operation.

The dynamic NPC quote worker and optional AI reasoning have been retired from current source. Existing NPC account/key variables required by isolated contract deployment are not permission to run a quote worker. The local Bun relayer's older protocol support is distinct from the current exact-path H1 HTTP entry. CORS is a browser boundary, not bot protection. Process caches/quotas reset on restart and need durable accounting before multi-instance operation can be treated as a global limit.

## Delivery and verification limits

Public RPC, hosting and account providers can fail or throttle. Ordinary local exploration should remain responsive after loading; canonical actions retain the last known state and original request on read failures. Offline cold start and cross-device synchronization are not guaranteed by device saves.

Contract unit tests, synthetic provider tests, offline recorded signature/receipt checks and browser emulation cover specific boundaries. The default Rust command intentionally ignores two real-Wasm integrations; those have separate commands. Physical-phone sound/performance, full same-earned-state recovery across two physical devices, independent human enjoyment, current Google OAuth and production security/load validation remain unpassed or unmeasured. Earlier live Privy adoption/operator evidence is narrower and dated. No mainnet readiness is claimed.
