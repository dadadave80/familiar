# Familiar

Familiar is a coastal puzzle adventure with Mochi and a harbor to restore. The new spatial game uses connected platforms, readable tides, a moving bridge, carried discoveries, deliberate home repairs and a distinct Wind-wheel goal. Storycraft preserves one earned lantern, Crest/Moth motifs, visible original/polished appearance, two home sockets and a truthful static origin. React/Vite/Phaser and Rust NEAR remain the stack; “Tidebound” is a proposed subtitle.

**November 13 status:** the reviewed QA correction is [published](https://familiar-two.vercel.app/outing/) from source `ae2c71c`, deployment `dpl_BRDpcWgHYwj4aR8QC15AFabmNAdn`. [Current release evidence](docs/TIDEBOUND-QA-RELEASE.json) verifies all 713 public hashes, seven HTTP guards, thirteen actual public viewport/touch profiles and phone/tablet/desktop game/email-form flows. Fifteen reproduced issues were fixed without changing the stack or finite rules. Run `bun install --frozen-lockfile`, then `bun --no-env-file run dev` and open `/outing/`. `/outing/?classic=1` preserves the earlier game and its saves; existing two-shell challenge links retain their original rules. The game document never scrolls; contained detail panels may scroll. The previous game release remains available as rollback.

The compatible [Root/Items code-only update](docs/TIDEBOUND-V2-UPGRADE.json) is FINAL on **NEAR testnet**, preserving configuration, stored-state digests, original player bindings, NFTs, keyless Mochi accounts and existing items. Root is `familiar-game.testnet`, Items is `items.familiar-game.testnet`; both support `first_light_v1` and `first_light_v2`, with finite economy `tidebound_h1_v1` unchanged. The subsequent [positive-evidence adoption recovery correction](docs/TIDEBOUND-QA-ROOT-UPGRADE.json) is also FINAL; current Root code is `66HumWXusDE79MzAbdk2Nqu6psWGUMcKxwn4uze9NzaQ`; Items code is `8wXoHBcJwoX9fUkz83uG5bmnM18hNWGJBceXx5dvGNa2`. No Pet/global-code or unrelated building update occurred.

[Original operator QA](docs/TIDEBOUND-GAMEPLAY.json) verifies 32 FINAL v1 transaction graphs: earned returns, exact commission, two-key craft convergence to supply one, once-only finish, both placements and a real transfer. [Fresh v2 operator acceptance](docs/TIDEBOUND-V2-GAMEPLAY.json) now verifies **15 additional FINAL transaction graphs** after specific bounded approval: both spatial expeditions, one protected credit/salvage/commission, actual-origin Moth craft, one 12-Shell finish, real transfer, current-holder placement and no remint after gifting. Root’s spendable decline was **0.75742 testNEAR** within the 1 cap; recipient storage used **0.00176** within 0.002. The recipient holds the one token and gains no maker achievement. The original v1 item and David’s account/Mochi/progress are unchanged. These remain operator keys, not a physical-device recovery test.

A new player chooses `username.familiar-game.testnet` once; Mochi needs no second name. [David’s original Privy-key Mac adoption](docs/TIDEBOUND-PLAYER.json) is FINAL. The same wallet/key and signing on Android are user-reported. Full recovery of the same earned item and progress on two real devices, iPad behavior, physical performance/audio and human enjoyment remain unverified. H1 acceptance is incomplete.

| Gate | Result |
| --- | --- |
| Spatial game, accessible full-screen controls, Storycraft | Implemented; thirteen Chromium/WebKit profiles, touch, lifecycle and actual public checks pass |
| Compatible testnet update and old ownership/state preservation | Complete; compatible update plus Root recovery correction, exact bytes and protected state verified |
| Original finite H1 operator acceptance | Complete for v1; 32 FINAL transaction graphs |
| Fresh v2 live acceptance | Complete; 15 independently verified FINAL receipt graphs |
| Same earned game state across two physical devices | Unpassed; Mac adoption and Android wallet report are narrower evidence |
| Human study / iPad / retention | 0/8 participants; untested; no retention claim |
| H2, mainnet, source push, public repository and submission | Not authorized or performed |

The final local checks pass: **308 Bun tests / 74,487 observed assertions**, **123 Rust executions**, build/typecheck, formatting and strict Clippy. Both actual-Wasm local sandboxes separately passed with the corrected Root; the mixed sandbox starts with the exact five deployed v1 binaries and changes only Root/Items. The assertion count is a runtime observation and can vary with asynchronous guard checks. These checks establish implementation behavior, not human fun or physical-device recovery. [JUDGES.md](JUDGES.md) contains the short demo, exact commands and evidence boundaries.

Repeatable QA: `bun --no-env-file run test:expedition-touch-browser`, `bun --no-env-file run test:expedition-lifecycle-browser`, and `bun --no-env-file run test:expedition-qa-browser <prepared-release>` (also `--webkit`; use `--public` only for an already-approved publication). Browser emulation is not physical-device evidence. Runtime art transfer fell 63%, but actual cold slow-3G readiness still measured about 83 seconds at 400ms/50,000B/s/CPU4; the loading state is visible at 2 seconds. Creation-callback loss before proven creation remains reserved; F07 covers the later registration stage. The preserved classic route should use one active tab; paused legacy delivery/selection/callback recovery needs work before broader exposure.

Secrets stay in ignored local configuration or the existing encrypted server environment. Root/admin keys stay local. Local issuance defaults off. The hosted service exposes only health, wallet lookup/explicit creation and explicit player creation. `bun run package:tidebound-review <existing-reviewed-release>` prepares a local package, preserving prior assets/chunks and replacing only the two approved HTML entries; it does not publish. Never rerun the completed live drivers or reset their private journals. NEAR Auth and the separate legacy registry remain preserved.

Familiar: First Light is a turn-based adventure with Mochi and a harbor to restore. The public homepage introduces the game and opens `/outing/` through **Play Familiar**. The original NEAR testnet pet game is available at `/legacy/`; its inventory and savings stay with its keyless pet account when ownership changes.

The [First Light design book](https://familiar-two.vercel.app/plan/) is the public review edition of the proposed adventure. It includes all fourteen chapters, illustrations and supporting data. The [motion preview](https://familiar-two.vercel.app/motion) plays nine implemented sequences. Both open without an account.

[Play Familiar](https://familiar-two.vercel.app/outing/) without signing in. Use **arrow keys/WASD**, tap a glowing neighboring platform, or use the accessible direction buttons. Contextual controls retrieve a find, use a tool, turn the wheel or return at the dock. Each accepted decision advances the tide and is saved before animation. Reload resumes that device’s accepted expedition. A connection is needed to load; physical installation/offline behavior of the redesign remains untested.

For local development, run `bun run dev`. **Play Familiar** opens `/outing/`. Restore the beacon, then choose **Wind Gate**: charge Left and Center, align the wheel at the upper-center platform, recover the Signal Vane and repair the harbor’s signal post. The Lantern redirects a locked source; turning the wheel changes its exit. Both courts share the pure rules engine. Earlier three-lane saves remain in `/outing/?classic=1`; the new preview and confirmed saved harbor stay separate and are never auto-merged.

Wind Gate and the landing page are included in the approved H1 release. Use `bun run test:expedition-browser` for the spatial game and `bun run test:outing-browser` for preserved classic regressions. The eight-person human playtest remains pending.

To reproduce the review deployment, pass the external public edition's `plan` directory to `bun --no-env-file scripts/package-review.ts <plan-directory>`. The command builds the frontend and prints a temporary Vercel deployment directory containing the static files and routes. The editable plans and public edition live outside Git.

Preview: [familiar-two.vercel.app](https://familiar-two.vercel.app). The homepage opens the full-screen game at `/outing/`. The original pet game at /legacy/ pauses play while public backend hosting is pending. Contracts are deployed on NEAR testnet and the local Bun services have passed real-chain readiness and browser checks. The complete contract loop also runs locally with no supplied secrets. See [PROGRESS.md](PROGRESS.md) for live versus local evidence.

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

For an authorized, funded fresh deployment, review `bun --env-file=.env.tidebound scripts/deploy.ts --tidebound --check` first. The default legacy environment is deliberately rejected. `bun run e2e:testnet` uses a public Post Office and independently verifies its transaction hashes through testnet RPC. It fails if no live endpoint is configured. `bun run e2e:testnet -- --stake` also stakes and unstakes; resume withdrawal after real epochs with `bun --env-file=.env.e2e scripts/e2e.ts --withdraw`. The ignored `.env.e2e` keeps that judge's generated guest pass, never an operator key.

Backend hosts receive only the relayer key or Bram's quote-only key. Keep root/admin keys local. Monitor testnet operating funds: the relayer stops below its 0.2 NEAR liquid floor; Bram needs gas balance and remaining function-key allowance. Refill or renew locally when needed. Initial deployment funding does not establish hosted uptime.

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

## Historical legacy scope

The following describes the November 5 pet prototype and its separate remaining work. It does not replace the current Tidebound evidence and gates above.

**Built and locally checked:** keyless adoption; current-owner authorization; care, energy/mood/streak/level rules; three forage locations; bread; NEP-245 inventory; pool stake/unstake/withdraw interface; NPC trading; 2% den fees; Monday UTC weekly den scores with cumulative treasury accounting preserved; fixed-price NFT resale; signed-delegate relayer; bounded Bram pricing with optional AI reasoning and scripted fallback; responsive town, panels, receipts, X-ray and offline pause; deployment and judge scripts.

**Stubbed only in explicit test harnesses:** the controllable sandbox staking pool and browser fixtures. Production paths do not use them.

**Checked on real testnet:** four deployed contract code hashes, immutable global pet code, scoped Bram key, initial market funding and all 16 deployment transactions. A real browser through the local relayer adopted a keyless pet, fed it, collected flour, staked 0.01 testnet NEAR with `kiln.pool.f863973.m0` and requested unstaking. Returned receipts were independently checked through RPC. Deployment records are in [TESTNET-DEPLOYMENT.json](docs/TESTNET-DEPLOYMENT.json); gameplay receipts are in [TESTNET-GAMEPLAY.json](docs/TESTNET-GAMEPLAY.json). These checks do not establish public service uptime.

**Implemented with local checks, awaiting live verification:** Google retention/recovery client. Tests verify authenticated canonical signing requests, MPC signatures before key grants, nonces, ownership, retry and backup behavior. Actual SDK imports work in development and production browsers. No successful user OAuth session or real Auth/MPC recovery transaction is claimed.

**Not completed:** legacy relayer/NPC public hosting, real pool reward/epoch/withdrawal evidence, live Google verification, cosmetic loot distribution, installable offline PWA caching, reproducible Docker Wasm builds, 24-hour hosted stability and a video. The manifest is present. Both DAO-seat and postcard stretches remain gated and unbuilt. David separately approved the H1 testnet stack and narrow account API publication. Root/admin keys remain local; only the isolated relayer key and existing Privy credentials are configured on the private server. The legacy `/legacy/` route serves the earlier pet interface, with play paused while public backends are unavailable; the public Beacon outing is playable.

Registry `familiar-1105-28522e.testnet` was [deployed and initialized](https://testnet.nearblocks.io/txns/FgUDFutmCPn1d2tBpSwx4to6szVD5T4vvXJJX38aehSm) on Nov 5. The selected pool was active and non-slashed at deployment; real stake/unstake succeeded. The smoke pet's release epoch is 5420. Withdrawal and two measured epoch boundaries remain outstanding. The retired `rpc.testnet.near.org` endpoint began returning deprecation errors after deployment; defaults now use the [officially listed public FastNear testnet RPC](https://docs.near.org/api/rpc/providers), `https://test.rpc.fastnear.com`.

Testnet NEAR is play money. Mainnet use requires a separate security and economic review; it is not enabled by a config switch.

The legacy APIs retain their callback limitations. New Tidebound craft/finish operations additionally have immutable item evidence, canonical retry and an authoritative polish cancellation fence; no timeout releases resources. An unforeseen trap can still strand a legacy operation; general legacy reconciliation is not implemented. Keep this prototype on testnet. See the [threat model](docs/THREAT-MODEL.md).

## Disclosures

New NEAR implementation during the hackathon window. David's prior EVM/Sui ticketing work is lineage only; no prior-chain code has been imported into this workspace. AI coding assistance: Codex. No second project has been declared in this session.

Libraries: near-sdk/near-contract-standards 5.30.0, near-sdk-contract-tools 4.0.0 (Apache-2.0 option), near-workspaces 0.24.0, near-api-js 7.4.0, Borsh 2.0.0, React 19.3.1, Phaser 3.90.0, Hono 4.13.16 and Vite 8.3.6. Optional Privy uses @privy-io/react-auth3.51.3 and @privy-io/node0.39.0. Optional Google uses @fast-auth-near/browser-sdk 1.4.2 and javascript-provider 1.4.1 (ISC declared in package metadata), isolated near-api-js 5.1.1 and Buffer 6.0.3. Bun manages packages, tests, services and Vite. The official `cargo near new` template was used; production Wasm uses `--cfg near` and explicit Binaryen lowering because the installed cargo-near optimizer failed on Rust 1.99 bulk-memory instructions. Byte-reproducible container builds are not claimed.

Art: [Kenney Tiny Town 1.1](https://kenney.nl/assets/tiny-town), CC0; downloaded from the author's OpenGameArt mirror after Kenney's download returned 403. The included license ships with the assets. Procedural pet art is original. Fraunces, Figtree and IBM Plex Mono are self-hosted, SIL OFL 1.1; library/font notices are in `web/public/licenses/`.

NEAR Auth's shared testnet client accepts `http://localhost:3000`; the checked 5173/5178 origins fail its callback policy. `bun run dev:auth` opens that supported local address. The relayer must allow it in `WEB_ORIGINS`, as in `.env.example`, and a funded deployment is required for real play. Public Google remains disabled by default. A separately registered public client can be supplied as `VITE_NEAR_AUTH_CLIENT_ID`; its provider must allow the exact callback/web origin. SDK 5 and SDK 7 exchange canonical serialized bytes only, checked by tests. Linking proves the Google-derived key before adding it to the player; pet accounts remain keyless. Recovery finds the pet by short name and backs up this browser's previous pass under `familiar.guest.backup.v1:<root>:<accountId>` before changing the active player. No existing key is deleted; keep browser data until live recovery is verified.

The optional NEAR AI base URL is `https://cloud-api.near.ai/v1`; no model or API key is invented, and the shipped default is scripted.

For NEAR AI credentials, complete a profile at [NEAR Builders](https://nearbuilders.org/join) and claim the $10 offer advertised in the [hackathon rules](https://nearhackathon.com/HACKATHON.md). Generate a key in the [NEAR AI Cloud dashboard](https://cloud.near.ai/) under API Keys. Put it directly in ignored `.env` as `NEAR_AI_API_KEY`, with the exact available model ID in `NEAR_AI_MODEL`; neither value belongs in a `VITE_` setting. [Official setup steps](https://docs.near.ai/cloud/quickstart).

## Tracks

Intended: **games** (player-signed errands, Bram trading, inventory, crafting and den fees in the complete sandbox loop) and **nfts** (a transferable, keyless account with its own inventory and savings). Final tracks remain David's submission decision. Agents and social are not claimed.

## Project documents

- [Evidence](PROGRESS.md)
- [Judge checks](JUDGES.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Threat model](docs/THREAT-MODEL.md)
- [MIT license](LICENSE)
