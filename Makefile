.DEFAULT_GOAL := help
.PHONY: help dev test typecheck build check browser evidence

help:
	@printf '%s\n' 'make dev       Start the local game' 'make test      Run Bun and Rust unit tests' 'make typecheck Check TypeScript' 'make build     Type-check and build the browser game' 'make check     Run tests and build' 'make browser   Check desktop/mobile routes and saved progress' 'make evidence  Verify recorded signatures and receipt graphs offline'

dev:
	bun run dev

test:
	bun run test
	cargo test --manifest-path contracts/Cargo.toml --workspace

typecheck:
	bun run typecheck

build:
	bun run build

check: test build

browser:
	bun run test:routing-browser

evidence:
	bun --no-env-file scripts/verify-game-evidence.ts
