/** Draws a tide run. The board is redrawn from `shown`; each accepted move plays its events, then shows the state after. */
import Phaser from "phaser";
import { MOCHI_GROUND, MOCHI_POSES, walkingPose, type MochiPoseName } from "../motion/mochi";
import { companionIdle } from "../expedition/companion";
import { DOCK, STORY_SHELL, applyMove, countdown, legalMoves, stepDestination, type Item, type Lane, type Position, type TideEvent, type TideState, type TideTransition } from "./engine";

const ART = "/assets/expedition/runtime/";
const IMAGES: Readonly<Record<string, string>> = {
  court: `${ART}tide-court.webp`, island: `${ART}stone-island.webp`, bridge: `${ART}wooden-bridge.webp`, mochi: `${ART}mochi-poses.webp`,
  keeper: `${ART}tidekeeper.webp`, shell: `${ART}shell.webp`, wave: `${ART}wave.webp`, lens: `${ART}lens.webp`, moth: `${ART}moth.webp`,
  reed: "/assets/season/reed.webp", glass: "/assets/season/glass.webp",
};
const FONT = "Figtree Variable, sans-serif";
const LANES = [0, 1, 2] as const;
const same = (a: Position, b: Position) => a.x === b.x && a.y === b.y;

export interface TideSnapshot { readonly tide: TideState; readonly reducedMotion: boolean }
export interface TideHooks {
  target: (position: Position) => void;
  ready: () => void;
  fault: (message: string) => void;
  beat: (event: TideEvent) => void;
  settled: (id: number) => void;
}

export class TideScene extends Phaser.Scene {
  private hooks: TideHooks;
  private snapshot: TideSnapshot;
  private shown: TideState;
  /** The story shell stays shut until its wave lands. */
  private shut = false;
  private backdrop!: Phaser.GameObjects.Image;
  private ground!: Phaser.GameObjects.Graphics;
  private lanes!: Phaser.GameObjects.Graphics;
  private hints!: Phaser.GameObjects.Graphics;
  private bridgeArt!: Phaser.GameObjects.Image;
  private keeper!: Phaser.GameObjects.Image;
  private actor!: Phaser.GameObjects.Sprite;
  private actorShadow!: Phaser.GameObjects.Ellipse;
  private actorPose: MochiPoseName = "curious";
  private parts: Phaser.GameObjects.GameObject[] = [];
  private prizes = new Map<string, Phaser.GameObjects.Image>();
  private ghosts: Phaser.GameObjects.Image[] = [];
  /** Everything `forecast` draws, so it can be redrawn without a full layout. */
  private marks: Phaser.GameObjects.GameObject[] = [];
  private shell: Phaser.GameObjects.Image | null = null;
  private pack: Phaser.GameObjects.Image[] = [];
  private presses = new Map<number, { target: string; x: number; y: number }>();
  private epoch = 0;
  private lastPresentation = 0;
  private playing = false;
  private gated = false;
  private stopped = false;
  private idleElapsed = 0;
  private idleScale = { x: 1, y: 1 };
  private presentationSize: { w: number; h: number } | null = null;
  private get w() { return this.presentationSize?.w ?? this.scale.width; }
  private get h() { return this.presentationSize?.h ?? this.scale.height; }

  constructor(snapshot: TideSnapshot, hooks: TideHooks) {
    super("tide-run");
    this.snapshot = snapshot; this.hooks = hooks; this.shown = snapshot.tide; this.shut = this.shellShut(snapshot.tide);
  }
  private shellShut(tide: TideState) { return !!tide.story && tide.wave < 2; }

  preload() {
    for (const [key, path] of Object.entries(IMAGES)) this.load.image(`tide-${key}`, path);
    this.load.on("loaderror", (file: Phaser.Loader.File) => {
      this.stopped = true;
      this.hooks.fault(`The ${file.key.replace("tide-", "")} artwork did not load. Your saved moves are safe. Retry the scene.`);
    });
  }

