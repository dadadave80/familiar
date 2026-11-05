#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
bun -e 'import {KeyPair} from "near-api-js"; if(process.env.NEAR_NETWORK!=="testnet" || !process.env.NEAR_ROOT?.endsWith(".testnet") || !process.env.ROOT_PRIVATE_KEY) throw new Error("Configure project testnet keys first."); const key=KeyPair.fromString(process.env.ROOT_PRIVATE_KEY); const p=Bun.spawn(["near","account","create-account","sponsor-by-faucet-service",process.env.NEAR_ROOT,"use-manually-provided-public-key",key.getPublicKey().toString(),"network-config","testnet","create"],{stdout:"inherit",stderr:"inherit"});process.exit(await p.exited);'
