import {expect,test} from "bun:test";
import {readFileSync} from "node:fs";
import {adminRecord,keyRecord,loadRecords,refereeRecord,selfRecord,SIGNER_ACTIONS,type HarborRecord,type Read} from "./records";

// Shapes captured from https://test.rpc.fastnear.com (finality final) on 2026-11-13.
const root="familiar-game.testnet",pet=`qa-mochi-h1.${root}`,player=`qa-maker-h1.${root}`,items=`items.${root}`;
const pinned="CQQ63d8dNsM8oVCeEsU57USX212396zFmhtnqjgeXi1J";
const signer="ed25519:2DP5Amx7h1JJ17P2B1VvwHMYf9adeuKuitqEEqWsRXt5";
const account={amount:"300000000000000000000000",block_hash:"EAcU",block_height:277567587,code_hash:"11111111111111111111111111111111",global_contract_hash:pinned,locked:"0",storage_paid_at:0,storage_usage:397};
const noKeys={block_hash:"38XB",block_height:277567588,keys:[]};
const full=(public_key:string)=>({access_key:{nonce:1,permission:"FullAccess"},public_key});
const playerKeys={block_hash:"38XB",block_height:1,keys:[full(signer),full("ed25519:Di7QPiWUz21DnQucab8pe6qYPAnWpZnQWXYPfwa8kn3S")]};
const adminKeys={block_hash:"38XB",block_height:1,keys:[full("ed25519:9gqucqLaUsuGCLoK9HFDthu5nDXXZmzASyE6rZa6QNw")]};
const config={relayer:`relayer.${root}`,pet_code_hash:pinned,items};
const token={token_id:pet,owner_id:player,metadata:{title:pet},approved_account_ids:{}};
const claim=(id:string)=>({operation_id:"op",id,input_hash:"0a35",lens:true,moth:false,rules_version:"tidebound_h1_v1",content_version:"first_light_v1"});
const journey={revision:11,shells:0,burned_shells:12,commission_fulfilled:true,claims:[claim("8c5cbc6a02e6a0878b90723334c9e2e682e690a76758922ee445225a560072e5"),claim("be6ec9d4bde579ad041995d9a5a17d3473b77fd24c9866535cf1ed5a7fdf5c39")]};
const protocol={network:"testnet",rules_version:"tidebound_h1_v1",content_version:"first_light_v1",items,registry:root};
const ok=<T,>(value:T):Read=>({ok:true,value}),fail:Read={ok:false};
const texts=(r:HarborRecord)=>r.lines.map(l=>l.text);
const states=(r:HarborRecord)=>r.lines.map(l=>l.state);
const self=(over:Partial<Parameters<typeof selfRecord>[0]>={})=>selfRecord({root,player,pet,account:ok(account),keys:ok(noKeys),token:ok(token),config:ok(config),...over});

test("Mochi's papers state each live read",()=>{
  const r=self();
  expect(states(r)).toEqual(["read","read","read","read"]);
  expect(texts(r)).toEqual([
    `Mochi’s own account is ${pet}.`,
    `The harbor register lists you, ${player}, as Mochi’s keeper.`,
    "No keys: no one, not you and not Familiar, can sign as Mochi’s account.",
    "Runs the shared Mochi code the harbor pins; Mochi’s account carries no separate code.",
  ]);
  expect(r.lines[3]!.detail).toBe(`Shared code CQQ63d…Xi1J · pinned by ${root}`);
});

test("Mochi's papers never claim success without the read",()=>{
  const r=self({account:fail,keys:fail,token:fail,config:fail});
  expect(states(r)).toEqual(["unchecked","unchecked","unchecked","unchecked"]);
  expect(texts(r).join(" ")).not.toMatch(/No keys|pins;|lists you/);
  // A missing keys field is not zero keys.
  expect(self({keys:ok({block_hash:"x"})}).lines[2]!.state).toBe("unchecked");
  // Config failure: the code is reported, the pin comparison is not.
  const noPin=self({config:fail}).lines[3]!;
  expect(noPin.state).toBe("unchecked");expect(noPin.text).toContain("couldn’t be checked");
});

test("Mochi's papers report findings as findings",()=>{
  expect(self({token:ok(null)}).lines[1]).toEqual({state:"finding",text:`The harbor register has no papers for ${pet}.`});
  expect(self({token:ok({...token,owner_id:`bob.${root}`})}).lines[1]!.text).toBe(`The harbor register lists bob.${root} as Mochi’s keeper, not ${player}.`);
  expect(self({token:ok({...token,token_id:`other.${root}`})}).lines[1]!.state).toBe("unchecked");
  expect(self({keys:ok(playerKeys)}).lines[2]).toMatchObject({state:"finding",text:"Mochi’s account has 2 keys, so it is not keyless."});
  expect(self({account:ok({...account,global_contract_hash:"Other1111111111111111111111"})}).lines[3]!.state).toBe("finding");
  expect(self({account:ok({...account,code_hash:"Own1111111111111111111111111111"})}).lines[3]!.text).toContain("separate code");
});

