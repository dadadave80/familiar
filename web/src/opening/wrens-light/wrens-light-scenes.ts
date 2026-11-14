export const WRENS_LIGHT_SCENES = [
  {
    id: "storm",
    transitionMs: 0,
    edit: "dip",
    editColour: "#132b31",
    heading: "The storm came in after dusk.",
    detail: "",
    description: "Storm clouds gather over the small harbor. The beacon shines across the water.",
  },
  {
    id: "beacon-dark",
    transitionMs: 450,
    edit: "dissolve",
    editColour: "#132b31",
    heading: "And the beacon went dark.",
    detail: "",
    description: "Rain sweeps past the beacon. Its lantern room is dark.",
  },
  {
    id: "wrens-lantern",
    transitionMs: 400,
    edit: "dip",
    editColour: "#132b31",
    heading: "Wren kept the light.",
    detail: "That night, she carried it down to the water.",
    description: "A brass lantern glows on the seat of Wren’s rowboat beside the quay.",
  },
  {
    id: "rowing-out",
    transitionMs: 400,
    edit: "dip",
    editColour: "#132b31",
    heading: "She rowed out to guide the boats in by hand.",
    detail: "",
    description: "Wren rows into the dark water, carrying a lantern. Her face is turned away.",
  },
  {
    id: "boats-home",
    transitionMs: 500,
    edit: "dip",
    editColour: "#132b31",
    heading: "The boats came home.",
    detail: "",
    description: "Fishing boats return through the sheltered harbor mouth, their small lights reflected in the sea.",
  },
  {
    id: "harbor-dawn",
    transitionMs: 800,
    edit: "light",
    editColour: "#132b31",
    heading: "By morning, the harbor was waking.",
    detail: "The beacon was still dark.",
    description: "Morning light warms the harbor cottages and quay. The beacon remains unlit.",
  },
  {
    id: "mochi-quay",
    transitionMs: 600,
    edit: "light",
    editColour: "#132b31",
    heading: "Keep Wren’s Light",
    detail: "Mochi is ready to help.",
    description: "Mochi waits on the quay, her red scarf and satchel ready, with the dark beacon across the water.",
  },
] as const;

export const LANDSCAPE_MEDIA = "(min-width: 650px) and (min-aspect-ratio: 6/5)";
export const LARGE_LANDSCAPE_MEDIA = "(min-width: 1024px) and (min-aspect-ratio: 6/5)";
export const OPENING_LANDSCAPE_SIZES = "(min-aspect-ratio: 8/5) 100vw, 160vh";
export const OPENING_FINAL_CROP_MEDIA = "(min-width: 1024px) and (min-height: 600px) and (min-aspect-ratio: 8/5) and (max-aspect-ratio: 16/9)";
export const openingPicture = (index: number, landscape = false) => `/assets/opening/${WRENS_LIGHT_SCENES[index].id}${landscape ? "-landscape" : ""}.webp`;
export const openingPictureSet = (source: string, largeLandscape = false) => largeLandscape && source.endsWith("-landscape.webp")
  ? `${source} 1728w, ${source.replace(/\.webp$/, "-2880.webp")} 2880w` : undefined;
export const openingPictureSizes = (source: string) => source.endsWith("/mochi-quay-landscape.webp")
  ? `${OPENING_FINAL_CROP_MEDIA} 130vw, ${OPENING_LANDSCAPE_SIZES}` : OPENING_LANDSCAPE_SIZES;

/** Approximate painted landmarks; Slice B must register its live camera before claiming a matched join. */
export const WRENS_LIGHT_FINAL_COMPOSITION = {
  registration: "film-target-unverified-against-prologue",
  coordinateSpace: "CSS pixels at reference viewport",
  tolerance: 4,
  portrait: {
    viewport: { width: 390, height: 844 },
    silhouette: { x: 145, y: 334, width: 161, height: 188 },
    foot: { x: 236, y: 520 },
    eyeline: { x: 261, y: 390 },
    beaconLantern: { x: 280, y: 188, width: 73, height: 85 },
  },
  landscape: {
    viewport: { width: 1440, height: 900 },
    // Calculated from the 1.3× desktop crop, awaiting a rendered registration check.
    silhouette: { x: 736.8, y: 418.6, width: 387.4, height: 453.7 },
    foot: { x: 956.5, y: 867.1 },
    eyeline: { x: 1020.2, y: 560.3 },
    beaconLantern: { x: 1198.3, y: 136.5, width: 192.4, height: 217.1 },
  },
} as const;
