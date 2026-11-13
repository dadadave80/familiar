import type { CourtEvent } from "./types";

export interface SoundLayer {
  kind:"tone"|"noise";frequency:number;gain:number;duration:number;delay?:number;to?:number;
  waveform?:OscillatorType;filter?:BiquadFilterType;
}
export function soundRecipe(event:CourtEvent):readonly SoundLayer[] {
  switch(event.kind) {
    case "move":return [0,.13].map(delay=>({kind:"noise",frequency:650,gain:.035,duration:.085,delay,filter:"bandpass"}));
    case "telegraph":return [{kind:"tone",frequency:110,to:90,gain:.025,duration:.2,waveform:"sine"}];
    case "rotate":return [{kind:"noise",frequency:410,gain:.035,duration:.16,filter:"bandpass"},{kind:"tone",frequency:196,to:160,gain:.012,duration:.1,waveform:"triangle"}];
    case "redirect":return [{kind:"noise",frequency:1800,gain:.025,duration:.25,filter:"highpass"},{kind:"tone",frequency:330,to:660,gain:.02,duration:.24}];
    case "wave":return [{kind:"noise",frequency:1000,gain:.085,duration:.65,filter:"lowpass"},{kind:"noise",frequency:2300,gain:.02,duration:.45,delay:.1,filter:"highpass"}];
    case "bridge":return [{kind:"noise",frequency:320,gain:.025,duration:.19,filter:"bandpass"},{kind:"tone",frequency:155,to:120,gain:.012,duration:.12,waveform:"triangle"}];
    case "open":return [{kind:"tone",frequency:659.25,gain:.035,duration:.3},{kind:"tone",frequency:880,gain:.025,duration:.27,delay:.07}];
    case "hit":return [{kind:"noise",frequency:220,gain:.045,duration:.17,filter:"bandpass"},{kind:"noise",frequency:900,gain:.025,duration:.22,filter:"lowpass"}];
    case "pickup":return [
      ...(event.rope?[{kind:"noise" as const,frequency:1600,gain:.025,duration:.2,filter:"bandpass" as const}]:[]),
      {kind:"tone",frequency:event.item==="moth"?1174.66:880,gain:.035,duration:.36,delay:event.rope?.1:0},
      {kind:"tone",frequency:event.item==="moth"?1567.98:1174.66,gain:.025,duration:.3,delay:.1},
    ];
    case "return":return [587.33,739.99,880].map((frequency,index)=>({kind:"tone",frequency,gain:.03,duration:.42,delay:index*.09}));
    case "rescue":return [440,369.99,293.66].map((frequency,index)=>({kind:"tone",frequency,gain:.025,duration:.3,delay:index*.1}));
  }
}

/** Opt-in foley only: no audio context, device request or sound before the player's gesture. */
export class HarborAudio {
  private context:AudioContext|null=null;
  private master:GainNode|null=null;
  private noise:AudioBuffer|null=null;
  private enabled=false;
  private generation=0;
  private sources=new Set<AudioScheduledSourceNode>();
  constructor(private readonly createContext:()=>AudioContext=()=>new AudioContext()) {}

  private stopSources(){for(const source of this.sources){try{source.stop();}catch{/* An ended sound is already silent. */}source.disconnect();}this.sources.clear();}
  async setEnabled(enabled:boolean):Promise<void> {
    const generation=++this.generation;this.enabled=false;
    if(!enabled){this.stopSources();if(this.context?.state==="running")await this.context.suspend();return;}
    if(!this.context||this.context.state==="closed") {
      this.context=this.createContext();this.master=this.context.createGain();this.master.gain.value=.3;this.master.connect(this.context.destination);this.noise=null;
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
  play(event:CourtEvent):void {
    const context=this.context,master=this.master;if(!this.enabled||!context||!master||context.state!=="running")return;
    try{for(const layer of soundRecipe(event)) {
      const start=context.currentTime+(layer.delay??0),end=start+layer.duration,gain=context.createGain();
      gain.gain.setValueAtTime(.0001,start);gain.gain.linearRampToValueAtTime(layer.gain,start+.018);gain.gain.exponentialRampToValueAtTime(.0001,end);gain.connect(master);
      let source:AudioScheduledSourceNode,filter:BiquadFilterNode|undefined;
      if(layer.kind==="tone") {
        const oscillator=context.createOscillator();oscillator.type=layer.waveform??"sine";
        oscillator.frequency.setValueAtTime(layer.frequency,start);if(layer.to)oscillator.frequency.exponentialRampToValueAtTime(layer.to,end);
        oscillator.connect(gain);source=oscillator;
      }else {
        const noise=context.createBufferSource();noise.buffer=this.noiseBuffer(context);filter=context.createBiquadFilter();filter.type=layer.filter??"lowpass";
        filter.frequency.setValueAtTime(layer.frequency,start);filter.Q.value=.7;noise.connect(filter);filter.connect(gain);source=noise;
      }
      this.sources.add(source);source.onended=()=>{this.sources.delete(source);source.disconnect();filter?.disconnect();gain.disconnect();};
      source.start(start);source.stop(end);
    }}catch{this.enabled=false;this.stopSources();}
  }
  async close():Promise<void> {
    this.generation++;this.enabled=false;this.stopSources();const context=this.context;this.context=null;this.master=null;this.noise=null;
    if(context&&context.state!=="closed")await context.close();
  }
}
