# Keep Wren’s Light

A seven-scene, player-paced film for Familiar. It ends before Bram’s Slice B prologue. Every caption, control and the wordmark is native HTML. Wren’s absence remains unexplained; no return, death, rescue promise, court rules or rewards are added.

## Story and editing

| Scene | Native caption | Edit into the scene |
| --- | --- | --- |
| `storm` | The storm came in after dusk. | Locked camera. |
| `beacon-dark` | And the beacon went dark. | Registered change of the beacon’s light. |
| `wrens-lantern` | Wren kept the light. / That night, she carried it down to the water. | 400ms dip through harbor ink. |
| `rowing-out` | She rowed out to guide the boats in by hand. | 400ms dip through harbor ink. |
| `boats-home` | The boats came home. | 500ms ink dip; no Wren return implied. |
| `harbor-dawn` | By morning, the harbor was waking. / The beacon was still dark. | 800ms light bloom covering the plate cut. |
| `mochi-quay` | Keep Wren’s Light / Mochi is ready to help. | 600ms light bloom, then hold for the player and destination readiness. |

There is no automatic advance or looping camera, so no Pause control is needed. The registered storm → dark beacon change dissolves. The three dark cuts fade out by 44%, hold harbor ink, and fade in after 56%. The two warm edits switch plates discretely at 50%, beneath a fully opaque light veil held from 44–56%. Layered ivory, amber and rose cloud gradients give the veil spatial texture; it uses normal compositing and an opaque backing so no boats, cottages or rope posts bleed through. Light rises after 25% and recedes by 75%, leaving those quarter frames clear. One early Continue queues until the edit ends, with **Turning page…** feedback. Reduced motion replaces each picture immediately without the light pass. Reading always waits indefinitely.

The eleven supplied v4 captures show the feather double exposure, early-Skip caption mismatch, close caption focus ring and cropped desktop flowers. This revision addresses those defects in source and unit checks; it has not been rendered in a browser.

## First paint and delivery

The temporary preview starts a high-priority first-image preload at `Opening.tsx` module evaluation, gated to its existing development `?wrens-light` route. Normal title routes do not fetch the film. The integrator can call the small, side-effect-free helper from its entry route before mounting:

```ts
import { preloadWrensLight } from "./wrens-light/opening-preload";
preloadWrensLight();
```

For discovery before JavaScript, the integrator must place these exact links in **the film entry’s `index.html` `<head>`**, before its module script. Their media queries are mutually exclusive and match the component’s orientation/desktop rules. Put them only in HTML that actually opens the film; unconditional links in a shared app shell would also fetch the first plate on routes that skip it. `Opening.tsx` still provides only the existing development preview fallback; this revision does not edit app HTML.

```html
<link rel="preload" as="image" type="image/webp" fetchpriority="high"
  href="/assets/opening/storm-landscape.webp"
  imagesrcset="/assets/opening/storm-landscape.webp 1728w, /assets/opening/storm-landscape-2880.webp 2880w"
  imagesizes="(min-aspect-ratio: 8/5) 100vw, 160vh"
  media="(min-width: 1024px) and (min-aspect-ratio: 6/5)">
<link rel="preload" as="image" type="image/webp" fetchpriority="high"
  href="/assets/opening/storm-landscape.webp"
  media="(min-width: 650px) and (width < 1024px) and (min-aspect-ratio: 6/5)">
<link rel="preload" as="image" type="image/webp" fetchpriority="high"
  href="/assets/opening/storm.webp"
  media="not all and (min-width: 650px) and (min-aspect-ratio: 6/5)">
```

Keep `imagesrcset` and `imagesizes` aligned with the rendered image and decode request: an uncropped plate at 1440×900 can choose 2880w at 2× DPR and 1728w at 1×. The final Mochi plate uses `openingPictureSizes` with 130vw inside its desktop crop media query; predecode, render and preview share it, and the cache also accounts for the 1.3× enlargement. A 1440px desktop crop therefore offers the 2880w candidate even at1×. `160vh` accounts for cover scaling when the viewport is taller than the plate’s 8:5 ratio. Below 1024 CSS pixels—including a turned 844×390 phone—the larger candidate is not offered at any DPR. Portrait stays at its existing single 780px plate.

