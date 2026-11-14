import { useEffect, useRef, useState } from "react";
import { countdown, type Position, type TideEvent, type TideTransition } from "./engine";
import { itemName, laneNames } from "./story";
import type { TideScene, TideSnapshot } from "./scene";

export interface TideWorldProps {
  snapshot: TideSnapshot;
  transition: TideTransition | null;
  presentationId: number;
  paused: boolean;
  onTarget: (position: Position) => void;
  onSettled: (id: number) => void;
  onBeat: (event: TideEvent) => void;
  onFault: (message: string) => void;
  onReady: () => void;
}

export default function TideWorld(props: TideWorldProps) {
  const mount = useRef<HTMLDivElement>(null), scene = useRef<TideScene | null>(null), current = useRef(props);
  const [ready, setReady] = useState(false);
  current.current = props;
  useEffect(() => {
    let alive = true, game: import("phaser").Game | undefined;
    const lost = (event: Event) => { event.preventDefault(); if (alive) current.current.onFault("The drawing surface stopped. Your accepted moves are saved. Reload the scene to continue."); };
    void Promise.all([import("phaser"), import("./scene")]).then(([{ default: Phaser }, { TideScene }]) => {
      if (!alive || !mount.current) return;
      const next = new TideScene(current.current.snapshot, {
        target: position => current.current.onTarget(position),
        ready: () => { if (!alive) return; setReady(true); current.current.onReady(); next.setGated(current.current.paused); },
        fault: message => { if (alive) current.current.onFault(message); },
        beat: event => { if (alive) current.current.onBeat(event); },
        settled: id => { if (alive) current.current.onSettled(id); },
      });
      scene.current = next;
      game = new Phaser.Game({ type: Phaser.AUTO, parent: mount.current, width: mount.current.clientWidth, height: mount.current.clientHeight, transparent: true, antialias: true, banner: false, audio: { noAudio: true }, loader: { imageLoadType: "HTMLImageElement" }, scene: next, scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.CENTER_BOTH }, input: { keyboard: false } });
      game.canvas.setAttribute("aria-hidden", "true"); game.canvas.addEventListener("webglcontextlost", lost);
    }).catch(() => { if (alive) current.current.onFault("The playfield could not open. Your saved harbor is safe. Retry the scene."); });
    return () => { alive = false; scene.current = null; if (game) { game.canvas.removeEventListener("webglcontextlost", lost); game.destroy(true); } };
  }, []);
  useEffect(() => { if (ready) scene.current?.setSnapshot(props.snapshot, props.transition, props.presentationId); }, [ready, props.snapshot, props.transition, props.presentationId]);
  useEffect(() => { scene.current?.setGated(props.paused); }, [props.paused]);
  const { tide } = props.snapshot;
  const coming = tide.outcome === "active" ? ` The next wave takes ${laneNames(tide.next.lanes)} in ${countdown(tide)}${tide.next.drops.length ? ` and leaves ${tide.next.drops.map(drop => itemName(drop.kind)).join(" and ")}` : ""}.` : "";
  return <div ref={mount} className="exp-world" data-testid="tide-world" data-ready={ready} data-position={`${tide.position.x},${tide.position.y}`} data-beat={tide.beat}
    role="img" aria-label={`The tide court: three lanes from the dock to the far shore.${coming} Movement controls follow.`} />;
}
