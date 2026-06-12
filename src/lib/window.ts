import type { MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Elements that must keep their normal mouse behavior inside a drag surface.
 * Anything else in the titlebar moves the window (double-click maximizes),
 * matching native macOS/Windows expectations with the overlay titlebar.
 */
const INTERACTIVE =
  "button, a, input, textarea, select, kbd, [role='button'], [role='tab'], [data-no-drag]";

/** True if the click landed on a native scrollbar gutter, not the content. */
function onScrollbar(e: MouseEvent<HTMLElement>): boolean {
  const el = e.target as HTMLElement;
  // Horizontal scrollbar occupies the bottom strip; vertical the right strip.
  const overflowsX = el.scrollWidth > el.clientWidth;
  const overflowsY = el.scrollHeight > el.clientHeight;
  if (!overflowsX && !overflowsY) return false;
  const rect = el.getBoundingClientRect();
  const sbSize = 16; // generous hit slop for the gutter
  if (overflowsX && e.clientY >= rect.bottom - sbSize) return true;
  if (overflowsY && e.clientX >= rect.right - sbSize) return true;
  return false;
}

export function dragWindow(e: MouseEvent<HTMLElement>): void {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
  // Don't start a window drag when the user grabs a scrollbar.
  if (onScrollbar(e)) return;
  const win = getCurrentWindow();
  if (e.detail === 2) {
    void win.toggleMaximize();
  } else {
    void win.startDragging();
  }
}
