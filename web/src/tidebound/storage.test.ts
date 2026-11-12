import { expect, test } from "bun:test";
import { ITEM_STORAGE_CAP, ITEM_STORAGE_TARGET, quoteItemStorage, storageNear } from "./storage";

const bounds={min:"0",max:null};
test("zero-min registration is not transferable storage credit",()=>{
  for(const balance of [null,{total:"0",available:"0"}]) {
    expect(quoteItemStorage(bounds,balance)).toEqual({available:0n,target:ITEM_STORAGE_TARGET,deposit:ITEM_STORAGE_TARGET,ready:false});
  }
  expect(storageNear(ITEM_STORAGE_TARGET)).toBe("0.02");
});
test("only the available-credit deficit is funded, including already registered recipients",()=>{
  expect(quoteItemStorage(bounds,{total:String(3n*10n**22n),available:String(10n**22n)}).deposit).toBe(10n**22n);
  expect(quoteItemStorage(bounds,{total:String(ITEM_STORAGE_CAP),available:String(ITEM_STORAGE_TARGET)}).ready).toBe(true);
  expect(quoteItemStorage({min:String(3n*10n**22n),max:null},null).deposit).toBe(3n*10n**22n);
});
test("malformed balances, insufficient finite bounds and deposits above the existing cap fail closed",()=>{
  for(const bad of [{min:"00",max:null},{min:"-1",max:null},{min:"0",max:"1"},{min:String(ITEM_STORAGE_CAP+1n),max:null},{min:"2",max:"1"}])expect(()=>quoteItemStorage(bad,null)).toThrow();
  for(const bad of [{total:"0",available:"1"},{total:"1",available:"01"},{total:"1"},{total:"x",available:"0"},{total:String(1n<<128n),available:"0"}])expect(()=>quoteItemStorage(bounds,bad)).toThrow();
  expect(()=>quoteItemStorage({min:"0",max:String(ITEM_STORAGE_TARGET)},{total:String(ITEM_STORAGE_TARGET),available:"0"})).toThrow();
});
