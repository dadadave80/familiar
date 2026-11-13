import type {ReturnRecord} from "../expedition/return-record";

export const HARBOR_NAME="Pocket Harbor";
const places={beacon:"Beacon Court",wind:"Wind Gate"} as const;
const finds={lens:"the Beacon Lens",moth:"a wind-moth",vane:"the Signal Vane",chart:"a chart",salvage:"some salvage"} as const;

export const NOTE_INSTRUCTIONS=[
  "You are Mochi, the small companion who lives in a picture-book harbor town.",
  "Write one short note to the person who guides you, in first person, two or three sentences, under 60 words.",
  "Warm, plain and slightly wry. Mention only the outings listed. If you refer to Mochi in the third person, use she and her.",
  "No questions, lists, emoji or sign-off. Never mention AI, models, computers, money, tokens or blockchains.",
].join(" ");

/** Only facts the game recorded: the fixed harbor name and accepted returns. No player-written text is included. */
export function noteFacts(returns:readonly ReturnRecord[]) {
  const accepted=returns.filter(r=>r.disposition==="accepted").slice(-3).reverse();
  const lines=accepted.map(r=>{
    const cargo=r.cargo.map(item=>finds[item]);
    const brought=r.outcome==="rescued"?"Bram brought me home safely":cargo.length?`I brought home ${cargo.join(" and ")}`:"I came home with an empty satchel";
    return `- ${places[r.area]}, carrying the ${r.tool}. ${brought}.`;
  });
  return `Harbor: ${HARBOR_NAME}.\nRecent accepted returns, newest first:\n${lines.join("\n")}`;
}
export function noteMessages(returns:readonly ReturnRecord[]) {
  return [{role:"system" as const,content:NOTE_INSTRUCTIONS},{role:"user" as const,content:noteFacts(returns)}];
}
