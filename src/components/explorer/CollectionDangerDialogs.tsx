import { useEffect, useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
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
import { useExplorer } from "@/stores/explorer";
import { useConnections } from "@/stores/connections";
import { api, errMsg } from "@/lib/api";
import { formatCount } from "@/lib/bson";
import { runExport } from "@/lib/files";
import { CheckRow } from "@/components/ui/check-row";

export type CollTarget = { db: string; coll: string } | null;

function useCollectionFacts(target: CollTarget) {
  const [count, setCount] = useState<number | null>(null);
  const [indexes, setIndexes] = useState<number | null>(null);
  useEffect(() => {
    setCount(null);
    setIndexes(null);
    if (!target) return;
    let stale = false;
    void api
      .countDocuments(target.db, target.coll, "")
      .then((c) => !stale && setCount(c.count ?? null))
      .catch(() => {});
    void api
      .listIndexes(target.db, target.coll)
      .then((ix) => !stale && setIndexes(ix.length))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [target?.db, target?.coll]); // eslint-disable-line react-hooks/exhaustive-deps
  return { count, indexes };
}

/** Optional pre-flight export used by both dialogs. Returns false if the
 *  user cancelled the file picker (the destructive action is then aborted). */
async function backupFirst(target: { db: string; coll: string }, format: "bson" | "json"): Promise<boolean> {
  const path = await save({
    title: `Backup ${target.coll} before removing`,
    defaultPath: `${target.coll}-backup.${format}`,
    filters: [{ name: format.toUpperCase(), extensions: [format] }],
  }).catch(() => null);
  if (!path) return false;
  const outcome = await runExport({
    database: target.db,
    collection: target.coll,
    filter: "",
    sort: "",
    format,
    path,
  });
  return !!outcome && !outcome.canceled;
}

/**
 * Drop collection: the design's confirm - facts, type-the-name, optional
 * BSON dump first, outline-danger action.
 */
export function DropCollectionDialog({
  target,
  onOpenChange,
}: {
  target: CollTarget;
  onOpenChange: (open: boolean) => void;
}) {
  const active = useConnections((s) => s.active);
  const closeTabsForCollection = useExplorer((s) => s.closeTabsForCollection);
  const loadCollections = useExplorer((s) => s.loadCollections);
  const { count, indexes } = useCollectionFacts(target);
  const [typed, setTyped] = useState("");
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) {
      setTyped("");
      setBackup(false);
      setBusy(false);
    }
  }, [target]);

  const ok = !!target && typed.trim() === target.coll;

  const run = async () => {
    if (!target || !ok) return;
    setBusy(true);
    try {
      if (backup) {
        const done = await backupFirst(target, "bson");
        if (!done) {
          toast.info("Drop cancelled - no backup was written");
          setBusy(false);
          return;
        }
      }
      await api.dropCollection(target.db, target.coll);
      toast.success(`Dropped ${target.coll}`);
      closeTabsForCollection(target.db, target.coll);
      await loadCollections(target.db);
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Drop collection</DialogTitle>
          <DialogDescription>
            {active?.name} · {target?.db}.{target?.coll}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="warnbox">
            <TriangleAlert />
            <div>
              This removes{" "}
              <b>{count === null ? "all" : formatCount(count)} documents</b>
              {indexes !== null && ` and ${indexes} index${indexes === 1 ? "" : "es"}`}. It cannot be undone
              from Ognom - there is no local snapshot of this collection.
            </div>
          </div>
          <div className="fld">
            <label htmlFor="drop-confirm">Type the collection name to confirm</label>
            <input
              id="drop-confirm"
              className="in"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ok && !busy && void run()}
              placeholder={target?.coll}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </div>
          <CheckRow on={backup} onChange={setBackup}>
            Export a BSON dump first (you choose where)
          </CheckRow>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!ok || busy} onClick={() => void run()}>
            {busy && <Loader2 className="spin" />}
            Drop collection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Clear collection: same shape, keeps the collection and its indexes. */
export function ClearCollectionDialog({
  target,
  onOpenChange,
}: {
  target: CollTarget;
  onOpenChange: (open: boolean) => void;
}) {
  const active = useConnections((s) => s.active);
  const refreshTabsForCollection = useExplorer((s) => s.refreshTabsForCollection);
  const { count } = useCollectionFacts(target);
  const [typed, setTyped] = useState("");
  const [backup, setBackup] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (target) {
      setTyped("");
      setBackup(false);
      setBusy(false);
    }
  }, [target]);

  const ok = !!target && typed.trim() === target.coll;

  const run = async () => {
    if (!target || !ok) return;
    setBusy(true);
    try {
      if (backup) {
        const done = await backupFirst(target, "json");
        if (!done) {
          toast.info("Clear cancelled - no backup was written");
          setBusy(false);
          return;
        }
      }
      const deleted = await api.clearCollection(target.db, target.coll);
      toast.success(`Cleared ${target.coll} - ${formatCount(deleted)} document${deleted === 1 ? "" : "s"} removed`);
      refreshTabsForCollection(target.db, target.coll);
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!target} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Clear collection</DialogTitle>
          <DialogDescription>
            {active?.name} · {target?.db}.{target?.coll}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="warnbox">
            <TriangleAlert />
            <div>
              This deletes <b>{count === null ? "every" : formatCount(count)} document{count === 1 ? "" : "s"}</b>{" "}
              in the collection. The collection and its indexes stay. It cannot be undone from Ognom.
            </div>
          </div>
          <div className="fld">
            <label htmlFor="clear-confirm">Type the collection name to confirm</label>
            <input
              id="clear-confirm"
              className="in"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && ok && !busy && void run()}
              placeholder={target?.coll}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
          </div>
          <CheckRow on={backup} onChange={setBackup}>
            Export a JSON backup first (you choose where)
          </CheckRow>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={!ok || busy} onClick={() => void run()}>
            {busy && <Loader2 className="spin" />}
            Clear collection
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
