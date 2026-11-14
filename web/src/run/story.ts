/** The story is three tides. Which one a harbor is on is read from what the harbor already saves. */
import type { Item, Lane, StoryPrize, TideStart, TideTransition } from "./engine";

export interface HarborStory { readonly banked: readonly string[]; readonly lit: boolean; readonly signaled: boolean }

export interface Chapter {
  readonly number: 1 | 2 | 3;
  readonly title: string;
  /** A fixed tide every new player gets: a careful player brings the prize home dry with waves to spare. */
  readonly seed: number;
  readonly before: string;
  readonly goal: string;
  /** Bram, once the prize is home and fitted. */
  readonly after: readonly string[];
}

export const CHAPTERS: Readonly<Record<StoryPrize, Chapter>> = {
  lens: {
    number: 1, title: "First light", seed: 5,
    before: "The lens went over the wall in the storm. It’s in the left shell. The old crab won’t let anyone near it.",
    goal: "Grab what the tide leaves. Don’t be in a lane when its wave lands. Step on the dock to bank.",
    after: ["Forty years I’ve known that crab. Never once seen it hold still."],
  },
  vane: {
    number: 2, title: "What the tide brings", seed: 4,
    before: "Reeds from Wren’s garden. Glass from her windows. That’s not flotsam. The crab is bringing her house back.",
    goal: "The Signal Vane is in the right shell. Bring it home, and anything else the tide leaves.",
    after: [
      "Wren kept this light. The night it failed she rowed out to guide the boats in by hand. The boats came home.",
      "The Tidekeeper was her familiar. It has been waiting for her light ever since. And now it’s on.",
    ],
  },
  moth: {
    number: 3, title: "The last thing", seed: 15,
    before: "There’s one thing it never gave up. Her wind-moth. Kept it dry in that shell through the whole storm.",
    goal: "The moth is in the right shell. It takes two places in the pack.",
    after: ["It knows she isn’t coming. It gave you the moth anyway.", "Two familiars and one light. That’ll do for a harbor."],
  },
};

/** The story tide a harbor should sail next, or null between chapters and once the moth is home. */
export function chapterFor(home: HarborStory): StoryPrize | null {
  if (!home.banked.includes("lens")) return "lens";
  if (home.lit && !home.banked.includes("vane")) return "vane";
  if (home.signaled && !home.banked.includes("moth")) return "moth";
  return null;
}
export const storyStart = (prize: StoryPrize): TideStart => ({ seed: CHAPTERS[prize].seed, story: prize });

const LANES = ["Left", "Center", "Right"] as const;
const NAMES: Readonly<Record<Item, string>> = { reed: "reed", glass: "sea glass", pearl: "pearl", lens: "Beacon Lens", vane: "Signal Vane", moth: "wind-moth" };
export const itemName = (item: Item) => NAMES[item];
export const laneNames = (lanes: readonly Lane[]) => lanes.map(lane => LANES[lane]).join(" and ");
const A: Readonly<Record<Item, string>> = { reed: "a reed", glass: "sea glass", pearl: "a pearl", lens: "the Beacon Lens", vane: "the Signal Vane", moth: "the wind-moth" };
/** "a reed", "sea glass", "a pearl": the name as it reads in a sentence. */
export const aPrize = (item: Item) => A[item];
const MANY: Readonly<Record<Item, string>> = { reed: "reeds", glass: "pieces of sea glass", pearl: "pearls", lens: "lenses", vane: "vanes", moth: "moths" };
const COUNT = ["no", "one", "two", "three", "four", "five", "six"];
/** "a reed and two pieces of sea glass", or with `the`: "the reed and the two pieces of sea glass". */
function list(items: readonly Item[], the = false): string {
  const parts = [...new Set(items)].map(kind => {
    const count = items.filter(item => item === kind).length;
    return count === 1 ? (the ? `the ${itemName(kind)}` : A[kind]) : `${the ? "the " : ""}${COUNT[count] ?? count} ${MANY[kind]}`;
  });
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] ?? "nothing";
}

const OPENED: Readonly<Record<StoryPrize, string>> = {
  lens: "The left shell opens. The lens is inside.",
  vane: "The right shell opens. Brass, and still turning.",
  moth: "The right shell opens. Something inside is glowing.",
};
const CARRIED: Readonly<Record<StoryPrize, string>> = {
  lens: "Mochi has the lens. Home is the dock.",
  vane: "Mochi has the vane. Home is the dock.",
  moth: "Mochi cradles the moth. It takes two places in her pack.",
};
const HOME: Readonly<Record<StoryPrize, string>> = {
  lens: "The lens is home. The rest of the tide is yours.",
  vane: "The vane is home. The rest of the tide is yours.",
  moth: "The moth is home.",
};
const isStory = (item: Item | null): item is StoryPrize => item === "lens" || item === "vane" || item === "moth";

/** One or two sentences about what this move really did, or nothing. Nothing is said that did not happen. */
export function consequence({ events }: TideTransition): string {
  const facts: string[] = [];
  for (const event of events) switch (event.kind) {
    case "pickup": facts.push(isStory(event.item) ? CARRIED[event.item] : `Mochi takes the ${itemName(event.item)}.`); break;
    case "full": facts.push(`No room for the ${itemName(event.item)}. Bank at the dock first.`); break;
    case "bank": {
      const story = event.items.find(isStory);
      facts.push(story ? HOME[story] : `Banked ${list(event.items)}: +${event.gained}.`);
      break;
    }
    case "sweep": facts.push(`The wave takes ${list(event.items.map(item => item.kind), true)} back.`); break;
    case "shield": facts.push("The Tidekeeper puts a claw in the water. The wave goes around."); break;
    case "splash": facts.push(event.lost
      ? `Splashed. The ${itemName(event.lost)} ${isStory(event.lost) ? "goes back to its shell" : "is gone"}.`
      : "Splashed. Mochi shakes it off."); break;
    case "open": facts.push(OPENED[event.item]); break;
    case "leave": facts.push(`The tide leaves ${list(event.items.map(item => item.kind))}.`); break;
    case "end":
      if (event.reason === "rescued") facts.push("Bram wades out and carries Mochi home.");
      else if (event.reason === "turned") facts.push(event.lost.length ? "The tide turns and takes what was still in the pack." : "The tide turns.");
      else facts.push("Mochi calls it a day.");
      break;
    default: break;
  }
  return facts.join(" ");
}
