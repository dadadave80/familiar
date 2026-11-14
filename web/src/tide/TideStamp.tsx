import type { CSSProperties, JSX } from "react";
import { cardArt, sealArt } from "./art";
import "./tide.css";

export default function TideStamp({ id, size, seal = false, tilt = 0, label = "", press = false }: {
  id: string; size: number; seal?: boolean; tilt?: number; label?: string; press?: boolean;
}): JSX.Element {
  const padding = Math.round(size * .065);
  const picture = size - padding * 2;
  const sealSize = Math.round(size * .38);
  // A whole number of notches keeps the four corners identical at every size.
  const pitch = size / Math.round(5 + size / 20);
  return <span className="tide-stamp" data-press={press || undefined} style={{
    "--stamp": `${size}px`, "--tilt": `${tilt}deg`, "--p": `${pitch}px`,
    "--r": `${pitch * .3}px`, "--stamp-padding": `${padding}px`, "--seal": `${sealSize}px`,
  } as CSSProperties}>
    <span className="tide-stamp-paper">
      <img src={cardArt(id)} width={picture} height={picture} alt={label} loading="lazy" decoding="async" />
    </span>
    {seal && <img className="tide-stamp-seal" src={sealArt("all-three")} width={sealSize} height={sealSize} alt="" loading="lazy" decoding="async" />}
  </span>;
}
