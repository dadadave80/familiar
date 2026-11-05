#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
command -v wasm-opt >/dev/null || { echo 'Install Binaryen (wasm-opt) before building.' >&2; exit 1; }
# SDK 5.30 needs the near cfg; Binaryen lowers Rust 1.99 bulk-memory instructions for NEAR.
RUSTFLAGS='--cfg near' cargo build --manifest-path contracts/Cargo.toml --locked --release --target wasm32-unknown-unknown \
  -p familiar-root -p familiar-pet -p familiar-items -p familiar-bakery -p familiar-market -p familiar-mock-pool
mkdir -p contracts/target/deploy
for contract in root pet items bakery market mock_pool; do
  wasm-opt "contracts/target/wasm32-unknown-unknown/release/familiar_${contract}.wasm" \
    --enable-bulk-memory --llvm-memory-copy-fill-lowering --signext-lowering -Oz --strip-debug --strip-producers \
    -o "contracts/target/deploy/familiar_${contract}.wasm"
done
