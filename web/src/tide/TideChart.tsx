import { useEffect, useState, type JSX } from "react";
import type { Area, Find, Position } from "../expedition/types";
import { chartLines, type ChartFrame } from "./chart";
import "./tide.css";

const colX = (x: number) => 70 + x * 80;
const rowY = (y: number) => 300 - y * 62;
const finds: Record<Find, Position> = { lens: { x: 0, y: 4 }, moth: { x: 2, y: 4 }, vane: { x: 1, y: 4 } };
const jitter = (index: number, seed: number) => ((index * seed + 7) % 13) / 4 - 1.5;

/** Points of the inked route; a foothold visited again sits a little to one side, so a retraced leg stays readable. */
function routePoints(frames: readonly ChartFrame[]) {
  const visits = new Map<string, number>();
  return frames.map((frame, i) => {
    const place = `${frame.position.x}:${frame.position.y}`, seen = visits.get(place) ?? 0;
    visits.set(place, seen + 1);
    const lean = seen ? (seen % 2 ? 1 : -1) * Math.ceil(seen / 2) * 4.5 : 0;
    return [colX(frame.position.x) + jitter(i, 5) + lean, rowY(frame.position.y) + jitter(i, 9) - lean] as const;
  });
}
/** A pen line through the points: straight runs, softly rounded at each turn. */
function inkPath(points: readonly (readonly [number, number])[]) {
  if (!points.length) return "";
  let d = `M${points[0]![0].toFixed(1)} ${points[0]![1].toFixed(1)}`;
  for (let i = 1; i < points.length; i++) {
    const [x, y] = points[i]!, next = points[i + 1];
    if (!next) { d += `L${x.toFixed(1)} ${y.toFixed(1)}`; break; }
    const [px, py] = points[i - 1]!, ease = (a: number, b: number) => a + (b - a) * 0.22;
    d += `L${ease(x, px).toFixed(1)} ${ease(y, py).toFixed(1)}Q${x.toFixed(1)} ${y.toFixed(1)} ${ease(x, next[0]).toFixed(1)} ${ease(y, next[1]).toFixed(1)}`;
  }
  return d;
}

