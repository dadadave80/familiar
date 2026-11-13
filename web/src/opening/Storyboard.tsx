// Dev-only storyboard (/outing/?storyboard under `vite dev`), ported from "Familiar Opening Storyboard.dc.html".
// Every frame is the real Opening frozen at a beat, so the board and the build cannot drift apart.
import { useState } from "react";
import { HarborAudio } from "../expedition/audio";
import Opening, { sx, type OpeningBeat } from "./Opening";

interface Beat { beat: OpeningBeat; title: string; notes: [string, string][] }
const BEATS: Beat[] = [
  { beat: "boot", title: "The tide finds the title", notes: [
    ["Time", "0.0–0.6 s water rises to the foot of the wordmark. Then it climbs the letters at the pace of the real download, never faster than 1.3 s."],
    ["Picture", "Dusk-green field, the wordmark unlit. Below the waterline the letters are lit. No spinner, bar or sentence."],
    ["Sound", "None. Sound has not been chosen yet."]] },
  { beat: "title", title: "The harbor surfaces", notes: [
    ["Time", "0.0–0.9 s the tide crests over the frame. 0.4–1.1 s the dusk thins. 0.9–2.0 s the water clears. Camera settles from 110% to 103% over 2.6 s."],
    ["Picture", "The wordmark never moves: the loading mark is the title. 2.3 s chapter line. 3.2 s Mochi glances at the bell and it sways once. 3.9 s the prompt starts to breathe."],
    ["Idle", "Characters move on twelves, like the stop-motion felt they are. Glints on the sun road, lantern flicker, a 75 s drift of warm to cool light."]] },
  { beat: "bell", title: "Ring for sound", notes: [
    ["Input", "Tap the bell, or Tab to it and press Enter. It never starts the game."],
    ["Motion", "0 ms the bell swings and two rings leave it (0.9 s decay). 0–220 ms Mochi startles, then 0.9 s of delight. Bram nods. The tag turns to “Sound on”."],
    ["Sound", "The shipped bell recipe, then at 0.95 s the three-note harbor phrase. Ring again to hush. The choice and the mix carry into play."]] },
  { beat: "attract", title: "Left alone, it plays", notes: [
    ["Time", "After 20 s untouched. Tide wipe: 0.62 s up, 0.14 s held, 0.52 s clear. About 13 s in the court, then the same wipe home."],
    ["Picture", "Three scripted decisions. Each shows its outcome first (ring and ghost, 0.8 s), then the step (0.44 s). Rising: the Tidekeeper leans and marks Left. Surge: wave 0.95 s, bridge 0.52 s, oyster 0.7 s, Mochi turns to look."],
    ["Input", "Any key or tap returns to the title."]] },
  { beat: "menu", title: "The signpost answers", notes: [
    ["Time", "0.00 s prompt out (0.18 s). Planks swing out 0.56 s each, 75 ms apart, with overshoot. 0.64 s the wind-moth lifts from the bell arm."],
    ["Signature", "The moth alights on the chosen plank and it dips under the weight, settling in 0.9 s. Mochi watches the signs."],
    ["Input", "Up, Down, W, S or hover to choose. Enter or tap to commit. Esc folds the signs."]] },
  { beat: "travel", title: "Into play", notes: [
    ["Time", "0.00 s the chosen plank knocks and Mochi’s paw comes up. 0.26 s planks fold, 40 ms apart. 0.26–3.06 s one camera move, eased in and out. 0.41–1.91 s the title lifts and thins."],
    ["Picture", "The moth flies ahead. 2.16 s Mochi looks up. 3.16 s the tide rises (0.62 s), holds until the game has loaded, then clears in 0.52 s over the harbor screen."],
    ["Sound", "Pickup chime on commit, then the shipped two-note departure phrase under the move."]] },
];
const PHONE: [OpeningBeat, string][] = [["title", "Title"], ["menu", "Title menu"], ["travel", "Into play"], ["attract", "Attract"]];
const noop = () => Promise.resolve();

