# Familiar

![Familiar: a little adventure with Mochi. A felt-miniature harbor at sunset: Mochi, an orange kitten in a red bandana, leaps between spiral stepping stones past a teal wave and a glowing wind-moth, while the stone-crab Tidekeeper watches and Bram the badger waves from the quay below the lighthouse.](docs/readme-banner.jpg)

A cozy turn-based Phaser puzzle adventure: guide Mochi as a volunteer harbor helper and restore the light. The introduction at `/` leads to `/outing/`. Three device story chapters recover the Beacon Lens, Signal Vane and wind-moth. Chapter 1 has eight calm waves; the later chapters have twelve. Each step or wait spends one move; a wave lands after every third move. Mochi collects finds by stepping onto them and banks cargo on arrival at the center dock.

The harbor prioritizes an open outing or unfinished filing, then a recovered repair, then the next story chapter. Once the beacon is lit, **Today’s tide · optional** opens daily preparation alongside the remaining story. The first finished daily outing sets that day’s score and stamps, including a zero-score, rescued or tide-turned outing; later sails are practice. Pausing leaves the outing open on its original day. Story outings use no daily result. The Home sheet and Log keep daily results; Bram shelves eligible reed and glass. Bell/Reed Steps, the later shore-bell discovery and optional courts remain on the Chart under their existing discovery requirements. Saved harbors keep the Tidekeeper’s three-ask court; each selected activity teaches its own rules and tools.

**Carried** means in Mochi’s pack; **banked safe** means secured for this outing. Banking does not finish it. **Finish and return** ends it without spending a move, then files the return; **filed in the harbor** means that save succeeded. A filed lens or vane still needs deliberate **installation**. Story prizes add no score. A failed filing keeps the finished outing available for retry, including when the prize write succeeded but closing the outing failed.

## Run

```sh
bun install --frozen-lockfile
make dev
```

No account is needed for the device preview. On touch screens, swipe once to move or tap a glowing neighboring platform. Tap **Wait** beside Mochi to wait and **Finish** at the Tide Run dock to finish the outing. On desktop, use WASD/arrows, Space to wait, R to finish at the dock and I for the free guide while the game has focus. Tide Run collects finds and banks cargo when Mochi steps onto them; the three-ask courts also use E for nearby objects and retain their Home action. Mouse targeting still works; optional **Button controls** expose the same actions. Sound is opt-in; reduced motion keeps the same outcomes. Device saves stay on that browser and never silently merge into a signed-in harbor.

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

Live stack: root `familiar-game.testnet`, items `items.familiar-game.testnet`. `make judge` reads current chain state over public RPC with no keys; `make break` runs the source rules. The deployed root code differs from the HEAD build recorded in `docs/FAMILIAR-GAMEPLAY.json`, so source tests describe HEAD, not necessarily the deployed bytes.

| Claim | What is true on testnet | Check | Limit |
| --- | --- | --- | --- |
| Mochi is a real account | Every pet the root lists (`nft_tokens`) is a sub-account with no access keys, running global code pinned by hash (`get_config.pet_code_hash`); its NFT papers on the root name the owner | `make judge` | Root and Items still have admin keys, so the whole stack is not immutable |
| The court is refereed | In source, `tidebound_claim` replays the submitted steps and accepts only a court that brings Mochi home, and 12 Shells are granted once per account; on chain, the test player's accepted claims and Shells match that | `make break` (rule), `make judge` (state) | Replay proves the steps are legal, not that a person played them; one pet passed between accounts can earn each its own Shells |
| Your key | Your account key is held by your Privy wallet; Familiar's signer prepares only named harbor actions | `make judge` lists the key's permission; custody and the method limit come from source (`privy-adapter.ts`, `sign.ts`), checked by `make break` | The key is full-access; the method limit is enforced by the signer, not by the chain |

## Source

- `web/src/expedition/`: rules, Phaser presentation, Mochi, sound and harbor.
- `web/src/run/`: the tide run (`tide_run_v1`): rules, Bram's guess, the story chapters and the device tide book.
- `web/src/tide/`: Today's tide, the Home sheet, Bram's tide log and the Tidekeeper's three-ask court with its solver.
- `web/src/season/`: Bram's shelf, till and Mochi's wish over the testnet `season` contract.
- `web/src/account/`, `web/src/tidebound/`: recoverable identity, original transactions and item provenance.
- `web/src/compatibility/`: frozen historical return validation.
- `contracts/`, `services/relayer/`: Rust testnet contracts and account HTTP service.
- `web/assets/source/`: art masters and generator inputs; [regeneration guide](web/assets/source/README.md).

The stack remains React/Vite/Phaser, Bun/TypeScript and Rust. The finite H1 economy preserves one protected craft credit, one salvage, one personal 12-Shell commission and one optional 12-Shell finish per token. Bound Shells have no cash redemption. Transfer does not transfer maker achievement; unknown outcomes preserve the original request.

## Status and evidence

[JUDGES.md](JUDGES.md) lists current reproducible claims. [PROGRESS.md](PROGRESS.md) records the latest verified changes. [Architecture](docs/ARCHITECTURE.md), [threat model](docs/THREAT-MODEL.md) and [archived reports](docs/ARCHIVED-REPORTS.md) explain the boundaries. Only two report JSONs remain: recorded gameplay evidence for regressions and original deployment evidence for isolation guards.

The GitHub workflow checks PRs to `main` and pushes to `main`. Merge through a PR after the required “Tests, build and evidence” check passes; protected `main` rejects direct and force pushes. Vercel’s Git integration builds production from `main`; PR branches get a device-only preview without account functions. Production builds reuse the existing encrypted account-service environment. `bun run build:release` writes a Build Output API artifact: production includes the Node 24 account endpoints; other environments build a device-only preview. It never signs or sends a game transaction. `bun run package:tidebound-review <existing-reviewed-release>` prepares a local artifact without publishing. Credentials and recovery journals stay in ignored private configuration; ordinary exploration requires no blockchain transaction.

Code is MIT licensed; artwork provenance and dependency/font licenses remain with their assets. The existing large Phaser bundle warning persists. Physical-phone audio/performance, full earned-state recovery across two physical devices and independent human enjoyment remain unverified.
