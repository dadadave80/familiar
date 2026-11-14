// Title screen for /outing/, ported from the Claude Design file FamiliarOpening.dc.html.
// The render loop writes styles directly; React only renders text and structure.
import { Component, type CSSProperties, type SyntheticEvent } from "react";
import "@fontsource-variable/fraunces";
import "@fontsource-variable/figtree";
import type { HarborAudio, TitleSound } from "../expedition/audio";
import { MOCHI_POSES, type MochiPoseName } from "../motion/mochi";
import "./opening.css";

const ART = "/assets/expedition/runtime/";
const cache = new Map<string, CSSProperties>();
/** Inline style string -> React style object, so the markup stays close to the design file. */
export function sx(text: string): CSSProperties {
  let style = cache.get(text);
  if (!style) {
    style = Object.fromEntries(text.split(";").filter(d => d.includes(":")).map(d => {
      const i = d.indexOf(":");
      return [d.slice(0, i).trim().replace(/-([a-z])/g, (_, c: string) => c.toUpperCase()), d.slice(i + 1).trim()];
    })) as CSSProperties;
    cache.set(text, style);
  }
  return style;
}

export type OpeningBeat = "live" | "boot" | "title" | "bell" | "attract" | "menu" | "travel";
export interface OpeningStart { sound: boolean; music: number; effects: number; surface?: "tide" }
function litHarbor(): boolean { try { return Object.keys(localStorage).some(key => key.startsWith("familiar.expedition.") && (() => { try { return JSON.parse(localStorage.getItem(key) ?? "null")?.home?.lit === true; } catch { return false; } })()); } catch { return false; } }
interface Props {
  audio: HarborAudio;
  hasSave: boolean;
  /** The tide covers the screen: mount the game underneath now. */
  onStart(start: OpeningStart): Promise<void>;
  /** The tide has drawn back over the game: unmount the opening. */
  onDone(): void;
  beat?: OpeningBeat;
  attractDelay?: number;
  /** Fill the parent box instead of the viewport (storyboard frames). */
  framed?: boolean;
}
interface State { prompt: string; sound: boolean; scroll: "" | "tide" | "options" | "credits"; music: number; effects: number; cap1: string; cap2: string; lane: string }
type Ease = "lin" | "io" | "out" | "in" | "back";
interface Tween { o: Record<string, number>; k: string; to: number; d: number; e: Ease; dl: number; el: number; from?: number; done?: boolean; res(): void }
type Plank = "continue" | "new" | "tide" | "options" | "credits";
interface Point { x: number; y: number }
interface CourtView {
  mx: number; my: number; gx: number; gy: number; ghostA: number; bx: number; brot: number; krot: number; ks: number;
  laneX: number; laneA: number; markA: number; wx: number; wy: number; wa: number; sh0: number; lens: number; sq: number;
  pose: MochiPoseName; flip: boolean; walk: number; wf?: Point; wt?: Point; rings: (Point & { hot: boolean })[];
}

const E: Record<Ease, (p: number) => number> = {
  lin: p => p, io: p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2, out: p => 1 - Math.pow(1 - p, 3),
  in: p => p * p * p, back: p => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2),
};
const COLS = ["Left", "Center", "Right"];
const PLANK = "position:relative;height:56px;width:236px;box-sizing:border-box;padding:0 12px 0 30px;border:1px solid #d6b374;border-radius:9px;background:#5d432c;color:#fff0ce;box-shadow:inset 0 1px 0 #b48d55,0 4px 14px #382b2040;font:650 23px/1 'Fraunces Variable',serif;letter-spacing:-.02em;text-align:left;cursor:pointer;transform-origin:0 50%;opacity:0;pointer-events:none";
const NAIL = "position:absolute;left:11px;top:50%;width:7px;height:7px;margin-top:-4px;border-radius:50%;background:#e4be78;box-shadow:inset -1px -1px 0 #9a733a";
const LABEL: Record<Plank, string> = { continue: "Continue", new: "New Harbor", tide: "Today’s Tide", options: "Options", credits: "Credits" };

const col = (x: number) => 126.67 + x * 253.33, row = (y: number) => 800 - y * 140;
const GEO = {
  tiles: [4, 3, 1, 0].flatMap(y => [0, 1, 2].map(x => ({ l: Math.round(col(x) - 110), t: Math.round(row(y) - 30) }))),
  walks: [310, 730].flatMap(m => [0, 1, 2].map(x => ({ l: Math.round(col(x) - 31.5), t: Math.round(m - 94.5) }))),
  gaps: [0, 1, 2].map(x => ({ l: Math.round(col(x) - 66) })),
  chev: [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ t: 44 + i * 72 })),
  glints: [[905, 488, 34], [950, 506, 26], [878, 528, 30], [930, 552, 40], [858, 584, 36], [915, 610, 44], [1005, 468, 22], [842, 470, 26], [800, 500, 24], [790, 560, 30]].map(([l, t, w]) => ({ l, t, w })),
};

export default class Opening extends Component<Props, State> {
  state: State = { prompt: "Press any key", sound: false, scroll: "", music: 4, effects: 5, cap1: "", cap2: "", lane: "" };
  root: HTMLDivElement | null = null;
  readonly hasLitHarbor = litHarbor();
  t = 0; dt = 16; last = 0; raf = 0; seq = 0; dead = false; frozen = false; rm = false; soundOn = false; landed = false; handedOff = false;
  tweens: Tween[] = [];
  els: Record<string, HTMLElement | null> = {};
  glints: HTMLElement[] = [];
  mp: Record<string, number> = { continue: 0, new: 0, tide: 0, options: 0, credits: 0 };
  moth = { x: 852, y: 444 };
  dip: Record<string, number> = {};
  idleAt = 0; bellAt = -1e9; bellAmp = 0; bramAt = -1e9; bootT0 = 0; bootShown = 0; bootReal = 0;
  bellFix: number | null = null; bootFix: number | null = null; fixedPose: MochiPoseName | null = null;
  poseQ: { n: MochiPoseName; a: number; b: number }[] | null = null;
  bootDone: (() => void) | null = null;
  sel: Plank | null = null;
  mode = "title"; mothTo = "perch";
  s: Record<string, number> = {};
  c = { pos: { x: 1, y: 0 } as Point, turn: 0, bridge: 1, locked: null as number | null, opened: [] as number[] };
  cv!: CourtView;
  ro?: ResizeObserver;

  setRoot = (el: HTMLDivElement | null) => { this.root = el; };
  stop = (e: SyntheticEvent) => e.stopPropagation();
  items(): Plank[] { return [this.props.hasSave ? "continue" : "new", "tide", "options", "credits"]; }

  componentDidMount() {
    this.dead = false; this.t = 0; this.moth = { x: 852, y: 444 };
    this.rm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (matchMedia("(pointer: coarse)").matches) this.setState({ prompt: "Tap to begin" });
    window.addEventListener("keydown", this.onKey);
    this.ro = new ResizeObserver(() => { if (this.frozen) this.draw(); });
    if (this.root) this.ro.observe(this.root);
    this.start();
  }
  componentDidUpdate(prev: Props) { if ((prev.beat ?? "live") !== (this.props.beat ?? "live")) this.start(); }
  componentWillUnmount() { this.dead = true; this.seq++; cancelAnimationFrame(this.raf); window.removeEventListener("keydown", this.onKey); this.ro?.disconnect(); }

