import { expect, test } from "bun:test";
import fixtures from "../contracts/common/tests/expedition-fixtures.json";
import { expeditionFixtures } from "./expedition-fixtures";
test("browser rules still match all pinned Rust intermediate-state fixtures",()=>{
  expect(expeditionFixtures()).toEqual(fixtures);
});
