import { useEffect, useRef } from "react";

export function Town({
  destination,
  sleeping,
}: {
  destination: string;
  sleeping: boolean;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<{ walk: (place: string) => void } | null>(null);
  useEffect(() => {
    let destroyed = false;
    let game: import("phaser").Game | undefined;
    void import("phaser").then(({ default: Phaser }) => {
      if (destroyed || !mount.current) return;
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      class Harbor extends Phaser.Scene {
        companion!: Phaser.GameObjects.Container;
        walking?: Phaser.Tweens.TweenChain;
        preload() {
          this.load.spritesheet("town", "/assets/tiny-town.png", {
            frameWidth: 16,
            frameHeight: 16,
          });
        }
        create() {
          const tile = (frame: number, col: number, row: number) =>
            this.add
              .image(col * 16, row * 16, "town", frame)
              .setOrigin(0)
              .setTint(0xffefd8);
          for (let y = 0; y < 14; y++)
            for (let x = 0; x < 30; x++)
              tile((x * 7 + y * 11) % 17 === 0 ? 1 : 0, x, y);
          const sea = this.add.graphics();
          sea.fillStyle(0x397d79).fillRect(0, 224, 480, 80);
          sea.fillStyle(0x4d9187).fillRect(0, 224, 480, 16);
          sea.fillStyle(0xe4be85).fillRect(0, 208, 480, 16);
          for (let x = 0; x < 30; x++) tile(37, x, 13);
          for (let x = 0; x < 30; x++) tile(25, x, 7);
          for (let y = 4; y < 14; y++) tile(25, 15, y);
          for (let x = 4; x <= 21; x++) tile(43, x, 10);
          for (let y = 4; y <= 10; y++) tile(43, 8, y);
          const house = (x: number, y: number, red = false) => {
            const roof = red ? 52 : 48;
            const bottom = red ? 64 : 60;
            [roof, roof + 1, roof + 2].forEach((f, i) => tile(f, x + i, y));
            [bottom, bottom + 1, red ? 67 : 63].forEach((f, i) =>
              tile(f, x + i, y + 1),
            );
            [72, 73, 74].forEach((f, i) => tile(f, x + i, y + 2));
            [84, 85, 86].forEach((f, i) => tile(f, x + i, y + 3));
          };
          house(5, 2, true);
          house(20, 3);
          house(11, 0);
          house(24, 9, true);
          const trees = [
            [2, 1],
            [1, 4],
            [2, 10],
            [4, 10],
            [2, 11],
            [27, 1],
            [26, 3],
            [28, 5],
            [23, 1],
            [18, 0],
            [3, 0],
            [0, 8],
            [28, 11],
            [10, 3],
            [18, 9],
            [21, 11],
          ];
          for (const [x, y] of trees) {
            tile(5, x, y);
            tile(16, x, y + 1);
            tile(28, x, y + 2);
          }
          for (const [x, y] of [
            [1, 3],
            [3, 5],
            [27, 8],
            [25, 2],
            [19, 11],
            [3, 9],
            [10, 9],
            [22, 9],
          ])
            tile(29, x, y);
          for (const [x, y] of [
            [9, 2],
            [4, 6],
            [18, 4],
            [23, 7],
            [6, 9],
            [12, 9],
            [17, 12],
          ])
            tile(2, x, y);
          tile(104, 17, 6);
          tile(83, 21, 7);
          tile(83, 6, 6);
          [44, 45, 46].forEach((f, i) => tile(f, 4 + i, 11));
          const dock = this.add.graphics();
          dock.fillStyle(0xa77b51).fillRect(225, 216, 32, 58);
          dock.lineStyle(1, 0x79583e);
          for (let y = 220; y < 272; y += 8) dock.lineBetween(225, y, 257, y);
          dock
            .fillStyle(0x6e533c)
            .fillRect(222, 216, 4, 64)
            .fillRect(256, 216, 4, 64);
          const waves = this.add.graphics().lineStyle(1, 0x9cc2af, 0.6);
          for (let i = 0; i < 20; i++)
            waves.lineBetween(
              (i * 73) % 470,
              240 + (i % 5) * 11,
              ((i * 73) % 470) + 9,
              240 + (i % 5) * 11,
            );
          if (!reduced)
            this.tweens.add({
              targets: waves,
              x: 5,
              duration: 2400,
              yoyo: true,
              repeat: -1,
              ease: "Sine.easeInOut",
            });
          const boat = this.add.graphics();
          boat.fillStyle(0x674638).fillEllipse(358, 266, 38, 14);
          boat.fillStyle(0xe3bc7e).fillEllipse(358, 263, 33, 9);
          boat.lineStyle(2, 0x674638).lineBetween(357, 261, 357, 229);
          boat.fillStyle(0xf8e8c8).fillTriangle(357, 230, 357, 253, 376, 253);
          const body = this.add.graphics();
          body.fillStyle(0x503729, 0.15).fillEllipse(0, 12, 22, 5);
          body.fillStyle(0xf2a541).fillRoundedRect(-11, -10, 22, 23, 9);
          body
            .fillTriangle(-10, -5, -9, -17, -2, -8)
            .fillTriangle(4, -9, 10, -17, 11, -3);
          body.fillStyle(0x33261f).fillCircle(-4, 0, 1.3).fillCircle(5, 0, 1.3);
          body
            .lineStyle(1, 0x503729)
            .lineBetween(-1, 5, 2, 6)
            .lineBetween(2, 6, 4, 4);
          this.companion = this.add.container(248, 156, [body]);
          if (!reduced)
            this.tweens.add({
              targets: body,
              scaleY: 0.96,
              duration: 1200,
              yoyo: true,
              repeat: -1,
              ease: "Sine.easeInOut",
            });
          sceneRef.current = this;
          this.walk(destination);
        }
        walk(place: string) {
          const stops: Record<string, [number, number]> = {
            home: [248, 156],
            mill: [136, 108],
            well: [280, 108],
            orchard: [72, 156],
            craft: [112, 108],
            sleep: [352, 108],
            market: [400, 204],
            den: [200, 108],
          };
          const [x, y] = stops[place] ?? stops.home;
          this.walking?.destroy();
          this.tweens.killTweensOf(this.companion);
          if (reduced) {
            this.companion.setPosition(x, y).setAlpha(0);
            this.tweens.add({
              targets: this.companion,
              alpha: 1,
              duration: 160,
            });
            return;
          }
          const points = [
            [248, this.companion.y],
            [248, y],
            [x, y],
          ];
          let previous = [this.companion.x, this.companion.y];
          const legs = points
            .map(([nextX, nextY]) => {
              const distance =
                Math.abs(nextX - previous[0]) + Math.abs(nextY - previous[1]);
              previous = [nextX, nextY];
              return { x: nextX, y: nextY, distance };
            })
            .filter((leg) => leg.distance > 0);
          const total = legs.reduce((sum, leg) => sum + leg.distance, 0);
          if (total)
            this.walking = this.tweens.chain({
              targets: this.companion,
              tweens: legs.map((leg) => ({
                x: leg.x,
                y: leg.y,
                duration: (800 * leg.distance) / total,
                ease: "Sine.easeInOut",
              })),
            });
        }
      }
      game = new Phaser.Game({
        type: Phaser.CANVAS,
        parent: mount.current,
        width: 480,
        height: 304,
        backgroundColor: "#88b775",
        pixelArt: true,
        antialias: false,
        scene: Harbor,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
        audio: { noAudio: true },
        banner: false,
      });
    });
    return () => {
      destroyed = true;
      sceneRef.current = null;
      game?.destroy(true);
    };
  }, []);
  useEffect(() => {
    sceneRef.current?.walk(sleeping ? "sleep" : destination);
  }, [destination, sleeping]);
  return (
    <div
      className="town"
      role="img"
      aria-label="A harbor town with Bram’s bakery, a mill, orchard, well, homes and a wooden dock. All places are available through the buttons below."
    >
      <div ref={mount} className="town-canvas" />
      <div className="town-sign sign-bakery">Bram’s bakery</div>
      <div className="town-sign sign-post">Post Office</div>
      <div className="town-sign sign-harbor">Littleharbor</div>
      <div className="town-sign sign-well">The well</div>
    </div>
  );
}