  start() {
    const beat = this.props.beat ?? "live"; this.frozen = beat !== "live"; this.seq++; this.tweens = []; cancelAnimationFrame(this.raf);
    this.s = { camT: 0, zoomAdd: 0, veil: 0, tide: 0, tideA: 1, boot: 0, lift: 0, titleA: 1, chapA: 1, promptA: 1, scrollP: 0, capA: 0, courtA: 0 };
    for (const k in this.mp) this.mp[k] = 0;
    this.sel = null; this.mode = "title"; this.poseQ = null; this.fixedPose = null; this.bellAt = -1e9; this.bellAmp = 0; this.bellFix = null; this.bootFix = null; this.mothTo = "perch"; this.dip = {}; this.courtReset();
    if (this.frozen) { this.t = 2000; this.applyBeat(beat); this.draw(); void document.fonts?.ready.then(() => { if (this.frozen && !this.dead) this.draw(); }); }
    else { this.last = 0; this.raf = requestAnimationFrame(this.tick); void this.boot(); }
  }
  applyBeat(b: OpeningBeat) {
    const s = this.s, ids = this.items(), re = () => this.draw();
    if (b === "boot") { Object.assign(s, { veil: 1, boot: 1, chapA: 0, promptA: 0, zoomAdd: .07 }); this.bootFix = .58; this.mode = "boot"; }
    else if (b === "bell") { this.bellFix = 13; this.fixedPose = "relieved"; this.setState({ sound: true }, re); }
    else if (b === "attract") {
      Object.assign(s, { courtA: 1, titleA: 0, chapA: 0, capA: 1 }); const v = this.cv; this.c.pos = { x: 0, y: 1 }; this.c.turn = 2;
      Object.assign(v, { mx: 126.67, my: 660, laneX: 126.67, laneA: 1, markA: 1, krot: -3, pose: "brace" }); this.cHints({ x: 1, y: 1 }); Object.assign(v, { gx: 380, gy: 660, ghostA: .45 });
      this.mode = "attract"; this.setState({ lane: "IN + OUT · LEFT", cap1: "Left is marked.", cap2: "The next surge follows that source." }, re);
    }
    else if (b === "menu") { ids.forEach(i => this.mp[i] = 1); s.promptA = 0; this.mode = "menu"; this.sel = ids[0]!; }
    else if (b === "travel") { Object.assign(s, { camT: .55, lift: .5, titleA: .55, chapA: .2, promptA: 0 }); ids.forEach(i => this.mp[i] = .35); this.fixedPose = "curious"; this.mode = "travel"; this.mothTo = "board"; }
  }

  // ---- time
  tick = (now: number) => {
    if (this.dead || this.frozen) return;
    const dt = this.last ? Math.min(64, now - this.last) : 16; this.last = now; this.dt = dt; this.t += dt;
    for (const w of this.tweens) {
      if (w.dl > 0) { w.dl -= dt; continue; }
      if (w.from === undefined) w.from = w.o[w.k]!;
      w.el += dt; const p = Math.min(1, w.el / w.d); w.o[w.k] = w.from + (w.to - w.from) * E[w.e](p);
      if (p >= 1) { w.done = true; w.res(); }
    }
    this.tweens = this.tweens.filter(w => !w.done);
    if (this.mode === "title" && this.t - this.idleAt > (this.props.attractDelay ?? 20) * 1000) void this.attract();
    this.draw(); this.raf = requestAnimationFrame(this.tick);
  };
  tw(o: Record<string, number>, k: string, to: number, d: number, e: Ease = "io", dl = 0): Promise<void> {
    return new Promise(res => {
      this.tweens = this.tweens.filter(w => { if (w.o === o && w.k === k) { w.res(); return false; } return true; });
      if (this.frozen) { o[k] = to; res(); return; }
      this.tweens.push({ o, k, to, d: Math.max(1, this.rm ? Math.min(d, 70) : d), e, dl: this.rm ? 0 : dl, el: 0, res });
    });
  }
  wait(ms: number) { return new Promise<void>(r => setTimeout(r, this.rm ? Math.min(ms, 60) : ms)); }
  touch() { this.idleAt = this.t; }
  poses(...l: [MochiPoseName, number][]) { let a = this.t; this.poseQ = l.map(([n, d]) => { const o = { n, a, b: a + d }; a += d; return o; }); }
  say(a: string, b = "") { this.setState({ cap1: a, cap2: b }); void this.tw(this.s, "capA", 1, 220); }

  // ---- sound: opt-in only, through the game's own HarborAudio
  sfx(n: TitleSound) { if (this.soundOn) this.props.audio.playTitle(n); }
  ring() {
    if (this.frozen) return; this.touch(); const on = !this.soundOn, audio = this.props.audio; this.bellAt = this.t; this.bellAmp = on ? 1 : .35;
    if (!on) { this.soundOn = false; this.setState({ sound: false }); void audio.setEnabled(false).catch(() => {}); return; }
    this.soundOn = true; this.setState({ sound: true }); this.poses(["startled", 220], ["relieved", 900]); this.bramAt = this.t;
    audio.setEnabled(true).then(() => {
      if (this.dead || !this.soundOn) return;
      audio.setMix(this.state.music / 5, this.state.effects / 5); audio.playTitle("bell");
      setTimeout(() => { if (!this.dead && this.soundOn && (this.mode === "title" || this.mode === "menu")) audio.playMusic("harbor"); }, 950);
    }).catch(() => { this.soundOn = false; this.setState({ sound: false }); });
  }

  // ---- input
  onTap = () => { if (this.frozen) return; this.touch(); if (this.mode === "title") this.openMenu(); else if (this.mode === "attract") void this.leaveCourt(); };
  onBell = (e: SyntheticEvent) => { e.stopPropagation(); this.ring(); };
  onSoundRow = () => this.ring();
  onPeg = (e: SyntheticEvent<HTMLButtonElement>) => {
    const { bus, n } = e.currentTarget.dataset, level = Number(n);
    this.setState(st => bus === "music" ? { ...st, music: level } : { ...st, effects: level }, () => { this.props.audio.setMix(this.state.music / 5, this.state.effects / 5); this.sfx("step"); });
  };
  onBack = () => this.closeScroll();
  onTide = () => { if (this.frozen) return; void this.tw(this.s, "scrollP", 0, 200, "in").then(() => this.setState({ scroll: "" })); void this.travel("continue", "tide"); };
  onPlankEnter = (e: SyntheticEvent<HTMLButtonElement>) => { if (!this.frozen && this.mode === "menu" && !this.state.scroll) this.select(e.currentTarget.dataset.plank as Plank); };
  onPlankClick = (e: SyntheticEvent<HTMLButtonElement>) => { e.stopPropagation(); if (this.frozen || this.mode !== "menu") return; const id = e.currentTarget.dataset.plank as Plank; this.select(id); this.choose(id); };
  onKey = (e: KeyboardEvent) => {
    if (this.frozen || this.dead || e.metaKey || e.ctrlKey || e.altKey) return; const key = e.key; if (key === "Tab" || key === "Shift") return; this.touch();
    const onBtn = e.target instanceof Element && !!e.target.closest("button");
    if (this.mode === "title") { if ((key === "Enter" || key === " ") && onBtn) return; e.preventDefault(); this.openMenu(); }
    else if (this.mode === "attract") { e.preventDefault(); void this.leaveCourt(); }
    else if (this.mode === "menu") {
      if (this.state.scroll) { if (key === "Escape" || key === "Backspace") this.closeScroll(); return; }
      const ids = this.items(), i = ids.indexOf(this.sel!);
      if (key === "ArrowDown" || key === "s" || key === "S") { e.preventDefault(); this.select(ids[(i + 1) % ids.length]!); }
      else if (key === "ArrowUp" || key === "w" || key === "W") { e.preventDefault(); this.select(ids[(Math.max(i, 0) - 1 + ids.length) % ids.length]!); }
      else if ((key === "Enter" || key === " ") && !onBtn) { e.preventDefault(); this.choose(this.sel ?? ids[0]!); }
      else if (key === "Escape") this.closeMenu();
    }
  };

