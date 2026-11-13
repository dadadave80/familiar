import { MOCHI_ATLAS, MOCHI_GROUND, MOCHI_POSES } from "./mochi";

export function MochiActor() {
  const { frame } = MOCHI_POSES.relieved;
  const column = frame % 4;
  const row = Math.floor(frame / 4);
  return (
    <div
      className="mochi-actor"
      data-testid="mochi-actor"
      data-pose="relieved"
      data-frame={frame}
      style={{ transform: `translate(-50%, -${MOCHI_GROUND * 100}%)` }}
      aria-hidden="true"
    >
      <img
        className="mochi-atlas"
        src={`/assets/first-light-motion/${MOCHI_ATLAS}.webp`}
        alt=""
        draggable={false}
        style={{ transform: `translate(${-column * 25}%, ${-row * 25}%)` }}
      />
    </div>
  );
}
