import constants from "./rules.json";
export const rules = constants;
export const itemIds = [
  "flour",
  "water",
  "berries",
  "bread",
  "hat",
  "scarf",
  "lantern",
] as const;
export const dens = ["Sea Glass", "Clover", "Marigold", "Moonbeam"] as const;
export function validName(name: string) {
  return (
    name.length >= 2 &&
    name.length <= 24 &&
    /^[a-z0-9]+([-_][a-z0-9]+)*$/.test(name) &&
    !["items", "bakery", "market", "relayer", "bram", "jar"].includes(name) &&
    !["den-", "p-", "seat-"].some((prefix) => name.startsWith(prefix))
  );
}