  // ---- beats
  async boot() {
    const k = ++this.seq, s = this.s; this.mode = "boot"; Object.assign(s, { veil: 1, tide: 0, tideA: 1, boot: 1, chapA: 0, promptA: 0, zoomAdd: .07 }); this.bootShown = 0; this.bootReal = 0; this.bootT0 = this.t;
    const urls = ["harbor", "mochi-poses", "bram", "moth", "tide-court", "tidekeeper", "stone-island", "wooden-bridge", "shell", "lens", "wave"]; let n = 0; const total = urls.length + 1, bump = () => { n++; this.bootReal = n / total; };
    urls.forEach(u => { const i = new Image(); i.onload = i.onerror = bump; i.src = ART + u + ".webp"; });
    (document.fonts ? Promise.all([document.fonts.load("620 80px 'Fraunces Variable'"), document.fonts.load("700 16px 'Figtree Variable'")]) : Promise.resolve()).then(bump, bump);
    await new Promise<void>(res => { this.bootDone = res; }); if (k !== this.seq) return;
    void this.tw(s, "veil", 0, 700, "lin", 420); await this.tw(s, "tide", 1.06, 900, "in"); if (k !== this.seq) return; s.boot = 0;
    void this.tw(s, "zoomAdd", 0, 2600, "out"); await this.tw(s, "tideA", 0, 1100, "out"); if (k !== this.seq) return; s.tide = 0; s.tideA = 1;
    await this.wait(300); if (k !== this.seq) return; void this.tw(s, "chapA", 1, 700, "out");
    await this.wait(900); if (k !== this.seq) return; this.poses(["look-right", 1100]); this.bellAt = this.t; this.bellAmp = .3;
    await this.wait(700); if (k !== this.seq) return; void this.tw(s, "promptA", 1, 600); this.mode = "title"; this.touch();
  }
  openMenu() {
    const k = ++this.seq, ids = this.items(); this.mode = "menu"; this.sel = null; void this.tw(this.s, "promptA", 0, 180); this.sfx("step");
    ids.forEach((id, i) => void this.tw(this.mp, id, 1, 560, "back", i * 75));
    setTimeout(() => { if (k === this.seq && this.mode === "menu" && !this.sel) this.select(ids[0]!); }, 75 * ids.length + 260);
  }
  closeMenu() { this.seq++; this.items().forEach((id, i) => void this.tw(this.mp, id, 0, 240, "in", i * 30)); this.sel = null; this.mode = "title"; void this.tw(this.s, "promptA", 1, 400, "io", 200); this.touch(); }
  select(id: Plank) {
    if (!id || this.sel === id) return; this.sel = id; this.landed = false; this.sfx("step");
    this.root?.querySelector<HTMLElement>(`[data-plank="${id}"]`)?.focus({ preventScroll: true });
  }
  choose(id: Plank) { if (id === "continue" || id === "new") void this.travel(id); else this.openScroll(id); }
  openScroll(id: "tide" | "options" | "credits") { this.dip[id] = this.t; this.sfx("pick"); this.setState({ scroll: id }); this.items().forEach(i => void this.tw(this.mp, i, 0, 240, "in")); void this.tw(this.s, "scrollP", 1, 420, "back", 180); }
  closeScroll() {
    void this.tw(this.s, "scrollP", 0, 200, "in").then(() => this.setState({ scroll: "" }));
    this.items().forEach((i, j) => void this.tw(this.mp, i, 1, 460, "back", 120 + j * 50));
    if (this.sel) this.root?.querySelector<HTMLElement>(`[data-plank="${this.sel}"]`)?.focus({ preventScroll: true });
  }
  async travel(id: Plank, surface?: "tide") {
    const k = ++this.seq, s = this.s, ids = this.items(); this.mode = "travel"; this.dip[id] = this.t; this.sfx("pick"); this.poses(["reach-ready", 420]);
    await this.wait(260); if (k !== this.seq) return; if (this.soundOn) this.props.audio.playMusic("departure"); this.mothTo = "board";
    ids.forEach((i, j) => void this.tw(this.mp, i, 0, 300, "in", j * 40)); this.sel = null;
    void this.tw(s, "lift", 1, 1500, "in", 150); void this.tw(s, "titleA", 0, 1100, "lin", 400); void this.tw(s, "chapA", 0, 500); void this.tw(s, "camT", 1, 2800, "io");
    await this.wait(1900); if (k !== this.seq) return; this.poses(["curious", 1500], ["relieved", 800]);
    await this.wait(900); if (k !== this.seq) return;
    // The camera has reached the dock: the tide rises, holds until the game is mounted beneath it, then draws back.
    this.mode = "wipe"; s.tideA = 1; s.tide = 0; await this.tw(s, "tide", 1.06, 620, "in"); if (k !== this.seq) return;
    this.handedOff = true;
    await this.props.onStart({ sound: this.soundOn, music: this.state.music / 5, effects: this.state.effects / 5, ...(surface ? { surface } : {}) });
    await this.wait(140); await this.tw(s, "tideA", 0, 520, "out");
    if (k === this.seq && !this.dead) this.props.onDone();
  }
  async wipe(swap: () => void) { const s = this.s; s.tideA = 1; s.tide = 0; this.mode = "wipe"; await this.tw(s, "tide", 1.06, 620, "in"); swap(); await this.wait(140); await this.tw(s, "tideA", 0, 520, "out"); s.tide = 0; s.tideA = 1; }
  async attract() {
    const k = ++this.seq, s = this.s; this.mode = "attract"; void this.tw(s, "titleA", 0, 500); void this.tw(s, "chapA", 0, 400);
    await this.wait(350); if (k !== this.seq) return; await this.wipe(() => { s.courtA = 1; this.courtReset(); }); if (k !== this.seq) return; this.mode = "attract";
    await this.courtDemo(k); if (k !== this.seq) return; void this.leaveCourt();
  }
  async leaveCourt() {
    const k = ++this.seq, s = this.s; void this.tw(s, "capA", 0, 150); await this.wipe(() => { s.courtA = 0; }); if (k !== this.seq) return;
    void this.tw(s, "titleA", 1, 500); void this.tw(s, "chapA", 1, 500); void this.tw(s, "promptA", 1, 400); this.mode = "title"; this.touch();
  }

  // ---- the attract court (rules follow engine.ts: low -> rising marks a source -> surge)
  cpt(p: Point) { return { x: col(p.x), y: row(p.y) }; }
  courtReset() {
    this.c = { pos: { x: 1, y: 0 }, turn: 0, bridge: 1, locked: null, opened: [] };
    this.cv = { mx: 380, my: 800, gx: 380, gy: 800, ghostA: 0, bx: 380, brot: 0, krot: 0, ks: 1, laneX: 126.67, laneA: 0, markA: 0, wx: 0, wy: 170, wa: 0, sh0: 0, lens: 0, sq: 1, pose: "curious", flip: false, walk: 0, rings: [] };
  }
  cDest(dir: "north" | "south" | "west" | "east"): Point | null {
    const c = this.c, d = { north: [0, 1], south: [0, -1], west: [-1, 0], east: [1, 0] }[dir], cross = (dir === "north" && c.pos.y === 1) || (dir === "south" && c.pos.y === 3);
    if (cross && c.pos.x !== c.bridge) return null;
    const p = { x: c.pos.x + d[0]!, y: c.pos.y + d[1]! * (cross ? 2 : 1) };
    return (p.x < 0 || p.x > 2 || p.y < 0 || p.y > 4 || (p.y === 2 && p.x !== c.bridge)) ? null : p;
  }
  cHints(hot?: Point) { this.cv.rings = (["north", "south", "west", "east"] as const).map(d => this.cDest(d)).filter((p): p is Point => !!p).map(p => ({ ...this.cpt(p), hot: !!hot && p.x === hot.x && p.y === hot.y })); }
  vv() { return this.cv as unknown as Record<string, number>; }
  async cStep(dir: "north" | "south" | "west" | "east", k: number) {
    const c = this.c, v = this.cv, n = this.vv(), to = this.cDest(dir); if (!to) return;
    const P = this.cpt(to), dxx = to.x - c.pos.x, cross = Math.abs(to.y - c.pos.y) === 2, ok = () => k === this.seq;
    this.cHints(to); v.gx = P.x; v.gy = P.y; void this.tw(n, "ghostA", .45, 200); await this.wait(820); if (!ok()) return;
    void this.tw(n, "ghostA", 0, 140); v.rings = []; v.pose = dxx < 0 ? "turn-left" : dxx > 0 ? "turn-right" : "curious"; v.sq = .93; await this.wait(130); if (!ok()) return;
    v.sq = 1; v.flip = dxx < 0; v.wf = { x: v.mx, y: v.my }; v.wt = P; v.walk = cross ? 2 : 1; this.sfx("step"); const d = cross ? 720 : 440; void this.tw(n, "mx", P.x, d, "io"); await this.tw(n, "my", P.y, d, "io"); if (!ok()) return;
    v.walk = 0; v.flip = false; v.pose = "neutral"; v.sq = .95; c.pos = to; this.say("Mochi finds her footing."); await this.wait(110); v.sq = 1;
    const ph = c.turn % 3; c.turn++;
    if (ph === 1) {
      await this.wait(350); if (!ok()) return; c.locked = to.x; v.laneX = P.x; v.pose = "brace"; this.setState({ lane: "IN + OUT · " + COLS[to.x]!.toUpperCase() });
      void this.tw(n, "krot", (to.x - 1) * 3, 300); void this.tw(n, "markA", 1, 260, "back"); void this.tw(n, "laneA", 1, 420); this.sfx("mark"); this.say(COLS[to.x] + " is marked.", "The next surge follows that source."); await this.wait(1300);
    } else if (ph === 2 && c.locked !== null) {
      await this.wait(350); if (!ok()) return; const ex = c.locked, X = this.cpt({ x: ex, y: 0 }).x; v.pose = "brace";
      this.say("The wave travels from " + COLS[ex] + " to " + COLS[ex] + ".");
      await this.tw(n, "ks", .94, 180); if (!ok()) return; void this.tw(n, "ks", 1.05, 160, "out"); v.wx = X; v.wy = 170; v.wa = .2; this.sfx("wave"); void this.tw(n, "wa", .92, 300); await this.tw(n, "wy", 840, 950, "in"); if (!ok()) return;
      void this.tw(n, "ks", 1, 300); void this.tw(n, "wa", 0, 200); void this.tw(n, "laneA", 0, 260); void this.tw(n, "markA", 0, 200); void this.tw(n, "krot", 0, 300); c.locked = null;
      if (ex !== c.bridge) { this.say("The " + COLS[ex] + " bridge opens; " + COLS[c.bridge] + " closes."); this.sfx("bridge"); void this.tw(n, "brot", (ex > c.bridge ? 1 : -1) * 1.8, 80); await this.tw(n, "bx", X, 520, "io"); void this.tw(n, "brot", 0, 160); c.bridge = ex; if (!ok()) return; }
      if (ex === 0 && !c.opened.includes(0)) { this.say("Left opens to the tide."); this.sfx("open"); await this.tw(n, "sh0", 1, 300); await this.tw(n, "lens", 1, 420, "back"); c.opened.push(0); }
    }
  }
  async courtDemo(k: number) {
    const ok = () => k === this.seq; this.cHints(); this.say("Tap a glowing neighbor to move.", "Water advances only when you decide."); await this.wait(1500); if (!ok()) return;
    for (const d of ["west", "north", "east"] as const) { await this.cStep(d, k); if (!ok()) return; }
    this.cv.pose = "turn-left"; await this.wait(520); if (!ok()) return; this.cv.pose = "relieved"; this.say("Left surge. Bridge at Left.", "Oyster opens. Mochi stays dry."); await this.wait(1900);
  }

