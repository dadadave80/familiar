import type { KeyboardEvent } from "react";

export function scrollReadingRegion(event: KeyboardEvent<HTMLElement>): void {
  const region = event.currentTarget;
  if (event.target !== region || region.ownerDocument.activeElement !== region || event.defaultPrevented ||
      event.nativeEvent.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;

  const style = region.ownerDocument.defaultView!.getComputedStyle(region);
  const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2;
  const page = Math.max(line, region.clientHeight - line - (Number.parseFloat(style.scrollPaddingTop) || 0) - (Number.parseFloat(style.scrollPaddingBottom) || 0));
  let top = region.scrollTop;
  switch (event.key) {
    case "ArrowUp": top -= line; break;
    case "ArrowDown": top += line; break;
    case "PageUp": top -= page; break;
    case "PageDown": top += page; break;
    case " ": top += event.shiftKey ? -page : page; break;
    case "Home": top = 0; break;
    case "End": top = region.scrollHeight; break;
    default: return;
  }
  // Instant scrolling also respects reduced motion and overrides CSS smooth scrolling.
  region.scrollTo({ top: Math.max(0, Math.min(top, region.scrollHeight - region.clientHeight)), behavior: "instant" });
  event.preventDefault();
}
