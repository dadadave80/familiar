import { expect, test } from "bun:test";
import { replayOuting, type Action } from "../outing/engine";
import { deriveStoryEvents, eligibleMotifs, prepareAdoption, applyPlacement, type LocalPreview, type AccountSnapshot } from "./domain";
const dry: Action[] = ["move:left", "wait", "move:center", "reel:lens", "return"];
const rescue: Action[] = ["wait", "move:left", "move:center", "move:right", "reel:lens", "move:center", "move:right", "take:moth", "move:center", "return"];
const local: LocalPreview = { rulesVersion:"tidebound_h1_v1", contentVersion:"first_light_v1", origins:{ crest:null, moth:null }, lantern:null, revision:0 };
const remote: AccountSnapshot = { authority:"near-testnet", revision:1, verifiedLensReturn:false, verifiedMothReturn:false, craftState:"unclaimed", ownedCraft:null, canonicalCraftOperationId:null };

test("motifs come from recomputed terminal returns, never cargo flags or failure", () => {
  const run = replayOuting("rope", [], dry)!;
  expect(deriveStoryEvents(run).map(e => e.id)).toEqual(["lens_return", "dry_crossing"]);
  expect(eligibleMotifs({ verifiedLensReturn:true, verifiedMothReturn:false })).toEqual(["crest"]);
  expect(deriveStoryEvents(replayOuting("rope", [], rescue)!).map(e => e.id)).toContain("moth_return");
  expect(deriveStoryEvents({ ...run, cargo:["moth"] })).toEqual([]);
  expect(deriveStoryEvents(replayOuting("rope", [], dry.slice(0,-1))!)).toEqual([]);
  expect(deriveStoryEvents(replayOuting("rope", [], Array(9).fill("wait"))!)).toEqual([]);
});

test("adoption preserves transferred or consumed previews and never remints", () => {
  const preview = { ...local, origins:{ crest:{ tool:"rope" as const, banked:[], actions:dry, area:"beacon" as const }, moth:null }, lantern:{ motif:"crest" as const, socket:"dock" as const } };
  expect(prepareAdoption(preview, remote).kind).toBe("claim-preview");
  expect(prepareAdoption(preview, { ...remote, craftState:"consumed" }).kind).toBe("preserve-memory");
  expect(prepareAdoption(preview, { ...remote, craftState:"reserved", canonicalCraftOperationId:"one" })).toMatchObject({ kind:"reconcile", operationId:"one" });
  expect(prepareAdoption({ ...preview, rulesVersion:"future" }, remote).kind).toBe("preserve-memory");
  expect(prepareAdoption({ ...preview, lantern:{ motif:"moth", socket:"porch" } }, remote).kind).toBe("preserve-memory");
});

test("placement is revision checked and moves one existing preview", () => {
  const placed = { ...local, lantern:{ motif:"crest" as const, socket:"porch" as const } };
  expect(applyPlacement(placed, "dock", 0)).toMatchObject({ ok:true, preview:{ revision:1, lantern:{ motif:"crest", socket:"dock" } } });
  expect(applyPlacement(placed, "dock", 1)).toMatchObject({ ok:false, reason:"conflict" });
  expect(applyPlacement(local, "porch", 0)).toMatchObject({ ok:false, reason:"missing-lantern" });
  expect(applyPlacement(placed, "elsewhere", 0)).toMatchObject({ ok:false, reason:"invalid-socket" });
});

test("a later Moth return imports personal progress after crafting or gifting without reminting",()=>{
  const run=replayOuting("rope",[],rescue)!;
  const transcript={tool:run.tool,banked:run.banked,actions:run.actions,area:run.area};
  const preview={...local,origins:{crest:transcript,moth:transcript},lantern:{motif:"crest" as const,socket:"dock" as const}};
  const gifted=prepareAdoption(preview,{...remote,verifiedLensReturn:true,craftState:"consumed"});
  expect(gifted).toMatchObject({kind:"preserve-memory",transcripts:[transcript]});
});

test("equivalent replay records do not depend on JSON object property order",()=>{
 const run=replayOuting("rope",[],dry)!;
 const reordered=Object.fromEntries(Object.entries(run).reverse()) as typeof run;
 reordered.waves=run.waves.map(w=>Object.fromEntries(Object.entries(w).reverse()) as typeof w);
 expect(deriveStoryEvents(reordered)).toEqual(deriveStoryEvents(run));
});
