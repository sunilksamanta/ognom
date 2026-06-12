import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import { errMsg } from "@/lib/api";

let busy = false;

/**
 * Check GitHub Releases for a newer build. Silent unless `manual` —
 * the auto-check on launch never nags and never surfaces errors.
 */
export async function checkForUpdates(manual = false): Promise<void> {
  if (busy) return;
  if (!manual && !import.meta.env.PROD) return; // dev builds don't self-update
  busy = true;
  try {
    const update = await check();
    if (update) {
      toast.info(`Ognom ${update.version} is available`, {
        id: "ognom-update",
        duration: 30_000,
        description: "Signed build from GitHub Releases. Installs in the background.",
        action: { label: "Install & restart", onClick: () => void install(update) },
      });
    } else if (manual) {
      toast.success("You're on the latest version");
    }
  } catch (e) {
    if (manual) toast.error(`Update check failed: ${errMsg(e)}`);
  } finally {
    busy = false;
  }
}

async function install(update: Update): Promise<void> {
  const id = toast.loading(`Downloading Ognom ${update.version}…`);
  try {
    let total = 0;
    let received = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
      } else if (event.event === "Progress" && total > 0) {
        received += event.data.chunkLength;
        toast.loading(
          `Downloading Ognom ${update.version}… ${Math.min(100, Math.round((received / total) * 100))}%`,
          { id }
        );
      }
    });
    toast.success("Update installed — restarting…", { id });
    await relaunch();
  } catch (e) {
    toast.error(`Update failed: ${errMsg(e)}`, { id, duration: 10_000 });
  }
}
