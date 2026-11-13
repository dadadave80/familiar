import { expect, test } from "bun:test";
import { HarborAudio, soundRecipe } from "./audio";
import type { CourtEvent } from "./types";

test("foley has bounded quiet envelopes and distinguishes surf, stone and glass",()=>{
  const events:CourtEvent[]=[
    {kind:"move",from:{x:1,y:0},to:{x:1,y:1}},{kind:"telegraph",column:0},{kind:"rotate",from:1,to:2},
    {kind:"redirect",from:1,to:0},{kind:"wave",source:0,exit:0},{kind:"bridge",from:1,to:0},{kind:"open",column:0},
    {kind:"hit",from:{x:0,y:3},to:{x:0,y:1},resolve:2},{kind:"pickup",item:"lens",from:{x:0,y:4},rope:true},
    {kind:"pickup",item:"moth",from:{x:2,y:4},rope:false},{kind:"return",cargo:["lens"]},{kind:"rescue",reason:"flood"},
  ];
  for(const event of events)for(const layer of soundRecipe(event)) {
    expect(layer.gain).toBeGreaterThan(0);expect(layer.gain).toBeLessThanOrEqual(.1);
    expect(layer.duration).toBeGreaterThan(.02);expect(layer.duration+(layer.delay??0)).toBeLessThan(1);
    expect(layer.frequency).toBeGreaterThan(20);expect(layer.frequency).toBeLessThan(3000);
  }
  expect(soundRecipe(events[4]!)[0]!.kind).toBe("noise");
  expect(soundRecipe(events[8]!)).not.toEqual(soundRecipe(events[9]!));
});

test("no audio context is created before opt-in and a late resume cannot outlive close",async()=>{
  let created=0,closed=0,oscillators=0,resume!:()=>void;
  const context={state:"suspended",destination:{},createGain:()=>({gain:{value:0},connect(){}}),
    resume:()=>new Promise<void>(resolve=>{resume=()=>{context.state="running";resolve();};}),
    close:async()=>{closed++;context.state="closed";},createOscillator:()=>{oscillators++;throw Error("Must remain silent");},
  };
  const audio=new HarborAudio(()=>{created++;return context as unknown as AudioContext;});
  audio.play({kind:"telegraph",column:0});expect(created).toBe(0);
  const enabling=audio.setEnabled(true);expect(created).toBe(1);
  await audio.close();resume();await enabling;
  audio.play({kind:"telegraph",column:0});expect(oscillators).toBe(0);expect(closed).toBe(1);
});

test("an unavailable audio device never aborts the presentation of an accepted move",async()=>{
  let gains=0;
  const context={state:"running",destination:{},currentTime:0,createGain:()=>{
    if(gains++)throw Error("Audio output became unavailable");return {gain:{value:0},connect(){}};
  }};
  const audio=new HarborAudio(()=>context as unknown as AudioContext);await audio.setEnabled(true);
  expect(()=>audio.play({kind:"move",from:{x:1,y:0},to:{x:1,y:1}})).not.toThrow();
});
