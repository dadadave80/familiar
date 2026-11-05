#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
echo 'Familiar: real local NEAR sandbox, disposable development accounts, no supplied secrets.'
bun install --frozen-lockfile
bash scripts/build-contracts.sh
bun run test:sandbox
