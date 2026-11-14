import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { cardForDay } from "./cards";
import type { TideEntry } from "./log";
import TideAsk from "./TideAsk";
import TideLog from "./TideLog";

const day=20771,card=cardForDay(day);
const reason="This expedition is open in another tab. Finish there, or close that tab before continuing here.";
const entry:TideEntry={day,cardId:card.id,tool:card.tool,commands:["return"],kept:[false,false,false],decisions:1,outcome:"returned",late:false,attempts:1,savedAt:"2026-11-14T00:00:00.000Z"};

function explainsBlock(html:string,count:number){
  expect(html).toContain(reason);
  expect(html).not.toContain("Finish the outing in progress first.");
  const described=html.match(/aria-describedby="([^"]+)"/g)??[];
  expect(described).toHaveLength(count);
  for(const attribute of described){
    const id=attribute.slice('aria-describedby="'.length,-1);
    expect(html).toContain(`id="${id}">${reason}</p>`);
  }
  expect(html.match(/aria-disabled="true"/g)?.length).toBeGreaterThanOrEqual(count);
}

test("today’s and earlier tides describe the actual sailing block",()=>{
  const props={today:{day,card,entry:null},earlier:[{day:day-1,card:cardForDay(day-1),entry:null}],sailBlockedReason:reason,onSail:()=>{},onOpenLog:()=>{}};
  explainsBlock(renderToStaticMarkup(<TideAsk {...props}/>),2);
});

test("a tide log replay describes the actual sailing block",()=>{
  const props={pages:[{kind:"tide" as const,day,card,entry}],reduced:true,sailBlockedReason:reason,summary:{sailed:1,kept:0,allThree:0},onSail:()=>{}};
  explainsBlock(renderToStaticMarkup(<TideLog {...props}/>),1);
});

test("a ready tide and log leave sailing enabled without a blocked note",()=>{
  for(const html of [
    renderToStaticMarkup(<TideAsk today={{day,card,entry:null}} earlier={[]} sailBlockedReason={null} onSail={()=>{}} onOpenLog={()=>{}}/>),
    renderToStaticMarkup(<TideLog pages={[{kind:"tide",day,card,entry}]} reduced sailBlockedReason={null} summary={{sailed:1,kept:0,allThree:0}} onSail={()=>{}}/>),
  ]){
    expect(html).toMatch(/class="exp-primary" aria-disabled="false"/);
    expect(html).not.toContain("aria-describedby");
    expect(html).not.toContain("Finish the outing in progress first.");
  }
});
