import { expect, test } from "bun:test";
import { isPlayerAccount, usernameAccountId } from "./names";
const root="familiar-game.testnet";
test("usernames share the game name rules and map only to the configured direct child",()=>{
 for(const name of ["mochi","my-harbor","tide_cat","a1"]){expect(usernameAccountId(name,root)).toBe(`${name}.${root}`);expect(isPlayerAccount(`${name}.${root}`,root)).toBe(true)}
 for(const name of ["a","Ava","has.dot","two--dashes","_front","tail-","items","bram","p-7","den-sun","seat-x","a".repeat(25)])expect(()=>usernameAccountId(name,root)).toThrow();
 expect(isPlayerAccount(`p-12.${root}`,root)).toBe(true);
 for(const id of [`${root}`,`cat.nested.${root}`,`mochi.foreign.testnet`,`items.${root}`,`p-no.${root}`])expect(isPlayerAccount(id,root)).toBe(false);
});
