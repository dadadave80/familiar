# Familiar

Familiar is a harbor-town pet game for NEAR testnet. Each pet is a keyless named account represented by an NFT; its inventory and savings stay with the account when ownership changes.

Preview: [familiar-two.vercel.app](https://familiar-two.vercel.app). The static frontend is public; play is paused because live contracts and services are not deployed. The complete contract loop runs locally with no supplied secrets; the responsive interface also runs at `http://127.0.0.1:5173` after `bun run dev`. See [PROGRESS.md](PROGRESS.md) for live versus local evidence.

## The problem

Many people will never open a crypto wallet.
Games should teach their mechanics through play rather than token speculation.
A pet that is an account can make ownership, sponsored transactions, and savings tangible.

## Try it in two minutes

Prerequisites: Bun 1.4.4, Rust 1.95 or newer, the `wasm32-unknown-unknown` target, and Binaryen 133 (`wasm-opt`). The first dependency download and contract build take additional time. The local sandbox run itself took about 107 seconds on the development machine.

For browser checks, install Chromium once with `bunx playwright install chromium` after `bun install --frozen-lockfile`.

1. Run `bash scripts/demo.sh` → contracts build and a real local NEAR sandbox starts with disposable development accounts. No wallet, `.env`, or private key is supplied by the judge.
2. Read `PASS keyless global pet adoption` → a player-signed delegate adopted a pet whose immutable global code hash matches the built Wasm and whose access-key list is empty.
3. Read the care, crafting, NPC, den and staking checks → flour and water became bread; Bram bought and sold it; a restricted key failed at `npc_deposit`; local epochs advanced through withdrawal.
4. Read the resale check → a second player owns the same pet account, with the same inventory and savings; the previous owner's call failed with `ERR_NOT_OWNER`.
5. Run `bun run test:browser` → labelled UI fixtures exercise the actual signing client, every panel, receipts, returning-player entry, offline pause, reduced motion and 44px buttons at 390×844 and 1280×800. Screenshots land in `web/screenshots/`. Fixture hashes are not chain evidence.

To inspect the interface, run `bun install --frozen-lockfile`, then `bun run relayer` and `bun run dev` in separate terminals. Unconfigured or unavailable chain services pause play. No simulated transaction is substituted.

For a funded deployment, run `bun run deploy:testnet -- --check` first. `bun run e2e:testnet` uses a public Post Office and independently verifies its transaction hashes through testnet RPC. It fails if no live endpoint is configured. `bun run e2e:testnet -- --stake` also stakes and unstakes; resume withdrawal after real epochs with `bun --env-file=.env.e2e scripts/e2e.ts --withdraw`. The ignored `.env.e2e` keeps that judge's generated guest pass, never an operator key.

## How NEAR is used

| Feature | Mechanic | File | Command |
| --- | --- | --- | --- |
| Named subaccounts and immutable global code | One keyless account per pet | `contracts/root/src/lib.rs` | `bun run test:sandbox` |
| NEP-171/approval/enumeration | The registry's current NFT owner may guide the pet | `contracts/root/src/lib.rs` | `bun run test:sandbox` |
| Signed delegate actions | Browser signs; Post Office pays the execution fee | `web/src/near.ts`, `services/relayer/src/` | `bun run test`; `bun run test:sandbox` |
| NEP-245/145 | Inventory stays in the pet's account | `contracts/items/src/lib.rs` | `bun run test:sandbox` |
| Cross-contract calls | Atomic inventory recipes and recoverable market payouts | `contracts/bakery/`, `contracts/market/` | `bun run test:contracts` |
| Staking pool interface | The pet stakes its own savings | `contracts/pet/src/lib.rs` | `bun run test:sandbox` uses the mock pool; live check is separate |
| Function-call key | Bram's key calls only `set_quotes` | `services/npc/`, `scripts/deploy.ts` | `bun run test:sandbox` tests protocol-level rejection |
| NEP-297 events | Receipts and bounded recent history | `contracts/common/src/lib.rs`, `web/src/receipts.ts` | `bun run test`; `bun run test:sandbox` |

Run the full local checks with `bun run test`, `bun run test:contracts`, `bun run test:browser`, `bun run test:auth-browser`, and `bun run test:sandbox` after `bun run build:contracts`. The Auth browser check builds the frontend and loads its actual SDK bundle without signing in or sending funds. Rust formatting and Clippy are also checked.

## Honest scope

**Built and locally checked:** keyless adoption; current-owner authorization; care, energy/mood/streak/level rules; three forage locations; bread; NEP-245 inventory; pool stake/unstake/withdraw interface; NPC trading; 2% den fees; Monday UTC weekly den scores with cumulative treasury accounting preserved; fixed-price NFT resale; signed-delegate relayer; bounded Bram pricing with optional AI reasoning and scripted fallback; responsive town, panels, receipts, X-ray and offline pause; deployment and judge scripts.

**Stubbed only in explicit test harnesses:** the controllable sandbox staking pool and browser fixtures. Production paths do not use them.

**Implemented with local checks, awaiting live verification:** Google retention/recovery client. Tests verify authenticated canonical signing requests, MPC signatures before key grants, nonces, ownership, retry and backup behavior. Actual SDK imports work in development and production browsers. No successful user OAuth session or real Auth/MPC recovery transaction is claimed.

**Not completed:** live contract deployment and public services, real pool reward/epoch/withdrawal evidence, live Google verification, cosmetic loot distribution, installable offline PWA caching, reproducible Docker Wasm builds, 24-hour hosted stability and a video. The manifest is present. Both DAO-seat and postcard stretches remain gated and unbuilt. David approved only the compiled static preview; Rust and service source were not uploaded. The published preview is the earlier frozen build before weekly scores and Google client integration, with play paused.

Live testnet account creation is verified; that is not a deployed-game claim. The selected pool `kiln.pool.f863973.m0` was an active, non-slashed testnet validator and answered the balance interface on Nov 5. Two measured epoch boundaries remain outstanding.

Testnet NEAR is play money. Mainnet use requires a separate security and economic review; it is not enabled by a config switch.

All callbacks handle downstream failures and operations reserve storage before dispatch. An unforeseen callback execution trap or out-of-gas failure can still strand an operation; general operation reconciliation is not implemented. Keep this prototype on testnet. See the [threat model](docs/THREAT-MODEL.md).

## Disclosures

New NEAR implementation during the hackathon window. David's prior EVM/Sui ticketing work is lineage only; no prior-chain code has been imported into this workspace. AI coding assistance: Codex. No second project has been declared in this session.

Libraries: near-sdk/near-contract-standards 5.30.0, near-sdk-contract-tools 4.0.0 (Apache-2.0 option), near-workspaces 0.24.0, near-api-js 7.4.0, Borsh 2.0.0, React 19.3.1, Phaser 3.90.0, Hono 4.13.16 and Vite 8.3.6. Optional Google uses @fast-auth-near/browser-sdk 1.4.2 and javascript-provider 1.4.1 (ISC declared in package metadata), isolated near-api-js 5.1.1 and Buffer 6.0.3. Bun manages packages, tests, services and Vite. The official `cargo near new` template was used; production Wasm uses `--cfg near` and explicit Binaryen lowering because the installed cargo-near optimizer failed on Rust 1.99 bulk-memory instructions. Byte-reproducible container builds are not claimed.

Art: [Kenney Tiny Town 1.1](https://kenney.nl/assets/tiny-town), CC0; downloaded from the author's OpenGameArt mirror after Kenney's download returned 403. The included license ships with the assets. Procedural pet art is original. Fraunces, Figtree and IBM Plex Mono are self-hosted, SIL OFL 1.1; library/font notices are in `web/public/licenses/`.

NEAR Auth's shared testnet client accepts `http://localhost:3000`; the checked 5173/5178 origins fail its callback policy. `bun run dev:auth` opens that supported local address. The relayer must allow it in `WEB_ORIGINS`, as in `.env.example`, and a funded deployment is required for real play. Public Google remains disabled by default. A separately registered public client can be supplied as `VITE_NEAR_AUTH_CLIENT_ID`; its provider must allow the exact callback/web origin. SDK 5 and SDK 7 exchange canonical serialized bytes only, checked by tests. Linking proves the Google-derived key before adding it to the player; pet accounts remain keyless. Recovery finds the pet by short name and backs up this browser's previous pass under `familiar.guest.backup.v1:<root>:<accountId>` before changing the active player. No existing key is deleted; keep browser data until live recovery is verified.

The optional NEAR AI base URL is `https://cloud-api.near.ai/v1`; no model or API key is invented, and the shipped default is scripted.

## Tracks

Intended: **games** (player-signed errands, Bram trading, inventory, crafting and den fees in the complete sandbox loop) and **nfts** (a transferable, keyless account with its own inventory and savings). Final tracks remain David's submission decision. Agents and social are not claimed.

## Project documents

- [Evidence](PROGRESS.md)
- [Judge checks](JUDGES.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Threat model](docs/THREAT-MODEL.md)
- [MIT license](LICENSE)
