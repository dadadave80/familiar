import { expect, test } from "bun:test";
import { createApp } from "./app";
import { KeyPair } from "near-api-js";
test("factory funding and daily caps return sanitized stamps copy and 429", async () => {
  for (const code of ["ERR_STAMPS", "ERR_DAILY_BUDGET", "ERR_QUOTA"]) {
    const app = createApp(
      { origins: [], root: "familiar.testnet" },
      {
        guest: async () => {
          throw new Error(
            `RPC execution failed: ${code}; internal details must stay private`,
          );
        },
        relay: async () => ({ hash: "", receiptSentenceKey: "" }),
      },
    );
    const response = await app.request("/v1/guest", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        publicKey: KeyPair.fromRandom("ed25519").getPublicKey().toString(),
      }),
    });
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      code: "QUOTA",
      error: "The Post Office is out of stamps; back in a minute.",
    });
  }
});

test("configured credentials alone never report live readiness", async () => {
  const app = createApp(
    { origins: [], root: "familiar.testnet" },
    {
      ready: async () => false,
      guest: async () => "",
      relay: async () => ({ hash: "", receiptSentenceKey: "" }),
    },
  );
  expect((await app.request("/health")).status).toBe(503);
});

test("unconfigured post office pauses honestly and accepts no guest", async () => {
  const app = createApp({ origins: ["http://localhost:5173"], root: "" });
  expect((await app.request("/health")).status).toBe(503);
  const response = await app.request("/v1/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  expect(response.status).toBe(503);
  expect(await response.text()).toContain("Post Office");
});
test("rejects unapproved origins and malformed public keys before provisioning", async () => {
  let creates = 0;
  const backend = {
    guest: async () => {
      creates++;
      return "p-1.familiar.testnet";
    },
    relay: async () => ({ hash: "unused", receiptSentenceKey: "feed" }),
  };
  const app = createApp(
    { origins: ["https://play.example"], root: "familiar.testnet" },
    backend,
  );
  const denied = await app.request("/v1/guest", {
    method: "POST",
    headers: {
      origin: "https://wrong.example",
      "content-type": "application/json",
    },
    body: "{}",
  });
  expect(denied.status).toBe(403);
  const invalid = await app.request("/v1/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"publicKey":"fake"}',
  });
  expect(invalid.status).toBe(400);
  expect(creates).toBe(0);
});

test("native Auth signing requires the configured browser origin and fails closed when disabled", async () => {
  let calls = 0;
  const backend = {
    guest:async()=>"", relay:async()=>({hash:"",receiptSentenceKey:""}),
    authSign:async (_body:unknown,origin:string)=>{ calls++; return {signature:[1], origin}; },
  };
  const app = createApp({origins:["https://play.example"],root:"familiar.testnet"},backend);
  const request = (origin?:string) => app.request("/v1/auth/sign", {method:"POST",headers:{"content-type":"application/json",...(origin ? {origin}: {})},body:"{}"});
  expect((await request()).status).toBe(403);
  expect((await request("https://wrong.example")).status).toBe(403);
  const accepted = await request("https://play.example");
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toEqual({signature:[1],origin:"https://play.example"});
  expect(calls).toBe(1);
  const disabled = createApp({origins:["https://play.example"],root:"familiar.testnet"},{guest:backend.guest,relay:backend.relay});
  expect((await disabled.request("/v1/auth/sign",{method:"POST",headers:{origin:"https://play.example"},body:"{}"})).status).toBe(503);
});

test("Tidebound mode cannot silently start with legacy principal sponsorship when Auth is missing",()=>{
 const result=Bun.spawnSync({cmd:[process.execPath,"--no-env-file","services/relayer/src/index.ts"],cwd:process.cwd(),env:{...process.env,TIDEBOUND_ENABLED:"true",NEAR_AUTH_CLIENT_ID:""},stdout:"pipe",stderr:"pipe"});
 expect(result.exitCode).not.toBe(0);expect(result.stderr.toString()).toContain("refusing a silent legacy sponsorship fallback");
});
