import { openUrl } from "@tauri-apps/plugin-opener";

/** Canonical project links. */
export const REPO_URL = "https://github.com/sunilksamanta/ognom";
export const REPO_LABEL = "github.com/sunilksamanta/ognom";

/**
 * Open a URL in the user's default browser. Uses the Tauri opener plugin in the
 * desktop app; falls back to `window.open` in the dev/browser preview where the
 * Tauri bridge is absent.
 */
export async function openExternal(url: string): Promise<void> {
  try {
    await openUrl(url);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}