  create() {
    if (this.stopped) return;
    const missing = Object.keys(IMAGES).find(key => !this.textures.exists(`tide-${key}`));
    if (missing) { this.stopped = true; this.hooks.fault(`The ${missing} artwork could not be decoded. Your saved moves are safe. Retry the scene.`); return; }
    const atlas = this.textures.get("tide-mochi"), source = atlas.getSourceImage() as HTMLImageElement;
    for (let i = 0; i < 16; i++) atlas.add(i, 0, (i % 4) * source.width / 4, Math.floor(i / 4) * source.height / 4, source.width / 4, source.height / 4);
    this.drawnTextures();
    this.backdrop = this.add.image(0, 0, "tide-court").setOrigin(.5).setDepth(-20);
    this.ground = this.add.graphics().setDepth(0);
    this.bridgeArt = this.add.image(0, 0, "tide-bridge").setDepth(.5);
    this.lanes = this.add.graphics().setDepth(2);
    this.hints = this.add.graphics().setDepth(2.1);
    this.keeper = this.add.image(0, 0, "tide-keeper").setOrigin(.5, 1).setDepth(3);
    this.actorShadow = this.add.ellipse(0, 0, 50, 13, 0x342719, .25).setDepth(7);
    this.actor = this.add.sprite(0, 0, "tide-mochi", 12).setOrigin(.5, MOCHI_GROUND).setDepth(10);
    this.scale.on("resize", () => {
      if (this.playing && this.presentationSize) {
        const zoom = Math.min(this.scale.width / this.presentationSize.w, this.scale.height / this.presentationSize.h);
        this.cameras.main.setZoom(zoom).centerOn(this.presentationSize.w / 2, this.presentationSize.h / 2);
      } else { this.cameras.main.setZoom(1).setScroll(0, 0); this.layout(); }
    });
    this.events.once("shutdown", () => { this.stopped = true; this.epoch++; });
    this.input.mouse?.disableContextMenu();
    const release = (pointer: Phaser.Input.Pointer) => this.presses.delete(pointer.id);
    this.input.on("pointerup", release); this.input.on("pointerupoutside", release);
    this.layout(); this.hooks.ready();
  }

  /** The Signal Vane and the pearl have no painted art yet: both are drawn. */
  private drawnTextures() {
    const vane = this.add.graphics();
    vane.lineStyle(6, 0x4d4031).lineBetween(31, 29, 31, 54).lineBetween(9, 29, 51, 29);
    vane.lineStyle(3, 0xe3b36b).lineBetween(30, 29, 30, 53).lineBetween(9, 28, 50, 28);
    vane.fillStyle(0x4d4031).fillTriangle(2, 9, 24, 23, 22, 31).fillTriangle(2, 42, 22, 31, 24, 23).fillTriangle(43, 15, 63, 28, 43, 37);
    vane.fillStyle(0x68877a).fillTriangle(5, 13, 21, 23, 20, 28).fillTriangle(5, 39, 20, 30, 22, 26);
    vane.fillStyle(0xf3c476).fillTriangle(45, 18, 60, 28, 45, 34);
    vane.fillStyle(0x534635).fillCircle(31, 28, 7).fillStyle(0xffda8a).fillCircle(30, 27, 4);
    vane.fillStyle(0x4d4031).fillRoundedRect(25, 51, 12, 6, 2);
    vane.generateTexture("tide-vane", 64, 64); vane.destroy();
    const pearl = this.add.graphics();
    pearl.fillStyle(0x2c4a47, .25).fillEllipse(32, 58, 44, 9);
    pearl.fillStyle(0xb9a48f).fillCircle(32, 31, 27).fillStyle(0xf1e3d2).fillCircle(31, 30, 25);
    pearl.fillStyle(0xfdf6ec).fillCircle(27, 25, 18).fillStyle(0xf3bfbb, .6).fillEllipse(40, 42, 20, 11);
    pearl.fillStyle(0xffffff, .95).fillEllipse(22, 19, 12, 8);
    pearl.generateTexture("tide-pearl", 64, 64); pearl.destroy();
  }

