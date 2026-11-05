# Product

<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
User specified Vite, React, TypeScript, Phaser 3 for the town canvas, vanilla CSS, self-hosted open fonts, NEAR client signing, and a PWA manifest. Bun manages packages, scripts, tests, and services. Vercel is the requested web hosting target.

## Users
Curious people who will never open a crypto wallet. Secondary audience: hackathon judges trying the game in two minutes, including AI reproducibility checks.

## Product Purpose
Adopt a small companion, feed it, send it on errands, bake bread, trade with Bram, and let it nap. The pet is a keyless named NEAR account; its NFT determines who may act for it. Inventory and savings stay with the account on resale.

## Operating Context
390px portrait baseline. Desktop centers the controls at 480px and widens the town to 720px. A stranger should adopt and read their first receipt within 60 seconds. Testnet only; hundreds of players and tens concurrently; public RPC, no indexer, no paid infrastructure.

## Capabilities and Constraints
Guest-first, no sign-up. Player actions must be signed in the browser and relayed without handing the service player keys. The registry verifies NFT ownership and serializes pet actions with transfers. Receipts describe confirmed actions and link to an explorer. A stopped relayer pauses play honestly without deleting a guest identity or claiming completion. Google recovery is additive and appears only after the first errand; it requires verified NEAR Auth configuration.

## Brand Commitments
Familiar. A small harbor town at golden hour, picture-book warmth. Warm, plain, slightly wry language. No “wallet”, “gas”, or “tx” before a receipt; real terms are glossed when introduced. No landing page, token prices, countdowns, buy-ins, pots, tutorial screens, or jargon in buttons. Sound is optional and off by default.

## Evidence on Hand
The user supplied `../HANDOFF.md`. `../PROGRESS.md` records actual commands and discrepancies. No deployed game, live receipts, screenshots, or successful auth integration existed at project start. Never fabricate them.

## Product Principles
- Play first; explain the chain afterwards, one sentence at a time.
- The pet leads; controls stay quiet and readable.
- Success appears only after confirmation; pending work stays pending.
- No pet dies; mood and energy recover predictably.

## Accessibility & Inclusion
Text contrast at least 4.5:1, 44px minimum targets, visible focus, keyboard equivalents for every canvas action, live action feedback, and reduced-motion support. The canvas never owns essential text or controls.
