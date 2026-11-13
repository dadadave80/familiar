import type { Area, CourtEvent } from "./types";

export interface SoundLayer {
  kind:"tone"|"noise";frequency:number;gain:number;duration:number;delay?:number;to?:number;
  waveform?:OscillatorType;filter?:BiquadFilterType;attack?:number;
}
const channelNotes=[293.66,369.99,440] as const;

export function soundRecipe(event:CourtEvent,area:Area="beacon"):readonly SoundLayer[] {
  switch(event.kind) {
    case "move":{
      if(Math.abs(event.to.y-event.from.y)>1) return [
        {kind:"tone",frequency:260,to:180,gain:.047,duration:.13,waveform:"triangle",attack:.005},
        {kind:"noise",frequency:820,gain:.03,duration:.12,delay:.15,filter:"bandpass"},
        {kind:"tone",frequency:205,to:142,gain:.035,duration:.2,delay:.15,waveform:"triangle"},
      ];
      return [0,.13].map((delay,i)=>({kind:"noise",frequency:720+85*((event.to.x+event.to.y+i)%3),gain:.038,duration:.085,delay,filter:"bandpass"}));
    }
    case "telegraph":return [{kind:"tone",frequency:110,to:90,gain:.025,duration:.2,waveform:"sine"}];
    case "rotate":return [
      {kind:"noise",frequency:510,gain:.046,duration:.17,filter:"bandpass"},
      {kind:"tone",frequency:channelNotes[event.to],to:channelNotes[event.to]*.94,gain:.05,duration:.12,delay:.14,waveform:"triangle",attack:.004},
      ...(event.to===0?[{kind:"tone" as const,frequency:587.33,gain:.041,duration:.34,delay:.22}]:[]),
    ];
    case "redirect":return [{kind:"noise",frequency:1800,gain:.025,duration:.25,filter:"highpass"},{kind:"tone",frequency:330,to:660,gain:.02,duration:.24}];
    case "wave":return [
      {kind:"noise",frequency:1000,gain:.085,duration:.65,filter:"lowpass"},
      {kind:"noise",frequency:2300,gain:.02,duration:.45,delay:.1,filter:"highpass"},
      ...(area==="wind"?[{kind:"tone" as const,frequency:channelNotes[event.source],to:channelNotes[event.exit],gain:.05,duration:.39,attack:.08}]:[]),
    ];
    case "bridge":return [{kind:"noise",frequency:320,gain:.025,duration:.19,filter:"bandpass"},{kind:"tone",frequency:155,to:120,gain:.012,duration:.12,waveform:"triangle"}];
    case "open":{
      if(area==="wind")return [
        {kind:"noise",frequency:1450,gain:.046,duration:.28,filter:"bandpass",attack:.05},
        {kind:"tone",frequency:channelNotes[event.column]*2,gain:.065,duration:.42,delay:.10,attack:.04},
      ];
      return [{kind:"tone",frequency:659.25,gain:.035,duration:.3},{kind:"tone",frequency:880,gain:.025,duration:.27,delay:.07}];
    }
    case "hit":return [{kind:"noise",frequency:220,gain:.045,duration:.17,filter:"bandpass"},{kind:"noise",frequency:900,gain:.025,duration:.22,filter:"lowpass"}];
    case "pickup":{
      const rope:SoundLayer[]=event.rope?[{kind:"noise",frequency:1600,gain:.025,duration:.2,filter:"bandpass"}]:[];
      if(event.item==="vane")return [...rope,
        {kind:"noise",frequency:730,gain:.052,duration:.22,filter:"bandpass"},
        {kind:"tone",frequency:440,gain:.07,duration:.49,delay:.09,waveform:"triangle",attack:.006},
        {kind:"tone",frequency:1080,to:1065,gain:.029,duration:.29,delay:.10,attack:.006},
      ];
      return [...rope,
        {kind:"tone",frequency:event.item==="moth"?1174.66:880,gain:.035,duration:.36,delay:event.rope?.1:0},
        {kind:"tone",frequency:event.item==="moth"?1567.98:1174.66,gain:.025,duration:.3,delay:.1},
      ];
    }
    case "return":return [{kind:"noise",frequency:480,gain:.035,duration:.28,filter:"lowpass"},{kind:"tone",frequency:235,to:175,gain:.034,duration:.18,delay:.18,waveform:"triangle"}];
    case "rescue":return [{kind:"noise",frequency:620,gain:.052,duration:.52,filter:"lowpass"},{kind:"noise",frequency:310,gain:.035,duration:.2,delay:.31,filter:"bandpass"}];
  }
}