Before decode, a tiny inline storm poster fills the scene with its original painted silhouettes and light, with **Bringing the harbor into view…** beside a quiet gold dot. Continue says **Loading…** and cannot advance or queue a scene. Skip stays usable. The runtime image is inserted only after successful decode, avoiding a spurious portrait fetch on landscape entry. Only then is beacon-dark warmed at low priority. Rotation immediately prioritizes its matching first plate; obsolete completions cannot change the scene. A failed/stalled request resolves after 15 seconds, retains the last valid art (or poster), and offers reading continuation.

## Slice B integration contract

`WrensLightSequence` exports these props:

```ts
onComplete(): void;
onSkip(): void;
destinationReady?: boolean; // false by default
onExited?(reason: "complete" | "skip"): void;
framed?: boolean; // fill a positioned parent instead of the viewport
```

`onComplete` or `onSkip` fires exactly once per mounted film. These request destination preparation. While waiting, the film retains its visible plate and that plate’s caption/progress, including after a failed scene image; it never requests final film art to permit exit. **Opening…** and **Leaving…** replace the actionable button labels, with flat busy styling and immediate visible **Opening the harbor…** feedback below the header. A persistent polite status announces the same preparation without moving the caption or focus. The caption retains its DOM identity across page changes. Once `destinationReady` is true, Skip/Escape exits directly, avoiding an unmatched storm-to-Mochi dissolve. Completion dissolves for `WRENS_LIGHT_DISSOLVE_MS` (600ms). `onExited` notifies the owner when to release destination inertness and focus its explicit target. During a completion dissolve, the film is inert and its header/caption/controls leave in the first 180ms. The arrival status remains outside the inert/aria-hidden film.

Final image decoding belongs to the destination: the preview uses a tiny inline Mochi poster immediately and upgrades only after its full image decodes. A failed network image leaves the poster visible. The real Slice B integration must still establish its own world and focus readiness. Image failures during ordinary reading retain their recovery message; a matched completion dissolve cannot be promised when the final film plate failed to load.

Implement the owner in this order:

1. Mount the real harbor/prologue underneath the film, with its enclosing element `inert` and `aria-hidden`. Preserve the chosen sound settings and the validated save/returning-player flow.
2. Wait for actual harbor assets/world readiness **and** the prologue’s first composition and explicit heading ref to exist. Module import completion is insufficient. Keep loading/retry state owned by the integration; do not set `destinationReady` after a rejected load.
3. Stage the destination using the final-frame landmarks below. Keep its background visible under the opaque film so the dissolve can reveal it; hide Bram’s parchment until the film finishes. Keep Mochi and the lantern room unobscured.
4. Set `destinationReady={true}`. Completion keeps both mounted during the 600ms dissolve; Skip exits directly.
5. In `onExited`, remove the film and release the destination’s inertness. In a layout effect **after that React commit**, reveal/focus the prologue heading through its explicit ref. When no prologue applies, use the explicit harbor primary-action ref instead. Do not search for the first heading or button.
6. Reveal Bram’s parchment, then pull back to ordinary harbor framing only after the prologue. The film owns no save flag or onboarding preference.

The following owner pattern shows the lifecycle. `worldReady`, `prologueReady`, `Prologue`, and `HarborWorld` are integration-owned Slice B inputs/components, not APIs claimed to exist in this branch:

