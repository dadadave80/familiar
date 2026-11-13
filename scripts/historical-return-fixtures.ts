import { createHash } from "node:crypto";
import { replayOuting, legalActions, applyAction } from "../web/src/compatibility/return-rules";

export function stateHash(value:unknown):string {
  const canonical=(v:unknown):unknown=>Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])) : v;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}
export function expeditionFixtures() {
  const cases = [
    { tool:"rope", banked:[], area:"beacon", commands:["move:left","wait","move:center","reel:lens","return"] },
    { tool:"rope", banked:[], area:"beacon", commands:["wait","move:left","move:center","move:right","reel:lens","move:center","move:right","take:moth","move:center","return"] },
    { tool:"lantern", banked:[], area:"beacon", commands:["wait","wait","lure:left","take:chart","move:left","take:lens","move:center","return"] },
    { tool:"rope", banked:["lens"], area:"wind", commands:["move:right","wait","move:center","move:left","wait","move:center","take:vane","return"] },
    { tool:"lantern", banked:["lens"], area:"wind", commands:["turn:vane","wait","turn:vane","wait","wait","lure:left","take:vane","return"] },
    { tool:"rope", banked:[], area:"beacon", commands:Array(9).fill("wait") as string[] },
  ];
  let seed=238947;
  const random=(n:number)=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n};
  for(const area of ["beacon","wind"] as const) for(const tool of ["rope","lantern"] as const) for(let i=0;i<100;i++) {
    const banked=i%2 ? ["lens" as const]:[];
    let run=replayOuting(tool,banked,[],area)!;
    while(run.outcome==="active") {
      const choices=legalActions(run);run=applyAction(run,choices[random(choices.length)]);
    }
    cases.push({tool,banked,area,commands:run.actions});
  }
  return cases.map(c=>({ ...c, states:Array.from({length:c.commands.length+1},(_,n)=>{
    const run=replayOuting(c.tool,c.banked,c.commands.slice(0,n),c.area);
    if(!run) throw Error("Invalid golden route");
    return stateHash([run,legalActions(run)]);
  })}));
}
if(import.meta.main) {
  await Bun.write(new URL("../contracts/common/tests/historical-return-fixtures.json",import.meta.url),JSON.stringify(expeditionFixtures())+"\n");
}
