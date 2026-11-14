# Familiar visual system

## First Light game — current direction, November 12

The harbor and expedition artwork form the full browser viewport. Navigation and controls belong to the handcrafted coastal world: compact wood/brass navigation, readable parchment objectives and tactile action buttons over the scene. Preserve Familiar, Mochi, Bram, the Tidekeeper, the wind-moth, the existing warm diorama art and self-hosted type. “Tidebound” is a proposed subtitle.

The desktop playfield has no exterior page frame, permanent cream sidebar or letterbox. Keep the center clear and expose the current decision first. Preparation, memory, discoveries, Workshop, Account and longer explanations use bounded menu states. The whole game page stays fixed; contained detail/account panels may scroll where useful, with reachable Back/Close controls.

Portrait keeps all three columns and both banks visible. Organic sandstone platforms and a single moving wooden bridge sit directly in the coastal world. Mochi walks to adjacent platforms, crosses an open bridge in one decision, reaches for discoveries, and carries them back to the dock. The Tidekeeper, source markers and ordered wave/bridge animation explain cause and effect. Hover and keyboard focus preview the exact accepted outcome; world-tap targets and optional Button controls retain equivalent actions.

Resizing changes presentation only. DOM buttons and labels preserve keyboard access, 44px targets, visible focus, contrast and reduced-motion outcomes. Browser viewport filling does not require forcing OS fullscreen. The engine saves an accepted decision before animation; one next direction may queue while Mochi completes it. Hidden tabs clear that queue. A single browser tab owns the active preview branch, preventing competing tabs from replacing moves.

At home, Beacon, Bram, Workbench and Satchel are places in the scene. The primary action follows the returned cargo, then restoration, then an earned light, then Wind Gate. Account lives in the menu. The origin diorama distinguishes a validated device memory from an actual maker's accepted NEAR event. Familiar has one playable edition. Old routes and invitation flags open the current game without modifying their original saved records.

Local previews, confirmed NEAR testnet ownership and uncertain operations retain explicit truthful labels. An immersive visual treatment cannot replace recovery, canonical state or receipt verification. Device and human playtest evidence belongs in `../PROGRESS.md` and `../JUDGES.md`.

## Interface system — November 14

The painted world already matches the Pocket Harbor concept; the interface layer on top follows one system so it reads as part of the same object.

- **Surfaces.** Cards are `#fbf3e2` with ink `#263e32`, secondary ink `#4f5d52` and hairlines `#e6d6b4`; radius 22px (20px under 480px), no border, one shadow (`0 14px 34px rgba(64,40,18,.20), 0 2px 6px rgba(64,40,18,.12)`). Panels, Today's tide, the tide log, the Home sheet, the harbor card and the move tray are all this card, opaque, never frosted.
- **Buttons.** One primary per surface: a deep-green pill (`#2b5f4d`, light top edge, darker bevel, cream Fraunces 650 18px, 20px leading line icon, 52px tall, 56px on touch). At most two secondaries: cream pills with a 1.5px tan border, Fraunces 600 17px. Quiet actions are Figtree 600 15px underlined links. Nothing interactive is smaller than 44×44; no text is smaller than 12px. Button text never wraps.
- **Icons.** One inline SVG line family (24 viewBox, 1.8 stroke, round caps, `currentColor`) for controls; painted art for things in the world. No Unicode glyphs or emoji as icons.
- **Focus and hover.** Focus is a 3px `#2b5f4d` outline on cream and a 3px `#fff5ce` outline over the scene; painted objects (title planks, place signs) get a shape-following glow instead. Generic hover rules sit inside `:where()` so a component's own colors always win; hover never erases a label.
- **Motion.** One authored moment per screen: the stamp pressing onto the Home sheet, the asks ticking in after it. Everything else is still, and reduced motion shows the final state.

**Harbor home** shows the loop's next step and nothing else: Take it to Bram when a find came home today and is not yet shelved, See today's ask before the day's tide, the result with Sail again after it, and Tomorrow's card once Bram has shelved the haul. Desktop uses a bottom-centre bar with the Chart and Log pills top right; phones use a card above a four-item dock (Chart, Log, Satchel, Menu); landscape phones use the bar and the top-right pills. Beacon, Bram, Workbench and Satchel are painted standing signs planted on visible ground, never over a character or under a card.

**Coming home** is the peak of the loop: a centred Home sheet with the day's stamp, the three asks, a large result line and the next action (Take it to Bram, or Sail again). All three kept shows Mochi's proud portrait. Closing any panel returns focus to whatever opened it.

**The court** keeps the board clear: a Mochi status card (portrait, tide line, pips for Resolve, satchel and tool, plus one hidden sentence that reads the whole status), the surge forecast in plain words ("Next wave: left lane"), and the Tidekeeper's asks as painted-icon chips beside compact input hints. The default direction/action pad is replaced by swipe/tap guidance on touch screens and WASD/arrows on desktop. Hint mode follows actual input, not viewport width. Button controls remain in a closed-by-default native disclosure; the world retains distinct, at-least-44px targets for Wait, return and contextual objects. Menus, Sound, Inspect and confirmations remain ordinary controls.

Swipes resolve only on release and produce one canonical step. A qualifying swipe travels at least 32 CSS pixels on its dominant axis with a 1.5 axis ratio; ambiguous drags do nothing. A stationary hold still inspects for free. Cancellation, multitouch, resize and modal changes discard unfinished gestures. Keyboard shortcuts act only with intentional game focus and leave native controls and text fields alone. These thresholds require physical-device comfort checks before mobile validation is claimed.

**Painted UI art** (gpt-6-astra masters in `assets/source/ui/`) shares the felt-and-clay world's light and materials: four driftwood signs, three Mochi portraits (default, splashed after a splash, proud) and twelve ask icons. Text stays code-native on every sign and chip.

## Introduction and current entry

The homepage remains the introduction with its Play Familiar action to `/outing/`. `/outing/` opens on a title screen inside the game: the living harbor, the wordmark, one prompt, and a signpost menu. Choosing Continue or New Harbor carries the camera to the dock and a tide wipe hands off to play. `?play` skips the title. Keep the warm coastal imagery and self-hosted Fraunces/Figtree typography. The retired town, motion lab and recovery demo have no navigation links or build entries. Shared Mochi poses and the lantern/origin artwork remain part of Familiar, with essential meaning available through DOM controls and text.
