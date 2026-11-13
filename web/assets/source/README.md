# Source artwork

`first-light-motion/` holds the thirteen original PNGs for First Light, including the three sheets and poses used by the [Mochi atlas builder](../../../scripts/build-mochi-atlas.ts). Run `bun scripts/build-mochi-atlas.ts` from the repository root to regenerate `web/public/assets/first-light-motion/mochi-poses-v1.webp`. The builder uses ImageMagick and cwebp.

The [First Light provenance record](../../public/assets/first-light-motion/provenance.json) retains the historical PNG filenames. Those names identify the source files in `first-light-motion/`. Browser artwork and public metadata live in `web/public/assets/first-light-motion/`.

`expedition-v2/` holds the PNG masters for the tide court, stone island and wooden bridge. Their runtime WebPs live in `web/public/assets/expedition-v2/runtime/`.
