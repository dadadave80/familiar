import { expect, test } from "bun:test";
import fixtures from "../contracts/common/tests/historical-return-fixtures.json";
import { expeditionFixtures } from "./historical-return-fixtures";
test("browser rules still match all pinned Rust intermediate-state fixtures",()=>{
  expect(expeditionFixtures()).toEqual(fixtures);
});
