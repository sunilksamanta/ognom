import { useEffect, useId, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { Loader2, Server } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const indexesId = useId();

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
          `Copy canceled — ${outcome.documents} document${outcome.documents === 1 ? "" : "s"} already copied to "${trimmedName}"`
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
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <DialogTitle>Copy collection to…</DialogTitle>
          <DialogDescription asChild>
            <div>
              Copy <span className="font-mono font-medium text-foreground">{source}</span> to any
              open connection — another server, database, or name. Streams in batches; large
              collections are fine.
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-normal text-muted-foreground">Target connection</Label>
            <Select value={targetWs} onValueChange={setTargetWs} disabled={busy}>
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Pick an open connection" />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((w) => (
                  <SelectItem key={w.info.id} value={w.info.id}>
                    <span className="flex items-center gap-1.5">
                      <Server className="h-3.5 w-3.5 text-muted-foreground" />
                      {w.info.name}
                      {w.info.id === activeId && (
                        <span className="text-[10px] text-muted-foreground">(current)</span>
                      )}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor={dbListId} className="text-xs font-normal text-muted-foreground">
                Target database
              </Label>
              <Input
                id={dbListId}
                list={`${dbListId}-list`}
                value={targetDb}
                onChange={(e) => setTargetDb(e.target.value)}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                className="h-8 font-mono"
              />
              <datalist id={`${dbListId}-list`}>
                {dbNames.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={nameId} className="text-xs font-normal text-muted-foreground">
                New collection name
              </Label>
              <Input
                id={nameId}
                value={targetName}
                onChange={(e) => setTargetName(e.target.value)}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                className="h-8 font-mono"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={filterId} className="text-xs font-normal text-muted-foreground">
              Filter <span className="text-muted-foreground/60">(optional — copies matching documents only)</span>
            </Label>
            <Input
              id={filterId}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder='{ status: "active" }'
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              className="h-8 font-mono"
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id={indexesId}
              checked={copyIndexes}
              onCheckedChange={(v) => setCopyIndexes(v === true)}
              disabled={busy}
            />
            <Label htmlFor={indexesId} className="text-xs font-normal">
              Copy indexes
            </Label>
          </div>

          {sameTarget && (
            <p className="text-xs text-destructive">
              Source and target are the same collection — change the connection, database, or name.
            </p>
          )}

          {busy && progress && (
            <div className="space-y-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                {pct === null ? (
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-primary" />
                ) : (
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${pct}%` }}
                  />
                )}
              </div>
              <p className="text-xs tabular-nums text-muted-foreground">
                {progress.copied.toLocaleString()}
                {progress.total ? ` / ${progress.total.toLocaleString()}` : ""} documents copied
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {busy ? (
            <Button variant="outline" size="sm" onClick={cancel}>
              Cancel copy
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
          <Button size="sm" disabled={!canCopy} onClick={() => void submit()}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Copy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
