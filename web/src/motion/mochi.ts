export const MOCHI_ATLAS = "mochi-poses-v1";
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
const WALK: readonly MochiPoseName[] = [
  "walk-contact-a", "walk-pass-a", "walk-contact-b", "walk-pass-b",
];

export function walkingPose(strides: number): MochiPoseName {
  return WALK[Math.floor(Math.max(0, strides) * WALK.length) % WALK.length]!;
}
