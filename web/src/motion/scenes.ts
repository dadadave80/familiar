export type ClipId = "dodge" | "lure" | "reel" | "echo" | "vane" | "hit" | "beacon" | "idle" | "moth";
type Lane = 0 | 1 | 2;

export interface MotionClip {
  id: ClipId;
  title: string;
  duration: number;
  description: string;
  chapter: "Encounter" | "Homecoming";
  beats: readonly { at: number; label: string; detail: string; phase: string }[];
}

export interface SceneState {
  harbor: boolean;
  mochiX: number;
  mochiY: number;
  guardianLift: number;
  guardianScale: number;
  waveLane: Lane | null;
  waveProgress: number;
  waveOpacity: number;
  targetLane: Lane | null;
  targetOpacity: number;
  echoLane: Lane | null;
  echoOpacity: number;
  lensX: number;
  lensY: number;
  lensOpacity: number;
  ropeProgress: number;
  lureOpacity: number;
  vaneRotation: number;
  beacon: number;
  moth: number;
  bram: number;
  celebration: number;
  resolve: 2 | 3;
  cue: string;
  detail: string;
  phase: string;
  beat: number;
}

// Authored motion studies: these samples do not execute game actions or award items.
export const CLIPS: readonly MotionClip[] = [
  {
    id: "dodge", title: "One step ahead", duration: 6200, chapter: "Encounter",
    description: "A warning, a sidestep, a clean escape.",
    beats: [
      { at: 0, label: "Read the water", detail: "The Tidekeeper has locked onto Left.", phase: "Surge ready" },
      { at: 1300, label: "Step into Center", detail: "Mochi takes the adjacent lane before the wave lands.", phase: "Surge ready" },
      { at: 2450, label: "Let the wave pass", detail: "The locked wave stays on Left.", phase: "Surge" },
      { at: 3700, label: "The shell gives way", detail: "The Beacon Lens is exposed, ready for a separate Reel action.", phase: "Low tide" },
    ],
  },
  {
    id: "lure", title: "Change its mind", duration: 6100, chapter: "Encounter",
    description: "A bright decoy draws the wave away.",
    beats: [
      { at: 0, label: "Center is marked", detail: "Mochi is standing in the locked source lane.", phase: "Surge ready" },
      { at: 1300, label: "Send a Lure left", detail: "The source changes from Center to Left.", phase: "Surge ready" },
      { at: 2650, label: "The wave follows", detail: "Mochi stays in Center as Left takes the surge.", phase: "Surge" },
      { at: 3950, label: "An opening, without a step", detail: "The left shell is open. The lens is ready to be reeled in.", phase: "Low tide" },
    ],
  },
  {
    id: "reel", title: "Bring it home", duration: 5500, chapter: "Encounter",
    description: "Pull the lens across. Keep your footing.",
    beats: [
      { at: 0, label: "The lens is exposed", detail: "Mochi reaches across from Center.", phase: "Low tide" },
      { at: 1400, label: "Reel, do not cross", detail: "The lens moves. Mochi stays in the same lane.", phase: "Low tide" },
      { at: 3000, label: "Into the satchel", detail: "The line slackens as the lens arrives.", phase: "Low tide" },
      { at: 4200, label: "A small, satisfied pause", detail: "The lens is safely stowed in Mochi’s satchel.", phase: "Settled" },
    ],
  },
  {
    id: "echo", title: "The water remembers", duration: 6800, chapter: "Encounter",
    description: "The second wave matters, too.",
    beats: [
      { at: 0, label: "Watch the first surge", detail: "The Tidekeeper sends a wave through Left.", phase: "Surge" },
      { at: 1900, label: "Left still holds an echo", detail: "On the next Low, Mochi waits in Center.", phase: "Low tide · echo pending" },
      { at: 4100, label: "The echo resolves", detail: "After the Low action, Left surges once more.", phase: "Low tide · echo" },
      { at: 5300, label: "Now the water is clear", detail: "The echo marker clears. Mochi has stayed outside its lane.", phase: "Low tide" },
    ],
  },
  {
    id: "vane", title: "Turn the tide", duration: 6000, chapter: "Encounter",
    description: "Give the wave a new destination.",
    beats: [
      { at: 0, label: "Center in, Right out", detail: "The Center socket is charged; the vane points to Right.", phase: "Surge ready" },
      { at: 1100, label: "Turn once toward Left", detail: "The locked source stays Center. The exit becomes Left.", phase: "Surge ready" },
      { at: 2400, label: "The wave takes the new path", detail: "The vane routes the surge into the Left socket.", phase: "Surge" },
      { at: 3800, label: "Both sockets are charged", detail: "The Signal Vane is ready in Center.", phase: "Low tide" },
    ],
  },
  {
    id: "hit", title: "A stumble, then steady", duration: 5500, chapter: "Encounter",
    description: "A wobble, a breath, back on your feet.",
    beats: [
      { at: 0, label: "Left is in the path", detail: "Mochi is still in the wave's lane.", phase: "Surge ready" },
      { at: 1200, label: "The surge arrives", detail: "The warning becomes a moving wave.", phase: "Surge" },
      { at: 2200, label: "One Resolve lost", detail: "A short recoil. Three Resolve becomes two.", phase: "Impact" },
      { at: 3650, label: "Find your footing", detail: "Mochi settles with 2 of 3 Resolve, ready for the next decision.", phase: "Low tide" },
    ],
  },
  {
    id: "beacon", title: "A light for everyone", duration: 6500, chapter: "Homecoming",
    description: "Restore the light. Share the joy.",
    beats: [
      { at: 0, label: "The lens is home", detail: "Mochi and Bram gather beneath the lighthouse.", phase: "Homecoming" },
      { at: 1300, label: "Lift it into place", detail: "The lens rises from Mochi to the lantern.", phase: "Restoration" },
      { at: 2850, label: "First light", detail: "A warm beam opens over the harbor.", phase: "Restoration" },
      { at: 4350, label: "A little joy, shared", detail: "Mochi celebrates with Bram as the light settles.", phase: "Homecoming" },
    ],
  },
  {
    id: "idle", title: "Room to breathe", duration: 6500, chapter: "Homecoming",
    description: "A peaceful moment with Bram.",
    beats: [
      { at: 0, label: "No hurry here", detail: "Mochi takes a breath beside Bram.", phase: "Harbor" },
      { at: 2100, label: "A quiet companion", detail: "A soft rise, a small shift, then stillness.", phase: "Harbor" },
      { at: 4350, label: "Stay a little longer", detail: "The idle settles without asking anything of you.", phase: "Harbor" },
    ],
  },
  {
    id: "moth", title: "An unexpected guest", duration: 6500, chapter: "Homecoming",
    description: "A wind-moth finds its way home.",
    beats: [
      { at: 0, label: "Something in the garden", detail: "A small visitor drifts into the warm light.", phase: "Harbor" },
      { at: 1900, label: "Mochi notices", detail: "A curious tilt makes room for the new arrival.", phase: "Harbor" },
      { at: 4300, label: "A place to linger", detail: "The moth stays. There is nothing to collect or tend.", phase: "Harbor" },
    ],
  },
];

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const progress = (time: number, start: number, end: number) => clamp((time - start) / (end - start));
const ease = (value: number) => value * value * (3 - 2 * value);
const between = (time: number, start: number, end: number) => ease(progress(time, start, end));
const mix = (from: number, to: number, amount: number) => from + (to - from) * amount;
const pulse = (time: number, start: number, peak: number, end: number) =>
  time <= peak ? between(time, start, peak) : 1 - between(time, peak, end);