  // ---- drawing
  $(n: string) { let e = this.els[n]; if (!e || !e.isConnected) { e = this.root?.querySelector<HTMLElement>(`[data-el="${n}"]`) ?? null; this.els[n] = e; } return e; }
  idlePose(t: number): MochiPoseName {
    const att = (this.mode === "menu" || (this.mode === "title" && !this.soundOn)) ? "look-right" : "curious", c = t % 9200;
    if (c >= 1700 && c < 3000) return att; if (c >= 4900 && c < 5650) return "curious"; if (c >= 5650 && c < 6500) return att === "look-right" ? att : "neutral"; return "neutral";
  }
  frame(el: HTMLElement, f: number) { el.style.backgroundPosition = ((f % 4) * 33.3333) + "% " + (Math.floor(f / 4) * 33.3333) + "%"; }
  draw() {
    const r = this.root; if (!r || this.s.camT === undefined) return; const W = r.clientWidth, H = r.clientHeight; if (!W || !H) return;
    r.dataset.mode = this.mode;
    const s = this.s, t = this.t, live = !this.frozen && !this.rm, fz = this.frozen, st = Math.floor(t * 12 / 1000) / 12 * 1000, $ = (n: string) => this.$(n);
    if (this.handedOff) { r.style.background = "transparent"; r.style.pointerEvents = "none"; for (const child of r.children) if ((child as HTMLElement).dataset.el !== "tide") (child as HTMLElement).style.visibility = "hidden"; }
    // Layout derives from how much of the painting this frame can show, not from device names.
    // k scales the signpost up so plank targets stay at least 44px; frozen frames keep the design scale.
    const s0 = Math.max(W / 1536, H / 1024), port = W / s0 < 824, u = fz ? W / (port ? 390 : 1440) : 1, short = H / u < 500 && !port, zt = port ? 1 : 1.03, visW = W / (s0 * zt), m = 14;
    const k = fz ? 1 : Math.max(1, Math.min(44 / (56 * s0 * zt), (H - 47 * s0 * zt - 8) / (412 * s0 * zt)));
    let PW = 236, postX = 890 + Math.min(260, (k - 1) * 600), mx = 620, cxT = 830;
    if (port) { PW = Math.max(170, Math.min(236, (visW - 2 * m - 198 - 8 * k) / k - 10)); const G = 198 + 8 * k + (10 + PW) * k, left = 1110.5 - G / 2; mx = left + 95; postX = left + 198 + 8 * k; cxT = 1110.5; }
    const gx = (x: number) => postX + (x - 890) * k, gy = (y: number) => 858 + (y - 858) * k;
    const clampT = (Sx: number, x: number, y: number) => [Math.min(0, Math.max(W - 1536 * Sx, x)), Math.min(0, Math.max(H - 1024 * Sx, y))] as const;
    const Sa = s0 * (zt + s.zoomAdd!), [txa, tya] = clampT(Sa, W / 2 - (cxT + (live ? Math.sin(t / 7000) * 6 : 0)) * Sa, H - 905 * Sa);
    const rightLimit = Math.min(1536, (W - txa) / Sa) - m;
    // Title size and centre that fit between the bakery roof (x 470) and R, in world units.
    const fit = (R: number) => { const F = Math.min(.105 * W, .21 * H, (R - 470) * Sa / 4.3), c = (470 + R) / 2 * Sa + txa; return { F, c, bot: (short ? .06 : .08) * H + F + (fz ? .2 * F : Math.max(.2 * F, 17)) * 1.7, right: c + F * 2.15 }; };
    let T = fit(1185), BW = PW, tucked = false;
    if (!port) {
      const clash = () => T.bot + 10 * u > gy(404) * Sa + tya - 22 * u && T.right > gx(788) * Sa + txa - 12 * u;
      if (clash()) postX = Math.max(postX, Math.min(1080, rightLimit - 246 * k));
      postX = Math.max(737, Math.min(postX, rightLimit - 246 * k));
      if (clash()) { T = fit(gx(788) - 12); tucked = true; }
      PW = Math.max(170, Math.min(236, (rightLimit - postX) / k - 10)); BW = Math.max(PW, Math.min(250, (rightLimit - postX) / k - 10));
    }
    const dx = postX - 890, mdx = mx - 620, tight = port || PW < 236;
    const f1 = fz ? (port ? .054 * W : .025 * W) : Math.max(21, Math.min(34, .025 * W)), f2 = fz ? (port ? .036 * W : .014 * W) : Math.max(14, Math.min(18, .013 * W));
    const capB = port ? .025 : short ? .04 : .09, capH = port ? f1 * 2.24 + f2 * 4.5 : f1 * 1.12 + f2 * 1.8;
    // Travel ends framing Mochi and the signpost, above the caption.
    const l0 = mx - 95, r0 = gx(900 + BW), Sb = s0 * Math.max(zt, Math.min(1.3, W / (s0 * (r0 - l0 + 56))));
    const [txb, tyb] = clampT(Sb, W / 2 - (l0 + r0) / 2 * Sb, Math.min(H * .57 - 705 * Sb, H * (1 - capB) - capH - 16 - 836 * Sb));
    const S = Sa + (Sb - Sa) * s.camT!, tx = txa + (txb - txa) * s.camT!, ty = tya + (tyb - tya) * s.camT!;
    let e = $("world"); if (e) e.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + S + ")";

    // title, boot tide
    const title = $("title"), br = $("bright");
    if (title) { title.style.left = port ? "50%" : T.c + "px"; title.style.top = port ? "4%" : short ? "6%" : "8%"; title.style.fontSize = port ? "min(21cqw,14cqh)" : T.F + "px"; title.style.opacity = String(s.titleA); title.style.transform = "translate(-50%," + (-s.lift! * H * .42) + "px) scale(" + (1 + s.lift! * .05) + ")"; }
    if (br) {
      if (s.boot) {
        const rc = br.getBoundingClientRect(), rr = r.getBoundingClientRect(), top = rc.top - rr.top;
        if (this.bootDone || this.bootFix != null) {
          let p: number;
          if (this.bootFix != null) p = this.bootFix;
          else {
            const el = t - this.bootT0, cap = Math.min(this.bootReal, Math.max(0, (el - 600) / 1300)); this.bootShown += (cap - this.bootShown) * Math.min(1, this.dt * .008); p = this.bootShown;
            if (p > .995 && el > 1900) { const d = this.bootDone; this.bootDone = null; d?.(); }
          }
          const el2 = this.bootFix != null ? 1 : E.out(Math.min(1, (t - this.bootT0) / 600)), wy0 = (top + rc.height + H * .03) + ((top - H * .02) - (top + rc.height + H * .03)) * p; s.tide = (H - (H + (wy0 - H) * el2)) / H;
        }
        br.style.clipPath = "inset(" + Math.max(0, Math.min(rc.height + 60, H - s.tide! * H - top)) + "px -80px -80px -80px)";
      } else br.style.clipPath = "none";
    }
    e = $("dim"); if (e) e.style.opacity = String(s.veil);
    e = $("veil"); if (e) { e.style.opacity = String(s.veil); e.style.display = s.veil! > 0 ? "block" : "none"; }
    e = $("tide"); if (e) { e.style.display = s.tide! > 0 ? "block" : "none"; e.style.height = (s.tide! * H) + "px"; e.style.opacity = String(s.tideA); }
    e = $("chap"); if (e) { e.style.opacity = String(s.chapA); const rl = e.lastElementChild; if (rl && rl.children.length === 3) { (rl.children[0] as HTMLElement).style.width = (rl.children[2] as HTMLElement).style.width = port || tucked ? "1em" : "2.4em"; (rl as HTMLElement).style.fontSize = fz ? ".2em" : "max(.2em,17px)"; } }
    e = $("prompt"); if (e) { e.style.fontSize = fz ? (port ? "3.1cqw" : "1.25cqw") : "clamp(12px,1.25cqw,18px)"; e.style.opacity = String((s.courtA! > 0 ? 0 : 1) * s.promptA! * (live ? .62 + .38 * (.5 + .5 * Math.sin(t / 1100)) : 1)); }
    e = $("cap");
    if (e) {
      e.style.opacity = String(s.capA);
      if (s.courtA! > 0 && short) { const fr = W * .36 + 380 * Math.min(W * .52 / 760, H * .94 / 900); e.style.left = (fr + (W - fr) / 2) + "px"; e.style.width = Math.max(120, W - fr - 28) + "px"; e.style.top = "34%"; e.style.bottom = "auto"; }
      else { e.style.left = "50%"; e.style.width = "min(88cqw,720px)"; e.style.top = "auto"; e.style.bottom = "calc(env(safe-area-inset-bottom,0px) + " + (s.courtA! > 0 ? (port ? 8 : 3.5) : capB * 100) + "%)"; }
      const [c1, c2] = e.children as unknown as HTMLElement[];
      if (c1 && c2) { c1.style.fontSize = fz ? (port ? "5.4cqw" : "2.5cqw") : "clamp(21px,2.5cqw,34px)"; c2.style.fontSize = fz ? (port ? "3.6cqw" : "1.4cqw") : "clamp(14px,1.3cqw,18px)"; }
    }
    e = $("scrim"); if (e) e.style.opacity = String(Math.max(s.capA! * .9, s.promptA! * .45));

    // light and water
    e = $("horizon"); if (e && live) e.style.backgroundPosition = (t / 70) + "px 0";
    e = $("lamp"); if (e) e.style.opacity = String(live ? .78 + .22 * Math.sin(st / 1000 * 5.3) : 1);
    e = $("wash"); if (e) e.style.opacity = String(live ? .6 + .4 * Math.sin(t / 12000) : .8);
    e = $("dusk"); if (e) e.style.opacity = String(live ? .05 + .05 * Math.sin(t / 12000 + Math.PI) : .05);
    if (!this.glints.length || !this.glints[0]!.isConnected) this.glints = [...r.querySelectorAll<HTMLElement>("[data-glint]")];
    this.glints.forEach((g, i) => { g.style.opacity = String(live ? .12 + .6 * Math.pow(Math.max(0, Math.sin(t / (700 + i * 90) + i * 2.1)), 2) : .45); if (live) g.style.transform = "translateX(" + (Math.sin(t / 1600 + i) * 5) + "px)"; });

    // Mochi and Bram, on twelves
    const q = this.poseQ?.find(o => t >= o.a && t < o.b), pose = this.fixedPose ?? (q ? q.n : this.idlePose(t)), breath = live ? 1 + .012 * (1 - Math.cos(st / 1000 * Math.PI * 2 / 3.25)) / 2 : 1;
    e = $("mochi"); if (e) { this.frame(e, MOCHI_POSES[pose].frame); e.style.transform = "translateX(" + mdx + "px) scaleY(" + breath + ")"; }
    e = $("mshadow"); if (e) e.style.transform = "translateX(" + mdx + "px)";
    e = $("bram"); if (e) { const bt = t - this.bramAt; e.style.transform = "rotate(" + (bt < 900 && live ? -3 * Math.exp(-bt / 300) : 0) + "deg) scaleY(" + (live ? 1 + .006 * (1 - Math.cos(st / 1000 * Math.PI * 2 / 4.1)) / 2 : 1) + ")"; }

    // signpost: bell, planks, scroll
    e = $("post"); if (e) { e.style.transformOrigin = "890px 858px"; e.style.transform = "translateX(" + dx + "px) scale(" + k + ")"; }
    const bt = t - this.bellAt; let ang = this.bellFix ?? 0;
    if (live) { if (bt < 5000) ang = this.bellAmp * 16 * Math.exp(-bt / 900) * Math.sin(bt / 130); if (this.mode === "title" && !this.soundOn && bt > 5000) { const n = t % 7000; if (n < 1400) ang += 3 * Math.exp(-n / 420) * Math.sin(n / 110); } }
    e = $("bell"); if (e) e.style.transform = "rotate(" + ang + "deg)";
    [0, 180].forEach((dl, i) => { const el = $("ring" + (i + 1)); if (!el) return; const p = this.bellFix != null ? .35 + i * .25 : (bt - dl) / 1100; if (p > 0 && p < 1 && (this.bellFix != null || this.bellAmp >= 1)) { el.style.opacity = String((1 - p) * .9); el.style.transform = "scale(" + (1 + p * 2.2) + ")"; } else el.style.opacity = "0"; });
    const ids = this.items(), inMenu = this.mode === "menu";
    ids.forEach((id, i) => {
      const el = r.querySelector<HTMLElement>(`[data-plank="${id}"]`); if (!el) return;
      const p = this.mp[id]!, seld = inMenu && this.sel === id, dt2 = t - (this.dip[id] ?? -1e9), dip = dt2 < 900 && live ? 3.2 * Math.exp(-dt2 / 260) * Math.cos(dt2 / 90) : 0, sway = live ? Math.sin(st / 1000 * 1.3 + i * 1.7) * .7 : 0;
      el.style.transform = "rotate(" + ((1 - p) * -22 + p * ([-1.6, 1.2, -.8, 1.5, -1.1][i % 5]! + sway) + (seld ? 1.6 : 0) + dip) + "deg) scaleX(" + Math.max(.001, p) + ")";
      el.style.width = PW + "px"; el.style.fontSize = tight ? Math.max(17, Math.min(21, PW / 10.6)) + "px" : "23px"; el.style.paddingRight = port ? "8px" : "12px"; el.style.opacity = String(Math.min(1, p * 1.6)); el.style.pointerEvents = p > .9 && inMenu && !this.frozen ? "auto" : "none";
      el.style.background = seld ? "#6a4d31" : "#5d432c"; el.style.borderColor = seld ? "#ffe1a1" : "#d6b374"; el.style.color = seld ? "#fff5d8" : "#fff0ce"; el.style.zIndex = seld ? "2" : "1";
    });
    e = $("scroll");
    if (e) {
      e.style.width = port ? Math.max(220, PW + 16) + "px" : BW + "px";
      // Keep the scroll's buttons at least 44px on screen, and lift it above the bottom edge.
      if (s.scrollP! > 0 && !fz) { const hh = Math.max(44, 44 / (S * k)), ww = Math.min(hh, (e.offsetWidth - 38) / 5); for (const bn of e.querySelectorAll("button")) { if (bn.dataset.bus) { bn.style.width = ww + "px"; bn.style.height = hh + "px"; } else bn.style.minHeight = hh + "px"; } }
      const ob = Math.max(0, gy(520) + e.offsetHeight * k - ((H - ty) / S - 10)) / k;
      e.style.transform = "translate(" + (port ? -16 : 0) + "px," + (-ob) + "px) scaleY(" + Math.max(.001, s.scrollP!) + ")"; e.style.opacity = String(Math.min(1, s.scrollP! * 2)); e.style.pointerEvents = s.scrollP! > .9 ? "auto" : "none"; }

    // wind-moth
    let tg = { x: gx(852), y: gy(444) };
    if (inMenu && this.sel && !this.state.scroll) tg = { x: gx(900 + PW - (tight ? 32 : 0)), y: gy(520 + ids.indexOf(this.sel) * 63 + 40) };
    else if (this.mothTo === "board" && this.mode !== "menu") tg = { x: gx(900 + BW - (BW < 250 ? 34 : 24)), y: gy(602) };
    tg.x = Math.max(-tx / S + 38, Math.min((W - tx) / S - 38, tg.x)); tg.y = Math.max(-ty / S + 48, tg.y);
    const mo = this.moth, ddx = tg.x - mo.x, ddy = tg.y - mo.y;
    if (live) { const kk = 1 - Math.exp(-this.dt * .0055); mo.x += ddx * kk; mo.y += ddy * kk; } else { mo.x = tg.x; mo.y = tg.y; }
    const dist = Math.hypot(tg.x - mo.x, tg.y - mo.y), fly = Math.min(1, dist / 70);
    if (dist < 7 && !this.landed && inMenu && this.sel) { this.landed = true; this.dip[this.sel] = t; }
    e = $("moth"); if (e) e.style.transform = "translate(" + (mo.x - 33) + "px," + (mo.y - 40 + (live ? Math.sin(t / 420) * 2 * (1 - fly) + Math.sin(t / 90) * 5 * fly : 0) - fly * 14) + "px) rotate(" + Math.max(-14, Math.min(14, ddx * .03)) + "deg) scaleX(" + (live ? (fly > .06 ? .55 + .45 * Math.abs(Math.sin(t / 38)) : .9 + .1 * Math.sin(st / 1000 * 2.2)) : 1) + ")";

    // court
    const ct = $("court"); if (ct) { ct.style.display = s.courtA! > 0 ? "block" : "none"; ct.style.opacity = String(s.courtA); }
    if (s.courtA! > 0) {
      const v = this.cv, fs = Math.min((port ? W * .9 : W * .52) / 760, H * (short ? .94 : .76) / 900), lf = (fz ? 14 : Math.max(14, 11 / fs)) + "px";
      e = $("field"); if (e) e.style.transform = "translate(" + ((port ? W * .5 : short ? W * .36 : W * .47) - 380 * fs) + "px," + Math.max(0, (H * (short ? 1 : .8) - 900 * fs) / 2) + "px) scale(" + fs + ")";
      e = $("docklabel"); if (e) e.style.fontSize = lf;
      let f: number = MOCHI_POSES[v.pose].frame;
      if (v.walk && v.wf && v.wt) { const d = Math.hypot(v.wt.x - v.wf.x, v.wt.y - v.wf.y) || 1, pr = Math.min(1, Math.hypot(v.mx - v.wf.x, v.my - v.wf.y) / d); f = 4 + Math.floor(pr * 4 * v.walk) % 4; }
      e = $("cmochi"); if (e) { this.frame(e, f); e.style.transform = "translate(" + (v.mx - 56) + "px," + (v.my - 98) + "px) scaleX(" + (v.flip ? -1 : 1) + ") scaleY(" + v.sq + ")"; }
      e = $("cshadow"); if (e) e.style.transform = "translate(" + (v.mx - 31) + "px," + (v.my - 4) + "px)";
      e = $("ghost"); if (e) { e.style.opacity = String(v.ghostA); e.style.transform = "translate(" + (v.gx - 56) + "px," + (v.gy - 98) + "px)"; }
      e = $("bridge"); if (e) e.style.transform = "translate(" + (v.bx - 52.5) + "px,363px) rotate(" + v.brot + "deg)";
      e = $("keeper"); if (e) { e.style.transform = "rotate(" + v.krot + "deg) scale(" + (2 - v.ks) + "," + v.ks + ")"; e.style.filter = v.laneA > .5 ? "sepia(.18) brightness(.95)" : "none"; }
      e = $("lane"); if (e) { e.style.opacity = String(v.laneA); e.style.transform = "translateX(" + (v.laneX - 77) + "px)"; }
      e = $("mark"); if (e) { e.style.opacity = String(Math.min(1, v.markA)); e.style.transform = "translateX(" + (v.laneX - 8) + "px) scale(" + Math.max(.01, v.markA) + ")"; }
      e = $("lanelabel"); if (e) { e.style.fontSize = lf; e.style.opacity = String(v.laneA); e.style.transform = "translateX(" + v.laneX + "px) translateX(-50%)"; }
      e = $("wave"); if (e) { e.style.opacity = String(v.wa); e.style.transform = "translate(" + (v.wx - 126.5) + "px," + (v.wy - 45) + "px)"; }
      e = $("sh0"); if (e) { e.style.opacity = String(v.sh0 >= 1 ? 0 : 1 - .65 * v.sh0); e.style.transform = "translateY(" + (v.sh0 * 15) + "px) scale(" + (1 + .25 * v.sh0) + "," + (1 - .45 * v.sh0) + ")"; }
      e = $("lens"); if (e) { e.style.opacity = String(Math.min(1, v.lens * 2)); e.style.transform = "scale(" + Math.max(.01, v.lens) + ")"; }
      for (let i = 0; i < 4; i++) { const el = $("cr" + i), rg = v.rings[i]; if (!el) continue; if (!rg) { el.style.opacity = "0"; continue; } el.style.opacity = rg.hot ? "1" : ".45"; el.style.transform = "translate(" + (rg.x - 113) + "px," + (rg.y - 34.5) + "px) scale(" + (rg.hot && live ? 1 + .03 * Math.sin(t / 140) : 1) + ")"; }
    }
  }

