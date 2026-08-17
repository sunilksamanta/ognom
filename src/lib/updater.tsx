import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { toast } from "sonner";
import { ArrowUpCircle, Download } from "lucide-react";
import { errMsg } from "@/lib/api";

let busy = false;

/**
 * Check GitHub Releases for a newer build. Silent unless `manual` - 
 * the auto-check on launch never nags and never surfaces errors.
 */
export async function checkForUpdates(manual = false): Promise<void> {
  if (busy) return;
  if (!manual && !import.meta.env.PROD) return; // dev builds don't self-update
  busy = true;
  try {
    const update = await check();
    if (update) {
      showUpdateToast(update.version, () => void install(update));
    } else if (manual) {
      toast.success("You're on the latest version");
    }
  } catch (e) {
    if (manual) toast.error(`Update check failed: ${errMsg(e)}`);
  } finally {
    busy = false;
  }
}

/**
 * "Update available" toast. A custom layout (not sonner's `action`) so the
 * button sits under the copy with room to breathe - the default side-by-side
 * layout squeezes the text into a narrow column beside the button.
 */
export function showUpdateToast(version: string, onInstall: () => void): void {
  toast.custom(
    (id) => (
      <div className="flex w-[356px] items-start gap-3 rounded-[var(--r)] border border-line-2 bg-raised p-4 text-text shadow-panel">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-primary">
          <ArrowUpCircle className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold">Ognom {version} is available</p>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-2">
            Signed build from GitHub Releases - installs in the background.
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              onClick={() => {
                toast.dismiss(id);
                onInstall();
              }}
              className="btn pri sm"
            >
              <Download className="h-3.5 w-3.5" />
              Install &amp; restart
            </button>
            <button
              onClick={() => toast.dismiss(id)}
              className="btn qt sm"
            >
              Later
            </button>
          </div>
        </div>
      </div>
    ),
    {
      id: "ognom-update",
      duration: 30_000,
      unstyled: true,
      style: { background: "transparent", border: "none", boxShadow: "none", padding: 0 },
    }
  );
}

async function install(update: Update): Promise<void> {
  const id = toast.loading(`Downloading Ognom ${update.version}...`);
  try {
    let total = 0;
    let received = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
      } else if (event.event === "Progress" && total > 0) {
        received += event.data.chunkLength;
        toast.loading(
          `Downloading Ognom ${update.version}... ${Math.min(100, Math.round((received / total) * 100))}%`,
          { id }
        );
      }
    });
    toast.success("Update installed - restarting...", { id });
    await relaunch();
  } catch (e) {
    toast.error(`Update failed: ${errMsg(e)}`, { id, duration: 10_000 });
  }
}
