import { expect, spyOn, test } from "bun:test";
import {
  Account,
  actions,
  base64Encode,
  DelegateAction,
  encodeSignedDelegate,
  JsonRpcProvider,
  KeyPair,
  KeyPairSigner,
  teraToGas,
} from "near-api-js";
import { createBackend } from "./chain";

test("concurrent delivery retries submit once and never share another signed payload", async () => {
  const key = KeyPair.fromRandom("ed25519");
  const root = "familiar.testnet";
  const make = async (senderId: string) => {
    const delegate = new DelegateAction({
      senderId,
      receiverId: root,
      actions: [
        actions.functionCall(
          "act",
          { token_id: `mochi.${root}`, action: { kind: "feed" } },
          teraToGas(250),
          0n,
        ),
      ],
      nonce: 1n,
      maxBlockHeight: 150n,
      publicKey: key.getPublicKey(),
    });
    return base64Encode(
      encodeSignedDelegate(
        (await new KeyPairSigner(key).signDelegateAction(delegate))
          .signedDelegate,
      ),
    );
  };
  let sends = 0;
  const mocks = [
    spyOn(JsonRpcProvider.prototype, "getNetworkId").mockResolvedValue(
      "testnet",
    ),
    spyOn(JsonRpcProvider.prototype, "viewBlock").mockResolvedValue({
      header: { height: 100 },
    } as Awaited<ReturnType<JsonRpcProvider["viewBlock"]>>),
    spyOn(JsonRpcProvider.prototype, "viewAccessKey").mockImplementation(
      async () => {
        await Bun.sleep(20);
        return { nonce: 0n, permission: "FullAccess" } as Awaited<
          ReturnType<JsonRpcProvider["viewAccessKey"]>
        >;
      },
    ),
    spyOn(JsonRpcProvider.prototype, "viewAccount").mockResolvedValue({
      amount: 10n ** 25n,
      storage_usage: 0,
    } as Awaited<ReturnType<JsonRpcProvider["viewAccount"]>>),
    spyOn(Account.prototype, "signAndSendTransaction").mockImplementation(
      async () => {
        sends++;
        return {
          status: { SuccessValue: "" },
          transaction: { hash: "2".repeat(44) },
          receipts_outcome: [
            {
              id: "inner",
              outcome: {
                executor_id: root,
                status: { SuccessValue: btoa("true") },
              },
            },
          ],
        } as Awaited<ReturnType<Account["signAndSendTransaction"]>>;
      },
    ),
  ];
  try {
    const backend = createBackend(
      root,
      `relayer.${root}`,
      key.toString(),
      "https://test.rpc.fastnear.com",
    );
    const encoded = await make(`p-1.${root}`);
    const [a, b] = await Promise.all([
      backend.relay(encoded),
      backend.relay(encoded),
    ]);
    expect(a.hash).toBe(b.hash);
    expect(sends).toBe(1);
    await backend.relay(await make(`p-2.${root}`));
    expect(sends).toBe(2);
  } finally {
    for (const mock of mocks) mock.mockRestore();
  }
});

