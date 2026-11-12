import { dirname, isAbsolute } from "node:path";
import { createHash } from "node:crypto";
import { baseEncode, JsonRpcProvider } from "near-api-js";
import legacy from "../docs/TESTNET-DEPLOYMENT.json";
const names=["root","pet","items","bakery","market"] as const;
const byteCost=10n**19n;
export function compatibleBudget(sizes:Record<typeof names[number],number>) {
  if(names.some(name=>!Number.isSafeInteger(sizes[name]) || sizes[name]<=0))throw Error("Build every compatible contract first.");
  // Conservative review allowance: 10x global publication storage, operating funds, and gas.
  return BigInt(names.reduce((n,name)=>n+sizes[name],sizes.pet*9))*byteCost+12n*10n**24n;
}
if(import.meta.main) {
  const output=process.argv.find(a=>a.startsWith("--output="))?.slice(9);
  if(!output || !isAbsolute(output))throw Error("Pass an absolute --output path outside Git under your specifications directory.");
  const destination=Bun.spawnSync({cmd:["git","-C",dirname(output),"rev-parse","--is-inside-work-tree"],stdout:"pipe",stderr:"pipe"});
  if(destination.exitCode!==128 || !destination.stderr.toString().includes("not a git repository"))throw Error("The deployment candidate must be stored outside a Git worktree.");
  const root=process.argv.find(a=>a.startsWith("--root="))?.slice(7);
  if(!root || root.length>39 || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.testnet$/.test(root) || root===legacy.root)throw Error("Pass --root=<new-isolated-name>.testnet; the legacy root is forbidden. This command never signs.");
  const provider=new JsonRpcProvider({url:"https://test.rpc.fastnear.com"});
  if(await provider.getNetworkId()!=="testnet")throw Error("Refusing a different network.");
  const contracts=await Promise.all(names.map(async name=>{
    const bytes=await Bun.file(`contracts/target/deploy/familiar_${name}.wasm`).arrayBuffer();
    return {name,account:name==="root"?root:name==="pet"?null:`${name}.${root}`,bytes:bytes.byteLength,codeHash:baseEncode(createHash("sha256").update(new Uint8Array(bytes)).digest())};
  }));
  const sizes=Object.fromEntries(contracts.map(c=>[c.name,c.bytes])) as Record<typeof names[number],number>;
  const accounts=await Promise.all([root,`items.${root}`,`bakery.${root}`,`market.${root}`].map(async account=>{
    try{const state=await provider.viewAccount({accountId:account});if(state.code_hash!=="11111111111111111111111111111111")throw Error(`Refusing existing code at ${account}`);return {account,exists:true,amount:state.amount.toString()};}
    catch(error){if(/UNKNOWN_ACCOUNT|does not exist/i.test(String(error)))return {account,exists:false,amount:"0"};throw error;}
  }));
  const result={checkedAt:new Date().toISOString(),mode:"READ_ONLY_CANDIDATE",network:"testnet",plannedRoot:root,deployed:false,legacyPreserved:legacy.root,contracts,accounts,conservativeBudgetYocto:compatibleBudget(sizes).toString(),budgetNote:"Review allowance from actual code bytes plus 12 test NEAR for operating storage/subsidies/gas. Not a spend authorization or executable funding quote.",requires:["configured recoverable provider, approved HTTPS origin and physical-device recovery/signing proof","review of complete fresh configuration and testnet budget","separate preserved deployment evidence path; never overwrite legacy records"],transactionsSigned:0};
  await Bun.write(output,JSON.stringify(result,null,2)+"\n");console.log(JSON.stringify(result,null,2));
}
