import {expect,test} from "bun:test";
import {assertTideboundContent,supportsTideboundContent} from "./protocol";
const root="familiar-game.testnet",primary={registry:root,network:"testnet",rules_version:"tidebound_h1_v1",content_version:"first_light_v1"};
const p={...primary,items:`items.${root}`},v2={supported_content_versions:["first_light_v1","first_light_v2"]};
test("v1 remains compatible without a capability list; v2 requires both exact compatible contracts",()=>{
 expect(supportsTideboundContent(root,p,primary,"first_light_v1")).toBe(true);
 expect(supportsTideboundContent(root,{...p,...v2},{...primary,...v2},"first_light_v2")).toBe(true);
 for(const [a,b] of [[p,primary],[{...p,...v2},primary],[p,{...primary,...v2}],[{...p,...v2},{...primary,...v2,network:"mainnet"}],[{...p,...v2},{...primary,supported_content_versions:["first_light_v2"]}]])expect(()=>assertTideboundContent(root,a,b,"first_light_v2")).toThrow();
});
