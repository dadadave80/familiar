import { expect, test } from "bun:test";
import { tideSailReason } from "./sailing";

const ready={lit:true,lease:"held" as const,problem:"",run:false,worldReady:true,showPassage:false,busy:false,pending:false};

test("a ready harbor can sail",()=>expect(tideSailReason(ready)).toBeNull());

for(const [state,reason] of [
  [{lit:false},"Restore the beacon before sailing today’s tide."],
  [{lease:"waiting"},"Checking whether this tab can sail."],
  [{lease:"blocked"},"This expedition is open in another tab. Finish there, or close that tab before continuing here."],
  [{lease:"unavailable"},"This browser cannot safely coordinate saved expeditions. Web Locks support is required; no move has been taken."],
  [{problem:"The saved expedition could not be read. Its original data has been preserved."},"The saved expedition could not be read. Its original data has been preserved."],
  [{run:true},"Finish the outing in progress first."],
  [{worldReady:false},"Opening the artwork. Mochi’s saved moves are safe."],
  [{showPassage:true},"Finish the harbor crossing first."],
  [{busy:true},"The original harbor action is still being checked."],
  [{pending:true},"Resolve the original request before setting out from this harbor."],
] satisfies [Partial<Parameters<typeof tideSailReason>[0]>,string][])test(`sailing explains ${Object.keys(state)[0]}`,()=>{
  expect(tideSailReason({...ready,...state})).toBe(reason);
});

test("a lease or saved-data problem takes priority over an outing",()=>{
  expect(tideSailReason({...ready,run:true,lease:"blocked"})).toContain("another tab");
  expect(tideSailReason({...ready,run:true,problem:"The move could not be saved."})).toBe("The move could not be saved.");
  expect(tideSailReason({...ready,run:true,lit:false})).toBe("Finish the outing in progress first.");
});