test("Auth sponsorship verifies compatible stack, Ed25519 derivation and binding; retries sponsor once", async()=>{
  const root="tidebound.testnet", sender=`p-1.${root}`, key=KeyPair.fromRandom("ed25519");
  const {createTransaction,encodeTransaction}=await import("near-api-js");
  const bytes=encodeTransaction(createTransaction(sender,key.getPublicKey(),root,1n,[actions.functionCall("tidebound_commission",{},teraToGas(100),0n)],new Uint8Array(32)));
  const enc=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString("base64url");
  const now=Math.floor(Date.now()/1000),userId="google-oauth2|fixture",origin="https://harbor.example";
  const value={transaction:base64Encode(bytes),response:{user:{userId},publicKey:key.getPublicKey().toString(),signatureRequest:{guardId:"jwt#https://login.testnet.fast-auth.com/",signPayload:[...bytes],verifyPayload:`${enc({alg:"RS256",kid:"fixture"})}.${enc({iss:"https://login.testnet.fast-auth.com/",sub:userId,azp:"fixture-client",aud:"auth0.jwt.fast-auth.testnet",iat:now,exp:now+60,scope:"transaction:sign",fatxn:[...bytes]})}.fixture`}}};
  let sends=0, derivedArgs:unknown,wrongBinding=false;
  const mocks=[
    spyOn(JsonRpcProvider.prototype,"getNetworkId").mockResolvedValue("testnet"),
    spyOn(JsonRpcProvider.prototype,"callFunction").mockImplementation((async (input:{method:string;args:unknown})=>{
      if(input.method==="tidebound_protocol") return {network:"testnet",registry:root,items:`items.${root}`,rules_version:"tidebound_h1_v1",content_version:"first_light_v1"};
      if(input.method==="craft_protocol")return {registry:root};
      if(input.method==="derived_public_key") { derivedArgs=input.args;return key.getPublicKey().toString(); }
      if(input.method==="get_player") return wrongBinding ? `p-2.${root}`:sender;
      throw Error("unexpected method");
    }) as JsonRpcProvider["callFunction"]),
    spyOn(JsonRpcProvider.prototype,"viewAccessKey").mockResolvedValue({nonce:0n,permission:"FullAccess"} as Awaited<ReturnType<JsonRpcProvider["viewAccessKey"]>>),
    spyOn(JsonRpcProvider.prototype,"viewBlock").mockResolvedValue({header:{height:100,hash:"11111111111111111111111111111111"}} as Awaited<ReturnType<JsonRpcProvider["viewBlock"]>>),
    spyOn(JsonRpcProvider.prototype,"experimental_protocolConfig").mockResolvedValue({chain_id:"testnet",transaction_validity_period:86400}),
    spyOn(JsonRpcProvider.prototype,"viewAccount").mockResolvedValue({amount:10n**25n,storage_usage:0} as Awaited<ReturnType<JsonRpcProvider["viewAccount"]>>),
    spyOn(Account.prototype,"callFunction").mockImplementation((async(input:{contractId:string;methodName:string;deposit:bigint})=>{
      expect(input.contractId).toBe("fast-auth.testnet");expect(input.methodName).toBe("sign");expect(input.deposit).toBe(10n**22n);sends++;await Bun.sleep(10);return {signature:[]};
    }) as Account["callFunction"]),
  ];
  try {
    const backend=createBackend(root,`relayer.${root}`,key.toString(),"https://test.rpc.fastnear.com",{items:`items.${root}`,clientId:"fixture-client",origins:[origin]});
    const [a,b]=await Promise.all([backend.authSign!(value,origin),backend.authSign!(value,origin)]);
    expect(a).toEqual(b);expect(sends).toBe(1);
    expect(derivedArgs).toEqual({path:`jwt#https://login.testnet.fast-auth.com/#${userId}`,predecessor:"fast-auth.testnet",domain_id:1});
    wrongBinding=true;
    const other=createBackend(root,`relayer.${root}`,key.toString(),"https://test.rpc.fastnear.com",{items:`items.${root}`,clientId:"fixture-client",origins:[origin]});
    await expect(other.authSign!(value,origin)).rejects.toThrow("ERR_AUTH_BINDING");expect(sends).toBe(1);
  } finally {for(const m of mocks) m.mockRestore();}
});

test("Tidebound sponsor cannot pay a delegated native companion purchase principal",async()=>{
 const key=KeyPair.fromRandom("ed25519"),root="fresh.testnet";
 const delegate=new DelegateAction({senderId:`p-1.${root}`,receiverId:`market.${root}`,actions:[actions.functionCall("buy_pet",{token_id:`mochi.${root}`},teraToGas(250),10n**22n)],nonce:1n,maxBlockHeight:150n,publicKey:key.getPublicKey()});
 const signed=base64Encode(encodeSignedDelegate((await new KeyPairSigner(key).signDelegateAction(delegate)).signedDelegate));
 const mocks=[spyOn(JsonRpcProvider.prototype,"getNetworkId").mockResolvedValue("testnet"),spyOn(JsonRpcProvider.prototype,"viewBlock").mockResolvedValue({header:{height:100,hash:"11111111111111111111111111111111"}} as Awaited<ReturnType<JsonRpcProvider["viewBlock"]>>),
    spyOn(JsonRpcProvider.prototype,"experimental_protocolConfig").mockResolvedValue({chain_id:"testnet",transaction_validity_period:86400})];
 try{const backend=createBackend(root,`relayer.${root}`,key.toString(),"https://test.rpc.fastnear.com",{items:`items.${root}`,clientId:"test",origins:[]});await expect(backend.relay(signed)).rejects.toThrow("ERR_PLAYER_FUNDED_PURCHASE_REQUIRED");}
 finally{for(const m of mocks)m.mockRestore();}
});

