# Source artwork

`first-light-motion/` holds twelve First Light PNGs, including the three pose sources used by the [Mochi atlas builder](../../../scripts/build-mochi-atlas.ts). Run `bun scripts/build-mochi-atlas.ts` from the repository root to regenerate `web/public/assets/first-light-motion/mochi-poses.webp`. The builder uses ImageMagick and cwebp.

The [First Light provenance record](../../public/assets/first-light-motion/provenance.json) identifies the source artwork and the archived `mochi-step.png` study. Browser artwork and public metadata live in `web/public/assets/first-light-motion/`.

`expedition/` holds the PNG masters and full-size WebPs for the tide court, stone island and wooden bridge. The other full-size optimizer inputs for Bram, the shell and the wave live in `first-light-motion/`.

Run `bun scripts/optimize-expedition-assets.ts` to regenerate the eleven WebPs in `web/public/assets/expedition/runtime/` using cwebp. In the [encoding manifest](../../public/assets/expedition/runtime/manifest.json), source paths are relative to `web/` and output paths to `web/public/`. Five inputs also appear at full size in the game or introduction.

`season/` holds the five Season 2 icon masters (glass, reed, Bram's shelf and till, Mochi's purse, the wish token), generated with gpt-6-astra through the Codex CLI; prompts and original paths are in the [season provenance record](../../public/assets/season/provenance.json). Run `bun scripts/optimize-season-assets.ts` to regenerate the WebPs and manifest in `web/public/assets/season/`; it removes the cream backdrop by corner flood fill and needs ImageMagick and cwebp.

`tide/` holds twenty PNG masters (the Tidekeeper's ask header, Bram's log cover and page, three seals, and fourteen card pictures), generated with gpt-6-astra through the Codex CLI; prompts and original paths are in the [tide provenance record](../../public/assets/tide/provenance.json). Run `bun scripts/optimize-tide-assets.ts` to regenerate the WebPs and manifest in `web/public/assets/tide/` using ImageMagick and cwebp; the header, log assets and seals get transparent backdrops, while card pictures keep their cream backdrop.