```tsx
const headingRef = useRef<HTMLHeadingElement>(null);
const primaryActionRef = useRef<HTMLButtonElement>(null);
const [requested, setRequested] = useState(false);
const [exited, setExited] = useState(false);
const [destinationReady, setDestinationReady] = useState(false);

useLayoutEffect(() => {
  const focusTarget = showPrologue ? headingRef.current : primaryActionRef.current;
  setDestinationReady(requested && worldReady && prologueReady && !!focusTarget);
}, [requested, worldReady, prologueReady, showPrologue]);

useLayoutEffect(() => {
  if (!exited) return;
  (showPrologue ? headingRef.current : primaryActionRef.current)
    ?.focus({ preventScroll: true });
}, [exited, showPrologue]);

return <>
  {requested && <div inert={!exited} aria-hidden={!exited}>
    <HarborWorld /* report actual asset/scene readiness to the owner */ />
    <Prologue headingRef={headingRef} primaryActionRef={primaryActionRef}
      parchmentVisible={exited} /* report composition mounted to the owner */ />
  </div>}
  {!exited && <WrensLightSequence
    onComplete={() => setRequested(true)}
    onSkip={() => setRequested(true)}
    destinationReady={destinationReady}
    onExited={() => setExited(true)}
  />}
</>;
```

The real prologue heading must have `tabIndex={-1}` and receive `headingRef` directly. It must remain mounted while waiting for readiness; visually hide the parchment without unmounting its heading. If the prologue is bypassed for a returning player, `prologueReady` means the chosen harbor action is mounted instead.

**Reduced motion:** use the same staged destination and readiness conditions. The film reveals it immediately (0ms) and calls `onExited`; focus still follows the commit that removes inertness. Do not add a delayed parchment entrance or camera pullback animation for this preference. If the preference changes during the dissolve, reveal completion becomes immediate.

**Film Skip and Escape skip only the film.** Both request the same Slice B destination as completion. They must never write `intro: "skip"` or activate the prologue’s separate **Skip introduction** action. Slice B owns:

> **Keep Wren’s Light**  
> You guide Mochi as a volunteer harbor helper.  
> Bram: “I’m Bram. Wren’s beacon helps the boats find harbor. The storm took its lens. Mochi’s ready to fetch it. Will you guide her?”  
> Mochi looks from the dark beacon to the water, then waits for your lead.  
> **Bring the Beacon Lens home from the left shell.**

Keep **Help Mochi**, **Skip introduction**, and **Use buttons** in Slice B. The old Court/Rope row is outside this film’s boundary and must be removed from that first-device journey by the integrator.

## Final-frame registration

`WRENS_LIGHT_FINAL_COMPOSITION` in `wrens-light-scenes.ts` exposes these approximate **film** landmarks in CSS pixels. Portrait landmarks were manually inspected; desktop values are calculated from the revised crop and await rendered confirmation. They are not a verified live-prologue match. Coordinates use the top-left origin; the silhouette includes the tail.

| Landmark | Portrait 390×844 | Landscape 1440×900 |
| --- | --- | --- |
| Mochi silhouette x/y/width/height | 145 / 334 / 161 / 188 | 736.8 / 418.6 / 387.4 / 453.7 |
| Foot midpoint x/y | 236 / 520 | 956.5 / 867.1 |
| Eyeline center x/y | 261 / 390 | 1020.2 / 560.3 |
| Beacon cap/lantern/balcony x/y/width/height | 280 / 188 / 73 / 85 | 1198.3 / 136.5 / 192.4 / 217.1 |

At 1440×900 the 8:5 master already fits exactly, so object-position alone cannot change the corner. The final plate instead uses a 1.3× crop around 75%/0%, restricted to desktop widths ≥1024, heights ≥600 and ratios 8:5 through 16:9. `object-position: center 77%` preserves roughly 28px of ground below Mochi at both ratio endpoints. The film and destination apply the same transform to the final plate and poster. Flower clearance and exact visual balance need browser confirmation.

Portrait and short landscape framing are unchanged. For the 844×390 landscape view, use the original uncropped 1440×900 landmarks: silhouette 816/322/298/349, foot 985/667, eyeline 1034/431, beacon 1171/105/148/167. With `s = max(viewWidth / 1440, viewHeight / 900)`, map using `x′ = x*s - (1440*s-viewWidth)/2` and `y′ = y*s - (900*s-viewHeight)*0.15`. Other ratios follow CSS cover positioning and need a matching destination transform.

