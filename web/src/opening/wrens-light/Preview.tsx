import { Component } from "react";
import type { OpeningStart } from "../Opening";
import WrensLight from "./WrensLightSequence";
import { LANDSCAPE_MEDIA, LARGE_LANDSCAPE_MEDIA, openingPicture, openingPictureSet, openingPictureSizes, WRENS_LIGHT_SCENES } from "./wrens-light-scenes";
import { FINAL_OPENING_PLACEHOLDER } from "./opening-placeholder";

interface PreviewState { requested: boolean; ready: boolean; painted: boolean; ended: boolean; replay: number }

/** Film-only destination; actual harbor readiness belongs to the integrator. */
export default class WrensLightPreview extends Component<{
  onStart(start: OpeningStart): Promise<void>;
  onDone(): void;
}, PreviewState> {
  state = { requested: false, ready: false, painted: false, ended: false, replay: 0 };
  heading: HTMLHeadingElement | null = null;
  private restartButton: HTMLButtonElement | null = null;
  private destination: HTMLImageElement | null = null;
  private live = false;
  private generation = 0;

  componentDidMount() {
    this.live = true;
    if (this.destination && this.state.requested && !this.state.ready) void this.prepareDestination(this.destination);
  }
  componentWillUnmount() { this.live = false; this.generation++; }

  requestDestination = () => this.setState({ requested: true });
  prepareDestination = async (image: HTMLImageElement) => {
    const generation = this.generation;
    // The inline final poster makes this destination independent of the network image.
    await image.decode().catch(() => {});
    if (this.live && generation === this.generation) this.setState({ ready: true });
  };
  preparePicture = async (image: HTMLImageElement) => {
    const generation = this.generation, source = image.currentSrc;
    try { await image.decode(); } catch { return; }
    if (this.live && generation === this.generation && source === image.currentSrc) this.setState({ painted: true });
  };
  private captureDestination = (image: HTMLImageElement | null) => {
    if (!image || image === this.destination) return;
    this.destination = image;
    void this.prepareDestination(image);
  };
  finish = () => this.setState({ ended: true }, () => this.heading?.focus({ preventScroll: true }));
  restart = () => {
    this.generation++;
    this.destination = null;
    this.setState(state => ({ requested: false, ready: false, painted: false, ended: false, replay: state.replay + 1 }));
  };

  render() {
    const { requested, ready, painted, ended, replay } = this.state;
    const final = WRENS_LIGHT_SCENES.length - 1;
    return <>
      {requested && <div className="wl-preview-destination" inert={!ended} aria-hidden={!ended}>
        <picture className="wl-placeholder" data-plate="mochi-quay">
          <source media={LANDSCAPE_MEDIA} srcSet={FINAL_OPENING_PLACEHOLDER.landscape} />
          <img ref={this.captureDestination} className="wl-picture" src={FINAL_OPENING_PLACEHOLDER.portrait} alt="" />
        </picture>
        <picture>
          <source media={LARGE_LANDSCAPE_MEDIA} srcSet={openingPictureSet(openingPicture(final, true), true)} sizes={openingPictureSizes(openingPicture(final, true))} />
          <source media={LANDSCAPE_MEDIA} srcSet={openingPicture(final, true)} />
          <img className="wl-picture" data-plate="mochi-quay" src={openingPicture(final)} alt="" decoding="async"
            style={{ visibility: painted ? "visible" : "hidden" }} onLoad={event => { void this.preparePicture(event.currentTarget); }}
            onError={() => this.setState({ painted: false })} />
        </picture>
        <div className="wl-shade" />
        <section hidden={!ended} className="wl-preview-note" role="dialog" aria-modal={ended || undefined} aria-labelledby="wl-preview-title"
          onKeyDown={event => {
            if (event.key === "Tab") { event.preventDefault(); this.restartButton?.focus(); }
          }}>
          <h2 id="wl-preview-title" tabIndex={-1} ref={node => { this.heading = node; }}>Film preview complete</h2>
          <p>The film ends here. You can replay it from the beginning.</p>
          <button type="button" ref={node => { this.restartButton = node; }} onClick={this.restart}>Replay film</button>
        </section>
      </div>}
      {!ended && <WrensLight key={replay} onComplete={this.requestDestination} onSkip={this.requestDestination}
        destinationReady={ready} onExited={this.finish} />}
    </>;
  }
}