  /** Presentation coordinates are responsive. Logical cells and accepted state never resize. */
  private field() {
    const portrait = this.w <= 900 && this.h > this.w;
    if (portrait && this.h < 500) { const top = 144, bottom = this.h - 166, width = this.w * .82; return { cx: this.w / 2, width, top, bottom, dy: (bottom - top) / 4, dx: width / 3 }; }
    if (this.h <= 500) { const available = this.w - 280, width = Math.max(240, Math.min(available * .91, 760)), top = 98, bottom = this.h - 34; return { cx: available / 2, width, top, bottom, dy: (bottom - top) / 4, dx: width / 3 }; }
    const top = portrait ? (this.h < 650 ? 151 : Math.max(200, this.h * .29)) : Math.max(190, this.h * .31);
    const bottom = portrait ? this.h - 240 : this.h - 72;
    const width = Math.min(portrait ? this.w * .84 : this.w * .50, 760);
    return { cx: portrait ? this.w * .5 : this.w * .45, width, top, bottom, dy: (bottom - top) / 4, dx: width / 3 };
  }
  private point(position: Position) { const f = this.field(); return { x: f.cx + (position.x - 1) * f.dx, y: f.bottom - position.y * f.dy }; }
  private tileSize() { const f = this.field(); return { width: Math.min(f.dx * .99, 220), height: Math.max(33, Math.min(f.dy * .65, 72)) }; }
  private actorSize() { return Math.min(this.field().dx * .66, this.field().dy * 1.1, 112); }
  private prizeSize(kind: Item) { return Math.min(kind === "reed" ? 62 : kind === "moth" ? 58 : 50, this.tileSize().width * .55); }
  private pose(name: MochiPoseName) { this.actorPose = name; this.actor.setFrame(MOCHI_POSES[name].frame); }
  private keep<T extends Phaser.GameObjects.GameObject>(part: T) { this.parts.push(part); return part; }
  private label(x: number, y: number, text: string, size: number, background = "#314d42") {
    return this.add.text(x, y, text, { fontFamily: FONT, fontSize: `${size}px`, fontStyle: "bold", color: "#fff5d8", backgroundColor: background, padding: { x: 7, y: 4 }, align: "center" }).setOrigin(.5).setDepth(12);
  }
  /** Phaser hit-tests game objects even when a DOM card above the canvas took the press. */
  private onCanvas(pointer: Phaser.Input.Pointer) { return pointer.downElement === this.game.canvas; }

  update(time: number, delta: number) {
    if (!this.actor || this.stopped || document.hidden) return;
    if (!this.snapshot.reducedMotion) for (const ghost of this.ghosts) ghost.setAlpha(.34 + .14 * Math.sin(time / 240));
    if (this.playing || this.gated || this.snapshot.reducedMotion) return;
    this.idleElapsed += Math.min(delta, 100);
    const idle = companionIdle(this.idleElapsed, this.attention(), false);
    if (this.idleElapsed > 1200) this.pose(idle.pose);
    this.actor.setScale(this.idleScale.x, this.idleScale.y * idle.breath);
  }
  private attention() {
    const tide = this.shown;
    if (tide.outcome !== "active") return "rest" as const;
    return countdown(tide) === 1 && tide.next.lanes.includes(tide.position.x) && tide.position.y > 0 ? "water" as const : "player" as const;
  }
  private resetIdle() {
    this.idleElapsed = 0; this.idleScale = { x: this.actor.scaleX, y: this.actor.scaleY }; this.actor.setAngle(0);
    if (this.snapshot.reducedMotion) this.pose(companionIdle(0, this.attention(), true).pose);
  }

