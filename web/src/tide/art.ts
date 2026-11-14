export const TIDE_ART = "/assets/tide/";
export const cardArt = (id: string) => `${TIDE_ART}card-${id}.webp`;
export const sealArt = (kind: "kept" | "slipped" | "all-three") => `${TIDE_ART}seal-${kind}.webp`;
export const keeperArt = TIDE_ART + "keeper-ask.webp";
export const logCoverArt = TIDE_ART + "log-cover.webp";
export const logPageArt = TIDE_ART + "log-page.webp";

/** One short sentence describing each card picture, for screen readers. Keyed by card id. */
export const CARD_PICTURE: Record<string, string> = {
  "wake-both-shells": "Two open coral shells glow on a spiral stone.",
  "every-source": "Three teal waves with white foam stand in a row on a spiral stone.",
  "no-waiting": "Three orange pawprints pass a sideways hourglass on a spiral stone.",
  "full-satchel": "A brass lens and a golden moth peek from an open brown satchel.",
  "dry-paws": "Two rust-red boots stay clear of a small teal wave on a spiral stone.",
  "once-across": "One orange pawprint marks the middle of a little wooden rope bridge.",
  "tidy-tide": "A straw broom stands beside a neat mound of white foam on a spiral stone.",
  "coiled-rope": "A flat coil of rope rests on a spiral stone, tied with a red bow.",
  "quiet-shell": "A golden moth sleeps on a closed coral shell on a spiral stone.",
  "surf-home": "Mochi rides a teal wave with a brass lens tucked in her satchel.",
  "brams-bridge": "A steaming brown mug and round brass spectacles rest at the left end of a wooden bridge.",
  "dry-and-tidy": "Two folded cream towels with teal stripes sit beneath a wooden clothes peg.",
  "lantern-haul": "A brass lens leans against a glowing lantern beside a golden moth.",
  "left-for-bram": "A cream parcel tied with twine bears a round tag stitched with a coral shell.",
};
