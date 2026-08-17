import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { save } from "@tauri-apps/plugin-dialog";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ResultsViewer, docSelectionKey, type DocSelection } from "@/components/explorer/ResultsViewer";
import { CheckRow } from "@/components/ui/check-row";
import { Blank } from "@/components/layout/Blank";
import { useExplorer, type Tab } from "@/stores/explorer";
import { useSettings } from "@/stores/settings";
import { useConnections } from "@/stores/connections";
import { api, errMsg, type Doc } from "@/lib/api";
import { runExport } from "@/lib/files";
import { toShellText } from "@/lib/bson";
import { formatCount } from "@/lib/bson";

/**
 * Find results for the Table / Documents views. The query itself lives in
 * the dock below; this pane renders results, the multi-select bar and errors.
 * Clicking a row opens it in the drawer.
 */
export function DocumentsPane({ tab }: { tab: Tab }) {
  const patchDocs = useExplorer((s) => s.patchDocs);
  const runFind = useExplorer((s) => s.runFind);
  const setDrawer = useExplorer((s) => s.setDrawer);
  const readOnly = useConnections(
    (s) => s.workspaces.find((w) => w.info.id === s.activeId)?.readOnly ?? false
  );
  const offerBackup = useSettings((s) => s.offerBackupOnDelete);
  const d = tab.docs;
  const view = tab.mode === "documents" ? "json" : "table";

  const [confirmSelected, setConfirmSelected] = useState(false);
  const [deletingSelected, setDeletingSelected] = useState(false);
  const [backupSelected, setBackupSelected] = useState(false);
  const [confirmOne, setConfirmOne] = useState<Doc | null>(null);

  const run = (resetPage: boolean) => void runFind(tab.id, { resetPage });

  // Stable identity so the memoized ResultsViewer doesn't re-render on every
  // keystroke in the dock.
  // Table rows open the drawer on Fields; document cards open it on JSON.
  const initialView = view === "json" ? "json" : "fields";
  const actions = useMemo(
    () => ({
      onView: (doc: Doc) => setDrawer(tab.id, { kind: "doc", doc, source: "docs", view: initialView }),
      onEdit: readOnly
        ? undefined
        : (doc: Doc) => setDrawer(tab.id, { kind: "doc", doc, source: "docs", view: initialView }),
      onDuplicate: readOnly ? undefined : (doc: Doc) => setDrawer(tab.id, { kind: "insert", template: doc }),
      onDelete: readOnly ? undefined : (doc: Doc) => setConfirmOne(doc),
    }),
    [tab.id, setDrawer, readOnly, initialView]
  );

  const selectedDoc = tab.drawer.kind === "doc" ? tab.drawer.doc : null;
  const selectedKey = selectedDoc ? docSelectionKey(selectedDoc) : null;

  // ---- multi-select (table view) ------------------------------------------
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [d.docs]);
  const selection: DocSelection = useMemo(
    () => ({
      selected,
      onToggle: (key, on) =>
        setSelected((s) => {
          const next = new Set(s);
          if (on) next.add(key);
          else next.delete(key);
          return next;
        }),
      onToggleAll: (keys, on) =>
        setSelected((s) => {
          const next = new Set(s);
          for (const k of keys) {
            if (on) next.add(k);
            else next.delete(k);
          }
          return next;
        }),
    }),
    [selected]
  );

  const selectedIds = () =>
    d.docs
      .filter((doc) => {
        const k = docSelectionKey(doc);
        return k !== null && selected.has(k);
      })
      .map((doc) => doc._id);

  const deleteSelected = async () => {
    const ids = selectedIds();
    if (ids.length === 0) return;
    setDeletingSelected(true);
    try {
      const filter = toShellText({ _id: { $in: ids } });
      if (backupSelected) {
        const path = await save({
          title: `Backup ${ids.length} document${ids.length === 1 ? "" : "s"} before deleting`,
          defaultPath: `${tab.collection}-${ids.length}-docs.json`,
          filters: [{ name: "JSON", extensions: ["json"] }],
        }).catch(() => null);
        if (!path) {
          toast.info("Delete cancelled - no backup was written");
          setDeletingSelected(false);
          return;
        }
        const out = await runExport({
          database: tab.database,
          collection: tab.collection,
          filter,
          sort: "",
          format: "json",
          path,
        });
        if (!out || out.canceled) {
          setDeletingSelected(false);
          return;
        }
      }
      const r = await api.bulkDelete(tab.database, tab.collection, filter);
      toast.success(`Deleted ${formatCount(r.deleted)} document${r.deleted === 1 ? "" : "s"}`);
      setConfirmSelected(false);
      setSelected(new Set());
      run(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDeletingSelected(false);
    }
  };

  const [deletingOne, setDeletingOne] = useState(false);
  const deleteOne = async () => {
    if (!confirmOne) return;
    setDeletingOne(true);
    try {
      await api.deleteDocument(tab.database, tab.collection, confirmOne._id);
      toast.success("Document deleted");
      if (selectedKey && selectedKey === docSelectionKey(confirmOne)) setDrawer(tab.id, { kind: "closed" });
      setConfirmOne(null);
      run(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setDeletingOne(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {d.error && (
        <div className="notice dgr mono mx-[var(--pad)] mt-3 shrink-0">
          <AlertCircle />
          <span className="min-w-0 flex-1 break-all">{d.error}</span>
        </div>
      )}

      {selected.size > 0 && (
        <div className="notice acc mx-[var(--pad)] mt-3 shrink-0 items-center py-1.5 no-select">
          <span className="font-mono text-[11.5px] text-text">
            {selected.size} document{selected.size === 1 ? "" : "s"} selected
          </span>
          <div className="grow" />
          <button className="btn qt sm" onClick={() => setSelected(new Set())}>
            Clear
          </button>
          <button
            className="btn dgr sm"
            disabled={readOnly}
            onClick={() => {
              setBackupSelected(false);
              setConfirmSelected(true);
            }}
          >
            <Trash2 />
            Delete {selected.size}
          </button>
        </div>
      )}

      {d.loading && d.docs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="spin h-5 w-5 text-text-3" />
        </div>
      ) : d.docs.length === 0 && !d.loading ? (
        <Blank
          small
          title={d.filter.trim() ? "No documents match this filter" : "This collection is empty"}
          text={
            d.filter.trim() ? (
              <>
                <span className="mono">{d.filter.trim()}</span> returned 0
                {d.count !== null ? ` of ${formatCount(d.count)}` : ""}.
              </>
            ) : readOnly ? (
              "Switch to edit mode to insert the first document."
            ) : (
              "Insert adds the first document, or import a JSON / CSV / BSON file."
            )
          }
          actions={
            d.filter.trim() ? (
              <>
                <button
                  className="btn"
                  onClick={() => {
                    patchDocs(tab.id, { filter: "" });
                    run(true);
                  }}
                >
                  Clear filter
                </button>
                <button
                  className="btn qt"
                  onClick={() => document.querySelector<HTMLInputElement>('.dock input[aria-label="Filter"]')?.focus()}
                >
                  Edit filter
                </button>
              </>
            ) : !readOnly ? (
              <button className="btn pri" onClick={() => setDrawer(tab.id, { kind: "insert" })}>
                Insert a document
              </button>
            ) : undefined
          }
        />
      ) : (
        <ResultsViewer
          docs={d.docs}
          view={view}
          actions={actions}
          selection={view === "table" ? selection : undefined}
          activeKey={selectedKey}
        />
      )}

      {/* delete selected */}
      <Dialog open={confirmSelected} onOpenChange={(o) => !o && !deletingSelected && setConfirmSelected(false)}>
        <DialogContent className="max-w-[480px]">
          <DialogHeader>
            <DialogTitle>Delete {selected.size} selected document{selected.size === 1 ? "" : "s"}?</DialogTitle>
            <DialogDescription>
              {tab.database}.{tab.collection}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="warnbox">
              <Trash2 />
              <div>
                The selected documents are permanently removed from the collection. It cannot be undone
                from Ognom.
              </div>
            </div>
            {offerBackup && (
              <CheckRow on={backupSelected} onChange={setBackupSelected}>
                Export the selected documents to a JSON file first
              </CheckRow>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={deletingSelected} onClick={() => setConfirmSelected(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deletingSelected} onClick={() => void deleteSelected()}>
              {deletingSelected && <Loader2 className="spin" />}
              Delete {selected.size}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete one */}
      <Dialog open={!!confirmOne} onOpenChange={(o) => !o && !deletingOne && setConfirmOne(null)}>
        <DialogContent className="max-w-[440px]">
          <DialogHeader>
            <DialogTitle>Delete document?</DialogTitle>
            <DialogDescription>
              {tab.database}.{tab.collection}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <div className="warnbox">
              <Trash2 />
              <div>
                <span className="mono">_id {confirmOne ? toShellText(confirmOne._id) : ""}</span> will be removed.
                It cannot be undone from Ognom.
              </div>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={deletingOne} onClick={() => setConfirmOne(null)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deletingOne} onClick={() => void deleteOne()}>
              {deletingOne && <Loader2 className="spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