  setSnapshot(snapshot: TideSnapshot, transition: TideTransition | null, id: number) {
    this.snapshot = snapshot;
    if (!this.actor || this.stopped) return;
    if (transition && id !== this.lastPresentation) { this.lastPresentation = id; void this.present(transition, id); }
    else if (!this.playing) { this.shown = snapshot.tide; this.shut = this.shellShut(snapshot.tide); this.layout(); }
  }
  setGated(gated: boolean) {
    this.gated = gated; if (gated) this.presses.clear(); if (!this.actor) return;
    this.input.enabled = !gated; this.time.paused = gated;
    if (gated) this.tweens.pauseAll(); else this.tweens.resumeAll();
  }

  private layout() {
    if (!this.actor || this.stopped) return;
    this.presses.clear();
    for (const part of this.parts) part.destroy();
    this.parts = []; this.prizes.clear(); this.pack = []; this.shell = null;
    this.ground.clear();
    const tide = this.shown, f = this.field(), tile = this.tileSize(), portrait = this.w <= 900 && this.h > this.w;
    const cover = this.backdrop.texture.getSourceImage() as HTMLImageElement;
    this.backdrop.setPosition(this.w / 2, this.h / 2).setScale(Math.max(this.w / cover.width, this.h / cover.height));
    // Fixed short walks join each bank. Only the long middle crossing moves with a wave.
    for (const y of [0, 3]) for (const x of LANES) {
      const from = this.point({ x, y }), to = this.point({ x, y: y + 1 }), length = f.dy * 1.35;
      this.keep(this.add.image(from.x, (from.y + to.y) / 2, "tide-bridge").setDisplaySize(length / 3, length).setDepth(.4));
    }
    const island = this.textures.get("tide-island").getSourceImage() as HTMLImageElement;
    for (let y = 0; y < 5; y++) for (const x of LANES) {
      const position = { x, y }, p = this.point(position);
      if (y !== 2) {
        this.ground.fillStyle(0x183c3d, .22).fillEllipse(p.x, p.y + tile.width * .1, tile.width * 1.05, tile.width * .18);
        this.ground.lineStyle(1, 0xe5edce, .35).strokeEllipse(p.x, p.y + tile.width * .1, tile.width * 1.09, tile.width * .24);
        this.keep(this.add.image(p.x, p.y, "tide-island").setOrigin(.5, .41).setDisplaySize(tile.width, tile.width * island.height / island.width).setDepth(1));
      } else if (x !== tide.bridge) this.ground.lineStyle(2, 0xa8c8bd, .4).strokeEllipse(p.x, p.y + 6, tile.width * .6, tile.height * .45);
      const zone = this.keep(this.add.zone(p.x, p.y, Math.max(44, tile.width), Math.max(44, Math.min(tile.height + 15, f.dy - 2))).setInteractive({ useHandCursor: true }).setDepth(16));
      const target = `${x},${y}`;
      zone.on("pointerdown", (pointer: Phaser.Input.Pointer) => { if (!this.gated && this.onCanvas(pointer)) this.presses.set(pointer.id, { target, x: pointer.x, y: pointer.y }); });
      zone.on("pointerup", (pointer: Phaser.Input.Pointer) => {
        const press = this.presses.get(pointer.id); this.presses.delete(pointer.id);
        if (this.gated || this.playing || pointer.wasCanceled || press?.target !== target || Math.hypot(pointer.x - press.x, pointer.y - press.y) > 12) return;
        if (pointer.wasTouch || pointer.leftButtonReleased()) this.hooks.target(position);
      });
    }
    const crossing = this.point({ x: tide.bridge, y: 2 }), span = f.dy * 1.65 * 1.36;
    this.bridgeArt.setPosition(crossing.x, crossing.y).setDisplaySize(span / 3, span).setAngle(0).setAlpha(1);
    const dock = this.point(DOCK);
    if (!(portrait && this.h < 500 && same(tide.position, DOCK))) this.keep(this.label(dock.x, dock.y + (this.h < 500 ? -tile.height * .45 : tile.height * .72), "DOCK", Math.min(14, this.w / 28)));
    const keeperHeight = Math.min(this.h < 500 ? f.top - (portrait ? 78 : 15) : 230, this.h * .26, portrait ? this.w * (this.h < 650 ? .38 : .45) : this.w * .52, portrait ? f.top - (this.h < 650 ? 15 : 80) : Infinity);
    this.keeper.setPosition(this.h < 500 && !portrait ? f.cx + Math.min(60, f.width * .18) : portrait && this.h < 650 ? this.w * .72 : f.cx, f.top - 8).setDisplaySize(keeperHeight * 1.32, keeperHeight);

    // The far-shore corners are shells: pearls arrive in them, and a story prize waits in one.
    for (const x of [0, 2] as const) {
      const p = this.point({ x, y: 4 }), waiting = this.shut && tide.story && STORY_SHELL[tide.story].x === x;
      const size = tile.width * (waiting ? .64 : .4);
      const shell = this.keep(this.add.image(p.x, p.y - (waiting ? 15 : 6), "tide-shell").setDisplaySize(size, size).setDepth(waiting ? 5 : 1.5));
      if (waiting) this.shell = shell; else shell.setAlpha(.9);
    }
    for (const item of tide.items) {
      const p = this.point(item), size = this.prizeSize(item.kind), beside = same(item, tide.position) ? -tile.width * .3 : 0;
      this.prizes.set(`${item.x},${item.y}`, this.keep(this.add.image(p.x + beside, p.y - size * .36, `tide-${item.kind}`).setDisplaySize(size, size).setDepth(6)));
    }
    const p = this.point(tide.position), size = this.actorSize();
    this.actor.setPosition(p.x, p.y).setDisplaySize(size, size).setFlipX(false);
    this.actorShadow.setPosition(p.x, p.y + 2).setSize(size * .55, Math.max(4, size * .1));
    this.pose(tide.outcome === "rescued" ? "startled" : tide.outcome !== "active" ? "relieved" : "curious");
    this.drawPack(tide.pack);
    this.forecast();
    this.resetIdle();
  }

