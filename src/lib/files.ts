import { save, open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api, errMsg, type ImportOutcome, type ImportPreview } from "@/lib/api";

/** Prompt for a path and export matching documents to JSON or CSV. */
export async function exportCollection(args: {
  database: string;
  collection: string;
  filter: string;
  sort: string;
  format: "json" | "csv";
}) {
  try {
    const ext = args.format;
    const path = await save({
      title: `Export ${args.collection}`,
      defaultPath: `${args.collection}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    if (!path) return;
    const count = await api.exportCollection({ ...args, path });
    toast.success(`Exported ${count} document${count === 1 ? "" : "s"}`);
  } catch (e) {
    toast.error(errMsg(e));
  }
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
        ? ` — set a password on ${outcome.needsPassword} of them`
        : "";
    toast.success(`Imported ${outcome.imported} connection${outcome.imported === 1 ? "" : "s"}${tail}`);
    return outcome;
  } catch (e) {
    toast.error(errMsg(e));
    return null;
  }
}

/** Prompt for a JSON/NDJSON file and import its documents. Returns true on success. */
export async function importDocuments(database: string, collection: string): Promise<boolean> {
  try {
    const path = await open({
      title: `Import into ${collection}`,
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json", "ndjson", "jsonl"] }],
    });
    if (!path || typeof path !== "string") return false;
    const count = await api.importDocuments(database, collection, path);
    toast.success(`Imported ${count} document${count === 1 ? "" : "s"}`);
    return true;
  } catch (e) {
    toast.error(errMsg(e));
    return false;
  }
}