export type MusicCue = "harbor"|"departure"|"beacon"|"wind-departure"|"signal";
type Bus = "music"|"effects";
const busGain:Record<Bus,number>={music:.65,effects:.45};

// Wind Gate's rising reed call finds its lower answering phrase at the repaired post.
function score(cue:MusicCue):SoundLayer[] {
  const d=293.66,a=220,e=329.63,fSharp=369.99,highA=440;
  const wind=cue==="wind-departure"||cue==="signal";
  let notes:ReadonlyArray<readonly [number,number,number]>;
  switch(cue){
    case "departure": notes=[[d,0,.62],[a,.34,.78]];break;
    case "harbor": notes=[[d,0,.85],[a,.51,.96],[e,1.53,1.12]];break;
    case "beacon": notes=[[d,0,.85],[a,.51,.96],[e,1.53,1.12],[d,2.42,1.85]];break;
    case "wind-departure": notes=[[d,0,.62],[fSharp,.32,.57],[highA,.77,1.06]];break;
    case "signal": notes=[[d,0,.62],[fSharp,.32,.57],[highA,.77,1.11],[e,1.74,.76],[d,2.49,1.8]];break;
  }
  const layers:SoundLayer[]=[];
  for(const [frequency,delay,duration] of notes){
    if(wind)layers.push(
      {kind:"tone",frequency:frequency*.992,to:frequency,delay,duration,gain:.093,waveform:"triangle",attack:.1},
      {kind:"tone",frequency:frequency*3.001,delay:delay+.035,duration:duration*.76,gain:.014,attack:.13});
    else layers.push({kind:"tone",frequency,delay,duration,gain:.10,waveform:"triangle",attack:.011},
      {kind:"tone",frequency:frequency*2.003,delay,duration:.20,gain:.021,attack:.006});
  }
  if(cue==="harbor"||cue==="beacon")layers.push({kind:"tone",frequency:d/2,delay:.10,duration:1.8,gain:.05,waveform:"triangle",attack:.36});
  if(cue==="beacon")layers.push(
    {kind:"tone",frequency:a,delay:2.28,duration:2.08,gain:.045,waveform:"triangle",attack:.45},
    {kind:"tone",frequency:369.99,delay:2.55,duration:1.67,gain:.033,attack:.31},
    {kind:"tone",frequency:d*2,delay:2.57,duration:1.30,gain:.027,attack:.04});
  if(cue==="signal")layers.push(
    {kind:"tone",frequency:a,delay:1.74,duration:2.4,gain:.044,waveform:"triangle",attack:.42},
    {kind:"tone",frequency:d/2,delay:2.48,duration:2.30,gain:.059,waveform:"triangle",attack:.23},
    {kind:"tone",frequency:highA*2,delay:2.58,duration:.90,gain:.026,attack:.008});
  return layers;
}

/** Sound is created only after opt-in. Neither effects nor the score advance the court. */
export class HarborAudio {
  private context:AudioContext|null=null;
  private buses:Record<Bus,GainNode>|null=null;
  private levels:Record<Bus,number>={music:1,effects:1};
  private noise:AudioBuffer|null=null;
  private enabled=false;
  private generation=0;
  private sources=new Map<AudioScheduledSourceNode,{bus:Bus;gain:GainNode}>();
  constructor(private readonly createContext:()=>AudioContext=()=>new AudioContext()) {}