  /** The lanes the next wave takes, its countdown, the prize it will leave, and which steps are safe. */
  private forecast() {
    for (const mark of this.marks) mark.destroy();
    this.marks = []; this.ghosts = [];
    this.lanes.clear(); this.hints.clear();
    const tide = this.shown, f = this.field(), tile = this.tileSize(), lanes = tide.outcome === "active" ? tide.next.lanes : [];
    const aim = lanes.length ? lanes.reduce<number>((sum, lane) => sum + lane, 0) / lanes.length - 1 : 0;
    this.keeper.setAngle(aim * 4);
    if (tide.outcome !== "active") return;
    const left = countdown(tide), width = tile.width * .78, top = f.top - 30, bottom = f.bottom - f.dy * .5;
    for (const lane of lanes) {
      const x = this.point({ x: lane, y: 2 }).x;
      this.lanes.fillStyle(0xc35235, left === 1 ? .4 : .24).fillRoundedRect(x - width / 2, top, width, bottom - top, 12);
      this.lanes.lineStyle(3, 0xf8be78, .95).strokeRoundedRect(x - width / 2, top, width, bottom - top, 12);
      for (let y = f.top + 20; y < bottom - 8; y += 50) this.lanes.lineBetween(x - 9, y - 7, x, y).lineBetween(x, y, x + 9, y - 7);
      // The channel is the one row nothing stands on, so the count sits there.
      this.marks.push(this.label(x, this.point({ x: lane, y: 2 }).y, String(left), Math.min(44, Math.max(26, f.dy * .5)), left === 1 ? "#a93a26" : "#314d42").setPadding(16, 2, 16, 2));
    }
    for (const drop of tide.next.drops) {
      // A story prize is never swept, and a shell holds one thing: nothing will be left beside it.
      if (tide.items.some(item => same(item, drop) && item.kind === tide.story)) continue;
      const p = this.point(drop), size = this.prizeSize(drop.kind), x = p.x + (same(drop, tide.position) ? -tile.width * .3 : 0);
      const ghost = this.add.image(x, p.y - size * .36, `tide-${drop.kind}`).setDisplaySize(size, size).setAlpha(.4).setDepth(5.5);
      this.ghosts.push(ghost); this.marks.push(ghost);
      this.marks.push(this.add.ellipse(x, p.y - size * .36, size * 1.2, size * 1.2).setStrokeStyle(2.5, 0xfff3c9, .85).setDepth(5.6));
    }
    if (this.playing) return;
    for (const move of legalMoves(tide)) {
      if (move === "home") continue;
      const to = stepDestination(tide, move) ?? tide.position, wet = applyMove(tide, move)!.events.some(event => event.kind === "splash");
      if (move === "wait" && !wet) continue;
      const at = this.point(to);
      this.hints.lineStyle(3, wet ? 0x8e3527 : 0xffe1a1, .95).strokeEllipse(at.x, at.y + tile.width * .025, tile.width * 1.03, tile.width * .36);
      if (wet) this.hints.lineBetween(at.x - 7, at.y - 7, at.x + 7, at.y + 7).lineBetween(at.x + 7, at.y - 7, at.x - 7, at.y + 7);
    }
  }