export default function Storyboard() {
  const [audio] = useState(() => new HarborAudio());
  const frame = (beat: OpeningBeat) => <Opening framed beat={beat} audio={audio} hasSave={false} onStart={noop} onDone={() => {}} />;
  const h2 = sx("margin:0;font:600 22px/1.15 'Fraunces Variable',serif;letter-spacing:-.02em");
  const list = sx("margin:0;padding-left:18px;display:flex;flex-direction:column;gap:6px;color:#535848");
  return (
    <main style={sx("min-height:100dvh;background:#f6f0e4")}>
      <style>{"html,body{margin:0;background:#f6f0e4}.fo-board a{color:#345341;text-underline-offset:.23em}.fo-board a:hover{color:#a54829}"}</style>
      <div className="fo-board" data-screen-label="Opening storyboard" style={sx("max-width:1500px;margin:0 auto;padding:clamp(20px,4vw,56px);box-sizing:border-box;color:#2e352a;font:400 15px/1.5 'Figtree Variable',sans-serif")}>
        <header style={sx("display:flex;flex-wrap:wrap;gap:16px 48px;align-items:flex-end;justify-content:space-between;padding-bottom:24px;border-bottom:1px solid #d8cfb9")}>
          <div style={sx("min-width:0;flex:1 1 420px")}>
            <div style={sx("font:700 12px/1 'Figtree Variable',sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#a54829")}>Familiar · First Light</div>
            <h1 style={sx("margin:10px 0 0;font:560 clamp(34px,4.4vw,60px)/1.04 'Fraunces Variable',serif;letter-spacing:-.035em;text-wrap:balance")}>The opening, beat by beat</h1>
            <p style={sx("margin:14px 0 0;max-width:62ch;color:#535848;text-wrap:pretty")}>Every frame below is the playable opening frozen at that beat, so the board and the build cannot drift apart. Times are measured from the start of each beat.</p>
          </div>
          <nav style={sx("display:flex;flex-wrap:wrap;gap:10px 22px;font-weight:650")}>
            <a href="/outing/">Play the opening</a>
            <a href="/outing/?play">Current harbor, as shipped</a>
          </nav>
        </header>

        <section style={sx("display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,400px),1fr));gap:44px 32px;margin-top:36px")}>
          {BEATS.map((b, i) => (
            <article key={b.beat} style={sx("display:flex;flex-direction:column;gap:12px;min-width:0")}>
              <div style={sx("position:relative;width:100%;aspect-ratio:16/10;border-radius:10px;overflow:hidden;background:#304e40")}>{frame(b.beat)}</div>
              <div style={sx("display:flex;align-items:baseline;gap:10px")}><span style={sx("font:700 12px/1 'Figtree Variable',sans-serif;letter-spacing:.12em;color:#a54829")}>{String(i + 1).padStart(2, "0")}</span><h2 style={h2}>{b.title}</h2></div>
              <dl style={sx("margin:0;display:grid;grid-template-columns:62px minmax(0,1fr);gap:6px 12px;font-size:14px;line-height:1.45")}>
                {b.notes.map(([k, v]) => [<dt key={k} style={sx("color:#625e4f;font-weight:700")}>{k}</dt>, <dd key={k + "d"} style={{ margin: 0 }}>{v}</dd>])}
              </dl>
            </article>))}
        </section>

        <section style={sx("margin-top:56px;padding-top:28px;border-top:1px solid #d8cfb9")}>
          <h2 style={{ ...h2, fontSize: 26, marginBottom: 18 }}>Phone, portrait</h2>
          <div style={sx("display:flex;flex-wrap:wrap;gap:24px 28px")}>
            {PHONE.map(([beat, label]) => (
              <figure key={beat} style={sx("margin:0;width:min(100%,210px)")}>
                <div style={sx("position:relative;width:100%;aspect-ratio:390/844;border-radius:14px;overflow:hidden;background:#304e40")}>{frame(beat)}</div>
                <figcaption style={sx("margin-top:8px;font-size:13px;color:#625e4f")}>{label}</figcaption>
              </figure>))}
          </div>
        </section>

        <section style={sx("margin-top:56px;padding-top:28px;border-top:1px solid #d8cfb9;display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:28px 48px")}>
          <div>
            <h2 style={{ ...h2, marginBottom: 12 }}>Where every word comes from</h2>
            <ul style={list}>
              <li>Court captions and forecasts, “Sound on / off”: from Game.tsx and the opening design.</li>
              <li>Menu labels, “First Light”, the Shells line: from the brief.</li>
              <li>Credits: the typefaces and libraries in package.json.</li>
              <li>New and provisional: “Press any key”, “Tap to begin”, “Back”, “Coming soon”.</li>
            </ul>
          </div>
          <div>
            <h2 style={{ ...h2, marginBottom: 12 }}>Still open</h2>
            <ul style={list}>
              <li>Today’s Tide is not built. Its scroll says “Coming soon” and no account or link appears.</li>
              <li>The menu offers Continue when this device has a harbor and New Harbor otherwise. Starting over needs its own beat.</li>
              <li>The court shown after 20 s is a scripted demo, not playable from the title.</li>
              <li>Mochi is “her” throughout; Bram is “he”.</li>
            </ul>
          </div>
        </section>
      </div>
    </main>
  );
}
