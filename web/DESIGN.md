# Familiar visual system

User-approved direction: the embedded brief in `../HANDOFF.md`. This is a new visual world; there is no incumbent interface.

## World and first viewport
The harbor is the artifact. A spacious illustrated town fills the center, with the companion in the square, a baker's shop, orchard, well, mill, post office and dock. The first screen offers a pet name and one “Adopt” action inside the town's lower paper margin. It contains no marketing hero. After adoption the pet name, mood and three energy pips sit above the town; a compact action row follows it. Mobile stacks the scene and controls. At 1280px desktop width, the town occupies 720px beside a 480px control column with a 32px gap, keeping the first care action visible without scrolling. The scene stays beside the active panel as desktop users scroll.

The signature interaction is a 600–900ms walk along the town's paths followed by a thermal receipt appearing below the action controls. The walk can anticipate confirmation, but rewards and receipt completion wait for success. Reduced motion uses fades and suppresses idle breathing.

## Tokens
```css
:root {
  --paper: #F6EFE3;
  --ink: #1E1A17;
  --sea: #2E6F6A;
  --sun: #F2A541;
  --coral: #E26D5A;
  --coral-dark: #9A4637;
  --moss: #5C7A3A;
  --dusk: #5B4E8A;
  --muted: #695D51;
  --line: #D8CBBA;
  --card: #FFF9EF;
  --radius: 16px;
  --shadow: 0 8px 28px #4B321514;
}
```
Paper is the page; ink carries text. Sea is the primary action and water color. Sun, coral, moss and dusk are material accents, not small-text colors. All spacing uses a 4px grid. Controls have 44px minimum touch height. Cards use 16px corners; pills are limited to short status and controls. One soft downward shadow creates depth.

## Type
Fraunces Variable gives names and headings the soft, slightly wonky character of a picture book while preserving an optical size axis. Figtree Variable is a compact humanist face for controls and small readable labels. IBM Plex Mono marks receipts as documents, with aligned values and hashes. Fontsource supplies self-hosted OFL-licensed font files; no external font request is needed.

## Surface briefs
- Town/pet: Experience. Pet and authored town lead; minimal surrounding chrome. DOM labels and buttons mirror all canvas locations.
- Pet sheet, bag, market and dens: Operate. Inline tab panels, labeled quantities, explicit disabled reasons, consistent rows and real prices denominated as testnet savings rather than token-price speculation.
- Receipt/X-ray: Read. Off-white thermal paper, perforated edge, structured one-sentence explanation, status and optional technical details. Never a transient toast.
- Onboarding: one name field, a procedural pet preview, and Adopt. First feed and errand remain visible. The first errand introduces the receipt; Google retention appears only after that. A quiet “Coming back?” control reveals name-based recovery for returning players. Unsupported origins explain that Google is not connected; no successful recovery is implied.

## Motion and states
UI transitions use 180ms ease-out. Pet breathing lasts 2.4 seconds. No repeated bounce or confetti spam. Pending, rejected, offline, quota-exhausted, empty inventory, no liquidity, insufficient energy, unbonding, and unknown transaction outcome all have explicit copy and recovery. Do not silently reset guest keys. Sound stays off unless enabled.

## Assets and verification
Town tiles: Kenney Tiny Town (CC0), license verified at https://kenney.nl/assets/tiny-town. Pet: layered procedural SVG body, eyes and accessory slots as expressly requested. The complete browser fixture suite passed at 390×844 and 1280×800, with twelve panel captures stored in `screenshots/*-fixture.png`. A visual reviewer accepted the viewport/action, accessible market-name, path-walking and entry-copy fixes after inspecting all twelve captures. Public preview captures at both sizes also verify the paused, unconfigured state; fixtures do not stand in for live chain evidence.