  private packSpot(index: number) {
    const size = this.actor.displayHeight, [dx, dy] = ([[-.48, -.34], [.48, -.34], [0, -.98]] as const)[index] ?? [0, -.94];
    return { x: this.actor.x + dx * size, y: this.actor.y + dy * size };
  }
  private drawPack(pack: readonly Item[]) {
    for (const icon of this.pack) { icon.destroy(); this.parts = this.parts.filter(part => part !== icon); }
    this.pack = pack.map((item, index) => {
      const spot = this.packSpot(index), size = Math.min(item === "moth" ? 40 : 34, this.actor.displayHeight * .38);
      return this.keep(this.add.image(spot.x, spot.y, `tide-${item}`).setDisplaySize(size, size).setDepth(11));
    });
  }
  private followActor() {
    this.actorShadow.setPosition(this.actor.x, this.actor.y + 2);
    for (const [index, icon] of this.pack.entries()) { const spot = this.packSpot(index); icon.setPosition(spot.x, spot.y); }
  }

  private async tween(targets: object, config: Omit<Phaser.Types.Tweens.TweenBuilderConfig, "targets">, duration: number) {
    if (this.stopped) return;
    await new Promise<void>(resolve => this.tweens.add({ ease: "Sine.easeInOut", ...config, targets, duration: this.snapshot.reducedMotion ? Math.min(duration, 70) : duration, onComplete: () => resolve() }));
  }
  private async hold(duration: number) {
    if (this.stopped) return;
    await new Promise<void>(resolve => this.time.delayedCall(this.snapshot.reducedMotion ? 30 : duration, () => resolve()));
  }

  private async present(transition: TideTransition, id: number) {
    const epoch = ++this.epoch;
    let reduced = this.snapshot.reducedMotion;
    this.presentationSize = { w: this.scale.width, h: this.scale.height };
    this.playing = true;
    this.shown = reduced ? transition.after : transition.before;
    this.shut = this.shellShut(this.shown);
    this.layout();
    for (const event of transition.events) {
      if (this.stopped || this.epoch !== epoch) return;
      if (!reduced && this.snapshot.reducedMotion) {
        reduced = true; this.shown = transition.after; this.shut = this.shellShut(this.shown); this.layout();
      }
      this.hooks.beat(event);
      if (reduced) await this.hold(30); else await this.presentEvent(event);
    }
    if (this.stopped || this.epoch !== epoch) return;
    this.shown = transition.after; this.shut = this.shellShut(this.shown);
    this.playing = false; this.presentationSize = null;
    this.cameras.main.setZoom(1).setScroll(0, 0);
    this.layout(); this.hooks.settled(id);
  }

