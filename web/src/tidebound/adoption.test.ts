import { expect,test } from "bun:test";
import {preservePreview} from "./adoption";
test("remote selection preserves finished previews and never replaces a different conflict backup",()=>{
 const data=new Map<string,string>([["save","first finished lantern"],["save:conflict:4:0","earlier active outing"]]);
 const store={getItem:(k:string)=>data.get(k)??null,setItem:(k:string,v:string)=>{data.set(k,v)}};
 preservePreview(store,"save",4);expect(data.get("save:conflict:4:0")).toBe("earlier active outing");expect(data.get("save:conflict:4:1")).toBe("first finished lantern");
 preservePreview(store,"save",4);expect(data.size).toBe(3);
 data.set("save","a different finished preview");preservePreview(store,"save",4);expect(data.get("save:conflict:4:2")).toBe("a different finished preview");
});
test("failed backup prevents remote replacement",()=>{
 const store={getItem:(key:string)=>key==="save"?"existing":null,setItem:()=>{throw Error("quota")}};
 expect(()=>preservePreview(store,"save",1)).toThrow();
});
