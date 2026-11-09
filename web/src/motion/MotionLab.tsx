import { useEffect, useRef, useState, type CSSProperties } from "react";
import { MotionPlayer } from "./timeline";
import { CLIPS, sampleScene, type ClipId, type SceneState } from "./scenes";
import "./motion.css";

const ART = "/assets/first-light-motion/";
const ASSETS = [
  "arena",
  "harbor",
  "mochi",
  "mochi-step",
  "bram",
  "tidekeeper",
  "moth",
  "lens",
  "wave",
  "shell",
];
const LANES = [21, 50, 79];
const position = (x: number, y: number): CSSProperties => ({ left: `${x}%`, top: `${y}%` });

function Glyph({
  name,
}: {
  name: "play" | "pause" | "replay" | "finish" | "arrow" | "heart" | "sun";
}) {
  const paths = {
    play: "m8 5 11 7-11 7Z",
    pause: "M8 5v14M16 5v14",
    replay: "M4 10a8 8 0 1 1 1 8M4 4v6h6",
    finish: "m5 5 10 7-10 7ZM19 5v14",
    arrow: "M5 12h14m-6-6 6 6-6 6",
    heart: "M12 20S3 14 3 8.5a4.5 4.5 0 0 1 9-1 4.5 4.5 0 0 1 9 1C21 14 12 20 12 20Z",
    sun: "M12 3V1m0 22v-2M3 12H1m22 0h-2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
  };
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={paths[name]} />
    </svg>
  );
}

