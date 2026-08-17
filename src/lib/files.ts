import { save, open } from "@tauri-apps/plugin-dialog";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { toast } from "sonner";
import {
  api,
  errMsg,
  type CopyProgress,
  type ImportOutcome,
  type ImportPreview,
} from "@/lib/api";

/** Run a cancellable job with a live progress toast (docs so far + cancel). */
async function withProgressToast(
  label: string,
  run: (jobId: string) => Promise<{ documents: number; canceled: boolean }>
): Promise<{ documents: number; canceled: boolean } | null> {
  const jobId = crypto.randomUUID();
  const toastId = toast.loading(`${label}...`, {
    action: { label: "Cancel", onClick: () => void api.cancelJob(jobId) },
  });
  let unlisten: UnlistenFn | null = null;
  try {
    unlisten = await listen<CopyProgress>("copy-progress", (e) => {
      if (e.payload.jobId !== jobId) return;
      const total = e.payload.total ? ` / ${e.payload.total.toLocaleString()}` : "";
      toast.loading(`${label} - ${e.payload.copied.toLocaleString()}${total} documents`, {
        id: toastId,
        action: { label: "Cancel", onClick: () => void api.cancelJob(jobId) },
      });
    });
    const outcome = await run(jobId);
    toast.dismiss(toastId);
    return outcome;
  } catch (e) {
    toast.dismiss(toastId);
    toast.error(errMsg(e));
    return null;
  } finally {
    unlisten?.();
  }
}

export type ExportFormat = "json" | "csv" | "ndjson" | "bson";

/** Export matching documents to a known path - streamed, cancellable, with a
 *  progress toast. Returns the outcome (null on error). */
export async function runExport(args: {
  database: string;
  collection: string;
  filter: string;
  sort: string;
  format: ExportFormat;
  path: string;
}) {
  const outcome = await withProgressToast(`Exporting ${args.collection}`, (jobId) =>
    api.exportCollection({ ...args, jobId })
  );
  if (!outcome) return null;
  if (outcome.canceled) {
    toast.info(`Export canceled - ${outcome.documents.toLocaleString()} documents written`);
  } else {
    toast.success(`Exported ${outcome.documents.toLocaleString()} document${outcome.documents === 1 ? "" : "s"}`);
  }
  return outcome;
}

/** Prompt for a path and export matching documents. */
export async function exportCollection(args: {
  database: string;
  collection: string;
  filter: string;
  sort: string;
  format: ExportFormat;
}) {
  const ext = args.format;
  const path = await save({
    title: `Export ${args.collection}`,
    defaultPath: `${args.collection}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  }).catch(() => null);
  if (!path) return;
  await runExport({ ...args, path });
}

/** Prompt for a path and export saved connections. `includeSecrets` requires a
 *  passphrase and produces an encrypted bundle. Returns true on success. */
export async function exportConnections(args: {
  ids?: string[];
  includeSecrets: boolean;
  passphrase?: string;
}): Promise<boolean> {
  try {
    const name = args.includeSecrets ? "ognom-connections-encrypted.json" : "ognom-connections.json";
    const path = await save({
      title: "Export connections",
      defaultPath: name,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return false;
    const count = await api.exportConnections({ ...args, path });
    toast.success(
      `Exported ${count} connection${count === 1 ? "" : "s"}${args.includeSecrets ? " (encrypted)" : " (no passwords)"}`
    );
    return true;
  } catch (e) {
    toast.error(errMsg(e));
    return false;
  }
}

/** Pick a connections export file and peek at it (encrypted? how many?). */
export async function pickConnectionImport(): Promise<{ path: string; preview: ImportPreview } | null> {
  try {
    const path = await open({
      title: "Import connections",
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path || typeof path !== "string") return null;
    const preview = await api.inspectConnectionImport(path);
    return { path, preview };
  } catch (e) {
    toast.error(errMsg(e));
    return null;
  }
}

/** Run the import for a previously-picked file. Returns the outcome, or null on error. */
export async function runConnectionImport(
  path: string,
  passphrase?: string
): Promise<ImportOutcome | null> {
  try {
    const outcome = await api.importConnections(path, passphrase);
    const tail =
      outcome.needsPassword > 0
        ? ` - set a password on ${outcome.needsPassword} of them`
        : "";
    toast.success(`Imported ${outcome.imported} connection${outcome.imported === 1 ? "" : "s"}${tail}`);
    return outcome;
  } catch (e) {
    toast.error(errMsg(e));
    return null;
  }
}

/** Prompt for a JSON/NDJSON/CSV/BSON file and import its documents - 
 *  streamed in batches, cancellable. Returns true when anything landed. */
export async function importDocuments(database: string, collection: string): Promise<boolean> {
  const path = await open({
    title: `Import into ${collection}`,
    multiple: false,
    filters: [
      { name: "Data files", extensions: ["json", "ndjson", "jsonl", "csv", "bson"] },
    ],
  }).catch(() => null);
  if (!path || typeof path !== "string") return false;
  const outcome = await withProgressToast(`Importing into ${collection}`, (jobId) =>
    api.importDocuments(database, collection, path, jobId)
  );
  if (!outcome) return false;
  if (outcome.canceled) {
    toast.info(`Import canceled - ${outcome.documents.toLocaleString()} documents inserted`);
  } else {
    toast.success(`Imported ${outcome.documents.toLocaleString()} document${outcome.documents === 1 ? "" : "s"}`);
  }
  return outcome.documents > 0;
}
