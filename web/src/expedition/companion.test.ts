import {expect,test} from "bun:test";
import {companionIdle,type Attention} from "./companion";

test("Mochi's idle attention holds readable poses and reduced motion stays still",()=>{
  expect(companionIdle(2000,"left",false).pose).toBe("turn-left");
  expect(companionIdle(2000,"right",false).pose).toBe("look-right");
  expect(companionIdle(2000,"water",false).pose).toBe("brace");
  expect(companionIdle(100,"rest",false).pose).toBe("relieved");
  for(const attention of ["left","right","rest","water","player"] satisfies Attention[]){
    const still=companionIdle(0,attention,true);
    for(const t of [100,2000,5300,9300,60000]){
      expect(companionIdle(t,attention,true)).toEqual(still);
      const moving=companionIdle(t,attention,false);
      expect(moving.breath).toBeGreaterThanOrEqual(1);
      expect(moving.breath).toBeLessThanOrEqual(1.005);
    }
    expect(companionIdle(2000,attention,false)).toEqual(companionIdle(11200,attention,false));
  }
});
