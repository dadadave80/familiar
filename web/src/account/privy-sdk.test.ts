import {expect,test} from "bun:test";
import {PrivyClient} from "@privy-io/react-auth";
import {KeyPair,baseDecode} from "near-api-js";
import {verifyPrivyWalletOwner} from "./privy-adapter";

test("installed Privy SDK refresh returns a direct User and preserves actual NEAR linked-wallet fields",async()=>{
  const key=KeyPair.fromRandom("ed25519").getPublicKey(),address=[...baseDecode(key.toString().slice(8))].map(n=>n.toString(16).padStart(2,"0")).join("");
  const wallet={walletId:"synthetic-near-wallet",implicitAddress:address,publicKey:key.toString()};
  const client=new PrivyClient({appId:"synthetic-app",apiUrl:"https://fixture.invalid"});
  const reads:unknown[]=[];
  // This is the installed SDK's actual refresh/conversion boundary, with synthetic HTTP data only.
  client.api.get=(async(path:unknown)=>{reads.push(path);return {identity_token:null,user:{id:"did:privy:synthetic-owner",created_at:1700000000,
    linked_accounts:[{type:"wallet",id:wallet.walletId,address,chain_type:"near",wallet_client_type:"privy",connector_type:"embedded",user_can_sign:true,imported:false,recovery_method:"privy-v2",public_key:`00${address}`}],
    mfa_methods:[],has_accepted_terms:false,is_guest:false}};}) as typeof client.api.get;
  const user=await client.updateUserAndIdToken();
  expect(reads).toEqual(["/api/v1/users/me"]);expect(user.id).toBe("did:privy:synthetic-owner");expect("user" in user).toBe(false);
  const wallets=user.linkedAccounts.filter(account=>account.type==="wallet");
  expect(wallets).toMatchObject([{id:wallet.walletId,chainType:"near",walletClientType:"privy",userCanSign:true,imported:false,recoveryMethod:"privy-v2",publicKey:`00${address}`}]);
  expect(verifyPrivyWalletOwner({id:user.id,wallets},wallet).toString()).toBe(key.toString());
  client.api.get=async()=>{throw Error("synthetic refresh network failure");};
  await expect(client.updateUserAndIdToken()).rejects.toThrow();
});
