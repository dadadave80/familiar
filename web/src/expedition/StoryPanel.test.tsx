import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import StoryPanel, { exchangeBeats, type StoryMoment } from "./StoryPanel";

const render=(kind:StoryMoment,beat=0,progress=false,buttons=false)=>renderToStaticMarkup(<StoryPanel kind={kind} beat={beat} progress={progress} buttons={buttons} headingRef={{current:null}} onClose={()=>{}} onHelp={()=>{}} onUseButtons={()=>{}} onContinue={()=>{}}/>);
test("the prologue establishes the role and objective with all three native choices",()=>{
  const html=render("introduction");
  for(const copy of ["Keep Wren’s Light","You guide Mochi as a volunteer harbor helper.","I’m Bram. Wren’s beacon helps the boats find harbor.","Mochi looks from the dark beacon to the water, then waits for your lead.","Bring the Beacon Lens home from the left shell.","Help Mochi","Skip introduction","Use buttons"])expect(html).toContain(copy);
  expect(html).toContain('id="exp-story-heading" data-prologue-heading="true"');
  expect(html).toContain('tabindex="-1"');
  expect(html).toContain('role="region" aria-label="Introduction"');
  expect(render("introduction",0,false,true)).toContain("Button controls will be open when you sail.");
});
test("the prologue objective stays with Help Mochi outside the scrolling prose",()=>{
  for(const buttons of [false,true]){
    const html=render("introduction",0,false,buttons);
    const actions=html.slice(html.indexOf('class="exp-story-actions"'));
    expect(actions).toContain('<p class="exp-story-objective">Bring the Beacon Lens home from the left shell.</p>');
    expect(actions.indexOf('class="exp-story-objective"')).toBeLessThan(actions.indexOf(">Help Mochi<"));
  }
});
test("manual replay is read-only before and after progress",()=>{
  for(const progress of [false,true]){
    const html=render("replay",0,progress);
    expect(html).toContain("Back to Mochi");
    expect(html).not.toContain("Help Mochi");
    expect(html).not.toContain("Skip introduction");
    expect(html).not.toContain("Use buttons");
    expect(html).not.toContain("Bring the Beacon Lens home from the left shell.");
  }
  expect(render("replay",0,true)).toContain("How it began");
  expect(render("replay",0,true)).toContain("The storm had taken the beacon’s lens. Mochi was ready to help.");
});
test("exchanges hold exactly one beat and end with the deliberate continuation",()=>{
  for(const kind of ["lens","vane","moth"] as const)for(const [beat,line] of exchangeBeats[kind].entries()){
    const html=render(kind,beat);
    expect(html).toContain(line);
    for(const other of exchangeBeats[kind].filter(other=>other!==line))expect(html).not.toContain(other);
    expect(html).toContain(beat===exchangeBeats[kind].length-1?">Continue with Mochi<":">Continue<");
  }
});
