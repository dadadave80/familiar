# Familiar

![Familiar: a little adventure with Mochi. A felt-miniature harbor at sunset: Mochi, an orange kitten in a red bandana, leaps between spiral stepping stones past a teal wave and a glowing wind-moth, while the stone-crab Tidekeeper watches and Bram the badger waves from the quay below the lighthouse.](docs/readme-banner.jpg)

**[Play Familiar in your browser](https://familiar-two.vercel.app).** No wallet, no account, no download.

Familiar is a cozy tide-puzzle game where the companion you guide is her own blockchain account. You help Mochi, a kitten, cross a rising tide to bring home the lens of Wren’s beacon. The three-chapter story plays with no sign-in. Sign in with an email, and your saved harbor’s Mochi is a NEAR testnet account with no access keys.

The idea is a virtual pet you do not rent from a database. Mochi has her own address, papers that name you as her owner, and a purse the shop keeps in her name. One command checks those claims against the live chain.

Built solo at NEAR HACKATHON, November 2026, for the Games With Real Economies track.

## Why Familiar is different

The games track judges the game loop, not the token, with a bonus when players never notice the chain. Familiar is built to that standard, and each point names its check:

- **The game comes first**: The story runs in a browser tab and saves on your device. Check it in [the live game](https://familiar-two.vercel.app).
- **Your companion is an account**: Each pet is a NEAR sub-account with no access keys, running code pinned by hash. A non-fungible token (NFT) on the root contract names her owner. Check it with `make judge`.
- **The contract is the referee**: The contract replays the Tidekeeper’s court step by step. It accepts only a route that brings Mochi home, and it grants 12 Shells once per account. Check it with `make break`.
- **The shop prices itself**: Bram’s shelf prices come from an integer formula inside the season contract, with no off-chain quote worker. Check the deployed code and current prices with `make judge`.
- **Mochi shops for herself**: A wish is a standing order with a purse of up to 24 Shells held for the pet. The contract confirms on the root that you own her before it takes the purse.
- **Nothing cashes out**: Shells are bound. No deposit buys them and nothing redeems them, so the economy rewards play.
- **The limits are stated**: Admin keys, key custody and what replay cannot prove are listed under [What runs on NEAR](#what-runs-on-near).

## Try the game

These steps take you from the first move to the on-chain checks. Each step says what you do and what you see:

1. Open [the live game](https://familiar-two.vercel.app) on a phone or in a narrow browser window. You see the introduction.
2. Start the game and choose **Help Mochi**. You see the first goal: “Bring the Beacon Lens home from the left shell.”
3. Swipe, or tap a glowing stone, to move. The water shifts with each move, and a wave arrives after every third move.
4. Step onto the lens, bring it to the center dock, choose **Finish and return**, then fit the lens. The beacon lights.
5. Clone the repository, run `bun install --frozen-lockfile`, then run `make judge`. You see each claim checked against live testnet state, ending with `All checks passed.`
6. Run `make break` with Rust installed. You see the contracts and signer refuse a doctored court, a second Shell grant and out-of-scope signing.

## How the game plays

Familiar is a turn-based puzzle about reading the water. These rules cover the tide run:

- **Moves and waves**: Each step or wait spends one move. A wave arrives after every third move. Chapter 1 has eight calm waves, and later chapters have twelve.
- **Finds and cargo**: Mochi collects a find by stepping onto it. Cargo is banked when she arrives at the center dock.
- **Three chapters**: You recover the Beacon Lens, the Signal Vane and the wind-moth. Story prizes add no score.
- **Today’s tide**: Once the beacon is lit, an optional daily outing opens beside the remaining story. Your first finished outing sets that day’s score and stamps. Later sails are practice.
- **The cast**: Mochi the kitten, Bram the badger who keeps the shelf, the stone-crab Tidekeeper, and Wren, keeper of the light.

The game uses four words with exact meanings:

- **Carried**: The find is in Mochi’s pack.
- **Banked safe**: The cargo is secured for this outing. Banking does not finish the outing.
- **Filed in the harbor**: **Finish and return** ended the outing without spending a move, and the save succeeded.
- **Installed**: You fitted a filed lens or vane. Installation is a deliberate step.

The harbor offers an open outing or unfinished filing first, then a recovered repair, then the next chapter. A failed filing keeps the finished outing available for retry. A paused outing stays open on its original day. Saved harbors keep the Tidekeeper’s three-ask court, and the Chart holds the Bell and Reed Steps and optional courts.

## What runs on NEAR

The live stack is three testnet contracts: root `familiar-game.testnet`, items `items.familiar-game.testnet` and season `season.familiar-game.testnet`. `make judge` reads current chain state over a public remote procedure call (RPC) endpoint with no keys. `make break` runs the source rules.

| Claim | What is true on testnet | Check | Limit |
| --- | --- | --- | --- |
| Mochi is a real account | Every pet the root lists (`nft_tokens`) is a sub-account with no access keys, running global code pinned by hash (`get_config.pet_code_hash`). Its NFT papers on the root name the owner | `make judge` | Root, items and season keep admin keys, so the whole stack is not immutable |
| The court is refereed | In source, `tidebound_claim` replays the submitted steps and accepts only a court that brings Mochi home. 12 Shells are granted once per account. On chain, the test player’s accepted claims and Shells match that | `make break` (rule), `make judge` (state) | Replay proves the steps are legal, not that a person played them. One pet passed between accounts can earn each its own Shells |
| Bram’s shelf prices itself | The season account runs the reviewed build. It keeps Bram’s till and shelf, prices every unit on chain and holds one purse per pet for Mochi’s wish | `make judge` (code hash, till and shelf), `make break` (refusals) | `make judge` reads state only and claims no trade |
| Your key | Your account key is held by your Privy wallet. Familiar’s signer prepares only named harbor actions | `make judge` lists the key’s permission. Custody and the method limit come from source (`privy-adapter.ts`, `sign.ts`), checked by `make break` | The key is full-access. The signer enforces the method limit, not the chain |

### How Bram prices the shelf

Bram’s prices are integer math in `contracts/season/src/pricing.rs`, mirrored exactly by `web/src/season/pricing.ts`:

```text
price   = base × clamp((target / max(stock, 1))^0.7, 0.5, 3.0) × (1 + 0.15 × heat)
buyback = 0.8 × price
```

A thin shelf raises a price to at most three times its base, and an overfull shelf lowers it to half. Recent trading adds heat, which halves at each day boundary. Bram’s till refills by 60 Shells a day up to 300, and that refill is the only source of season Shells. Goods come from the opening shelf and the daily court, which the contract replays before it mints glass or reed.

Each trade names a `max_price` or `min_price`, so a trade never fills at a worse price than you named. Each account trades up to 20 units of a good per day. On 2026-11-14, `make judge` reported the till at 289 Shells, glass at 41 units priced 8 and reed at 42 units priced 4.

### Limits you should know

Familiar states what its chain claims do not cover:

- **Admin keys remain**: Root, items and season each keep a full-access admin key.
- **Deployed root differs from HEAD**: The deployed root code differs from the build recorded in `docs/FAMILIAR-GAMEPLAY.json`. Source tests describe HEAD.
- **The tide run is local**: The tide run saves on your device. No contract referees it.
- **The economy is finite and bound**: The H1 rules allow one protected craft credit, one salvage, one personal 12-Shell commission and one optional 12-Shell finish per token. Shells have no cash redemption.
- **The sealed note is optional**: Mochi’s note sends an end-to-end encrypted request to NEAR AI. It stays off unless `VITE_SEALED_NOTE_ENABLED` and the server key are set.
- **Testnet only**: Nothing in Familiar runs on mainnet or spends real funds.

## Run Familiar locally

You need [Bun](https://bun.sh) 1.4 to run the game, and no account for the device harbor:

```sh
bun install --frozen-lockfile
make dev
```

`make dev` starts the Vite server and prints the local address. The controls match the live game:

- **Touch**: Swipe once to move, or tap a glowing neighboring platform. Tap **Wait** beside Mochi to wait, and **Finish** at the dock to finish the outing.
- **Keyboard**: Use WASD or the arrow keys to move, Space to wait, R to finish at the dock and I for the free guide.
- **Courts**: The three-ask courts also use E for nearby objects and keep their Home action.
- **Buttons and mouse**: Mouse targeting works, and **Button controls** expose the same actions as buttons.
- **Comfort**: Sound is opt-in. Reduced motion keeps the same outcomes.

Device saves stay on that browser. They never merge silently into a signed-in harbor.

## Commands that check the project

Each `make` target wraps a `bun run` or `cargo` command, and the underlying commands still work:

| Command | Purpose |
| --- | --- |
| `make test` | Bun and Rust unit tests |
| `make typecheck` | TypeScript check |
| `make build` | TypeScript check and Vite build |
| `make check` | Tests and build |
| `make browser` | Chromium and WebKit route and save checks |
| `make evidence` | Offline checks of recorded signatures and receipts |
| `make judge` | Live, read-only testnet checks of the claims above, over public RPC with no keys |
| `make break` | Contract and signer refusals: doctored court, Shells twice, out-of-scope signing |

Browser checks require `bunx playwright install chromium webkit`. Full outing checks use `bun scripts/test-expedition-browser.ts --only=390` and `bun scripts/test-passage-browser.ts`. Real-Wasm sandbox checks require `bun run build:contracts`, then `bun run test:tidebound-sandbox` or `bun run test:sandbox`. Default Rust tests leave these integrations ignored.

## What was built during the hackathon

No code in this repository predates the hackathon window:

- **History**: The first commit is dated 2026-11-05, so the [commit history](https://github.com/dadadave80/familiar/commits/main) shows the whole build.
- **Libraries**: Phaser 3, React 19, Vite 8, TypeScript, Bun, Hono, near-api-js, borsh, Privy React Auth, the NEAR AI inference SDK, FastAuth packages, near-sdk for the Rust contracts and Playwright for browser checks. Fonts are Figtree and Fraunces from Fontsource.
- **AI assistance**: AI coding agents (Claude Code and Codex) wrote code under the author’s direction and review. [AGENTS.md](AGENTS.md) holds the rules they follow.
- **Artwork**: Masters, generator inputs and provenance records live in `web/assets/source/` and `web/public/assets/`. The [regeneration guide](web/assets/source/README.md) names the generated pieces.
- **License**: Code is MIT licensed in [LICENSE](LICENSE). Artwork provenance and dependency and font licenses remain with their assets.

## Where the code lives

The stack is React, Vite and Phaser in the browser, Bun and TypeScript for services, and Rust for contracts:

- `web/src/expedition/`: rules, Phaser presentation, Mochi, sound and harbor.
- `web/src/run/`: the tide run (`tide_run_v1`), with its rules, Bram’s guess, the story chapters and the device tide book.
- `web/src/tide/`: Today’s tide, the Home sheet, Bram’s tide log and the Tidekeeper’s three-ask court with its solver.
- `web/src/season/`: Bram’s shelf, till and Mochi’s wish over the testnet `season` contract.
- `web/src/account/`, `web/src/tidebound/`: recoverable identity, original transactions and item provenance.
- `web/src/compatibility/`: frozen historical return validation.
- `contracts/`, `services/relayer/`: Rust testnet contracts and the account HTTP service.
- `web/assets/source/`: art masters and generator inputs.

Transfer does not transfer the maker’s achievement, and unknown transaction outcomes preserve the original request.

## Status, evidence and open gaps

These documents hold the evidence behind this README:

- [JUDGES.md](JUDGES.md) lists the current reproducible claims.
- [PROGRESS.md](PROGRESS.md) records the latest verified changes.
- [Architecture](docs/ARCHITECTURE.md), the [threat model](docs/THREAT-MODEL.md) and the [archived reports](docs/ARCHIVED-REPORTS.md) explain the boundaries.

The GitHub workflow checks pull requests to `main` and pushes to `main`. Protected `main` rejects direct and force pushes, and merges wait for the “Tests, build and evidence” check. Vercel’s Git integration builds production from `main`. Pull request branches get a device-only preview without account functions.

`bun run build:release` writes a Build Output API artifact and never signs or sends a game transaction. Production includes the Node 24 account endpoints, and other environments build a device-only preview. Credentials and recovery journals stay in ignored private configuration. Ordinary exploration requires no blockchain transaction.

These gaps remain open:

- Audio and performance on a physical phone are unverified.
- Full earned-state recovery across two physical devices is unverified.
- Independent human enjoyment is unverified.
- The large Phaser bundle warning persists.