There was no implemented/captured Slice B prologue in the accessible worktrees on 2026-11-14. Consequently these are **provisional registration targets**. Before accepting a matched dissolve, the integrator must capture the actual destination at all three requested sizes, compare silhouette size, foot, eyeline and beacon, and align to within roughly 4 CSS pixels at each reference size. If the live stage cannot match, regenerate the final plate from that captured reference. A dissolve by itself does not correct a spatial jump.

## Input, focus and layout

- The heading receives focus on entry and page changes without a pointer focus ornament. Intentional keyboard navigation reveals a full 3px cream perimeter with 12px clearance, separated from the painting by harbor ink. A permanent 18px scroll gutter contains the ring; detail copy has 20px separation. Focus changes no layout dimensions, and pointer input clears the ornament. Rendered contrast, clipping and forced-colors behavior still need browser verification. Native buttons retain their full visible keyboard focus outline. The reading region is explicitly `tabIndex={-1}`; Arrow Up/Down, Page Up/Down, Home and End scroll its overflowing text from caption focus.
- Forward Tab: caption → Skip film → Continue → Skip film. Reverse Tab from caption goes to Continue. Native buttons retain Enter/Space behavior. Keyboard shortcuts remain scoped to the film.
- Artwork pointer down/up/cancel restores caption focus immediately, before image decoding; dragged, canceled and non-primary gestures do not advance. Reading retains native touch scrolling.
- Progress remains visible on all seven scenes: 8px completed markers, an 18×8px current marker, and “Scene n of 7” associated with the heading. Indicators are not buttons.
- Network-pending advancement says **Preparing…**; a queued scene edit says **Turning page…**, keeping the action footprint stable. Skip remains available. A missing image keeps the previous painting and gives an honest reading-continuation message after the 15-second allowance.
- Rotation selects a newly decoded format before replacing the visible plate. While the portrait/landscape variant loads, the previous valid image stays visible; a failed variant does not erase it.
- Portrait plates reserve the header, lower caption and control regions. Settled desktop uses one coherent landscape painting reaching both edges; there is no repeated background, blurred Mochi, portrait inset or seam. Caption, detail and progress share one left edge. Desktop controls form a group with a 28px gap after the dots; short landscape controls are capped at 310px (right edge 336px at 844×390), clear of the observed oar around x365. Scrims are code-native and concentrated behind text, with lighter treatment for morning scenes.

## Preview and verification

The temporary development wiring in `../Opening.tsx` selects `Preview.tsx` at `/outing/?wrens-light`. After Complete or Skip, the preview mounts its inline final poster and inert end card, decodes that local poster, and sets `destinationReady`. Full responsive art loads independently and remains hidden until decoded; failure keeps the poster. Only `onExited` removes the film, reveals the card and focuses its heading. Replay invalidates stale decodes and starts fresh. This demonstrates a film-only destination, not the real prologue. Normal title behavior, `?play`, account state and returning-player eligibility remain integration-owned.

Run with Bun:

```sh
bun test web/src/opening
bun run typecheck
bun --no-env-file scripts/optimize-opening-assets.ts
bun --no-env-file web/src/opening/wrens-light/verify-browser.ts
```

`verify-browser.ts` separates two kinds of evidence. The isolated contract fixture tests delayed readiness, completion/Skip/Escape, explicit ref focus after reveal, both Tab directions, canceled gestures followed by Enter/Space/Right Arrow, pending images, enlarged text, all scenes and target viewports in Chromium/WebKit. Its destination is explicitly named “Contract destination”; it is **not** evidence that the actual harbor works. Mid-transition captures freeze both JavaScript timers and CSS animation before starting the edit, then save separate 25%, 50% and 75% frames; settled captures resume both and await all film animations, not image opacity alone. Warm cuts also sample 44/49/51/56% to check exclusive plate exposure beneath full light coverage. Additional checks cover 12px focus clearance, unchanged caption/plate during Skip, immediate busy feedback, completion controls gone by exit midpoint, and first-image selection at desktop DPR 1/2 and phone DPR 3. These checks are prepared but were not run. Focus events are not screen-reader announcements.

