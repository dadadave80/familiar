import type { CSSProperties } from "react";
import { MOCHI_ATLAS, MOCHI_GROUND, MOCHI_WIDTH, type MochiPose } from "./mochi";

export function MochiActor({ x, y, pose }: { x: number; y: number; pose: MochiPose }) {
  const column = pose.frame % 4;
  const row = Math.floor(pose.frame / 4);
  const style = {
    left: `${x}%`, top: `${y}%`, width: `${MOCHI_WIDTH}%`,
    "--mochi-ground": `${MOCHI_GROUND * 100}%`,
  } as CSSProperties;
  return (
    <div
      className="motion-actor mochi-actor"
      data-testid="mochi-actor"
      data-pose={pose.pose}
      data-frame={pose.frame}
      style={style}
      aria-hidden="true"
    >
      <span className="actor-shadow" />
      <span
        className="mochi-body"
        style={{ transform: `translateY(${-pose.lift}cqw) rotate(${pose.rotate}deg) scale(${pose.scaleX}, ${pose.scaleY})` }}
      >
        <span className="mochi-cell">
          <img
            className="mochi-atlas"
            src={`/assets/first-light-motion/${MOCHI_ATLAS}.webp`}
            alt=""
            draggable={false}
            style={{ transform: `translate(${-column * 25}%, ${-row * 25}%)` }}
          />
        </span>
      </span>
    </div>
  );
}