  private stopSources(bus?:Bus,fade=false){
    for(const [source,voice] of this.sources)if(!bus||voice.bus===bus){
      if(fade&&this.context?.state==="running"&&typeof voice.gain.gain.cancelAndHoldAtTime==="function"){
        const now=this.context.currentTime;
        voice.gain.gain.cancelAndHoldAtTime(now);
        voice.gain.gain.linearRampToValueAtTime(0,now+.025);
        source.stop(now+.025);
      }else{
        try{source.stop();}catch{/* An ended sound is already silent. */}
        source.disconnect();this.sources.delete(source);
      }
    }
  }
  setMix(music:number,effects:number):void {
    for(const [bus,value] of [["music",music],["effects",effects]] as const){
      if(!Number.isFinite(value))continue;
      const level=Math.min(1,Math.max(0,value));
      this.levels[bus]=level;
      if(level===0)this.stopSources(bus);
      if(this.buses&&this.context)this.buses[bus].gain.setTargetAtTime(busGain[bus]*level*level,this.context.currentTime,.015);
    }
  }
  async setEnabled(enabled:boolean):Promise<void> {
    const generation=++this.generation;this.enabled=false;
    if(!enabled){this.stopSources();if(this.context?.state==="running")await this.context.suspend();return;}
    if(!this.context||this.context.state==="closed") {
      const context=this.createContext();
      try{
        const buses={music:context.createGain(),effects:context.createGain()};
        for(const bus of ["music","effects"] as const){
          buses[bus].gain.value=busGain[bus]*this.levels[bus]**2;
          buses[bus].connect(context.destination);
        }
        this.buses=buses;this.context=context;this.noise=null;
      }catch(error){await context.close();throw error;}
    }
    const context=this.context;
    if(context.state!=="running")await context.resume();
    if(generation===this.generation&&context===this.context&&context.state==="running")this.enabled=true;
  }
  private noiseBuffer(context:AudioContext) {
    if(this.noise)return this.noise;
    const buffer=context.createBuffer(1,Math.ceil(context.sampleRate*.8),context.sampleRate),data=buffer.getChannelData(0);
    let seed=73129;
    for(let i=0;i<data.length;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;data[i]=(seed/4294967296)*2-1;}
    this.noise=buffer;return buffer;
  }
  play(event:CourtEvent,area:Area="beacon"):void {
    this.schedule("effects",soundRecipe(event,area));
  }
  playMusic(cue:MusicCue):void {
    this.stopSources("music",true);
    this.schedule("music",score(cue));
  }
  private schedule(bus:Bus,layers:readonly SoundLayer[]):void {
    const context=this.context,output=this.buses?.[bus];
    if(!this.enabled||!context||!output||!this.levels[bus]||context.state!=="running")return;
    const now=context.currentTime;
    try{for(const layer of layers) {
      const start=now+(layer.delay??0),end=start+layer.duration,gain=context.createGain();
      gain.gain.setValueAtTime(.0001,start);gain.gain.linearRampToValueAtTime(layer.gain,start+(layer.attack??.018));gain.gain.exponentialRampToValueAtTime(.0001,end);gain.connect(output);
      let source:AudioScheduledSourceNode,filter:BiquadFilterNode|undefined;
      if(layer.kind==="tone") {
        const oscillator=context.createOscillator();oscillator.type=layer.waveform??"sine";
        oscillator.frequency.setValueAtTime(layer.frequency,start);if(layer.to)oscillator.frequency.exponentialRampToValueAtTime(layer.to,end);
        oscillator.connect(gain);source=oscillator;
      }else {
        const noise=context.createBufferSource();noise.buffer=this.noiseBuffer(context);filter=context.createBiquadFilter();filter.type=layer.filter??"lowpass";
        filter.frequency.setValueAtTime(layer.frequency,start);filter.Q.value=.7;noise.connect(filter);filter.connect(gain);source=noise;
      }
      this.sources.set(source,{bus,gain});source.onended=()=>{this.sources.delete(source);source.disconnect();filter?.disconnect();gain.disconnect();};
      source.start(start);source.stop(end);
    }}catch{this.enabled=false;this.stopSources();}
  }
  async close():Promise<void> {
    this.generation++;this.enabled=false;this.stopSources();const context=this.context;this.context=null;this.buses=null;this.noise=null;
    if(context&&context.state!=="closed")await context.close();
  }
}