test("key line reports the permission exactly and never claims a function-call key",()=>{
  const r=keyRecord({player,signerKey:signer,provider:"privy",keys:ok(playerKeys)});
  expect(texts(r).slice(0,3)).toEqual([
    "Your harbor key lives in your Privy wallet.",
    "This sign-in’s key: FullAccess: full control of the account.",
    "Another key: FullAccess: full control of the account.",
  ]);
  expect(r.lines[1]!.detail).toBe("ed25519:2DP5Amx7…");
  expect(texts(r).join(" ")).not.toMatch(/FunctionCall/);
  expect(r.lines.at(-1)).toMatchObject({state:"source"});
  expect(r.lines.at(-1)!.text).toContain("the chain enforces only the key permission above");
  const fc=keyRecord({player,signerKey:signer,provider:"other",keys:ok({keys:[{public_key:signer,access_key:{nonce:1,permission:{FunctionCall:{receiver_id:root,method_names:["adopt"],allowance:null}}}}]})});
  expect(texts(fc).slice(0,2)).toEqual(["The key this sign-in uses is on your account.",`This sign-in’s key: FunctionCall: only ${root}, adopt.`]);
});

test("key line without the read or without the sign-in key says so",()=>{
  const failed=keyRecord({player,signerKey:signer,provider:"privy",keys:fail});
  expect(states(failed)).toEqual(["unchecked","source"]);
  expect(failed.lines[1]!.text).toEndWith("the chain enforces only your key’s permission, which couldn’t be checked just now.");
  expect(texts(failed).join(" ")).not.toContain("Privy wallet");
  const missing=keyRecord({player,signerKey:"ed25519:Elsewhere",provider:"privy",keys:ok(playerKeys)});
  expect(missing.lines[0]).toEqual({state:"finding",text:"The key this sign-in uses isn’t on your account right now."});
  expect(keyRecord({player,signerKey:signer,provider:"privy",keys:ok({keys:[{public_key:signer,access_key:{permission:"Weird"}}]})}).lines[0]!.state).toBe("unchecked");
});

test("signer allowlist matches every method the signer accepts",()=>{
  const source=readFileSync(new URL("../../../services/relayer/src/auth/sign.ts",import.meta.url),"utf8");
  const body=source.slice(source.indexOf("export function validateNativeIntent"),source.indexOf("export function validateSigningRequest"));
  const accepted=new Set([...body.matchAll(/case "([a-z_]+)"/g),...body.matchAll(/methodName==="([a-z_]+)"/g)].map(m=>m[1]!));
  accepted.add("transfer");
  expect(new Set(SIGNER_ACTIONS.map(a=>a.method))).toEqual(accepted);
});

test("Tidekeeper's stamp says what the contract checks",()=>{
  const r=refereeRecord({journey:ok(journey),protocol:ok(protocol)});
  expect(texts(r)).toEqual([
    "The harbor replayed your steps and agreed they bring Mochi home.",
    "Accepted return 8c5cbc…72e5","Accepted return be6ec9…5c39",
    "Shells: 0 held, 12 spent.","Bram’s workshop commission is fulfilled.",
    "The harbor currently plays rules tidebound_h1_v1, content first_light_v1.",
  ]);
  expect(r.lines[1]!.detail).toBe("Rules tidebound_h1_v1 · content first_light_v1");
  expect(texts(r).join(" ")).not.toMatch(/human|person|you played|proves/i);
});

test("Tidekeeper's stamp without claims or reads",()=>{
  const empty=refereeRecord({journey:ok({...journey,claims:[],shells:0,burned_shells:0,commission_fulfilled:false}),protocol:fail});
  expect(texts(empty)).not.toContain("The harbor replayed your steps and agreed they bring Mochi home.");
  expect(empty.lines.at(-1)!.state).toBe("unchecked");
  const failed=refereeRecord({journey:fail,protocol:fail});
  expect(states(failed)).toEqual(["unchecked","unchecked","unchecked","unchecked"]);
  // The real Journey parser lacks claims; a journey without them must not read as zero returns.
  expect(refereeRecord({journey:ok({...journey,claims:undefined}),protocol:ok(protocol)}).lines[0]!.state).toBe("unchecked");
});