function Scene({
  state: s,
  clip,
  time,
  reduced,
}: {
  state: SceneState;
  clip: ClipId;
  time: number;
  reduced: boolean;
}) {
  const stepping = clip === "dodge" && s.mochiX > 21 && s.mochiX < 50;
  const waveX = s.waveLane === null ? 50 : LANES[s.waveLane]!;
  const hover = reduced ? 0 : Math.sin(time / 350) * 1.2;
  const wings = reduced ? 1 : .86 + Math.sin(time / 100) * .14;
  const lift = reduced ? 0 : s.mochiLift;
  const shellOpen = clip === "reel" ? 1 : s.lensOpacity;
  return (
    <>
      <img
        className="motion-backdrop"
        src={`${ART}${s.harbor ? "harbor" : "arena"}.png`}
        alt=""
      />
      <div className="motion-sunset" style={{ opacity: s.beacon * .22 }} />
      {s.harbor ? (
        <>
          <div
            className="beacon-beam"
            style={{
              opacity: s.beacon * .6,
              transform: `rotate(${-14 + s.beacon * 12}deg) scaleX(-1)`,
            }}
          />
          <div className="beacon-lamp" style={{ opacity: s.beacon }} />
          <div
            className="motion-actor bram-actor"
            style={{ ...position(25, 82), opacity: s.bram }}
          >
            <span className="actor-shadow" />
            <img
              src={`${ART}bram.png`}
              alt=""
              style={{
                transform: `rotate(${reduced ? 0 : Math.sin(time / 700) * 1.1}deg)`,
              }}
            />
          </div>
        </>
      ) : (
        <>
          <div
            className="guardian-ripple"
            style={{
              transform: `translate(-50%, -50%) scale(${1 + s.guardianLift / 100})`,
              opacity: .3 + s.guardianLift / 100,
            }}
          />
          <img
            className="tidekeeper-actor"
            src={`${ART}tidekeeper.png`}
            alt=""
            style={{
              transform: `translate(-50%, -100%) translateY(${-s.guardianLift / 10}cqw) scale(${s.guardianScale})`,
            }}
          />
          {(clip === "dodge" || clip === "lure" || clip === "reel") && <>
            <div className="shell-barrier" data-open={shellOpen} style={position(18, 43)}>
              {[-1, 1].map(side => <img
                key={side}
                src={`${ART}shell.png`}
                alt=""
                style={{
                  clipPath: side < 0 ? "inset(0 50% 0 0)" : "inset(0 0 0 50%)",
                  transform: `translate(${side * shellOpen * 45}%, ${shellOpen * 24}%) rotate(${side * shellOpen * 35}deg)`,
                }}
              />)}
            </div>
            <div className="shell-barrier" style={position(83, 43)}>
              <img src={`${ART}shell.png`} alt="" />
            </div>
          </>}
          {s.targetLane !== null && (
            <div
              className="lane-mark target-mark"
              style={{ ...position(LANES[s.targetLane]!, 57), opacity: s.targetOpacity }}
            >
              <span>{clip === "vane" ? "Locked source" : "Wave here"}</span>
            </div>
          )}
          {clip === "vane" && s.waveLane !== null && (
            <div
              className="lane-mark exit-mark"
              style={{ ...position(LANES[s.waveLane]!, 57), opacity: s.targetOpacity }}
            >
              <span>Wave exits here</span>
            </div>
          )}
          {s.echoLane !== null && (
            <div
              className="lane-mark echo-mark"
              style={{ ...position(LANES[s.echoLane]!, 60), opacity: s.echoOpacity }}
            >
              <span>Echo next</span>
            </div>
          )}
          {clip === "vane" && (
            <div className="vane-instrument" aria-hidden="true">
              <svg viewBox="0 0 72 72">
                <circle cx="36" cy="36" r="32" />
                <path d="M36 6v6M36 60v6M6 36h6M60 36h6" />
                <g
                  style={{
                    transform: `rotate(${s.vaneRotation}deg)`,
                    transformOrigin: "36px 36px",
                  }}
                >
                  <path className="vane-pointer" d="m36 14 8 25-8-4-8 4Z" />
                  <path d="M36 35v22" />
                </g>
              </svg>
              <span>Signal vane</span>
            </div>
          )}
        </>
      )}
      <svg
        className="motion-rope"
        viewBox="0 0 1000 667"
        aria-hidden="true"
        style={{ opacity: s.ropeProgress > 0 ? 1 : 0 }}
      >
        <path
          d={`M ${s.mochiX * 10} ${(s.mochiY - 8) * 6.67} Q ${(s.mochiX + s.lensX) * 5} ${s.mochiY * 6.67 - 140} ${s.lensX * 10} ${s.lensY * 6.67}`}
          pathLength="1"
          strokeDasharray="1"
          strokeDashoffset={1 - s.ropeProgress}
        />
      </svg>
      <div
        className="motion-lens"
        style={{
          ...position(s.lensX, s.lensY),
          opacity: s.lensOpacity,
          transform: `translate(-50%, -50%) rotate(${clip === "reel" ? s.ropeProgress * -12 : 0}deg)`,
        }}
      >
        <img src={`${ART}lens.png`} alt="" />
      </div>
      <div className="motion-actor mochi-actor" style={position(s.mochiX, s.mochiY)}>
        <span
          className="actor-shadow"
          style={{
            opacity: .22 - Math.min(lift / 220, .14),
            transform: `translateX(-50%) scale(${1 - Math.min(lift / 180, .25)})`,
          }}
        />
        <img
          src={`${ART}${stepping ? "mochi-step" : "mochi"}.png`}
          alt=""
          style={{
            transform: `translateY(${-lift / 10}cqw) rotate(${s.mochiRotate}deg) scale(${s.mochiScaleX}, ${s.mochiScaleY})`,
          }}
        />
      </div>
      <div
        className="lure-ring"
        style={{
          ...position(21, 53),
          opacity: s.lureOpacity,
          transform: `translate(-50%, -50%) scale(${.7 + s.lureOpacity * .4})`,
        }}
      >
        <Glyph name="sun" />
      </div>
      {s.waveLane !== null && (
        <div
          className="motion-wave"
          style={{
            ...position(waveX, 42 + s.waveProgress * 23),
            opacity: s.waveOpacity,
            transform: `translate(-50%, -50%) scale(${.5 + s.waveProgress * .7})`,
          }}
        >
          <img src={`${ART}wave.png`} alt="" />
        </div>
      )}
      {s.celebration > 0 && (
        <div
          className="motion-celebration"
          style={{ opacity: s.celebration }}
          aria-hidden="true"
        >
          {Array.from({ length: 7 }, (_, i) => (
            <i
              key={i}
              style={{
                left: `${s.mochiX + (i - 3) * 3}%`,
                top: `${s.mochiY - 23 - Math.sin(i * 1.7) * 6}%`,
                transform: `translateY(${-s.celebration * 1.4}cqw) rotate(${i * 37}deg)`,
              }}
            />
          ))}
        </div>
      )}
      <div
        className="motion-moth"
        style={{
          ...position(65 + hover * 1.7, 65 + hover),
          opacity: s.moth,
          transform: `translate(-50%, -50%) rotate(${hover * 4}deg) scaleX(${wings})`,
        }}
      >
        <img src={`${ART}moth.png`} alt="" />
      </div>
      {!s.harbor && (
        <div className="lane-names" aria-hidden="true">
          <span>Left</span>
          <span>Center</span>
          <span>Right</span>
        </div>
      )}
    </>
  );
}

