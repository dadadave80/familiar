import type { MochiPoseName } from "../motion/mochi";

export type Attention = "left"|"right"|"rest"|"water"|"player";

/** Small pose holds around planted feet. Curiosity never advances the tide. */
export function companionIdle(elapsed:number,attention:Attention,reduced:boolean):{pose:MochiPoseName;breath:number} {
  const resting=attention==="rest",base=resting?"relieved":"neutral";
  if(reduced)return {pose:resting?base:attention==="left"?"turn-left":attention==="right"?"look-right":attention==="water"?"brace":"curious",breath:1};
  const t=Math.max(0,elapsed)%9200;
  let pose:MochiPoseName=base;
  if(t>=1700&&t<3000)pose=attention==="left"?"turn-left":attention==="right"?"look-right":attention==="water"?"brace":resting?"relieved":"curious";
  else if(t>=4900&&t<5650)pose="curious";
  else if(t>=5650&&t<6500)pose=resting?"relieved":attention==="left"?"turn-left":attention==="right"?"look-right":"neutral";
  const held=Math.floor(t*12/1000)/12;
  return {pose,breath:1+.005*(1-Math.cos(held*Math.PI*2/3.25))/2};
}