After the integrator connects Slice B, run the real first-device journey in an environment that permits a local server:

```sh
OPENING_INTEGRATION_URL=http://127.0.0.1:5173/outing/?wrens-light bun --no-env-file web/src/opening/wrens-light/verify-browser.ts
```

That optional path visits the real app and requires the actual prologue heading to receive focus, with all three approved actions present. It covers completion, Skip and Escape with held cold harbor assets and a warm navigation. Use a URL that explicitly replays the new-device film; it must not be the standalone film-only preview left on this branch. Without the URL it prints **NOT RUN**, not a passing integration result.

Verification on 2026-11-14:

| Check | Observed result |
| --- | --- |
| `bun test web/src/opening` | 52 passed, 0 failed, 708 assertions. |
| `bun run typecheck` | Passed after the final code and harness edits. |
| Full `bun run test` | 531 passed, 9 failed, 40,623 assertions; all failures are HTTP fixtures reporting EADDRINUSE while binding port 0 in this sandbox. This is not a passing full-suite claim. |
| Rust contracts | Not rerun in this Bun-only frontend revision; contract files are outside the allowed boundary. |
| Browser journeys / captures | Not run, as instructed. The eleven supplied v4 captures informed these changes; updated checks are prepared for opaque warm midpoints, focus clearance, immediate exit feedback and direct Skip. New bloom/crop appearance is unverified. |

No physical-phone, WebKit/Chromium rendered-layout, screen-reader, motion-comfort or newcomer-comprehension pass is claimed. The actual Slice B integration and cross-scene registration remain unverified.

## Art provenance

Masters, preserved native outputs and exact prompts live under `web/assets/source/opening/`. `provenance.json` consolidates the per-family prompt records, including `art-arrival-prompts.json`. Runtime WebPs, source/output hashes, dimensions and bytes are in `web/public/assets/opening/manifest.json` and `provenance.json`.

Masters remain **1170×2532 portrait** and **2304×1440 landscape**, unchanged. Runtime WebPs use proportional Lanczos resizing to **780×1688 portrait**, **1728×1080 landscape**, and **2880×1800 desktop**, with WebP quality **87**, method 6, sharp YUV and stripped metadata. No crop or repaint. The 2880px version is an explicit upsample of the approved 2304px master; native generator outputs are approximately 1586px wide landscape. It avoids browser enlargement of the smaller 1728px delivery file, but adds no new native detail. Physical high-DPR sharpness remains unverified.

| Delivery set | Film bytes | First storm bytes |
| --- | ---: | ---: |
| Portrait, unchanged | 1,035,864 | 172,552 |
| 1728px landscape, unchanged | 1,399,252 | 184,376 |
| 2880px desktop, seven added files | 2,539,964 | 330,610 |

All 21 WebPs occupy **4,975,080 bytes**; that is an archive total, not a single-visit download. Existing fourteen WebPs remain byte-identical, so phone image bytes do not increase. A desktop browser selects a candidate; resizing/rotation may fetch multiple versions. The two storm posters retain their exact bytes; two added Mochi posters bring the inline total to **6,304 data-URI bytes** in a **6,573-byte** TypeScript module. The optimizer enforces per-film budgets of 1,250,000 / 1,800,000 / 3,200,000 bytes and first-plate budgets of 200,000 / 300,000 / 500,000 bytes, with at most 10,000 inline data-URI bytes. Manifest and provenance include actual dimensions, source/output SHA256 hashes, encoding and the upsample limitation. This revision ran the optimizer and verified all 21 full-size delivery hashes remain unchanged; the four inline posters have individual hashes and source records. No art generation was used; existing approved masters were re-encoded.

The built-in `image_gen.imagegen` tool generated the plates. `gpt-6-astra` is recorded as the requested model; the tool did not expose its backend model, so actual model identity is unverified. Native generator dimensions differ from the requested delivery size. Provenance records the preserved raw hashes and any proportional normalization; images are never squeezed, text is never painted into them, and the optimizer does not silently crop a subject.

No commit, push, branch creation, signing, account call or app-file integration is part of this change.
