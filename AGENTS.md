# Familiar session rules

Read `PROGRESS.md` and the local `HANDOFF.md` when present. The handoff is deliberately untracked. Current official NEAR documentation wins on API details. Record discrepancies in `PROGRESS.md`.

- Use Bun for package management, scripts, tests, and TypeScript services.
- Testnet only. Project testnet signing is authorized; mainnet calls, token spending, public visibility, pushes, social posts, and submissions require David's explicit approval. Never force-push.
- Never commit secrets. `.env` is ignored; `.env.example` contains placeholders only. Inspect staged changes before each commit.
- Use descriptive conventional branch names without agent prefixes.
- Keep specifications and plans under `/Users/dadadave/.codex/specs/`, outside any Git worktree. `HANDOFF.md`, `web/PRODUCT.md`, and `web/DESIGN.md` are expressly requested product documents.
- Use the installed NEAR agent skills for contracts and clients, and Impeccable for frontend work.
- Authorize by predecessor, never transaction signer. All callbacks are private, handle failure, and must not panic. Preserve funds and ownership through asynchronous operations.
- Test before committing: `cargo test --manifest-path contracts/Cargo.toml --workspace` and `bun run test`. Use small conventional local commits. Ask before every push.
- Keep evidence honest: no invented transaction hashes, deployed URLs, test results, auth configuration, or feature claims. `PROGRESS.md` is the running evidence table; `JUDGES.md` contains reproducible claims.
