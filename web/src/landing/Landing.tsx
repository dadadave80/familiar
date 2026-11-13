import { planUrl } from "../plan-url";
import "./landing.css";

const art = "/assets/first-light-motion/";

export function Landing() {
  return (
    <div className="familiar-landing">
      <a className="fl-skip" href="#adventure">Skip to the adventure</a>
      <header className="fl-header">
        <a className="fl-wordmark" href="/" aria-label="Familiar home">familiar<span>.</span></a>
        <nav aria-label="Main navigation">
          <a className="fl-nav-story" href="#tide">The adventure</a>
          <a className="fl-play fl-play-small" href="/outing/">Play Familiar</a>
        </nav>
      </header>

      <main id="adventure">
        <section className="fl-hero" aria-labelledby="fl-title">
          <div className="fl-intro">
            <h1 id="fl-title">A small friend.<br />A light to<br />bring home.</h1>
            <p>Meet Mochi. A curious little companion with a very big job. Read the tide, recover what the storm scattered, and bring a sleepy harbor back to life.</p>
            <a className="fl-play" href="/outing/">Play Familiar</a>
            <p className="fl-entry-note">In your browser. At your pace. No sign-up.</p>
            <a className="fl-story-link" href="#tide">See how the tide turns</a>
          </div>
          <figure className="fl-harbor">
            <div className="fl-harbor-scene">
              <img className="fl-harbor-backdrop" src={`${art}harbor.webp`} width="1536" height="1024" alt="Pocket Harbor at sunset, with a little bakery by the water and a lighthouse waiting across the bay." fetchPriority="high" />
              <img className="fl-hero-mochi" src={`${art}mochi.webp`} width="1280" height="1200" alt="Mochi, an orange companion with a red scarf and a satchel, ready to explore." />
            </div>
            <figcaption>There’s a whole little world on the other side of the water.</figcaption>
          </figure>
        </section>

        <section className="fl-tide" id="tide" aria-labelledby="fl-tide-title">
          <div className="fl-tide-heading">
            <h2 id="fl-tide-title">Sometimes the wave<br />is the way forward.</h2>
            <p>The Tidekeeper marks a source, then sends a wave. Cross the connected platforms and it might open the shell you needed. Stay a little longer and you might bring someone home.</p>
          </div>
          <figure className="fl-court">
            <div className="fl-court-scene">
              <img className="fl-court-backdrop" src={`${art}arena.webp`} width="1536" height="1024" alt="Beacon Court concept illustration above the water, with a lens cradle to the left and a nest to the right." loading="lazy" />
              <img className="fl-court-guardian" src={`${art}tidekeeper.webp`} alt="" loading="lazy" />
              <img className="fl-court-mochi" src={`${art}mochi.webp`} alt="" loading="lazy" />
            </div>
            <figcaption>Beacon Court concept art. In the game, Mochi crosses connected platforms.</figcaption>
          </figure>
          <dl className="fl-choices">
            <div>
              <dt>Bring a little ingenuity.</dt>
              <dd>Choose Rope to reel in an exposed find, or Lantern to redirect a marked source. Two uses. Your call.</dd>
            </div>
            <div>
              <dt>Make room for a detour.</dt>
              <dd>A lens takes one pack slot. A wind-moth takes two. Decide what’s worth one more turn, then carry your finds back to the dock.</dd>
            </div>
            <div>
              <dt>Come home with a story.</dt>
              <dd>Install what you recover. Watch the lighthouse glow. Mochi remembers a moment from the trip you actually took.</dd>
            </div>
          </dl>
        </section>

        <section className="fl-wind" aria-labelledby="fl-wind-title">
          <figure className="fl-wind-scene">
            <img src={`${art}wind-gate-v1.webp`} width="1536" height="1024" alt="Wind Gate concept illustration, where stone channels route the tide through a turning wheel." loading="lazy" />
            <figcaption>Wind Gate concept art. This outing opens after you restore the lighthouse.</figcaption>
          </figure>
          <div className="fl-wind-copy">
            <h2 id="fl-wind-title">You know the tide.<br />Now turn it.</h2>
            <p>Beyond the beacon, the channel sends a familiar wave somewhere new. Align the wheel, trace the exit, and charge Left and Center to recover the harbor’s Signal Vane.</p>
            <p>Rope or Lantern. A different route. Something else to bring home.</p>
            <a className="fl-story-link" href="/outing/">Begin with Beacon Court</a>
          </div>
        </section>

        <section className="fl-invitation" aria-labelledby="fl-invitation-title">
          <img src={`${art}moth.webp`} alt="" loading="lazy" />
          <h2 id="fl-invitation-title">Mochi’s ready when you are.</h2>
          <p>A little planning. A splash of courage. A place to come back to.</p>
          <a className="fl-play" href="/outing/">Play Familiar</a>
          <p className="fl-save-note">Progress saves in this browser on this device. You’ll need a connection to load the game.</p>
        </section>
      </main>

      <footer className="fl-footer">
        <a className="fl-wordmark" href="/">familiar<span>.</span></a>
        <nav aria-label="More about Familiar">
          <a href={planUrl}>The design book</a>
          <a href="/motion/">Mochi in motion</a>
        </nav>
      </footer>
    </div>
  );
}
