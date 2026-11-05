# Familiar threat model

Scope: hackathon-scale testnet prototype, hundreds of players and tens of concurrent actions. This is not a mainnet audit or a guarantee against protocol/runtime changes.

| Boundary | What it may do | Enforcement / remaining trust |
| --- | --- | --- |
| Browser | Sign the owner's commands | Guest key remains in localStorage; requests contain public keys or signed delegates. XSS or a compromised frontend can steal a guest key. Preserve browser data while Google recovery remains unverified. |
| Relayer | Pay fees and forward allowed signed commands | Ed25519/Borsh verification, live nonce/key checks, method/receiver/deposit/gas/expiry limits and quotas. It cannot forge a player signature. It can censor/delay and is trusted for liveness. |
| Registry | Authorize the current NFT owner | Predecessor-based checks, action/transfer busy locks, standard approvals and resolver. Root/market/items deployer keys remain present on testnet and their operator is trusted. |
| Pet | Spend its own funds and inventory through fixed actions | No access keys, pinned global code hash, registry-only executor, fixed pool/buildings, level/reserve/energy/mood checks. No arbitrary call or transfer method. |
| Buildings | Mint/burn/transfer game items | Registered building permissions, fixed IDs and bounded batches; atomic recipes and authenticated inventory movement. Buildings are trusted game logic. |
| Bram service | Set bounded prices | NPC predecessor plus actual quote-only function-call key; deploy script checks method/receiver/allowance before funding and reads it back. LLM output cannot contain prices or actions. |
| Pool | Hold and return testnet staking funds | One configured active pool, success-only bookkeeping and actual pool balance views. Pool correctness, validator operation, rewards and withdrawal availability remain external dependencies. |
| NEAR Auth / MPC | Additive recovery authority for the player account | Google session, canonical transaction claims and MPC signature checked before key grants. Auth0, deployed JWT guard, MPC and public RPC remain trusted. The original browser key is retained; pet accounts remain keyless. Actual live sign-in/recovery is unverified. |

## Funds and asynchronous operations

Root funds guests and one subsidized adoption per player, with daily limits, spendable-balance checks, serialized registration and reservations for future player/NFT storage. Repeated item registration refunds duplicate deposits. These are bounded subsidies, not strong anti-Sybil protection.

Pet operations serialize with ownership changes. Item recipes execute in one receipt. Market terms and reserves are fixed before item/NFT movement; failed transfer attempts preserve or restore the correct balance, and failed payouts remain claimable. Sale fees use the registry's actual pet den rather than a caller-supplied value. Incoming standard item transfers are reconciled into stock before updated quotes commit.

Market storage is bounded by its bootstrap funds, with pending-operation reservations and a 100-listing cap. NPC money, price escrow and fees cannot be counted as new operating capacity. Tests measure maximum-length identities and the 50-trade ring against the reserved byte bounds.

Callbacks are private, bounded and handle downstream failures without intentionally panicking. Minimum prepaid-gas checks reject caller-underfunded operations before locks or transfers; the sandbox checks 40-Tgas rejections. **An unforeseen callback execution failure itself can still strand a registry lock, pet pending operation, stock sync, registration, trade or payment. General operation-ID reconciliation is not implemented.** A timeout-based unlock or recredit would risk double settlement and is deliberately absent. Immutable pets have no operator rescue key. This is a material reason to keep this release on testnet.

## Service and browser limits

Rate counters and request-result caches are per process. Restarting a service resets them; multiple instances need durable quotas before production use. The contract's daily subsidies and the relayer's actual balance floor remain effective independently. CORS limits browser origins but is not an anti-bot mechanism. Guest provisioning does not provide strong identity verification.

The relayer's ordinary funding, NPC administration and root deployment keys belong only in ignored environment files or host secrets. The NPC runtime receives its scoped key, not its administrative key. The frontend receives only `VITE_` public configuration. No server logs an original key-bearing exception. Deployment `.env` creation is exclusive and mode 0600; setup refuses to overwrite it. The live judge command saves its generated guest key once in ignored `.env.e2e` before requesting funding.

Public RPC, hosting and optional NEAR AI may fail or throttle requests. UI state is retained and play pauses; a timeout is not a completed receipt. A confirmed transaction remains displayed even if the subsequent view refresh fails. The judge command independently verifies relayer outcomes through public RPC. Browser fixture captures are explicitly separated from chain evidence.

Google retention uses a player-signed, additive FullAccess key after authenticated possession proof; a failed proof cannot grant access. Recovery sponsors only a fixed testnet Auth call, then checks exact bytes, stable Google subject/key, issuer/audience/client/expiry, Ed25519 signature, fresh nonce and final owner/key read-back. Failed attempts do not switch the local identity. A previously successful AddKey with uncertain read-back can be reconciled on retry. The canonical pass changes only after its current identity is checked and backed up; a failed write retains the active pass. Neither original nor recovery keys are removed. Backup passes remain sensitive browser data. Auth/SDK browser import checks and unit fixtures do not prove the deployed OAuth/MPC service works; public default recovery stays disabled until its origin is registered and a live flow succeeds.

## Outstanding verification

Live deployment, full testnet staking rewards/unbonding/withdrawal, two measured epoch boundaries, hosted uptime through the requested dates, browser-based Google recovery, container builds and general callback-failure recovery are not verified. A hosted frontend preview is not evidence that the contracts or services are deployed. Mainnet, force-pushes, public repository visibility and submission remain outside the current authorization.
