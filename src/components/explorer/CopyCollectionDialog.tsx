import { useEffect, useId, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Loader2, Server } from "lucide-react";
import { toast } from "sonner";
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
import { CheckRow } from "@/components/ui/check-row";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnections } from "@/stores/connections";
import { api, errMsg, type CopyProgress } from "@/lib/api";

interface CopyCollectionDialogProps {
  open: boolean;
  /** Source (always the active workspace). */
  database: string;
  source: string;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful copy so the caller can refresh, when the
   *  target landed in the active workspace. */
  onCopied: (targetDb: string) => void;
}

export function CopyCollectionDialog({
  open,
  database,
  source,
  onOpenChange,
  onCopied,
}: CopyCollectionDialogProps) {
  const dbListId = useId();
  const nameId = useId();
  const filterId = useId();

  const workspaces = useConnections((s) => s.workspaces);
  const activeId = useConnections((s) => s.activeId);

  const [targetWs, setTargetWs] = useState<string>("");
  const [targetDb, setTargetDb] = useState("");
  const [targetName, setTargetName] = useState("");
  const [filter, setFilter] = useState("");
  const [copyIndexes, setCopyIndexes] = useState(true);
  const [dbNames, setDbNames] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<CopyProgress | null>(null);
  const jobRef = useRef<string | null>(null);

  // Reset the form each time the dialog opens for a collection.
  useEffect(() => {
    if (!open) return;
    setTargetWs(activeId ?? "");
    setTargetDb(database);
    setTargetName(source);
    setFilter("");
    setCopyIndexes(true);
    setBusy(false);
    setProgress(null);
    jobRef.current = null;
  }, [open, activeId, database, source]);

  // Suggest the target workspace's databases (typing a new name is fine too).
  useEffect(() => {
    if (!open || !targetWs) return;
    let stale = false;
    api
      .listDatabases(targetWs)
      .then((dbs) => !stale && setDbNames(dbs.map((d) => d.name)))
      .catch(() => !stale && setDbNames([]));
    return () => {
      stale = true;
    };
  }, [open, targetWs]);

  const trimmedDb = targetDb.trim();
  const trimmedName = targetName.trim();
  const sameTarget =
    targetWs === activeId && trimmedDb === database && trimmedName === source;
  const canCopy = !busy && !!targetWs && trimmedDb.length > 0 && trimmedName.length > 0 && !sameTarget;

  const submit = async () => {
    if (!canCopy) return;
    const jobId = crypto.randomUUID();
    jobRef.current = jobId;
    setBusy(true);
    setProgress({ jobId, copied: 0, total: null });

    let unlisten: UnlistenFn | null = null;
    try {
      unlisten = await listen<CopyProgress>("copy-progress", (e) => {
        if (e.payload.jobId === jobId) setProgress(e.payload);
      });
      const outcome = await api.copyCollection({
        sourceDatabase: database,
        sourceCollection: source,
        targetWorkspace: targetWs,
        targetDatabase: trimmedDb,
        targetCollection: trimmedName,
        filter,
        copyIndexes,
        jobId,
      });
      if (outcome.canceled) {
        toast.info(
          `Copy canceled - ${outcome.documents} document${outcome.documents === 1 ? "" : "s"} already copied to "${trimmedName}"`
        );
      } else {
        const wsName = workspaces.find((w) => w.info.id === targetWs)?.info.name ?? "target";
        toast.success(
          `Copied ${outcome.documents} document${outcome.documents === 1 ? "" : "s"} to ${wsName} / ${trimmedDb}.${trimmedName}` +
            (outcome.indexes > 0
              ? ` with ${outcome.indexes} index${outcome.indexes === 1 ? "" : "es"}`
              : "")
        );
      }
      if (targetWs === activeId) onCopied(trimmedDb);
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      unlisten?.();
      jobRef.current = null;
      setBusy(false);
      setProgress(null);
    }
  };

  const cancel = () => {
    if (jobRef.current) void api.cancelJob(jobRef.current);
  };

  const pct =
    progress?.total && progress.total > 0
      ? Math.min(100, Math.round((progress.copied / progress.total) * 100))
      : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Copy collection to...</DialogTitle>
          <DialogDescription>
            {database}.{source} · to any open connection, streamed in batches
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <div className="fld">
            <label>Target connection</label>
            <Select value={targetWs} onValueChange={setTargetWs} disabled={busy}>
              <SelectTrigger className="font-sans">
                <SelectValue placeholder="Pick an open connection" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((w) => (
                  <SelectItem key={w.info.id} value={w.info.id}>
                    <span className="flex items-center gap-1.5 font-sans">
                      <Server className="h-3.5 w-3.5 text-text-3" />
                      {w.info.name}
                      {w.info.id === activeId && (
                        <span className="font-mono text-[10px] text-text-3">(current)</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="two">
            <div className="fld">
              <label htmlFor={dbListId}>Target database</label>
              <input
                id={dbListId}
                className="in"
                list={`${dbListId}-list`}
                value={targetDb}
                onChange={(e) => setTargetDb(e.target.value)}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
              />
              <datalist id={`${dbListId}-list`}>
                {dbNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
            <div className="fld">
              <label htmlFor={nameId}>New collection name</label>
              <input
                id={nameId}
                className="in"
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          </div>

          <div className="fld">
            <label htmlFor={filterId}>Filter</label>
            <input
              id={filterId}
              className="in"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder='{ status: "active" }'
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
            />
            <div className="hint">Optional, copies matching documents only.</div>
          </div>

          <CheckRow on={copyIndexes} onChange={setCopyIndexes} disabled={busy}>
            Copy indexes
          </CheckRow>

          {sameTarget && (
            <div className="notice dgr">
              Source and target are the same collection - change the connection, database, or name.
            </div>
          )}

          {busy && progress && (
            <div className="notice acc">
              <Loader2 className="spin" />
              <div className="min-w-0 flex-1">
                <div className="mono tabular-nums">
                  {progress.copied.toLocaleString()}
                  {progress.total ? ` / ${progress.total.toLocaleString()}` : ""} documents copied
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
                  {pct === null ? (
                    <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                  ) : (
                    <div
                      className="h-full rounded-full bg-primary transition-[width]"
                      style={{ width: `${pct}%` }}
                    />
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogBody>

        <DialogFooter>
          {busy ? (
            <Button variant="outline" onClick={cancel}>
              Cancel copy
            </Button>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
          <Button disabled={!canCopy} onClick={() => void submit()}>
            {busy && <Loader2 className="spin" />}
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
