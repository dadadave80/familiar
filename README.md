# Familiar

A cozy turn-based puzzle adventure with Mochi and a coastal harbor to restore. The introduction stays at `/`; **Play Familiar** opens the current Phaser game at `/outing/`.

Guide Mochi across tidal platforms, recover the Beacon Lens, restore the lighthouse, and explore Wind Gate for the Signal Vane. Bell Steps and Reed Steps offer supply and skiff crossings. Once the signal and both services are restored, follow Mochi to the old Bell arch, listen at low tide, and bring the discovery home to open a new routing choice.

The old town, classic three-lane game, motion lab and recovery demo are retired. Their URLs lead to Familiar. Pure historical replay and signing rules remain to verify old earned returns and preserve original pending operations. Existing browser data is never cleared or automatically merged into the current game.

## Play and develop

```sh
bun install --frozen-lockfile
bun run dev
```

Open the printed local address. No account is needed for the device preview. Arrow keys/WASD, touch on neighboring platforms and accessible direction buttons guide Mochi. Inspect is free; accepted decisions advance the tide and save before animation. Sound is opt-in. Reduced motion keeps the same outcomes.

The page fills the viewport on desktop and mobile portrait/landscape; only contained panels scroll. A connection is needed to load. Device previews and Bell/Reed discoveries remain on that browser. Signing in does not merge or replace them.

## Current implementation

| Area | Source |
| --- | --- |
| Introduction | `web/src/landing/` |
| Spatial game, companions, audio and harbor | `web/src/expedition/` |
| Shared Mochi poses and static origin actor | `web/src/motion/` |
| Recovery and current account boundary | `web/src/account/`, `web/src/expedition/harbor-session.tsx` |
| Historical return proofs and canonical item clients | `web/src/compatibility/`, `web/src/tidebound/` |
| NEAR testnet contracts and HTTP service | `contracts/`, `services/relayer/` |
| Original art masters | `web/assets/source/` |
| Optimized runtime art and provenance | `web/public/assets/` |

The stack is React/Vite/Phaser with pure TypeScript rules, Bun tooling and Rust contracts. The older dynamic NPC pricing worker is retired; Bram’s finite commission remains part of the Root contract. Original PNGs and generator-only WebPs stay outside the public delivery directory; runtime artwork uses committed optimized WebPs. The [source-art guide](web/assets/source/README.md) documents regeneration. Earlier prototype screenshots are archived outside Git and future captures are ignored.

## Verification

```sh
bun run test
cargo test --manifest-path contracts/Cargo.toml --workspace
bun run build
bun run test:routing-browser
bun run test:expedition-browser -- --quick
bun scripts/test-passage-browser.ts
```

Install the browser engines once with `bunx playwright install chromium webkit`. The routing check confirms introduction → Play → Familiar, retired URL handling, saved-run reload and preservation of old browser namespaces. Expedition and passage checks use browser emulation. They do not establish physical-phone audio, performance or human enjoyment.

The separate actual-Wasm sandbox commands are `bun run test:tidebound-sandbox` and `bun run test:sandbox`, after `bun run build:contracts`. They use disposable local accounts and a mock pool. Default Rust tests leave those integrations ignored. Completed live drivers and their journals must never be rerun to infer recovery.

## Ownership and evidence

Canonical progress uses recoverable named NEAR testnet accounts and current-holder checks. The finite H1 economy retains one protected craft credit, one workshop salvage, one personal 12-Shell commission and one optional 12-Shell finish per token. Bound Shells have no cash redemption. Transfer moves ownership without moving the maker's achievement or provenance. Unknown transaction outcomes keep the original operation; they never authorize another mint, payment, refund or unlock.

Recorded historical and current-content acceptance, contract upgrades and deployment evidence remain in `docs/`. The read-only `bun --no-env-file scripts/verify-game-evidence.ts` checks the captured signatures, exact calls and full receipt graphs without keys or a connection. Completed live mutation drivers are archived outside the repository; private recovery journals remain untouched. They are dated evidence, not instructions to repeat transactions. Superseded hosting/setup reports are recorded in the [archive index](docs/ARCHIVED-REPORTS.md). [JUDGES.md](JUDGES.md) distinguishes reproducible current checks from historical runs. [PROGRESS.md](PROGRESS.md) records the latest verified work. Full same-earned-state recovery across two physical devices and the planned human study remain unpassed.

The current source cleanup is local. The existing public site may still serve the prior deployment until a separately authorized release. Repository creation, source pushes, public visibility, mainnet actions and submissions remain separate actions.

## Release preparation

`bun run package:tidebound-review <existing-reviewed-release>` prepares a local current Familiar artifact for the existing Familiar Vercel project. It builds fresh introduction/game pages and bundles, copies current runtime art, provenance and licenses, preserves the validated H1 function boundary, and replaces retired page routes with redirects. It does not publish. Unlike the retired overlay process, it does not carry earlier game/demo pages or old hashed bundles forward.

Secrets stay in ignored local configuration or the existing encrypted hosting environment. Root/admin keys stay local. Ordinary movement and conversation need no blockchain transaction. The GitHub-to-production workflow is not configured yet.

## Credits and limits

Code is MIT licensed. Generated and reused artwork has its recorded provenance; the code license does not establish separate reference-art rights. Open-source library and font licenses are in `web/public/licenses/`. No mainnet, cash-redemption, retention or valuation result is claimed. The large Phaser bundle warning and physical-device/human validation gaps remain documented.
