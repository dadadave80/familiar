# Familiar visual system

## First Light game — current direction, November 12

The harbor and expedition artwork form the full browser viewport. Navigation and controls belong to the handcrafted coastal world: compact wood/brass navigation, readable parchment objectives and tactile action buttons over the scene. Preserve Familiar, Mochi, Bram, the Tidekeeper, the wind-moth, the existing warm diorama art and self-hosted type. “Tidebound” is a proposed subtitle.

The desktop playfield has no exterior page frame, permanent cream sidebar or letterbox. Keep the center clear and expose the current decision first. Preparation, memory, discoveries, Workshop, Account and longer explanations use bounded menu states. The whole game page stays fixed; contained detail/account panels may scroll where useful, with reachable Back/Close controls.

Portrait keeps all three registered lanes visible in a width-aligned playfield while reused coastal artwork continues behind the HUD. Resizing changes presentation only. DOM buttons and labels preserve keyboard access, 44px targets, visible focus, contrast and reduced-motion outcomes. Browser viewport filling does not require forcing OS fullscreen.

Local previews, confirmed NEAR testnet ownership and uncertain operations retain explicit truthful labels. An immersive visual treatment cannot replace recovery, canonical state or receipt verification. Device and human playtest evidence belongs in `../PROGRESS.md` and `../JUDGES.md`.

The sections below describe the retained November 5 legacy town at `/legacy/`; their sidebar/scroll layout is not the First Light game direction.

User-approved direction: the harbor world in `../HANDOFF.md`, refined on November 5, 2026 with the chosen emphasis “Cozy town and companion, with clearer actions.” The existing identity and game behavior remain the foundation.

## World and first viewport
The harbor is the artifact. A spacious pixel-art town leads, with the companion in the square, a baker's shop, orchard, well, post office and dock. The desktop entry pairs the town with a paper control column: a larger companion preview, name field and one “Adopt” action. It contains no marketing hero. After adoption, a compact companion portrait, name, mood and three energy pips sit together above the map. At 1280px, the map column is about 696px and the control surface 464px with a 40px gap. The town column stays visible as desktop users scroll through controls and receipts.

Below 1000px the scene and controls stack, with persistent labeled navigation at the bottom after adoption. Safe-area padding and scroll clearance keep the receipt and final controls reachable. Choosing a place brings its panel into view. The first care action remains above navigation in the tested 320px, 390px and 768px viewports. Long pet names wrap within the profile. The sea-green care button is the clear first action; errands and inventory use readable rows. The map retains its licensed pixel art with a restrained color treatment.

The signature interaction remains a 600–900ms walk along the town's paths followed by a thermal receipt below the action controls. The walk can anticipate confirmation, but rewards and receipt completion wait for success. Reduced motion uses fades and suppresses idle breathing. All game, signing, recovery and receipt behavior is preserved by this interface refinement.

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
Town tiles: Kenney Tiny Town (CC0), license verified at https://kenney.nl/assets/tiny-town. Pet: layered procedural SVG body, eyes and accessory slots as expressly requested. The redesigned interface's fixture suite passes at 320×844, 390×844, 768×1024 and 1280×800. Fourteen primary captures live in `screenshots/*-fixture.png`; edge-width and viewport-only captures are written to the operating system temporary directory. Coverage includes initial actions, persistent navigation, keyboard focus, long names, recovery, all five panels, receipts, offline identity preservation, and clipping. Independent visual review inspected all 32 captures. These are fixture/UI checks, not live chain evidence; public-preview and live-testnet screenshots from earlier work retain their original design and historical meaning.
