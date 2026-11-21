import { Component, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/figtree";
import { LANDSCAPE_MEDIA, LARGE_LANDSCAPE_MEDIA, OPENING_FINAL_CROP_MEDIA, openingPicture, openingPictureSet, openingPictureSizes, WRENS_LIGHT_SCENES } from "./wrens-light-scenes";
import { OPENING_PLACEHOLDER } from "./opening-placeholder";
import "./wrens-light-sequence.css";

export type WrensLightExit = "complete" | "skip";
export const WRENS_LIGHT_DISSOLVE_MS = 600;
export const WRENS_LIGHT_IMAGE_TIMEOUT_MS = 15000;

export interface WrensLightSequenceProps {
  /** Request the prologue. These notifications never skip its introduction. */
  onComplete(): void;
  onSkip(): void;
  /** True only when the mounted destination, its assets and explicit focus target are ready. */
  destinationReady?: boolean;
  /** Reveal/unmount the film, release destination inertness, then focus its explicit ref. */
  onExited?(reason: WrensLightExit): void;
  /** Storyboard frames fill their parent; normal playback fills the viewport. */
  framed?: boolean;
}

interface State {
  scene: number;
  picture: number;
  previous: string | null;
  landscape: boolean;
  largeLandscape: boolean;
  previousLargeLandscape: boolean;
  pending: boolean;
  unavailable: boolean;
  reduced: boolean;
  exit: WrensLightExit | null;
  revealing: boolean;
  loading: boolean;
  hasPicture: boolean;
  keyboard: boolean;
}

export class WrensLightSequence extends Component<WrensLightSequenceProps, State> {
  state: State = { scene: 0, picture: 0, previous: null, landscape: false, largeLandscape: false, previousLargeLandscape: false, pending: false, unavailable: false, reduced: false, exit: null, revealing: false, loading: true, hasPicture: false, keyboard: false };
  root: HTMLDivElement | null = null;
  caption: HTMLHeadingElement | null = null;
  reading: HTMLDivElement | null = null;
  private live = false;
  private generation = 0;
  private firstRequest = 0;
  private requested: WrensLightExit | null = null;
  private exitNotified = false;
  private pendingScene: number | null = null;
  private motion?: MediaQueryList;
  private landscape?: MediaQueryList;
  private largeLandscape?: MediaQueryList;
  private pictures = new Map<string, Promise<boolean>>();
  private cancelLoads = new Set<() => void>();
  private exitTimer?: ReturnType<typeof setTimeout>;
  private shotTimer?: ReturnType<typeof setTimeout>;
  private queuedAdvance = false;
  private pointer: { x: number; y: number; id: number } | null = null;

  componentDidMount() {
    this.live = true;
    ++this.generation;
    this.motion = matchMedia("(prefers-reduced-motion: reduce)");
    this.landscape = matchMedia(LANDSCAPE_MEDIA);
    this.largeLandscape = matchMedia(LARGE_LANDSCAPE_MEDIA);
    this.motion.addEventListener("change", this.updateMotion);
    this.landscape.addEventListener("change", this.updateFormat);
    this.largeLandscape.addEventListener("change", this.updateFormat);
    this.setState({ reduced: this.motion.matches, landscape: this.landscape.matches, largeLandscape: this.largeLandscape.matches, loading: true, hasPicture: false });
    this.focusCaption(true);
    this.prepareFirst();
  }

  private prepareFirst() {
    const request = ++this.firstRequest, generation = this.generation;
    void this.preparePicture(0).then(({ ready, landscape, largeLandscape }) => {
      if (!this.live || generation !== this.generation || request !== this.firstRequest || this.requested) return;
      this.setState({ loading: false, hasPicture: ready, unavailable: !ready, landscape, largeLandscape });
      if (ready) void this.loadPicture(1);
    });
  }

  componentDidUpdate() { this.beginReveal(); }

  componentWillUnmount() {
    this.live = false;
    this.generation++;
    this.pendingScene = null;
    clearTimeout(this.exitTimer);
    clearTimeout(this.shotTimer);
    this.motion?.removeEventListener("change", this.updateMotion);
    this.landscape?.removeEventListener("change", this.updateFormat);
    this.largeLandscape?.removeEventListener("change", this.updateFormat);
    for (const cancel of this.cancelLoads) cancel();
    this.pictures.clear();
  }

  private updateMotion = () => {
    const reduced = this.motion?.matches ?? false;
    this.setState({ reduced }, () => {
      if (reduced && this.state.revealing) this.finishReveal();
      else if (reduced) this.finishShot();
    });
  };
  private updateFormat = () => {
    if (this.state.revealing || this.requested) return;
    // Rotation prioritizes its first plate immediately, while still deferring the next scene.
    if (this.state.loading) { this.prepareFirst(); return; }
    const picture = this.state.picture, generation = this.generation;
    void this.preparePicture(picture).then(({ ready, landscape, largeLandscape }) => {
      if (!this.live || generation !== this.generation || this.state.picture !== picture || this.requested) return;
      if (!ready) { this.setState({ unavailable: true }); return; }
      clearTimeout(this.shotTimer);
      const advance = this.queuedAdvance;
      this.queuedAdvance = false;
      this.setState({ landscape, largeLandscape, hasPicture: true, previous: null, pending: this.pendingScene !== null, unavailable: false }, () => {
        if (advance) this.advance();
      });
      void this.loadPicture(this.state.scene + 1);
    });
  };
  private focusCaption = (reset = false) => {
    if (reset && this.reading) this.reading.scrollTop = 0;
    this.caption?.focus({ preventScroll: true });
  };

  private async preparePicture(index: number) {
    const generation = this.generation;
    let landscape: boolean, largeLandscape: boolean, ready: boolean;
    do {
      landscape = this.landscape?.matches ?? false;
      largeLandscape = this.largeLandscape?.matches ?? false;
      ready = await this.loadPicture(index, landscape, "high", largeLandscape);
    } while (this.live && generation === this.generation && (landscape !== (this.landscape?.matches ?? false) || largeLandscape !== (this.largeLandscape?.matches ?? false)));
    return { ready, landscape, largeLandscape };
  }

  private loadPicture(index: number, landscape = this.landscape?.matches ?? false, priority: "high" | "low" = "low", largeLandscape = this.largeLandscape?.matches ?? false): Promise<boolean> {
    if (index >= WRENS_LIGHT_SCENES.length) return Promise.resolve(true);
    const source = openingPicture(index, landscape);
    const srcSet = openingPictureSet(source, largeLandscape);
    // The desktop crop needs 1.3× the painted width, including when prewarming at DPR 1.
    const cropped = srcSet && source.endsWith("/mochi-quay-landscape.webp") && typeof matchMedia === "function" && matchMedia(OPENING_FINAL_CROP_MEDIA).matches;
    const rasterWidth = typeof window === "undefined" ? 0 : (cropped ? window.innerWidth * 1.3 : Math.max(window.innerWidth, window.innerHeight * 1.6)) * window.devicePixelRatio;
    const cacheKey = srcSet ? `${srcSet}|${rasterWidth > 1728 ? 2880 : 1728}` : source;
    const cached = this.pictures.get(cacheKey);
    if (cached) return cached;
    const promise = new Promise<boolean>(resolve => {
      const picture = new Image();
      let settled = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        picture.onload = picture.onerror = null;
        this.cancelLoads.delete(cancel);
        if (!ready) this.pictures.delete(cacheKey);
        resolve(ready);
      };
      const cancel = () => finish(false);
      // A missing picture must never trap the player between pages.
      const timeout = setTimeout(cancel, WRENS_LIGHT_IMAGE_TIMEOUT_MS);
      this.cancelLoads.add(cancel);
      picture.onload = () => { void picture.decode().then(() => finish(true), () => finish(false)); };
      picture.onerror = cancel;
      picture.fetchPriority = priority;
      if (srcSet) { picture.sizes = openingPictureSizes(source); picture.srcset = srcSet; }
      picture.src = source;
    });
    this.pictures.set(cacheKey, promise);
    return promise;
  }

  advance = () => {
    if (this.requested || this.pendingScene !== null || this.state.loading) return;
    if (this.state.previous !== null && !this.state.reduced) {
      this.queuedAdvance = true;
      this.setState({ pending: true });
      return;
    }
    if (this.state.scene === WRENS_LIGHT_SCENES.length - 1) { this.requestExit("complete"); return; }
    const next = this.state.scene + 1;
    const generation = this.generation;
    this.pendingScene = next;
    this.setState({ pending: true });
    void this.preparePicture(next).then(({ ready, landscape, largeLandscape }) => {
      if (!this.live || generation !== this.generation || this.requested || this.pendingScene !== next) return;
      this.pendingScene = null;
      this.setState(state => ({
        scene: next, picture: ready ? next : state.picture,
        previous: ready && state.hasPicture && !state.reduced ? openingPicture(state.picture, state.landscape) : null,
        previousLargeLandscape: state.largeLandscape,
        largeLandscape: ready ? largeLandscape : state.largeLandscape,
        hasPicture: state.hasPicture || ready, landscape: ready ? landscape : state.landscape, pending: false, unavailable: !ready,
      }), () => {
        this.focusCaption(true);
        if (this.state.previous !== null) this.shotTimer = setTimeout(this.finishShot, WRENS_LIGHT_SCENES[next].transitionMs);
      });
      if (ready) void this.loadPicture(next + 1);
    });
  };

  skip = () => this.requestExit("skip");

  finishShot = () => {
    if (!this.live || this.state.previous === null) return;
    clearTimeout(this.shotTimer);
    const advance = this.queuedAdvance;
    this.queuedAdvance = false;
    this.setState({ previous: null, pending: false }, () => { if (advance) this.advance(); });
  };

  private requestExit(reason: WrensLightExit) {
    if (this.requested) return;
    this.requested = reason;
    clearTimeout(this.shotTimer);
    this.queuedAdvance = false;
    this.pendingScene = null;
    // Skip keeps the visible plate and its words; only the destination owns exit readiness.
    this.setState({ exit: reason, scene: this.state.picture, loading: false, pending: false, previous: null });
    if (reason === "skip") this.props.onSkip();
    else this.props.onComplete();
    this.beginReveal();
  }

  private beginReveal = () => {
    if (!this.live || !this.requested || !this.props.destinationReady || this.state.revealing) return;
    this.setState({ revealing: true }, () => {
      if (this.requested === "skip" || this.state.reduced) this.finishReveal();
      else this.exitTimer = setTimeout(this.finishReveal, WRENS_LIGHT_DISSOLVE_MS);
    });
  };

  private finishReveal = () => {
    if (!this.live || !this.requested || this.exitNotified) return;
    this.exitNotified = true;
    clearTimeout(this.exitTimer);
    const reason = this.requested;
    this.props.onExited?.(reason);
  };

  onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (this.state.revealing || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (["Tab", "Enter", " ", "ArrowRight", "ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End", "Escape"].includes(event.key)) this.setState({ keyboard: true });
    if (event.key === "Escape") { event.preventDefault(); this.skip(); return; }
    if (event.key === "Tab") {
      const buttons = this.root?.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (document.activeElement === this.caption || document.activeElement === this.reading) {
        event.preventDefault(); (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
      return;
    }
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, textarea, select") || event.repeat) return;
    const reading = this.reading;
    if (reading && ["ArrowDown", "ArrowUp", "PageDown", "PageUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const amount = event.key.startsWith("Page") ? reading.clientHeight * .8 : 40;
      reading.scrollTop = event.key === "Home" ? 0 : event.key === "End" ? reading.scrollHeight
        : reading.scrollTop + (event.key.endsWith("Up") ? -amount : amount);
      return;
    }
    if (["Enter", " ", "ArrowRight"].includes(event.key)) { event.preventDefault(); this.advance(); }
  };

  onPictureDown = (event: PointerEvent<HTMLDivElement>) => {
    this.usePointer();
    this.focusCaption();
    if (event.isPrimary && event.button === 0) {
      this.pointer = { x: event.clientX, y: event.clientY, id: event.pointerId };
      try { event.currentTarget?.setPointerCapture?.(event.pointerId); } catch { /* A synthetic or already-canceled pointer has no capture. */ }
    } else this.pointer = null;
  };

  onPictureUp = (event: PointerEvent<HTMLDivElement>) => {
    this.focusCaption();
    const start = this.pointer;
    this.pointer = null;
    if (start && start.id === event.pointerId && Math.hypot(event.clientX - start.x, event.clientY - start.y) < 12) this.advance();
  };

  onPictureCancel = () => { this.pointer = null; this.focusCaption(); };

  usePointer = () => { if (this.state.keyboard) this.setState({ keyboard: false }); };

  render() {
    const { scene, picture, previous, landscape, largeLandscape, previousLargeLandscape, pending, unavailable, reduced, exit, revealing, loading, hasPicture, keyboard } = this.state;
    const page = WRENS_LIGHT_SCENES[scene], last = scene === WRENS_LIGHT_SCENES.length - 1;
    const renderPicture = (source: string, current: boolean, responsive: boolean) => <img
      className={`wl-picture ${current ? "wl-current" : "wl-previous"}`} src={source} alt="" draggable={false}
      data-plate={source.split("/").pop()?.replace(/(?:-landscape)?\.webp$/, "")}
      srcSet={openingPictureSet(source, responsive)} sizes={openingPictureSet(source, responsive) ? openingPictureSizes(source) : undefined}
      fetchPriority={scene === 0 ? "high" : "auto"} decoding="async" />;
    return <><div ref={node => { this.root = node; }} className={`wl-opening${this.props.framed ? " wl-framed" : ""}`}
      style={{ "--wl-edit-duration": `${page.transitionMs}ms`, "--wl-edit-colour": page.editColour } as CSSProperties}
      data-scene={page.id} data-still={reduced || undefined} data-holding={Boolean(exit) || undefined}
      data-edit={page.edit} data-loading={loading || undefined} data-keyboard={keyboard || undefined}
      data-revealing={revealing || undefined} inert={revealing} aria-hidden={revealing || undefined}
      role="region" aria-label="Keep Wren’s Light opening" onKeyDown={this.onKeyDown} onPointerDownCapture={this.usePointer}>
      <div className="wl-world" aria-hidden="true" onPointerDown={this.onPictureDown} onPointerUp={this.onPictureUp}
        onPointerCancel={this.onPictureCancel} onLostPointerCapture={this.onPictureCancel} onMouseDown={event => event.preventDefault()}>
        <div className="wl-painting">
          {!hasPicture && <picture className="wl-placeholder">
            <source media={LANDSCAPE_MEDIA} srcSet={OPENING_PLACEHOLDER.landscape} />
            <img className="wl-picture" src={OPENING_PLACEHOLDER.portrait} alt="" draggable={false} />
          </picture>}
          {previous !== null && renderPicture(previous, false, previousLargeLandscape)}
          {hasPicture && <div key={picture} className={previous !== null ? "wl-reveal" : "wl-frame"} onAnimationEnd={event => { if (event.target === event.currentTarget) this.finishShot(); }}>{renderPicture(openingPicture(picture, landscape), true, largeLandscape)}</div>}
          {previous !== null && page.edit === "light" && !reduced && <div key={`${picture}-light`} className="wl-light" />}
        </div>
        <div className="wl-shade" />
      </div>
      <header className="wl-top">
        <span className="wl-wordmark" aria-hidden="true">familiar<span>.</span></span>
        <button className="wl-skip" onClick={this.skip} aria-disabled={Boolean(exit)}>{exit ? "Leaving…" : <>Skip<span className="wl-sr"> film</span></>}</button>
      </header>
      <div className="wl-bottom">
        <div className="wl-reading" ref={node => { this.reading = node; }} tabIndex={-1}>
          <h1 ref={node => { this.caption = node; }} className={`wl-caption${last ? " wl-title" : ""}`} tabIndex={-1}
            aria-describedby={`wl-detail-${page.id} wl-description-${page.id} wl-progress`}>{page.heading}</h1>
          <p id={`wl-detail-${page.id}`} className="wl-detail">{page.detail}</p>
          <p id={`wl-description-${page.id}`} className="wl-sr">{page.description}</p>
          {loading && <p className="wl-loading" role="status">Bringing the harbor into view…</p>}
          {unavailable && !exit && <p className="wl-image-error" role="status">This picture couldn’t load. You can keep reading.</p>}
        </div>
        <div className="wl-actions">
          <div className="wl-pages" aria-hidden="true">
            {WRENS_LIGHT_SCENES.map((item, index) => <span key={item.id} className={index === scene ? "wl-page-current" : index < scene ? "wl-page-read" : ""} />)}
          </div>
          <span id="wl-progress" className="wl-sr">Scene {scene + 1} of {WRENS_LIGHT_SCENES.length}</span>
          <button className={`wl-next${last ? " wl-enter" : ""}`} onClick={this.advance} aria-busy={loading || pending || Boolean(exit)} aria-disabled={loading || pending || Boolean(exit)}>
            <span>{exit ? "Opening…" : loading ? "Loading…" : pending ? previous ? "Turning page…" : "Preparing…" : last ? "Enter the harbor" : "Continue"}</span>
            {exit ? <span className="wl-busy-mark" aria-hidden="true" /> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6" /></svg>}
          </button>
        </div>
        <span className="wl-sr" role="status">{pending && !exit ? previous ? "Turning the page." : "Preparing the next picture. Skip is still available." : ""}</span>
      </div>
      {exit && !revealing && <p className="wl-loading wl-wait" aria-hidden="true">Opening the harbor…</p>}
    </div><span className="wl-sr wl-exit-status" role="status" aria-live="polite">{exit ? revealing ? "Entering the harbor." : "Opening the harbor…" : ""}</span></>;
  }
}

export default WrensLightSequence;
