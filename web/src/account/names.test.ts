import { expect, test } from "bun:test";
import { isPlayerAccount, mochiNameForPlayer, usernameAccountId } from "./names";
import { validName } from "../rules";
const root="familiar-game.testnet";
test("usernames share the game name rules and map only to the configured direct child",()=>{
 for(const name of ["mochi","my-harbor","tide_cat","a1"]){expect(usernameAccountId(name,root)).toBe(`${name}.${root}`);expect(isPlayerAccount(`${name}.${root}`,root)).toBe(true)}
 for(const name of ["a","Ava","has.dot","two--dashes","_front","tail-","items","bram","p-7","den-sun","seat-x","a".repeat(25)])expect(()=>usernameAccountId(name,root)).toThrow();
 expect(isPlayerAccount(`p-12.${root}`,root)).toBe(true);
 for(const id of [`${root}`,`cat.nested.${root}`,`mochi.foreign.testnet`,`items.${root}`,`p-no.${root}`])expect(isPlayerAccount(id,root)).toBe(false);
});
test("Mochi's internal name is stable across devices and fits the 24-character contract limit at maximum username length",async()=>{
 const account=usernameAccountId("a".repeat(24),root),[one,two]=await Promise.all([mochiNameForPlayer(account,root),mochiNameForPlayer(account,root)]);
 expect(one).toBe(two);expect(one).toMatch(/^mochi-[a-f0-9]{18}$/);expect(one).toHaveLength(24);expect(validName(one)).toBe(true);
 const longRoot="a".repeat(31)+".testnet",maximum=usernameAccountId("b".repeat(24),longRoot);
 expect(maximum).toHaveLength(64);expect(await mochiNameForPlayer(maximum,longRoot)).toMatch(/^mochi-[a-f0-9]{18}$/);
});
test("Mochi derivation hashes the complete canonical account, including the root, and accepts legacy players",async()=>{
 expect(await mochiNameForPlayer("player1.familiar-game.testnet",root)).toBe("mochi-26df99dccead29eb76");
 expect(await mochiNameForPlayer(`player1.${root}`,root)).not.toBe(await mochiNameForPlayer("player1.another-harbor.testnet","another-harbor.testnet"));
 expect(await mochiNameForPlayer(`p-12.${root}`,root)).toMatch(/^mochi-[a-f0-9]{18}$/);
 for(const invalid of [root,`cat.nested.${root}`,`items.${root}`,"player1.foreign.testnet"])await expect(mochiNameForPlayer(invalid,root)).rejects.toThrow("saved player account");
});