test("admin disclosure reads both keys and says full-access only when reported",()=>{
  const r=adminRecord({root,items,rootKeys:ok(adminKeys),itemsKeys:ok(adminKeys)});
  expect(texts(r)).toEqual([
    "Root and Items still have full-access admin keys on testnet, so the whole harbor is not immutable: their code can still be changed.",
    `${root} still has 1 full-access admin key.`,`${items} still has 1 full-access admin key.`,
  ]);
  const partial=adminRecord({root,items,rootKeys:ok(adminKeys),itemsKeys:fail});
  expect(texts(partial)[0]).toBe("Part of the harbor still has a full-access admin key on testnet, so it is not immutable.");
  expect(partial.lines[2]!.state).toBe("unchecked");
  expect(states(adminRecord({root,items,rootKeys:fail,itemsKeys:fail}))).toEqual(["unchecked","unchecked"]);
  expect(texts(adminRecord({root,items,rootKeys:ok(noKeys),itemsKeys:ok(noKeys)}))).toEqual([`${root} has no full-access keys.`,`${items} has no full-access keys.`]);
});

const encode=(v:unknown)=>[...new TextEncoder().encode(JSON.stringify(v))];
function chain(override:(body:{params:Record<string,string>})=>unknown|undefined=()=>undefined){
  const calls:string[]=[];
  const fetcher=async(_url:string,init:{body:string})=>{
    const body=JSON.parse(init.body) as {params:Record<string,string>};calls.push(`${body.params.request_type}:${body.params.account_id}:${body.params.method_name??""}`);
    expect(body.params.finality).toBe("final");
    const custom=override(body);if(custom!==undefined)return custom as {ok:boolean;json():Promise<unknown>};
    const p=body.params,args=p.args_base64?JSON.parse(atob(p.args_base64)):null;
    let result:unknown;
    if(p.request_type==="view_account")result=account;
    else if(p.request_type==="view_access_key_list")result=p.account_id===pet?noKeys:p.account_id===player?playerKeys:adminKeys;
    else result={block_hash:"x",logs:[],result:encode(({get_config:config,nft_token:args?.token_id===pet?token:null,tidebound_journey:journey,tidebound_protocol:protocol} as Record<string,unknown>)[p.method_name!])};
    return {ok:true,json:async()=>({jsonrpc:"2.0",id:"x",result})};
  };
  return {calls,fetcher};
}
const target={rpcUrl:"https://rpc.test",root,player,pet,signerKey:signer,provider:"privy" as const};

test("loadRecords reads each fact from its own account",async()=>{
  const {calls,fetcher}=chain();
  const records=await loadRecords(target,fetcher);
  expect(records.map(r=>r.kind)).toEqual(["self","key","referee","admin"]);
  expect(records.flatMap(r=>r.lines).filter(l=>l.state==="unchecked")).toEqual([]);
  expect(calls.sort()).toEqual([
    `call_function:${root}:get_config`,`call_function:${root}:nft_token`,`call_function:${root}:tidebound_journey`,`call_function:${root}:tidebound_protocol`,
    `view_access_key_list:${root}:`,`view_access_key_list:${items}:`,`view_access_key_list:${player}:`,`view_access_key_list:${pet}:`,`view_account:${pet}:`,
  ]);
});

test("loadRecords isolates each failure shape to its own line",async()=>{
  const {fetcher}=chain(({params})=>{
    if(params.request_type==="view_account")return {ok:true,json:async()=>({jsonrpc:"2.0",error:{name:"HANDLER_ERROR",cause:{name:"UNKNOWN_ACCOUNT"}}})};
    if(params.method_name==="tidebound_journey")return {ok:true,json:async()=>({jsonrpc:"2.0",result:{error:"wasm execution failed with error: MethodResolveError(MethodNotFound)",logs:[]}})};
    if(params.account_id===player)return {ok:false,json:async()=>{throw Error("502");}};
    if(params.account_id===items)return {ok:true,json:async()=>{throw SyntaxError("not json");}};
    if(params.method_name==="get_config")return Promise.reject(Error("offline"));
    return undefined;
  });
  const [s,k,r,a]=await loadRecords(target,fetcher);
  expect(states(s!)).toEqual(["unchecked","read","read","unchecked"]);
  expect(states(k!)).toEqual(["unchecked","source"]);
  expect(states(r!)).toEqual(["unchecked","unchecked","unchecked","read"]);
  expect(texts(a!)[0]).toBe("Part of the harbor still has a full-access admin key on testnet, so it is not immutable.");
  expect(a!.lines[2]!.state).toBe("unchecked");
});