function wave(state: SceneState, time: number, lane: Lane, start: number, end: number) {
  state.waveLane = lane;
  state.waveProgress = progress(time, start, end);
  state.waveOpacity = between(time, start, start + 140) * (1 - between(time, end - 180, end));
}

export function sampleScene(id: ClipId, time: number): SceneState {
  if (!Number.isFinite(time)) throw new RangeError("Scene time must be finite");
  const clip = CLIPS.find(candidate => candidate.id === id);
  if (!clip) throw new RangeError(`Unknown motion clip: ${id}`);
  const t = Math.max(0, Math.min(clip.duration, time));
  let beat = 0;
  while (beat + 1 < clip.beats.length && clip.beats[beat + 1]!.at <= t) beat++;
  const caption = clip.beats[beat]!;
  const harbor = clip.chapter === "Homecoming";
  const state: SceneState = {
    harbor, mochiX: harbor ? 43 : 50, mochiY: harbor ? 83 : 62,
    guardianLift: 0, guardianScale: 1,
    waveLane: null, waveProgress: 0, waveOpacity: 0,
    targetLane: null, targetOpacity: 0, echoLane: null, echoOpacity: 0,
    lensX: 21, lensY: 48, lensOpacity: 0, ropeProgress: 0, lureOpacity: 0,
    vaneRotation: 120, beacon: 0, moth: 0, bram: harbor ? 1 : 0, celebration: 0,
    resolve: 3, cue: caption.label, detail: caption.detail, phase: caption.phase, beat,
  };

  switch (id) {
    case "dodge": {
      const step = between(t, 1500, 2250);
      state.mochiX = mix(21, 50, step);
      state.targetLane = 0;
      state.targetOpacity = between(t, 200, 600) * (1 - between(t, 3100, 3400));
      state.guardianLift = 8 * pulse(t, 800, 1450, 2400);
      state.guardianScale = 1 + 0.025 * pulse(t, 800, 1450, 2400);
      wave(state, t, 0, 2450, 3250);
      state.lensOpacity = between(t, 3300, 3650);
      break;
    }
    case "lure": {
      state.targetLane = t < 1800 ? 1 : 0;
      state.targetOpacity = between(t, 150, 450) * (1 - between(t, 3400, 3650));
      state.lureOpacity = pulse(t, 1000, 1750, 2350);
      state.guardianLift = 8 * pulse(t, 850, 1600, 2500);
      wave(state, t, 0, 2650, 3550);
      state.lensOpacity = between(t, 3750, 4100);
      break;
    }
    case "reel": {
      const pull = between(t, 1100, 2800);
      state.lensX = mix(21, 50, pull);
      state.lensY = mix(48, 53, pull) - 6 * Math.sin(Math.PI * pull);
      state.lensOpacity = 1 - between(t, 2900, 3400);
      state.ropeProgress = between(t, 450, 950) * (1 - between(t, 2800, 3100));
      state.celebration = pulse(t, 3300, 3650, 4250);
      break;
    }
    case "echo": {
      state.targetLane = 0;
      state.targetOpacity = 1 - between(t, 1600, 1900);
      if (t < 1900) wave(state, t, 0, 1000, 1900);
      else if (t < 5100) wave(state, t, 0, 4200, 5100);
      if (t >= 1900 && t < 5100) {
        state.echoLane = 0;
        state.echoOpacity = between(t, 1900, 2200) * (1 - between(t, 4800, 5100));
      }
      state.guardianLift = 6 * pulse(t, 0, 650, 1100);
      break;
    }
    case "vane": {
      state.vaneRotation = mix(120, 240, between(t, 950, 1750));
      state.targetLane = 1;
      state.targetOpacity = 1 - between(t, 3100, 3500);
      wave(state, t, t < 1750 ? 2 : 0, 2400, 3300);
      break;
    }
    case "hit": {
      state.mochiX = 21;
      state.targetLane = 0;
      state.targetOpacity = 1 - between(t, 2100, 2350);
      state.resolve = t >= 2200 ? 2 : 3;
      wave(state, t, 0, 1200, 2400);
      break;
    }
    case "beacon": {
      const rise = between(t, 900, 2600);
      state.lensX = mix(43, 82.6, rise);
      state.lensY = mix(72, 23, rise) - 8 * Math.sin(Math.PI * rise);
      state.lensOpacity = 1 - between(t, 2750, 3050);
      state.beacon = between(t, 2700, 3700);
      state.celebration = pulse(t, 3500, 4100, 5000);
      break;
    }
    case "idle": {
      state.beacon = 1;
      break;
    }
    case "moth": {
      state.moth = between(t, 500, 1400);
      state.beacon = 1;
      break;
    }
  }
  return state;
}
