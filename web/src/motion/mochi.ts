import { CLIPS, sampleScene, type ClipId, type SceneState } from "./scenes";

export const MOCHI_ATLAS = "mochi-poses-v1";
export const MOCHI_WIDTH = 18;
export const MOCHI_GROUND = .875;

// Frame-local paw coordinates share the registered atlas canvas and ground line.
// They also anchor the Reel line, so it follows the articulated paw when seeking.
export const MOCHI_POSES = {
  neutral: { frame: 0, paw: { x: .47, y: .67 } },
  "look-right": { frame: 1, paw: { x: .49, y: .67 } },
  "turn-right": { frame: 2, paw: { x: .62, y: .67 } },
  "profile-right": { frame: 3, paw: { x: .7, y: .67 } },
  "walk-contact-a": { frame: 4, paw: { x: .7, y: .75 } },
  "walk-pass-a": { frame: 5, paw: { x: .61, y: .73 } },
  "walk-contact-b": { frame: 6, paw: { x: .58, y: .75 } },
  "walk-pass-b": { frame: 7, paw: { x: .68, y: .73 } },
  "turn-left": { frame: 8, paw: { x: .34, y: .67 } },
  "reach-ready": { frame: 9, paw: { x: .32, y: .58 } },
  "reach-left": { frame: 10, paw: { x: .16, y: .51 } },
  "pull-in": { frame: 11, paw: { x: .29, y: .64 } },
  curious: { frame: 12, paw: { x: .47, y: .67 } },
  startled: { frame: 13, paw: { x: .43, y: .59 } },
  brace: { frame: 14, paw: { x: .38, y: .77 } },
  relieved: { frame: 15, paw: { x: .47, y: .67 } },
} as const;

export type MochiPoseName = keyof typeof MOCHI_POSES;
export interface MochiPose {
  pose: MochiPoseName;
  frame: number;
  /** Upward displacement in percent of stage width (CSS cqw). */
  lift: number;
  rotate: number;
  scaleX: number;
  scaleY: number;
  paw: { x: number; y: number };
}

type PoseBeat = readonly [at: number, pose: MochiPoseName];
const WALK: readonly MochiPoseName[] = [
  "walk-contact-a", "walk-pass-a", "walk-contact-b", "walk-pass-b",
];

function heldPose(time: number, beats: readonly PoseBeat[]): MochiPoseName {
  let selected: MochiPoseName = "neutral";
  for (const [at, pose] of beats) {
    if (time < at) break;
    selected = pose;
  }
  return selected;
}

/** A pure shared-clock sample: pause and reverse scrubbing never accumulate pose state. */
export function sampleMochi(id: ClipId, time: number, reduced = false): MochiPose {
  if (!Number.isFinite(time)) throw new RangeError("Mochi time must be finite");
  const clip = CLIPS.find(candidate => candidate.id === id);
  if (!clip) throw new RangeError(`Unknown motion clip: ${id}`);
  const t = Math.max(0, Math.min(clip.duration, time));
  let pose: MochiPoseName = "neutral";
  let lift = 0;
  let rotate = 0;
  let scaleY = 1;

  switch (id) {
    case "dodge": {
      pose = heldPose(t, [
        [850, "look-right"], [1100, "turn-right"],
        [2250, "turn-right"], [2525, "look-right"], [2700, "neutral"],
      ]);
      if (t >= 1500 && t < 2250) {
        // Eight pose holds over the lane distance: two short cycles, never a time-only treadmill.
        const distance = (sampleScene(id, t).mochiX - 21) / 29;
        pose = reduced ? "turn-right" : WALK[Math.min(7, Math.floor(distance * 8)) % 4]!;
      }
      break;
    }
    case "lure":
      pose = heldPose(t, [
        [800, "turn-left"], [1050, "reach-ready"], [1400, "reach-left"],
        [1950, "reach-ready"], [2300, "turn-left"], [2650, "neutral"],
        [3900, "relieved"], [4600, "neutral"],
      ]);
      break;
    case "reel":
      pose = heldPose(t, [
        [150, "turn-left"], [450, "reach-ready"], [850, "reach-left"],
        [1300, "pull-in"], [1600, "reach-ready"], [1850, "reach-left"],
        [2200, "pull-in"], [2500, "reach-ready"], [2750, "pull-in"],
        [3350, "turn-left"], [3550, "relieved"], [4650, "neutral"],
      ]);
      if (reduced && t >= 450 && t < 3350) pose = "reach-left";
      break;
    case "echo":
      pose = heldPose(t, [
        [700, "turn-left"], [1900, "curious"], [3900, "turn-left"],
        [5300, "relieved"], [6100, "neutral"],
      ]);
      break;
    case "vane":
      pose = heldPose(t, [
        [700, "turn-left"], [950, "reach-ready"], [1250, "reach-left"],
        [1600, "pull-in"], [1900, "turn-left"], [2400, "neutral"],
        [3800, "relieved"], [4700, "neutral"],
      ]);
      break;
    case "hit":
      pose = heldPose(t, [
        [1800, "curious"], [2200, "startled"], [2450, "brace"],
        [3250, "relieved"], [3650, "neutral"],
      ]);
      if (reduced && t >= 2200 && t < 3250) pose = "brace";
      break;
    case "beacon":
      pose = heldPose(t, [
        [650, "look-right"], [900, "turn-right"], [1300, "curious"],
        [2850, "look-right"], [3800, "relieved"], [5100, "neutral"],
      ]);
      break;
    case "idle": {
      // Breathing is a tiny change around planted feet, sampled on the same 12fps clock.
      const held = Math.floor(t * 12 / 1000) / 12;
      const breath = (1 - Math.cos(2 * Math.PI * held / 3.25)) / 2;
      if (!reduced && t < clip.duration) scaleY += .004 * breath;
      pose = heldPose(t, [[2400, "curious"], [3250, "neutral"]]);
      break;
    }
    case "moth":
      pose = heldPose(t, [
        [1050, "look-right"], [1700, "turn-right"], [2050, "curious"],
        [4300, "look-right"], [4900, "neutral"],
      ]);
      break;
  }

  // Authored endpoints settle into a neutral pose; repeated Finish is visually idempotent.
  if (t === clip.duration) pose = "neutral";
  if (!reduced && pose === "curious") rotate = .6;
  if (reduced) {
    lift = 0;
    rotate = 0;
    scaleY = 1;
  }
  return { pose, ...MOCHI_POSES[pose], lift, rotate, scaleX: 1, scaleY };
}

/** Convert the registered paw through the exact actor transform into stage percentages. */
export function mochiPawPosition(scene: Pick<SceneState, "mochiX" | "mochiY">, pose: MochiPose) {
  const dx = (pose.paw.x - .5) * MOCHI_WIDTH * pose.scaleX;
  const dy = (pose.paw.y - MOCHI_GROUND) * MOCHI_WIDTH * pose.scaleY;
  const angle = pose.rotate * Math.PI / 180;
  return {
    x: scene.mochiX + dx * Math.cos(angle) - dy * Math.sin(angle),
    // The 3:2 stage is wider than it is tall; cqw needs the same aspect correction.
    y: scene.mochiY + (dx * Math.sin(angle) + dy * Math.cos(angle) - pose.lift) * 1.5,
  };
}
