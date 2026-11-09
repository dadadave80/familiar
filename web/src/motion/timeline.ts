export interface MotionScheduler {
  now(): number;
  request(callback: () => void): number;
  cancel(handle: number): void;
}

const browserScheduler: MotionScheduler = {
  now: () => performance.now(),
  request: callback => requestAnimationFrame(callback),
  cancel: handle => cancelAnimationFrame(handle),
};

export class MotionPlayer {
  readonly #duration: number;
  readonly #onFrame: (time: number) => void;
  readonly #onFinish?: () => void;
  readonly #scheduler: MotionScheduler;
  #time = 0;
  #rate = 1;
  #playing = false;
  #finished = false;
  #destroyed = false;
  #lastNow = 0;
  #frameId: number | undefined;
  #generation = 0;

  constructor(options: {
    duration: number;
    onFrame: (time: number) => void;
    onFinish?: () => void;
    scheduler?: MotionScheduler;
  }) {
    if (!Number.isFinite(options.duration) || options.duration <= 0) {
      throw new RangeError("Motion duration must be finite and positive");
    }
    this.#duration = options.duration;
    this.#onFrame = options.onFrame;
    this.#onFinish = options.onFinish;
    this.#scheduler = options.scheduler ?? browserScheduler;
  }

  get state() {
    return { time: this.#time, duration: this.#duration, playing: this.#playing, rate: this.#rate };
  }

  play() {
    if (this.#destroyed || this.#playing || this.#time === this.#duration) return;
    this.#playing = true;
    this.#lastNow = this.#scheduler.now();
    this.#schedule();
  }

  pause() {
    if (this.#destroyed || !this.#playing) return;
    this.#advance();
    this.#stop();
    this.#present();
  }

  seek(time: number) {
    if (this.#destroyed) return;
    if (!Number.isFinite(time)) throw new RangeError("Motion time must be finite");
    this.#time = Math.max(0, Math.min(this.#duration, time));
    this.#lastNow = this.#scheduler.now();
    this.#present();
  }

  setRate(rate: number) {
    if (this.#destroyed) return;
    if (!Number.isFinite(rate) || rate <= 0) throw new RangeError("Motion rate must be finite and positive");
    if (this.#playing) this.#advance();
    this.#rate = rate;
    this.#present();
  }

  finish() {
    if (this.#destroyed || (this.#finished && this.#time === this.#duration)) return;
    this.#stop();
    this.#time = this.#duration;
    this.#present();
  }

  reset() {
    if (this.#destroyed) return;
    this.#stop();
    this.#finished = false;
    this.#time = 0;
    this.#present();
  }

  destroy() {
    this.#destroyed = true;
    this.#stop();
  }

  #advance() {
    const now = this.#scheduler.now();
    this.#time = Math.min(this.#duration, this.#time + Math.max(0, now - this.#lastNow) * this.#rate);
    this.#lastNow = now;
  }

  #stop() {
    this.#playing = false;
    this.#generation++;
    if (this.#frameId !== undefined) this.#scheduler.cancel(this.#frameId);
    this.#frameId = undefined;
  }

  #present() {
    const completed = this.#time === this.#duration && !this.#finished;
    if (this.#time === this.#duration) {
      this.#stop();
      this.#finished = true;
    }
    this.#onFrame(this.#time);
    if (completed && !this.#destroyed && this.#finished && this.#time === this.#duration) this.#onFinish?.();
  }

  #schedule() {
    if (this.#destroyed || !this.#playing || this.#frameId !== undefined) return;
    const generation = this.#generation;
    this.#frameId = this.#scheduler.request(() => {
      // A reset can invalidate an already-dispatched frame even after cancellation.
      if (this.#destroyed || generation !== this.#generation) return;
      this.#frameId = undefined;
      this.#advance();
      this.#present();
      this.#schedule();
    });
  }
}