  private async presentEvent(event: TideEvent) {
    const tide = this.shown, f = this.field();
    switch (event.kind) {
      case "move": {
        const from = this.point(event.from), to = this.point(event.to), dx = to.x - from.x, dy = to.y - from.y, distance = Math.hypot(dx, dy);
        const crossing = Math.abs(event.to.y - event.from.y) === 2;
        this.hints.clear();
        this.pose(dx < 0 ? "turn-left" : dx > 0 ? "turn-right" : dy < 0 ? "curious" : "brace");
        this.actor.setFlipX(dx < 0);
        await this.tween(this.actor, { x: to.x, y: to.y, onUpdate: () => {
          const progress = distance === 0 ? 1 : Math.min(1, Math.hypot(this.actor.x - from.x, this.actor.y - from.y) / distance);
          this.pose(walkingPose(progress * (crossing ? 2 : 1))); this.followActor();
        } }, crossing ? 280 : 170);
        this.shown = { ...tide, position: event.to };
        this.actor.setFlipX(false); this.pose("neutral");
        break;
      }
      case "pickup": {
        const prize = this.prizes.get(`${event.at.x},${event.at.y}`);
        this.pose("reach-ready");
        if (prize) { const spot = this.packSpot(tide.pack.length); await this.tween(prize, { ...spot, scaleX: prize.scaleX * .6, scaleY: prize.scaleY * .6 }, 170); }
        this.shown = { ...tide, items: tide.items.filter(item => !same(item, event.at)), pack: [...tide.pack, event.item] };
        this.layout(); this.pose("relieved"); await this.hold(60);
        break;
      }
      case "full": {
        const prize = this.prizes.get(`${tide.position.x},${tide.position.y}`);
        this.pose("curious");
        if (prize) await this.tween(prize, { angle: 9, yoyo: true, repeat: 1 }, 70);
        break;
      }
      case "bank": {
        const dock = this.point(DOCK);
        this.pose("relieved");
        await Promise.all(this.pack.map((icon, index) => this.tween(icon, { x: dock.x + (index - 1) * 14, y: dock.y + 10, alpha: 0, delay: index * 45 }, 210)));
        if (event.gained) {
          const gain = this.add.text(dock.x, dock.y - this.actor.displayHeight * .9, `+${event.gained}`, { fontFamily: FONT, fontSize: "26px", fontStyle: "bold", color: "#fff3c4", stroke: "#2b5f4d", strokeThickness: 6 }).setOrigin(.5).setDepth(20);
          void this.tween(gain, { y: gain.y - 34, alpha: 0, ease: "Sine.easeIn" }, 720).then(() => gain.destroy());
        }
        this.shown = { ...tide, pack: [] }; this.drawPack([]);
        break;
      }
      case "wave": {
        const stop = f.bottom - f.dy * .5, width = this.tileSize().width * 1.15;
        if (event.lanes.includes(tide.position.x) && tide.position.y > 0) this.pose("brace");
        const waves = event.lanes.map(lane => this.add.image(this.point({ x: lane, y: 4 }).x, f.top - 70, "tide-wave").setDisplaySize(width, 90).setAlpha(.2).setDepth(14));
        await Promise.all(waves.map(wave => this.tween(wave, { y: stop, alpha: .92 }, 340)));
        for (const wave of waves) void this.tween(wave, { y: stop + 14, alpha: 0 }, 130).then(() => wave.destroy());
        this.shown = { ...tide, next: { lanes: [], drops: [] } }; this.forecast();
        break;
      }
      case "sweep": {
        const swept = event.items.flatMap(item => this.prizes.get(`${item.x},${item.y}`) ?? []);
        await Promise.all(swept.map(prize => this.tween(prize, { y: prize.y + 26, alpha: 0, angle: 24 }, 170)));
        this.shown = { ...tide, items: tide.items.filter(item => !event.items.some(gone => same(gone, item))) }; this.layout();
        break;
      }
      case "shield": {
        const ring = this.add.ellipse(this.actor.x, this.actor.y - this.actor.displayHeight * .3, 30, 22).setStrokeStyle(4, 0xffe7a8, .95).setDepth(15);
        this.pose("curious");
        await this.tween(this.keeper, { angle: this.keeper.angle - 7, yoyo: true }, 130);
        await this.tween(ring, { scaleX: 4.4, scaleY: 4.4, alpha: 0 }, 330);
        ring.destroy(); this.shown = { ...tide, shielded: true };
        break;
      }
      case "splash": {
        const to = this.point(event.to), lost = event.lost ? this.pack.at(-1) : undefined;
        this.pose("startled");
        if (lost) void this.tween(lost, { x: lost.x + 46, y: lost.y + 30, alpha: 0, angle: 40 }, 260);
        await this.tween(this.actor, { x: to.x, y: to.y, onUpdate: () => this.followActor() }, 230);
        const back = event.lost && event.lost !== "reed" && event.lost !== "glass" && event.lost !== "pearl" ? [{ ...STORY_SHELL[event.lost], kind: event.lost }] : [];
        this.shown = { ...tide, position: event.to, hearts: event.hearts, pack: tide.pack.slice(0, -1), items: [...tide.items, ...back] };
        this.layout(); this.pose("startled"); await this.hold(140); this.pose("relieved");
        break;
      }
      case "bridge": {
        const berth = this.point({ x: event.to, y: 2 }), direction = event.to > event.from ? 1 : -1;
        await this.tween(this.bridgeArt, { angle: direction * 1.8, y: berth.y + 3, alpha: .88 }, 55);
        await this.tween(this.bridgeArt, { x: berth.x, y: berth.y + 2, angle: -direction * .7 }, 180);
        this.shown = { ...tide, bridge: event.to }; this.layout();
        break;
      }
      case "open": {
        if (this.shell) await this.tween(this.shell, { y: this.shell.y + 15, scaleX: this.shell.scaleX * 1.25, scaleY: this.shell.scaleY * .55, alpha: .35 }, 240);
        this.shut = false;
        this.shown = { ...tide, items: [...tide.items, { ...STORY_SHELL[event.item], kind: event.item }] }; this.layout();
        await this.arrive([STORY_SHELL[event.item]]); await this.hold(160);
        break;
      }
      case "leave":
        this.shown = { ...tide, items: [...tide.items, ...event.items] }; this.layout();
        await this.arrive(event.items);
        break;
      case "forecast":
        // A forecast only follows a wave, which lands on the beat this move spent.
        this.shown = { ...tide, next: event.wave, beat: tide.beat + 1 }; this.forecast();
        await this.tween(this.keeper, { angle: this.keeper.angle + 2.5, yoyo: true }, 80);
        break;
      case "end":
        this.hints.clear();
        this.pose(event.reason === "rescued" ? "startled" : "relieved");
        await this.hold(event.reason === "rescued" ? 360 : 200);
        break;
    }
  }

  /** A prize the wave leaves pops onto its platform. */
  private async arrive(at: readonly Position[]) {
    await Promise.all(at.map(position => {
      const prize = this.prizes.get(`${position.x},${position.y}`);
      if (!prize) return Promise.resolve();
      const { scaleX, scaleY, y } = prize;
      prize.setScale(scaleX * .3, scaleY * .3).setY(y + 10);
      return this.tween(prize, { scaleX, scaleY, y, ease: "Back.easeOut" }, 190);
    }));
  }
}