  render() {
    const st = this.state, ids = this.items();
    const pegs = (bus: "music" | "effects") => [1, 2, 3, 4, 5].map(n => (
      <button key={n} data-bus={bus} data-n={n} onClick={this.onPeg} aria-label={(bus === "music" ? "Music" : "Effects") + " level " + n} aria-pressed={n <= st[bus]} style={sx("width:30px;height:44px;padding:0;border:0;background:transparent;cursor:pointer;display:grid;place-items:center")}>
        <span style={{ ...sx("width:16px;height:16px;box-sizing:border-box;border-radius:50%;border:2px solid #5d4228"), background: n <= st[bus] ? "#3c6555" : "transparent" }} />
      </button>));
    const scrollTitle = st.scroll ? LABEL[st.scroll] : "";
    return (
      <div className={this.props.framed ? "familiar-opening framed" : "familiar-opening"}>
        <div ref={this.setRoot} data-screen-label="Opening" data-testid="opening" onPointerDown={this.onTap} style={sx("position:absolute;inset:0;overflow:hidden;background:#304e40;container-type:size;font-family:'Figtree Variable',sans-serif;color:#fff1d1;user-select:none;touch-action:manipulation;cursor:default")}>
          <div data-el="world" style={sx("position:absolute;left:0;top:0;width:1536px;height:1024px;transform-origin:0 0;will-change:transform")}>
            <img src={ART + "harbor.webp"} alt="" draggable={false} style={sx("position:absolute;left:0;top:0;width:1536px;height:1024px;display:block")} />
            <div data-el="horizon" style={sx("position:absolute;left:640px;top:457px;width:540px;height:5px;background:repeating-linear-gradient(90deg,#fff1c8aa 0 10px,transparent 10px 34px);filter:blur(1.2px);mix-blend-mode:screen;opacity:.35")} />
            {GEO.glints.map((g, i) => <div key={i} data-glint="1" style={{ ...sx("position:absolute;height:3px;border-radius:50%;background:#ffe8b0;filter:blur(.6px);mix-blend-mode:screen;opacity:.4"), left: g.l, top: g.t, width: g.w }} />)}
            <div data-el="lamp" style={sx("position:absolute;left:293px;top:392px;width:140px;height:120px;background:radial-gradient(closest-side,#ffd27a88,#ffcd6533 55%,transparent);mix-blend-mode:screen")} />
            <div data-el="wash" style={sx("position:absolute;left:0;top:0;width:1536px;height:1024px;background:radial-gradient(90% 70% at 80% 44%,#ffc98a66,#ff9d7a22 45%,transparent 72%);mix-blend-mode:soft-light;pointer-events:none")} />
            <div data-el="dusk" style={sx("position:absolute;left:0;top:0;width:1536px;height:1024px;background:#5a4a8c;opacity:.05;pointer-events:none")} />

            <img data-el="bram" src={ART + "bram.webp"} alt="" draggable={false} style={sx("position:absolute;left:319px;top:587px;width:223px;height:255px;transform-origin:50% 100%")} />
            <div data-el="mshadow" style={sx("position:absolute;left:572px;top:823px;width:96px;height:14px;border-radius:50%;background:#34271940")} />
            <div data-el="mochi" role="img" aria-label="Mochi" style={{ ...sx("position:absolute;left:525px;top:664px;width:190px;height:190px;transform-origin:50% 87.5%"), background: `url('${ART}mochi-poses.webp') 0% 100%/400% 400% no-repeat` }} />

            <div data-el="post" onPointerDown={this.stop} style={sx("position:absolute;left:0;top:0")}>
              <div style={sx("position:absolute;left:882px;top:452px;width:16px;height:406px;border-radius:2px;background:linear-gradient(90deg,#4d3823,#77583a 45%,#5d432c)")} />
              <div style={sx("position:absolute;left:878px;top:446px;width:24px;height:9px;border-radius:3px;background:#766346")} />
              <div style={sx("position:absolute;left:818px;top:466px;width:70px;height:7px;border-radius:3px;background:#77583a;box-shadow:0 2px 0 #4d382366")} />
              <div data-el="ring1" style={sx("position:absolute;left:796px;top:470px;width:60px;height:60px;box-sizing:border-box;border:2px solid #ffe1a1;border-radius:50%;opacity:0;pointer-events:none")} />
              <div data-el="ring2" style={sx("position:absolute;left:796px;top:470px;width:60px;height:60px;box-sizing:border-box;border:2px solid #ffe1a1;border-radius:50%;opacity:0;pointer-events:none")} />
              <button data-el="bell" className="fo-bell" onClick={this.onBell} aria-label={st.sound ? "Mute game audio" : "Enable game audio"} aria-pressed={st.sound} style={sx("position:absolute;left:796px;top:471px;width:60px;height:124px;padding:0;border:0;background:transparent;cursor:pointer;transform-origin:50% 0")}>
                <span style={sx("position:absolute;left:29px;top:0;width:2px;height:10px;background:#5d4228")} />
                <span style={sx("position:absolute;left:9px;top:9px;width:42px;height:40px;border-radius:21px 21px 5px 5px / 28px 28px 5px 5px;background:linear-gradient(105deg,#f6d894 0%,#e3bc79 42%,#b88947 100%);box-shadow:inset -4px -3px 0 #a9783a55,0 3px 6px #38281840")} />
                <span style={sx("position:absolute;left:4px;top:45px;width:52px;height:9px;border-radius:5px;background:linear-gradient(105deg,#eecb86,#c79a55)")} />
                <span style={sx("position:absolute;left:26px;top:52px;width:9px;height:9px;border-radius:50%;background:#77583a")} />
                <span style={sx("position:absolute;left:30px;top:60px;width:1.5px;height:20px;background:#e0bf86")} />
                <span style={sx("position:absolute;left:26px;top:79px;width:9px;height:9px;box-sizing:border-box;border:1.5px solid #e0bf86;border-radius:50%")} />
                <span style={sx("position:absolute;left:-8px;top:92px;width:76px;height:24px;box-sizing:border-box;display:grid;place-items:center;background:#f3e1b8;border:1px solid #a77d45;border-radius:4px;color:#2d4637;font:700 12px/1 'Figtree Variable',sans-serif;transform:rotate(-3deg);box-shadow:0 2px 5px #382b2040")}>{st.sound ? "Sound on" : "Sound off"}</span>
              </button>

              <div data-el="planks" role="menu" aria-label="Title menu" style={sx("position:absolute;left:900px;top:520px;width:236px;display:flex;flex-direction:column;gap:7px")}>
                {ids.map(id => (
                  <button key={id} data-plank={id} role="menuitem" onPointerEnter={this.onPlankEnter} onClick={this.onPlankClick} style={sx(PLANK)}>
                    <span style={sx(NAIL)} />{LABEL[id]}
                  </button>))}
              </div>

              <div data-el="scroll" role="dialog" aria-label={scrollTitle} style={sx("position:absolute;left:900px;top:520px;width:250px;transform-origin:50% 0;opacity:0;pointer-events:none")}>
                <div style={sx("position:relative;height:56px;box-sizing:border-box;display:flex;align-items:center;padding:0 16px 0 30px;border:1px solid #ffe1a1;border-radius:9px;background:#6a4d31;color:#fff5d8;box-shadow:inset 0 1px 0 #b48d55,0 4px 14px #382b2040;font:650 23px/1 'Fraunces Variable',serif;letter-spacing:-.02em")}><span style={sx("position:absolute;left:11px;top:50%;width:7px;height:7px;margin-top:-4px;border-radius:50%;background:#e4be78")} />{scrollTitle}</div>
                <div style={sx("display:flex;justify-content:space-between;padding:0 34px;height:10px")}><span style={sx("width:2px;background:#c9ad79")} /><span style={sx("width:2px;background:#c9ad79")} /></div>
                <div style={sx("padding:14px 16px 12px;background:#f3e1b8;border:2px solid #fff0cf;outline:1px solid #a77d45;border-radius:12px;box-shadow:0 8px 24px #352c2440;color:#263e32;font:500 14px/1.4 'Figtree Variable',sans-serif;display:flex;flex-direction:column;gap:10px")}>
                  {st.scroll === "tide" && <>
                    <p style={{ margin: 0 }}>One ask a day from the Tidekeeper, on a fresh Beacon Court.</p>
                    {this.hasLitHarbor ? <button className="fo-row" onClick={this.onTide} style={sx("min-height:44px;border:1px solid #ae9062;border-radius:9px;padding:9px 14px;background:#eddbad;color:#2d4637;box-shadow:inset 0 2px 0 #fff0cf,inset 0 -2px 0 #b9945a40,0 3px 8px #33271120;font:750 15px/1.2 'Figtree Variable',sans-serif;cursor:pointer")}>Continue to today’s ask</button> : <p style={{ margin: 0 }}>The asks begin once the beacon is lit.</p>}
                  </>}
                  {st.scroll === "options" && <>
                    <button className="fo-row" onClick={this.onSoundRow} aria-pressed={st.sound} style={sx("min-height:44px;border:1px solid #ae9062;border-radius:9px;padding:9px 14px;background:#eddbad;color:#2d4637;box-shadow:inset 0 2px 0 #fff0cf,inset 0 -2px 0 #b9945a40,0 3px 8px #33271120;font:750 15px/1.2 'Figtree Variable',sans-serif;cursor:pointer")}>{st.sound ? "Sound on" : "Sound off"}</button>
                    <div style={sx("display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between")}><span style={{ fontWeight: 800 }}>Music</span><div style={{ display: "flex" }}>{pegs("music")}</div></div>
                    <div style={sx("display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between")}><span style={{ fontWeight: 800 }}>Effects</span><div style={{ display: "flex" }}>{pegs("effects")}</div></div>
                  </>}
                  {st.scroll === "credits" && <>
                    <div><div style={{ fontWeight: 800 }}>Type</div><div>Fraunces · Figtree</div></div>
                    <div><div style={{ fontWeight: 800 }}>Made with</div><div>Phaser · React · Hono · near-api-js</div></div>
                  </>}
                  <button onClick={this.onBack} style={sx("align-self:flex-start;min-height:44px;padding:4px 7px;background:transparent;border:0;font:750 13px/1.4 'Figtree Variable',sans-serif;color:#2b5146;text-decoration:underline;text-underline-offset:3px;cursor:pointer")}>Back</button>
                </div>
              </div>
            </div>

            <img data-el="moth" src={ART + "moth.webp"} alt="" draggable={false} style={sx("position:absolute;left:0;top:0;width:66px;height:44px;pointer-events:none;will-change:transform")} />
          </div>

          <div data-el="court" aria-hidden="true" style={{ ...sx("position:absolute;inset:0;display:none;pointer-events:none"), background: `#3f8f8a url('${ART}tide-court.webp') center/cover no-repeat` }}>
            <div data-el="field" style={sx("position:absolute;left:0;top:0;width:760px;height:900px;transform-origin:0 0")}>
              <img data-el="keeper" src={ART + "tidekeeper.webp"} alt="" style={sx("position:absolute;left:248px;top:56px;width:264px;height:176px;transform-origin:50% 100%")} />
              {GEO.walks.map((w, i) => <img key={i} src={ART + "wooden-bridge.webp"} alt="" style={{ ...sx("position:absolute;width:63px;height:189px"), left: w.l, top: w.t }} />)}
              {GEO.gaps.map((g, i) => <div key={i} style={{ ...sx("position:absolute;top:510px;width:132px;height:33px;box-sizing:border-box;border:2px solid #a8c8bd66;border-radius:50%"), left: g.l }} />)}
              <img data-el="bridge" src={ART + "wooden-bridge.webp"} alt="" style={sx("position:absolute;left:0;top:0;width:105px;height:314px")} />
              {GEO.tiles.map((t, i) => <div key={i} style={{ ...sx("position:absolute;width:220px;height:74px"), left: t.l, top: t.t }}><div style={sx("position:absolute;left:-6px;top:32px;width:232px;height:40px;border-radius:50%;background:#183c3d38;outline:1px solid #e5edce59")} /><img src={ART + "stone-island.webp"} alt="" style={sx("position:absolute;left:0;top:0;width:220px;height:74px")} /></div>)}
              <div data-el="lane" style={sx("position:absolute;left:0;top:210px;width:154px;height:625px;box-sizing:border-box;background:#c3523538;border:3px solid #f8be78f2;border-radius:12px;opacity:0")}>{GEO.chev.map((c, i) => <span key={i} style={{ ...sx("position:absolute;left:67px;width:14px;height:14px;box-sizing:border-box;border-right:3px solid #f8be78;border-bottom:3px solid #f8be78;transform:rotate(45deg)"), top: c.t }} />)}</div>
              <div data-el="mark" style={sx("position:absolute;left:0;top:259px;width:16px;height:16px;box-sizing:border-box;border:2px solid #ffdf96;outline:2px solid #4e4534;border-radius:50%;opacity:0;z-index:6")} />
              <div data-el="lanelabel" style={sx("position:absolute;left:0;top:120px;padding:4px 7px;background:#314d42;color:#fff5d8;font:700 14px/1.2 'Figtree Variable',sans-serif;white-space:nowrap;opacity:0;z-index:6")}>{st.lane}</div>
              {[0, 1, 2, 3].map(i => <div key={i} data-el={"cr" + i} style={sx("position:absolute;left:0;top:0;width:226px;height:80px;box-sizing:border-box;border:3px solid #ffe1a1;border-radius:50%;opacity:0")} />)}
              <img data-el="lens" src={ART + "lens.webp"} alt="" style={sx("position:absolute;left:103px;top:201px;width:48px;height:48px;opacity:0")} />
              <img data-el="sh0" src={ART + "shell.webp"} alt="" style={sx("position:absolute;left:56px;top:154px;width:141px;height:141px")} />
              <img src={ART + "shell.webp"} alt="" style={sx("position:absolute;left:563px;top:154px;width:141px;height:141px")} />
              <div data-el="docklabel" style={sx("position:absolute;left:380px;top:846px;transform:translateX(-50%);padding:4px 7px;background:#314d42;color:#fff5d8;font:700 14px/1.2 'Figtree Variable',sans-serif")}>DOCK</div>
              <div data-el="ghost" style={{ ...sx("position:absolute;left:0;top:0;width:112px;height:112px;opacity:0"), background: `url('${ART}mochi-poses.webp') 0% 0%/400% 400% no-repeat` }} />
              <div data-el="cshadow" style={sx("position:absolute;left:0;top:0;width:62px;height:11px;border-radius:50%;background:#34271940")} />
              <div data-el="cmochi" style={{ ...sx("position:absolute;left:0;top:0;width:112px;height:112px;transform-origin:50% 87.5%"), background: `url('${ART}mochi-poses.webp') 0% 100%/400% 400% no-repeat` }} />
              <img data-el="wave" src={ART + "wave.webp"} alt="" style={sx("position:absolute;left:0;top:0;width:253px;height:90px;opacity:0")} />
            </div>
          </div>

          <div data-el="scrim" style={sx("position:absolute;left:0;right:0;bottom:0;height:32%;background:linear-gradient(180deg,transparent,#2a1d1099);opacity:0;pointer-events:none")} />
          <div data-el="veil" style={sx("position:absolute;inset:0;background:#304e40;pointer-events:none")} />
          <div data-el="tide" style={sx("position:absolute;left:0;right:0;bottom:0;height:0;display:none;box-sizing:border-box;background:linear-gradient(180deg,#4b8a80 0%,#386457 55%,#2b5046 100%);border-top:3px solid #f8e9c5;box-shadow:0 -1px 26px #f8e9c566,inset 0 14px 22px -10px #bfe6d655;pointer-events:none")} />

          <div data-el="title" style={sx("position:absolute;left:53.5%;top:8%;transform:translateX(-50%);font-size:min(10.5cqw,21cqh);text-align:center;pointer-events:none;white-space:nowrap")}>
            <div style={sx("position:relative;font:620 1em/1 'Fraunces Variable',serif;letter-spacing:-.045em")}>
              <div data-el="dim" aria-hidden="true" style={{ color: "#56796a" }}>familiar.</div>
              <h1 data-el="bright" style={sx("position:absolute;inset:0;margin:0;font:inherit;letter-spacing:inherit;color:#fff1d1;text-shadow:0 .018em 0 #5d4228,0 .036em 0 #5d4228cc,0 .09em .22em #3a281899")}>familiar<span style={{ color: "#e4be78" }}>.</span></h1>
            </div>
            <div data-el="chap" style={{ opacity: 0 }}>
              <div style={sx("display:flex;align-items:center;justify-content:center;gap:.9em;margin-top:.55em;font:500 max(.2em,17px)/1 'Fraunces Variable',serif;letter-spacing:.01em;color:#fff1d1;text-shadow:0 1px 0 #5d4228,0 2px 10px #3a2818aa")}><span style={sx("width:2.4em;height:2px;background:#e4be78;box-shadow:0 1px 0 #5d4228")} /><span>First Light</span><span style={sx("width:2.4em;height:2px;background:#e4be78;box-shadow:0 1px 0 #5d4228")} /></div>
            </div>
          </div>

          <div data-el="cap" role="status" aria-live="polite" style={sx("position:absolute;left:50%;bottom:9%;transform:translateX(-50%);width:min(88cqw,720px);text-align:center;opacity:0;pointer-events:none;color:#fff1d1;text-shadow:0 1px 0 #5d4228,0 2px 14px #2a1d10,0 0 22px #2a1d10")}>
            <div style={sx("font:620 clamp(21px,2.5cqw,34px)/1.12 'Fraunces Variable',serif;letter-spacing:-.025em;text-wrap:balance")}>{st.cap1}</div>
            <div style={sx("margin-top:.45em;font:560 clamp(14px,1.3cqw,18px)/1.35 'Figtree Variable',sans-serif;text-wrap:pretty")}>{st.cap2}</div>
          </div>
          <div data-el="prompt" style={sx("position:absolute;left:50%;bottom:calc(env(safe-area-inset-bottom,0px) + 3.5%);transform:translateX(-50%);font:700 clamp(12px,1.25cqw,18px)/1 'Figtree Variable',sans-serif;letter-spacing:.2em;text-transform:uppercase;color:#fff1d1;text-shadow:0 1px 0 #5d4228,0 2px 12px #2a1d10,0 0 18px #2a1d10;opacity:0;white-space:nowrap;pointer-events:none")}>{st.prompt}</div>
        </div>
      </div>
    );
  }
}