export function MotionLab() {
  const [clipId, setClipId] = useState<ClipId>("dodge");
  const clip = CLIPS.find(c => c.id === clipId)!;
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [systemReduced, setSystemReduced] = useState(
    () => matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const [motionOverride, setMotionOverride] = useState<boolean | null>(null);
  const reduced = motionOverride ?? systemReduced;
  const [assetState, setAssetState] = useState<"loading" | "ready" | "error">("loading");
  const [loadAttempt, setLoadAttempt] = useState(0);
  const player = useRef<MotionPlayer | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const state = sampleScene(clipId, time);

  function stageVisible() {
    const bounds = stage.current?.getBoundingClientRect();
    return !!bounds &&
      Math.min(bounds.bottom, innerHeight) - Math.max(bounds.top, 0) >= bounds.height * .25;
  }

  useEffect(() => {
    document.title = "First Light, in motion · Familiar";
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setSystemReduced(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let active = true;
    setAssetState("loading");
    Promise.all(
      ASSETS.map(name => {
        const image = new Image();
        image.src = `${ART}${name}.png`;
        return image.decode();
      }),
    ).then(
      () => {
        if (active) setAssetState("ready");
      },
      () => {
        if (active) setAssetState("error");
      },
    );
    return () => {
      active = false;
    };
  }, [loadAttempt]);

  useEffect(() => {
    const current = new MotionPlayer({
      duration: clip.duration,
      onFrame: next => {
        setTime(next);
        setPlaying(current.state.playing);
      },
    });
    player.current = current;
    current.reset();
    const pause = () => {
      current.pause();
      setPlaying(false);
    };
    const onVisibility = () => {
      if (document.hidden) pause();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const observer = new IntersectionObserver(
      entries => {
        if (
          (!entries[0]?.isIntersecting || entries[0].intersectionRatio < .25) &&
          !stageVisible()
        ) pause();
      },
      { threshold: [0, .25] },
    );
    if (stage.current) observer.observe(stage.current);
    return () => {
      current.destroy();
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      player.current = null;
    };
  }, [clipId, clip.duration]);

  useEffect(() => {
    if (reduced && player.current?.state.playing) player.current.finish();
  }, [reduced]);

  function play(replay = false) {
    const current = player.current;
    if (!current || assetState !== "ready") return;
    if (document.hidden) return;
    if (!stageVisible()) stage.current?.scrollIntoView({
      block: "center",
      behavior: "instant",
    });
    if (replay || current.state.time === clip.duration) current.reset();
    if (reduced) current.finish();
    else {
      current.play();
      setPlaying(current.state.playing);
    }
  }

  return (
    <main className="motion-lab">
      <header className="motion-masthead">
        <a href="/" className="familiar-wordmark">
          familiar<span> a little world, together.</span>
        </a>
        <span className="motion-edition">First Light · Motion study</span>
      </header>
      <section className="motion-introduction">
        <h1>First Light, <em>in motion.</em></h1>
        <p>
          A twitch of the ears. A wave worth watching.<br className="desktop-break" /> A little harbor coming back to life.
        </p>
      </section>
      <div className="motion-workbench">
        <div className="motion-theatre">
          <div
            ref={stage}
            className="motion-stage"
            data-testid="motion-stage"
            data-reduced={String(reduced)}
            data-playing={String(playing)}
          >
            <div
              className="motion-scene-art"
              role="img"
              aria-label={`${clip.title}. ${state.cue}. ${state.detail}${state.harbor ? "" : ` Resolve: ${state.resolve} of 3.`}`}
            >
              <Scene key={loadAttempt} state={state} clip={clipId} time={time} reduced={reduced} />
              <div className="scene-title">
                <span className="scene-status-dot" />
                {state.harbor ? "Pocket Harbor" : "The Tidekeeper’s shore"}
              </div>
              {!state.harbor && (
                <div className="resolve-display" aria-hidden="true">
                  <span>Resolve</span>
                  {[1, 2, 3].map(n => (
                    <span key={n} className={n > state.resolve ? "resolve-lost" : ""}>
                      <Glyph name="heart" />
                    </span>
                  ))}
                </div>
              )}
            </div>
            {assetState !== "ready" && (
              <div className="motion-load-state" role="status">
                <p>
                  {assetState === "loading"
                    ? "Setting the little stage…"
                    : "The scene art couldn’t load."}
                </p>
                {assetState === "error" && (
                  <button onClick={() => setLoadAttempt(n => n + 1)}>Try again</button>
                )}
              </div>
            )}
          </div>
          <div
            className="motion-caption"
            data-testid="motion-status"
            data-clip={clipId}
            data-time={Math.round(time)}
            data-duration={clip.duration}
            data-playing={String(playing)}
          >
            <div className="motion-phase">{state.phase}</div>
            <div aria-live="polite" aria-atomic="true">
              <h2>{state.cue}</h2>
              <p>{state.detail}</p>
            </div>
          </div>
          <div className="motion-transport">
            <div className="motion-scrub">
              <label className="sr-only" htmlFor="motion-time">Scrub animation</label>
              <input
                id="motion-time"
                type="range"
              aria-valuetext={`${(time / 1000).toFixed(1)} of ${(clip.duration / 1000).toFixed(1)} seconds`}
                min="0"
                max={clip.duration}
                step="1"
                value={Math.round(time)}
                disabled={assetState !== "ready"}
                onChange={event => {
                  player.current?.pause();
                  player.current?.seek(Number(event.target.value));
                }}
                style={{ "--progress": `${time / clip.duration * 100}%` } as CSSProperties}
              />
              <span>
                {(time / 1000).toFixed(1)} <span>/ {(clip.duration / 1000).toFixed(1)}s</span>
              </span>
            </div>
            <div className="motion-buttons">
              <button
                className="motion-primary"
                disabled={assetState !== "ready"}
                onClick={() => playing ? player.current?.pause() : play()}
              >
                <Glyph name={playing ? "pause" : "play"} />
                {playing ? "Pause" : "Play"}
              </button>
              <button disabled={assetState !== "ready"} onClick={() => play(true)}>
                <Glyph name="replay" />Replay
              </button>
              <button disabled={assetState !== "ready"} onClick={() => player.current?.finish()}>
                <Glyph name="finish" />Finish
              </button>
              <label className="reduced-control">
                <input
                  type="checkbox"
                  checked={reduced}
                  onChange={event => setMotionOverride(event.target.checked)}
                />
                <span>Reduced motion</span>
              </label>
            </div>
          </div>
        </div>
        <aside className="motion-library" aria-label="Animation sequences">
          <div className="motion-library-heading">
            <h2>Little moments.</h2>
            <span>09 scenes</span>
          </div>
          {(["Encounter", "Homecoming"] as const).map(chapter => (
            <div className="motion-chapter" key={chapter}>
              <h3>{chapter}</h3>
              {CLIPS.filter(c => c.chapter === chapter).map(c => (
                <button
                  key={c.id}
                  data-motion-clip={c.id}
                  aria-pressed={c.id === clipId}
                  onClick={() => {
                    player.current?.pause();
                    setTime(0);
                    setPlaying(false);
                    setClipId(c.id);
                    player.current?.reset();
                  }}
                >
                  <span>{c.title}<small>{c.description}</small></span>
                  <Glyph name="arrow" />
                </button>
              ))}
            </div>
          ))}
          <p className="motion-library-note">Take your time. The tide waits for you.</p>
        </aside>
      </div>
      <footer className="motion-footer">
        <p>Authored animation preview · No gameplay progress is saved.</p>
        <p>Silent by design. Play to begin.</p>
      </footer>
    </main>
  );
}
