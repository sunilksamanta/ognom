import type { MouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/**
 * Elements that must keep their normal mouse behavior inside a drag surface.
 * Anything else in the titlebar moves the window (double-click maximizes),
 * matching native macOS/Windows expectations with the overlay titlebar.
 */
const INTERACTIVE =
  "button, a, input, textarea, select, kbd, [role='button'], [role='tab'], [data-no-drag]";

export function dragWindow(e: MouseEvent<HTMLElement>): void {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
  const win = getCurrentWindow();
  if (e.detail === 2) {
    void win.toggleMaximize();
  } else {
    void win.startDragging();
  }
}
