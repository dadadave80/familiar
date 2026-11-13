# Familiar

A cozy turn-based Phaser puzzle adventure with Mochi and a coastal harbor to restore. The introduction at `/` leads to `/outing/`. Recover the Beacon Lens, route the tide through Wind Gate, help at Bell/Reed Steps, and follow Mochi's later shore-bell discovery.

## Run

```sh
bun install --frozen-lockfile
make dev
```

No account is needed for the device preview. Use neighboring-platform taps, WASD/arrows or accessible buttons. Inspect is free. Sound is opt-in; reduced motion keeps the same outcomes. Device saves stay on that browser and never silently merge into a signed-in harbor.

## Commands

| Command | Purpose |
| --- | --- |
| `make test` | Bun and Rust unit tests |
| `make typecheck` | TypeScript check |
| `make build` | TypeScript check and Vite build |
| `make check` | Tests and build |
| `make browser` | Chromium/WebKit route and save checks |
| `make evidence` | Offline recorded signature/receipt checks |
| `make judge` | Live, read-only testnet checks of the claims below; public RPC, no keys |
| `make break` | Contract and signer refusals: doctored court, Shells twice, out-of-scope signing |

Make is a shortcut layer; the underlying `bun run` commands still work. Browser checks require `bunx playwright install chromium webkit`. Full outing checks use `bun scripts/test-expedition-browser.ts --only=390` and `bun scripts/test-passage-browser.ts`. Real-Wasm sandbox checks require `bun run build:contracts`, then `bun run test:tidebound-sandbox` or `bun run test:sandbox`; default Rust tests leave these integrations ignored.

## NEAR in Familiar

Live stack: root `familiar-game.testnet`, items `items.familiar-game.testnet`. `make judge` reads every line below from public RPC.

| Claim | What is true on testnet | Check | Limit |
| --- | --- | --- | --- |
| Mochi is a real account | Each pet is a sub-account with no access keys, running global code pinned by hash (`get_config.pet_code_hash`); its NFT papers on the root name the owner | `make judge` | Root and Items still have admin keys, so the whole stack is not immutable |
| The court is refereed | `tidebound_claim` replays the submitted steps and accepts only a court that brings Mochi home; 12 Shells are granted once per account | `make judge`, `make break` | Replay proves the steps are legal, not that a person played them; one pet passed between accounts can earn each its own Shells |
| Your key | Your account key is held by your Privy wallet; Familiar's signer prepares only named harbor actions | `make judge` lists the key; `make break` runs the signer refusals | The key is full-access; the method limit is enforced by the signer, not by the chain |

## Source

- `web/src/expedition/`: rules, Phaser presentation, Mochi, sound and harbor.
- `web/src/account/`, `web/src/tidebound/`: recoverable identity, original transactions and item provenance.
- `web/src/compatibility/`: frozen historical return validation.
- `contracts/`, `services/relayer/`: Rust testnet contracts and account HTTP service.
- `web/assets/source/`: art masters and generator inputs; [regeneration guide](web/assets/source/README.md).

The stack remains React/Vite/Phaser, Bun/TypeScript and Rust. The finite H1 economy preserves one protected craft credit, one salvage, one personal 12-Shell commission and one optional 12-Shell finish per token. Bound Shells have no cash redemption. Transfer does not transfer maker achievement; unknown outcomes preserve the original request.

## Status and evidence

[JUDGES.md](JUDGES.md) lists current reproducible claims. [PROGRESS.md](PROGRESS.md) records the latest verified changes. [Architecture](docs/ARCHITECTURE.md), [threat model](docs/THREAT-MODEL.md) and [archived reports](docs/ARCHIVED-REPORTS.md) explain the boundaries. Only two report JSONs remain: recorded gameplay evidence for regressions and original deployment evidence for isolation guards.

The GitHub workflow checks PRs to `main` and pushes to `main`. Merge through a PR after the required “Tests, build and evidence” check passes; protected `main` rejects direct and force pushes. Vercel’s Git integration builds production from `main`; PR branches get a device-only preview without account functions. Production builds reuse the existing encrypted account-service environment. `bun run build:release` writes a Build Output API artifact: production includes the Node 24 account endpoints; other environments build a device-only preview. It never signs or sends a game transaction. `bun run package:tidebound-review <existing-reviewed-release>` prepares a local artifact without publishing. Credentials and recovery journals stay in ignored private configuration; ordinary exploration requires no blockchain transaction.

Code is MIT licensed; artwork provenance and dependency/font licenses remain with their assets. The existing large Phaser bundle warning persists. Physical-phone audio/performance, full earned-state recovery across two physical devices and independent human enjoyment remain unverified.
