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
            <p>Guide Mochi as a volunteer harbor helper. Bring home the missing Beacon Lens and help the harbor find its light again.</p>
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
            <h2 id="fl-tide-title">Read the water. Bring the light home.</h2>
            <p>Each step or wait advances the water. A wave arrives after every third move. Read its lanes, cross the moving bridge, and carry your finds back to the center dock.</p>
          </div>
          <figure className="fl-court">
            <div className="fl-court-scene">
              <img className="fl-court-backdrop" src={`${art}arena.webp`} width="1536" height="1024" alt="Beacon Court concept illustration above the water, with a lens cradle to the left and a nest to the right." loading="lazy" />
              <img className="fl-court-guardian" src={`${art}tidekeeper.webp`} alt="" loading="lazy" />
              <img className="fl-court-mochi" src={`${art}mochi.webp`} alt="" loading="lazy" />
            </div>
            <figcaption>Beacon Court concept art.</figcaption>
          </figure>
          <dl className="fl-choices">
            <div>
              <dt>One clear errand.</dt>
              <dd>Bring the Beacon Lens home from the left shell. Your first outing has eight calm waves.</dd>
            </div>
            <div>
              <dt>Keep what you bank.</dt>
              <dd>Step onto the center dock to bank cargo. Banking keeps the outing open; finishing returns you to the harbor.</dd>
            </div>
            <div>
              <dt>Make the return matter.</dt>
              <dd>Fit the lens into the beacon. Each repair uncovers another piece of the harbor’s story.</dd>
            </div>
          </dl>
        </section>

        <section className="fl-wind" aria-labelledby="fl-wind-title">
          <figure className="fl-wind-scene">
            <img src={`${art}wind-gate.webp`} width="1536" height="1024" alt="Wind Gate concept illustration, where stone channels route the tide through a turning wheel." loading="lazy" />
            <figcaption>Wind Gate concept art. Optional outings have their own rules on the Harbor chart.</figcaption>
          </figure>
          <div className="fl-wind-copy">
            <h2 id="fl-wind-title">A harbor worth helping.</h2>
            <p>Once the beacon shines, the Harbor chart opens other ways to help. Bell Steps, Reed Steps, and the optional courts each explain their own outing.</p>
            <a className="fl-story-link" href="/outing/">Begin with Mochi</a>
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
      </footer>
    </div>
  );
}
