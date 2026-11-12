# Familiar

[Play Familiar](https://familiar-two.vercel.app/outing/): a full-screen coastal puzzle adventure with Mochi, Beacon Court, Wind Gate and Storycraft. The full H1 UI and isolated NEAR testnet stack `familiar-game.testnet` are public with David’s approval. **H1 is not complete:** restoration of the same player, Mochi, items and progress on two real devices, and the human playtest, remain unpassed. “Tidebound” remains a proposed subtitle.

[Recorded operator QA](docs/TIDEBOUND-GAMEPLAY.json) now verifies **32 FINAL transaction graphs**: accepted lens/moth/vane returns, the finite commission, two-key craft convergence to supply one, once-only finish, both home placements and one real item transfer. The maker’s balance is 0 and recipient’s is 1 at the recorded final snapshot; the recipient earned its own later achievement separately. These were operator-controlled testnet accounts, not Privy or physical-device recovery tests. [Initial deployment](docs/TIDEBOUND-DEPLOYMENT.json) passed 16 transactions / 50 independent checks. [The code-only Root correction](docs/TIDEBOUND-NATIVE-GAS-UPGRADE.json) records current hash `3eeoimzgrF1M9amhaRHs9jpSrPuSw1QYJFhoPAsFLyH3`, unchanged stored state and unchanged other contracts.

A player chooses a username once: `username.familiar-game.testnet`. **Adopt Mochi** uses a stable internal identifier automatically; existing companion IDs and pending requests are preserved. Privy email login, original-wallet restoration and verified signing were observed on the Mac. David reported the same wallet/key and signing on Android/Chrome. [The player evidence](docs/TIDEBOUND-PLAYER.json) now confirms a FINAL Mac adoption by `dadadave80.familiar-game.testnet` with the original Privy key: one owned keyless Mochi, the expected global code, and no duplicate player. The earlier refresh rejection is resolved for that action. Its journey is still unclaimed and item inventory empty; iPad and full two-device game recovery remain untested.

The [current production release](docs/TIDEBOUND-SESSION-RELEASE.json) is `dpl_DhyHF4kWbbeKgzqRsF4Q9Hma7MnE`: all 665 public file hashes and seven HTTP checks passed; its compiled game/SDK passed phone, tablet and desktop checks. Protocol 88’s gas purchase floor requires about 0.18 test NEAR plus fees/storage for adoption, so new named players now receive 0.25. The client checks actual prepayment before signing; this endowment does not fund unlimited play. Gift storage is a separate, explicitly reviewed recipient-owned credit deposit, followed by a separate gift confirmation. **Complete two-device game recovery remains unpassed.**

| Gate | Current result |
| --- | --- |
| Full-screen UI, compatible testnet stack and finite H1 operator loop | Complete for the implemented/operator-tested scope |
| Recoverable wallet | Mac observed; matching Android wallet/signing user-reported |
| First authenticated Mac adoption | Complete; FINAL receipt and original-key ownership verified |
| Full player/Mochi/items/progress recovery | Unpassed; same-game-state two-device comparison remains |
| Human study and iPad | 0/8 human participants; iPad untested |
| H2, mainnet, source push and submission | Not authorized or performed |

Use `bun install --frozen-lockfile`, then `bun --no-env-file run dev` and open `/outing/` for local play. The art fills the viewport, with coastal navigation/actions over the world. The game page stays fixed; contained account/detail panels may scroll. Workshop previews remain local and non-transferable until separate canonical claim/craft confirmation. See [JUDGES.md](JUDGES.md) for exact reproducibility commands, the short demo, live receipt links and complete/blocked gates.

Source checkpoint `7d0db98` passed 230 Bun tests / 60,975 assertions, 101 Rust tests, typecheck/build, formatting and strict Clippy; both local sandbox integrations separately passed. Public browser evidence covers phone/tablet/desktop layout and empty email-form startup, with wallet/player API mutations blocked. Those checks do not establish physical-device performance or human understanding.

The separate ignored `.env.tidebound` preserves the legacy configuration; `.env.privy.local` keeps Privy secrets server-side. Local issuance flags default off. The hosted H1 service exposes only health, wallet lookup/explicit creation and explicit player creation; root/admin keys stay local. `bun run package:tidebound-review <existing-reviewed-release>` builds a local review package, preserves prior assets/chunks except the two approved HTML entries, and performs no upload or deployment. `bun run test:privy-review-browser <prepared-H1-release> --h1` checks compiled UI without entering identity. Deployment/funding are separate approved actions, not implied by these commands. NEAR Auth and the original legacy tuple remain preserved.

Familiar: First Light is a turn-based adventure with Mochi and a harbor to restore. The public homepage introduces the game and opens `/outing/` through **Play Familiar**. The original NEAR testnet pet game is available at `/legacy/`; its inventory and savings stay with its keyless pet account when ownership changes.

The [First Light design book](https://familiar-two.vercel.app/plan/) is the public review edition of the proposed adventure. It includes all fourteen chapters, illustrations and supporting data. The [motion preview](https://familiar-two.vercel.app/motion) plays nine implemented sequences. Both open without an account.

[Play Familiar](https://familiar-two.vercel.app/outing/) without signing in. Press **←** or **→** on desktop, or swipe horizontally on the scene on a phone. Each legal move advances one turn. Tap a lane to inspect it for free. The movement buttons work with either input. An ordinary reload resumes the outing in the same browser. Installing the outing from its page launches it in a standalone window. It needs a connection to load.

For local development, run `bun run dev`. The homepage introduces Mochi and the adventure, with **Play Familiar** opening `/outing/`. Restore the lighthouse, prepare another outing, and choose **Wind Gate**. Trace each source to its exit, charge the Left and Center sockets, recover the Signal Vane, then return and deliberately repair the harbor's signal post. The Lantern changes the source. Turning the vane at Center changes the routing before that action's wave. Both outings share the same rules engine and device save. Existing Beacon saves are read and upgraded on the next write.

Wind Gate and the landing page are included in the approved H1 release. Use `bun run test:outing-browser` for the local browser suite, which covers both outings, landing-to-game navigation, touch/keyboard inputs, reloads, and failed-save recovery. The eight-person human playtest remains pending.

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
