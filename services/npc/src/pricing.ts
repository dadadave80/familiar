export const dials = ["steady", "generous", "careful"] as const;
export type Dial = (typeof dials)[number];

export function priceQuote({
  last,
  stock,
  dial,
}: {
  last: bigint;
  stock: bigint;
  dial: Dial;
}) {
  if (last <= 0n || stock < 0n || !dials.includes(dial))
    throw new Error("Invalid market observation.");
  // Scarce inputs earn a higher bid; surplus lowers asks. Temperament only nudges by 5%.
  const scarcity = stock < 5n ? 20n : stock > 30n ? -20n : 0n;
  const nudge = dial === "generous" ? 5n : dial === "careful" ? -5n : 0n;
  const floor = (last + 1n) / 2n;
  const relativeCeiling = (last * 3n) / 2n;
  const ceiling = relativeCeiling < 10n ** 24n ? relativeCeiling : 10n ** 24n;
  const bound = (price: bigint) =>
    price < floor ? floor : price > ceiling ? ceiling : price;
  const bid = bound((last * (90n + scarcity + nudge)) / 100n);
  const ask = bound((last * (110n + scarcity + nudge)) / 100n);
  return { bid, ask: ask < bid ? bid : ask, max_qty: 10n };
}
