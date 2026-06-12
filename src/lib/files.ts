import { save, open } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import { api, errMsg } from "@/lib/api";

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