export default function TideChart({ frames, area, reduced, label }: {
  frames: readonly ChartFrame[]; area: Area; reduced: boolean; label: string;
}): JSX.Element {
  const [shown, setShown] = useState(reduced ? Math.max(0, frames.length - 1) : 0);
  const [replay, setReplay] = useState(0);
  const last = Math.max(0, frames.length - 1);
  useEffect(() => {
    setShown(reduced ? last : 0);
    if (reduced || !last) return;
    let cursor = 0;
    const timer = setInterval(() => {
      cursor += 1;
      setShown(cursor);
      if (cursor === last) clearInterval(timer);
    }, 320);
    return () => clearInterval(timer);
  }, [frames, reduced, replay, last]);

  const end = reduced ? last : Math.min(shown, last);
  const current = frames[end];
  const visible = frames.slice(0, end + 1);
  const points = routePoints(frames);
  const waits = new Map<string, number>();
  const restart = () => { setShown(reduced ? last : 0); setReplay(value => value + 1); };

  return <figure className="tide-chart">
    <svg role="img" aria-label={label} viewBox="0 0 300 340">
      <path d="M24 12L25 328M29 12L30 328" stroke="#c9ad7c" strokeWidth=".7" opacity=".4" />
      <path d="M0 153Q35 145 70 154T140 153T210 154T300 151L300 199Q265 205 230 197T160 199T90 197T0 201Z" fill="#b6d5c5" opacity=".6" />
      <path d="M36 173Q62 165 87 173T138 173M183 185Q208 177 236 185T284 185" fill="none" stroke="#5fa79a" strokeWidth="1" opacity=".5" />
      {[0, 1, 3, 4].flatMap(y => [0, 1, 2].map(x => <ellipse key={`${x}:${y}`} cx={colX(x)} cy={rowY(y)} rx={13 + (x + y) % 2} ry={11 + (x * 2 + y) % 3} fill="#e6d6b0" stroke="#8b734c" strokeWidth="1.2" transform={`rotate(${(x - y) * 3} ${colX(x)} ${rowY(y)})`} />))}
      <rect x="132" y="307" width="36" height="8" rx="1.5" fill="#bf9e68" stroke="#8b734c" strokeWidth="1" />
      <path d="M143 308V314M157 308V314" stroke="#8b734c" strokeWidth=".8" />
      {current && <g fill="#d3b477" stroke="#8b734c" strokeWidth="1">
        <path d={`M${colX(current.bridge) - 9} 126V226M${colX(current.bridge) + 9} 126V226`} fill="none" />
        {[131, 154, 177, 200].map((y, i) => <rect key={y} x={colX(current.bridge) - 13} y={y} width="26" height="19" rx="2" transform={`rotate(${i % 2 ? 2.5 : -2} ${colX(current.bridge)} ${y + 9.5})`} />)}
      </g>}
      {area === "beacon" ? [0, 2].map(x => <g key={x} transform={`translate(${colX(x)} ${rowY(4)})`} fill="#f1dfb7" stroke="#8b734c" strokeWidth="1.2" strokeLinejoin="round">
        {current?.opened.includes(x as 0 | 2) ? <>
          <path d="M-13-5Q-13-22 0-14Q13-22 13-5Q0 0-13-5Z" />
          <path d="M-13 5Q0 0 13 5Q9 18 0 14Q-9 18-13 5Z" />
        </> : <>
          <path d="M-14 2Q-12-13 0-9Q12-13 14 2Q0 14-14 2Z" />
          <path d="M-13 2Q0-1 13 2M-7-6L-3 1M7-6L3 1" fill="none" />
        </>}
      </g>) : <g fill="none" stroke="#8b734c" strokeWidth="1.5">
        <circle cx={colX(1)} cy={rowY(3)} r="16" />
        <path d="M134 114H166M150 98V130M139 103L161 125M139 125L161 103M138 43V53Q150 65 162 53V43" />
      </g>}
      {visible.slice(1).filter(frame => frame.wave && (reduced || frame === current)).map(frame => <path
        key={`${replay}:wave:${frame.index}`} className={reduced ? undefined : "tide-chart-wave"}
        d={`M${colX(frame.wave!.exit)} ${rowY(4)}V${rowY(0)}`} fill="none" stroke="#5fa79a" strokeWidth="14" strokeLinecap="round" opacity={reduced ? .12 : .45}
      />)}
      <path className="tide-ink" d={inkPath(points.slice(0, end + 1))} stroke="#2c4335" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" fill="none" opacity=".92" />
      {visible.slice(1).map(frame => {
        const x = colX(frame.position.x), y = rowY(frame.position.y);
        const place = `${frame.position.x}:${frame.position.y}`;
        const wait = waits.get(place) ?? 0;
        if (frame.command === "wait") waits.set(place, wait + 1);
        const item: Find | null = frame.pickup;
        const pickup = item && finds[item];
        return <g key={frame.index}>
          {frame.command === "wait" && <circle cx={x + 7 + wait * 3} cy={y - 6 - wait * 2} r="6" fill="none" stroke="#2c4335" strokeWidth="1.3" />}
          {pickup && <circle cx={colX(pickup.x)} cy={rowY(pickup.y)} r="4.5" fill="#2c4335"><title>{`${frame.pickup} collected`}</title></circle>}
          {frame.splash && <g fill="#5fa79a">
            {[-1, 0, 1].map(n => <path key={n} d="M0-5C-1-2-4 0-3 3C-2 6 2 6 3 3C4 0 1-2 0-5Z" transform={`translate(${x + n * 10} ${y - 13 + Math.abs(n) * 5}) rotate(${n * 25})`} />)}
          </g>}
        </g>;
      })}
      {current && <circle cx={points[end]![0]} cy={points[end]![1]} r="5.5" fill="#2c4335" stroke="#fbf3dc" strokeWidth="2" />}
      {end === last && current?.outcome === "returned" && <text x="175" y="320" className="tide-home">home</text>}
      {end === last && current?.outcome === "rescued" && <text x="150" y="333" textAnchor="middle" className="tide-home">Bram fetched her</text>}
    </svg>
    <figcaption className="tide-chart-controls">
      <button type="button" className="tide-watch" onClick={restart}>Watch again</button>
      <details className="tide-route"><summary>Read the route</summary><ol>{chartLines(frames, area).map((line: string, i: number) => <li key={i}>{line}</li>)}</ol></details>
    </figcaption>
  </figure>;
}
