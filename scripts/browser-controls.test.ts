import { expect, test } from "bun:test";
import type { Page } from "@playwright/test";
import { guide } from "./browser-controls";

test("keyboard guidance waits for the new playfield before its first command",async()=>{
  const calls:string[]=[];
  let ready!:()=>void;
  const opening=new Promise<void>(resolve=>{ready=resolve;});
  const game={last:()=>game,locator:()=>({waitFor:async()=>{await opening;}}),focus:async()=>{calls.push("focus");}};
  const page={locator:()=>game,keyboard:{press:async(key:string)=>{calls.push(key);}}} as unknown as Page;
  const command=guide(page,"north");
  await Promise.resolve();
  expect(calls).toEqual([]);
  ready();await command;
  expect(calls).toEqual(["focus","ArrowUp"]);
});
