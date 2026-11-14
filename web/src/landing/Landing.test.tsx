import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Landing } from "./Landing";

test("the landing explains Mochi’s first Tide Run without court tools or story spoilers", () => {
  const html = renderToStaticMarkup(<Landing />);
  for (const copy of [
    "Guide Mochi as a volunteer harbor helper. Bring home the missing Beacon Lens and help the harbor find its light again.",
    "Read the water. Bring the light home.", "One clear errand.", "Your first outing has eight calm waves.",
    "Banking keeps the outing open; finishing returns you to the harbor.", "Make the return matter.",
    "A harbor worth helping.", "Begin with Mochi", "<figcaption>Beacon Court concept art.</figcaption>",
  ]) expect(html).toContain(copy);
  for (const spoiler of ["Rope", "Lantern to redirect", "Signal Vane", "wind-moth", "Wren", "Begin with Beacon Court", "In the game, Mochi crosses connected platforms."]) expect(html).not.toContain(spoiler);
});