test("native Auth sponsorship uses current protocol validity and rejects malformed or mismatched block evidence",async()=>{
 const root="tidebound.testnet",sender=`p-1.${root}`,key=KeyPair.fromRandom("ed25519"),origin="https://harbor.example";
 const {createTransaction,encodeTransaction,baseEncode}=await import("near-api-js");
 const bytes=encodeTransaction(createTransaction(sender,key.getPublicKey(),root,1n,[actions.functionCall("tidebound_commission",{},teraToGas(50),0n)],new Uint8Array(32)));
 const enc=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString("base64url");
 const now=Math.floor(Date.now()/1000),userId="google-oauth2|validity-fixture",blockHash=baseEncode(new Uint8Array(32));
 const value={transaction:base64Encode(bytes),response:{user:{userId},publicKey:key.getPublicKey().toString(),signatureRequest:{guardId:"jwt#https://login.testnet.fast-auth.com/",signPayload:[...bytes],verifyPayload:`${enc({alg:"RS256",kid:"fixture"})}.${enc({iss:"https://login.testnet.fast-auth.com/",sub:userId,azp:"fixture-client",aud:"auth0.jwt.fast-auth.testnet",iat:now,exp:now+60,scope:"transaction:sign",fatxn:[...bytes]})}.fixture`}}};
 let sends=0,finalHeight=250,originalHeight=100,validity:unknown=1000,returnedHash=blockHash,protocolNetwork="testnet";
 const mocks=[
  spyOn(JsonRpcProvider.prototype,"getNetworkId").mockResolvedValue("testnet"),
  spyOn(JsonRpcProvider.prototype,"callFunction").mockImplementation((async(input:{method:string})=>{
   if(input.method==="tidebound_protocol")return{network:"testnet",registry:root,items:`items.${root}`,rules_version:"tidebound_h1_v1",content_version:"first_light_v1"};
   if(input.method==="craft_protocol")return{registry:root};
   if(input.method==="derived_public_key")return key.getPublicKey().toString();
   if(input.method==="get_player")return sender;
   throw Error("unexpected method");
  }) as JsonRpcProvider["callFunction"]),
  spyOn(JsonRpcProvider.prototype,"viewAccessKey").mockResolvedValue({nonce:0n,permission:"FullAccess"} as Awaited<ReturnType<JsonRpcProvider["viewAccessKey"]>>),
  spyOn(JsonRpcProvider.prototype,"viewBlock").mockImplementation((async(input:{blockId?:string})=>({header:{height:input.blockId ? originalHeight:finalHeight,hash:input.blockId ? returnedHash:blockHash}})) as JsonRpcProvider["viewBlock"]),
  spyOn(JsonRpcProvider.prototype,"experimental_protocolConfig").mockImplementation(async()=>({chain_id:protocolNetwork,transaction_validity_period:validity}) as Awaited<ReturnType<JsonRpcProvider["experimental_protocolConfig"]>>),
  spyOn(JsonRpcProvider.prototype,"viewAccount").mockResolvedValue({amount:10n**25n,storage_usage:0} as Awaited<ReturnType<JsonRpcProvider["viewAccount"]>>),
  spyOn(Account.prototype,"callFunction").mockImplementation((async()=>{sends++;return{signature:[]};}) as Account["callFunction"]),
 ];
 const backend=()=>createBackend(root,`relayer.${root}`,key.toString(),"https://test.rpc.fastnear.com",{items:`items.${root}`,clientId:"fixture-client",origins:[origin]});
 try {
  await backend().authSign!(value,origin);expect(sends).toBe(1);
  finalHeight=1100;await backend().authSign!(value,origin);expect(sends).toBe(2);
  for(const wrong of ["expired","future","missing-period","zero-period","fraction-period","unsafe-period","string-period","protocol-network","block-hash"]){
   finalHeight=250;originalHeight=100;validity=1000;protocolNetwork="testnet";returnedHash=blockHash;
   if(wrong==="expired")finalHeight=1101;
   if(wrong==="future")originalHeight=251;
   if(wrong==="missing-period")validity=undefined;
   if(wrong==="zero-period")validity=0;
   if(wrong==="fraction-period")validity=0.5;
   if(wrong==="unsafe-period")validity=Number.MAX_SAFE_INTEGER+1;
   if(wrong==="string-period")validity="1000";
   if(wrong==="protocol-network")protocolNetwork="mainnet";
   if(wrong==="block-hash")returnedHash=baseEncode(new Uint8Array(32).fill(1));
   await expect(backend().authSign!(value,origin)).rejects.toThrow();expect(sends).toBe(2);
  }
 } finally{for(const m of mocks)m.mockRestore();}
});
