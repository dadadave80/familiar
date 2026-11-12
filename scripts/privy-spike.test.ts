import { expect, test } from "bun:test";
import { resolve } from "node:path";

test("the sign-only launcher rejects missing or mismatched configuration before opening a server",async()=>{
  for(const [serverId,publicId,secret] of [["","",""],["fixture-app","different-app","fixture-secret"],["fixture-app","fixture-app",""]]) {
    const child=Bun.spawn(["bun","--no-env-file","scripts/privy-spike.ts"],{
      cwd:resolve(import.meta.dir,".."),
      env:{...process.env,PRIVY_APP_ID:serverId,VITE_PRIVY_APP_ID:publicId,PRIVY_APP_SECRET:secret},
      stdout:"pipe",stderr:"pipe",
    });
    const [code,output]=await Promise.all([child.exited,new Response(child.stderr).text()]);
    expect(code).not.toBe(0);
    expect(output).toContain("Set matching Privy App IDs");
    expect(output).not.toContain("fixture-secret");
  }
});
