import { expect, spyOn, test } from "bun:test";
import { JsonRpcProvider, KeyPair } from "near-api-js";
import { createRecoverableAccountConnection } from "./client";
import type { AccountSession, NearAuthAdapterOptions } from "./adapter";

test("Near Auth connection verifies every root/items protocol field before its player provisioning HTTP request",async()=>{
  const root="fresh.testnet",account=`mochi.${root}`,key=KeyPair.fromRandom("ed25519"),data=new Map<string,string>();
  const previousLocation=Object.getOwnPropertyDescriptor(globalThis,"location"),previousStorage=Object.getOwnPropertyDescriptor(globalThis,"localStorage");
  Object.defineProperty(globalThis,"location",{configurable:true,value:{origin:"https://harbor.example"}});
  Object.defineProperty(globalThis,"localStorage",{configurable:true,value:{getItem:(name:string)=>data.get(name)??null,setItem:(name:string,value:string)=>{data.set(name,value)}}});
  let rootProtocol:Record<string,unknown>={registry:root,items:`items.${root}`,network:"testnet",rules_version:"tidebound_h1_v1",content_version:"first_light_v1"};
  let itemProtocol:Record<string,unknown>={registry:root,network:"testnet",rules_version:"tidebound_h1_v1",content_version:"first_light_v1"};
  let network="testnet",posts=0,registered=false;
  const mocks=[
    spyOn(JsonRpcProvider.prototype,"getNetworkId").mockImplementation(async()=>network),
    spyOn(JsonRpcProvider.prototype,"callFunction").mockImplementation((async({method}:{method:string})=>{
      if(method==="get_player")return registered?account:null;
      if(method==="tidebound_protocol")return rootProtocol;
      if(method==="craft_protocol")return itemProtocol;
      throw Error("Unexpected synthetic protocol view");
    }) as JsonRpcProvider["callFunction"]),
    spyOn(JsonRpcProvider.prototype,"viewAccessKey").mockResolvedValue({permission:"FullAccess",nonce:0n} as Awaited<ReturnType<JsonRpcProvider["viewAccessKey"]>>),
    spyOn(globalThis,"fetch").mockImplementation(Object.assign(async(input:Parameters<typeof fetch>[0],init?:Parameters<typeof fetch>[1])=>{
      expect(String(input)).toBe("https://post.example/v1/guest");expect(init?.method).toBe("POST");
      expect(JSON.parse(String(init?.body))).toEqual({publicKey:key.getPublicKey().toString(),username:"mochi"});posts++;registered=true;
      return Response.json({accountId:account,root,network:"testnet"});
    },{preconnect:globalThis.fetch.preconnect})),
  ];
  try {
    const connection=createRecoverableAccountConnection({root,items:`items.${root}`,rpcUrl:"https://rpc.invalid",relayerUrl:"https://post.example",clientId:"fixture-configured",approvedOrigin:"https://harbor.example"})!;
    // Seed only the session boundary; actual factory provisioning and canonical protocol guards execute. No OAuth is performed.
    const options=Reflect.get(connection.adapter,"options") as NearAuthAdapterOptions;
    options.openSession=async()=>({userId:"google-oauth2|fixture",publicKey:key.getPublicKey().toString(),clientId:"fixture-configured",async endSession(){},async requestSignature(){throw Error("No signing in protocol test")},signatureBytes(){throw Error("No signing in protocol test")}} satisfies AccountSession);
    await connection.adapter.authenticate();
    const originalRoot={...rootProtocol},originalItems={...itemProtocol};
    for(const source of ["root","items"] as const){
      for(const field of source==="root"?["registry","items","network","rules_version","content_version"]:["registry","network","rules_version","content_version"]){
        for(const value of [undefined,"wrong"]){
          rootProtocol={...originalRoot};itemProtocol={...originalItems};(source==="root"?rootProtocol:itemProtocol)[field]=value;
          await expect(connection.adapter.provisionAccount("mochi")).rejects.toThrow("No player was created");expect(posts).toBe(0);
        }
      }
    }
    rootProtocol={...originalRoot};itemProtocol={...originalItems};network="mainnet";
    await expect(connection.adapter.provisionAccount("mochi")).rejects.toThrow("testnet");expect(posts).toBe(0);network="testnet";
    expect((await connection.adapter.provisionAccount("mochi")).nearAccountId).toBe(account);expect(posts).toBe(1);
  }finally{
    for(const mock of mocks)mock.mockRestore();
    if(previousLocation)Object.defineProperty(globalThis,"location",previousLocation);else Reflect.deleteProperty(globalThis,"location");
    if(previousStorage)Object.defineProperty(globalThis,"localStorage",previousStorage);else Reflect.deleteProperty(globalThis,"localStorage");
  }
});
