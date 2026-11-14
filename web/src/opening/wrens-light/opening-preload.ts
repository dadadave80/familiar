import { LANDSCAPE_MEDIA, LARGE_LANDSCAPE_MEDIA, openingPicture, openingPictureSet, OPENING_LANDSCAPE_SIZES } from "./wrens-light-scenes";

/** Import from the entry route, before mounting the film, to warm only the matching first plate. */
export function preloadWrensLight() {
  if (typeof document === "undefined" || typeof matchMedia === "undefined") return;
  const href = openingPicture(0, matchMedia(LANDSCAPE_MEDIA).matches);
  if (document.head.querySelector(`link[rel="preload"][href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "preload";
  link.as = "image";
  link.type = "image/webp";
  link.fetchPriority = "high";
  const srcset = openingPictureSet(href, matchMedia(LARGE_LANDSCAPE_MEDIA).matches);
  if (srcset) { link.imageSizes = OPENING_LANDSCAPE_SIZES; link.imageSrcset = srcset; }
  link.href = href;
  document.head.append(link);
}
