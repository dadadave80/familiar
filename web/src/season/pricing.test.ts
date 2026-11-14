import { expect, test } from "bun:test";
import cases from "../../../contracts/season/fixtures/pricing-cases.json";
import { BASE, TARGET, S, buyShells, buybackFp, commission, decayHeat, pow07, priceFp, sellShells, type Good } from "./pricing";

test("pricing.ts equals pricing.rs on 1,000 seeded cases", () => {
  expect(cases.length).toBe(1000);
  for (const c of cases) {
    const good = c.good as Good;
    const heatNow = decayHeat(BigInt(c.heat_fp), BigInt(c.days));
    const price = priceFp(BASE[good], TARGET[good], BigInt(c.stock), heatNow);
    const ratio = TARGET[good] * S / (BigInt(c.stock) > 1n ? BigInt(c.stock) : 1n);
    expect([heatNow, pow07(ratio), price, buybackFp(price), buyShells(price), sellShells(price), commission(price * BASE.glass / BASE[good])].map(String))
      .toEqual([c.heat_now_fp, c.pow, c.price_fp, c.buyback_fp, c.buy, c.sell, c.commission]);
  }
});
