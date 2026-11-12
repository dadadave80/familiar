import {expect,test} from "bun:test";
import {compatibleBudget} from "./tidebound-preflight";
test("compatible preflight accounts for every artifact and 10x pet publication, never missing builds",()=>{
 expect(compatibleBudget({root:100,pet:200,items:300,bakery:400,market:500})).toBe(3300n*10n**19n+12n*10n**24n);
 expect(()=>compatibleBudget({root:100,pet:0,items:300,bakery:400,market:500})).toThrow();
});
