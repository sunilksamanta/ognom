import { useEffect, useId, useMemo, useRef, useState } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { ChevronDown, ChevronRight, GitCompare, Loader2, Server } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useConnections } from "@/stores/connections";
import {
  api,
  errMsg,
  type DiffEntry,
  type DiffOutcome,
  type DiffProgress,
} from "@/lib/api";
import { diffDocs, formatId, previewValue } from "@/lib/diff";
import { cn } from "@/lib/utils";

interface DiffCollectionDialogProps {
  open: boolean;
  /** Source (always the active workspace). */
  database: string;
  source: string;
  onOpenChange: (open: boolean) => void;
}

const idKey = (id: unknown) => JSON.stringify(id);

/** One row in a category list: checkbox, id, optional expandable field diff. */
function EntryRow({
  entry,
  checked,
  onCheck,
  expandable,
}: {
  entry: DiffEntry;
  checked: boolean;
  onCheck: (v: boolean) => void;
  expandable: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const fields = useMemo(
    () =>
      expanded && entry.source && entry.target
        ? diffDocs(entry.source, entry.target)
        : [],
    [expanded, entry]
  );

  return (
    <div className="rounded-md border border-transparent hover:border-border">
      <div className="flex items-center gap-2 px-2 py-1">
        <Checkbox checked={checked} onCheckedChange={(v) => onCheck(v === true)} />
        {expandable ? (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="flex min-w-0 flex-1 items-center gap-1 text-left"
          >
            {expanded ? (
              <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
            <span className="truncate font-mono text-xs">{formatId(entry.id)}</span>
          </button>
        ) : (
          <span className="min-w-0 flex-1 truncate font-mono text-xs">
            {formatId(entry.id)}
          </span>
        )}
      </div>
      {expanded && fields.length > 0 && (
        <div className="mx-2 mb-1.5 overflow-x-auto rounded bg-muted/40 p-1.5">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="pr-3 font-normal">Field</th>
                <th className="pr-3 font-normal">Source</th>
                <th className="font-normal">Target</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {fields.map((f) => (
                <tr key={f.path} className="align-top">
                  <td className="pr-3 text-muted-foreground">{f.path}</td>
                  <td className="whitespace-pre-wrap break-all pr-3 text-info">
                    {previewValue(f.left)}
                  </td>
                  <td className="whitespace-pre-wrap break-all text-destructive">
                    {previewValue(f.right)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function DiffCollectionDialog({
  open,
  database,
  source,
  onOpenChange,
}: DiffCollectionDialogProps) {
  const filterId = useId();

  const workspaces = useConnections((s) => s.workspaces);
  const activeId = useConnections((s) => s.activeId);

  // -------------------------------------------------- setup state
  const [targetWs, setTargetWs] = useState("");
  const [targetDb, setTargetDb] = useState("");
  const [targetColl, setTargetColl] = useState("");
  const [filter, setFilter] = useState("");
  const [dbNames, setDbNames] = useState<string[]>([]);
  const [collNames, setCollNames] = useState<string[]>([]);

  // -------------------------------------------------- run state
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<DiffProgress | null>(null);
  const [result, setResult] = useState<DiffOutcome | null>(null);
  const jobRef = useRef<string | null>(null);

  // -------------------------------------------------- selection + sync state
  const [selChanged, setSelChanged] = useState<Set<string>>(new Set());
  const [selMissing, setSelMissing] = useState<Set<string>>(new Set());
  const [selExtra, setSelExtra] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<null | {
    title: string;
    description: string;
    confirmLabel: string;
    destructive: boolean;
    run: () => Promise<void>;
  }>(null);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTargetWs(activeId ?? "");
    setTargetDb(database);
    setTargetColl(source);
    setFilter("");
    setBusy(false);
    setProgress(null);
    setResult(null);
    setSelChanged(new Set());
    setSelMissing(new Set());
    setSelExtra(new Set());
    jobRef.current = null;
  }, [open, activeId, database, source]);

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

  useEffect(() => {
    if (!open || !targetWs || !targetDb) return;
    let stale = false;
    api
      .listCollections(targetDb, targetWs)
      .then((cs) => !stale && setCollNames(cs.map((c) => c.name)))
      .catch(() => !stale && setCollNames([]));
    return () => {
      stale = true;
    };
  }, [open, targetWs, targetDb]);

  const sameTarget = targetWs === activeId && targetDb === database && targetColl === source;
  const canRun = !busy && !!targetWs && !!targetDb && !!targetColl && !sameTarget;

  const runDiff = async () => {
    if (!canRun) return;
    const jobId = crypto.randomUUID();
    jobRef.current = jobId;
    setBusy(true);
    setResult(null);
    setProgress({ jobId, phase: "source", processed: 0, total: null });

    let unlisten: UnlistenFn | null = null;
    try {
      unlisten = await listen<DiffProgress>("diff-progress", (e) => {
        if (e.payload.jobId === jobId) setProgress(e.payload);
      });
      const outcome = await api.diffCollections({
        sourceDatabase: database,
        sourceCollection: source,
        targetWorkspace: targetWs,
        targetDatabase: targetDb,
        targetCollection: targetColl,
        filter,
        jobId,
      });
      if (outcome.canceled) {
        toast.info("Diff canceled");
      } else {
        setResult(outcome);
        setSelChanged(new Set(outcome.changedDocs.map((e) => idKey(e.id))));
        setSelMissing(new Set(outcome.onlyInSourceDocs.map((e) => idKey(e.id))));
        setSelExtra(new Set());
      }
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

  const targetName = workspaces.find((w) => w.info.id === targetWs)?.info.name ?? "target";

  const runSync = async (
    action: "copy" | "delete",
    entries: DiffEntry[],
    selected: Set<string>,
    doneMsg: (n: number) => string
  ) => {
    const ids = entries.filter((e) => selected.has(idKey(e.id))).map((e) => e.id);
    if (ids.length === 0) return;
    setSyncing(true);
    try {
      const applied = await api.syncDocuments({
        sourceDatabase: database,
        sourceCollection: source,
        targetWorkspace: targetWs,
        targetDatabase: targetDb,
        targetCollection: targetColl,
        action,
        ids,
      });
      toast.success(doneMsg(applied));
      // Re-run the diff so the lists reflect the new reality.
      await runDiff();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSyncing(false);
      setConfirm(null);
    }
  };

  const toggle = (set: Set<string>, key: string, on: boolean): Set<string> => {
    const next = new Set(set);
    if (on) next.add(key);
    else next.delete(key);
    return next;
  };

  const allKeys = (entries: DiffEntry[]) => new Set(entries.map((e) => idKey(e.id)));

  const category = (
    entries: DiffEntry[],
    totalCount: number,
    selected: Set<string>,
    setSelected: (s: Set<string>) => void,
    expandable: boolean,
    empty: string,
    actions: React.ReactNode
  ) => (
    <div className="flex h-[300px] flex-col">
      {entries.length === 0 ? (
        <p className="flex flex-1 items-center justify-center text-xs text-muted-foreground">
          {empty}
        </p>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b px-2 py-1.5">
            <Checkbox
              checked={selected.size === entries.length && entries.length > 0}
              onCheckedChange={(v) =>
                setSelected(v === true ? allKeys(entries) : new Set())
              }
            />
            <span className="text-xs text-muted-foreground">
              {selected.size} of {entries.length} selected
              {totalCount > entries.length &&
                ` — showing first ${entries.length} of ${totalCount.toLocaleString()}`}
            </span>
          </div>
          <ScrollArea className="flex-1">
            <div className="flex flex-col gap-px p-1">
              {entries.map((e) => {
                const k = idKey(e.id);
                return (
                  <EntryRow
                    key={k}
                    entry={e}
                    checked={selected.has(k)}
                    onCheck={(v) => setSelected(toggle(selected, k, v))}
                    expandable={expandable}
                  />
                );
              })}
            </div>
          </ScrollArea>
          <div className="flex justify-end gap-2 border-t px-2 py-2">{actions}</div>
        </>
      )}
    </div>
  );

  const pct =
    progress?.total && progress.total > 0
      ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
      : null;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && !syncing && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompare className="h-4 w-4" />
            Diff collection
          </DialogTitle>
          <DialogDescription asChild>
            <div>
              Compare <span className="font-mono font-medium text-foreground">{source}</span>{" "}
              against another collection by <span className="font-mono">_id</span> — see what's
              missing, extra, or changed, then sync selected documents.
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-normal text-muted-foreground">Compare with</Label>
              <Select value={targetWs} onValueChange={setTargetWs} disabled={busy}>
                <SelectTrigger className="h-8">
                  <SelectValue placeholder="Connection" />
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
            <div className="space-y-1.5">
              <Label className="text-xs font-normal text-muted-foreground">Database</Label>
              <Select value={targetDb} onValueChange={setTargetDb} disabled={busy}>
                <SelectTrigger className="h-8 font-mono">
                  <SelectValue placeholder="Database" />
                </SelectTrigger>
                <SelectContent>
                  {dbNames.map((n) => (
                    <SelectItem key={n} value={n} className="font-mono">
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-normal text-muted-foreground">Collection</Label>
              <Select value={targetColl} onValueChange={setTargetColl} disabled={busy}>
                <SelectTrigger className="h-8 font-mono">
                  <SelectValue placeholder="Collection" />
                </SelectTrigger>
                <SelectContent>
                  {collNames.map((n) => (
                    <SelectItem key={n} value={n} className="font-mono">
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={filterId} className="text-xs font-normal text-muted-foreground">
              Filter <span className="text-muted-foreground/60">(optional — applied to both sides)</span>
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

          {sameTarget && (
            <p className="text-xs text-destructive">
              Pick a different connection, database, or collection to compare against.
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
                {progress.phase === "source" ? "Scanning source" : "Scanning target"} —{" "}
                {progress.processed.toLocaleString()}
                {progress.total ? ` / ${progress.total.toLocaleString()}` : ""} documents
              </p>
            </div>
          )}

          {result && (
            <>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs tabular-nums">
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {result.identical.toLocaleString()}
                  </span>{" "}
                  identical
                </span>
                <span className="text-muted-foreground">
                  <span className={cn("font-medium", result.changed > 0 && "text-warning")}>
                    {result.changed.toLocaleString()}
                  </span>{" "}
                  changed
                </span>
                <span className="text-muted-foreground">
                  <span
                    className={cn("font-medium", result.onlyInSource > 0 && "text-info")}
                  >
                    {result.onlyInSource.toLocaleString()}
                  </span>{" "}
                  only in source
                </span>
                <span className="text-muted-foreground">
                  <span
                    className={cn("font-medium", result.onlyInTarget > 0 && "text-destructive")}
                  >
                    {result.onlyInTarget.toLocaleString()}
                  </span>{" "}
                  only in target
                </span>
                <span className="ml-auto text-muted-foreground/70">{result.execMs} ms</span>
              </div>

              <Tabs defaultValue="changed">
                <TabsList className="h-8">
                  <TabsTrigger value="changed" className="text-xs">
                    Changed ({result.changed.toLocaleString()})
                  </TabsTrigger>
                  <TabsTrigger value="missing" className="text-xs">
                    Only in source ({result.onlyInSource.toLocaleString()})
                  </TabsTrigger>
                  <TabsTrigger value="extra" className="text-xs">
                    Only in target ({result.onlyInTarget.toLocaleString()})
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="changed" className="mt-2 rounded-md border">
                  {category(
                    result.changedDocs,
                    result.changed,
                    selChanged,
                    setSelChanged,
                    true,
                    "No changed documents.",
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={selChanged.size === 0 || syncing}
                      onClick={() =>
                        setConfirm({
                          title: "Overwrite on target?",
                          description: `This replaces ${selChanged.size} document${selChanged.size === 1 ? "" : "s"} in ${targetName} / ${targetDb}.${targetColl} with the source version. This cannot be undone.`,
                          confirmLabel: "Overwrite",
                          destructive: true,
                          run: () =>
                            runSync("copy", result.changedDocs, selChanged, (n) =>
                              `Overwrote ${n} document${n === 1 ? "" : "s"} on the target`
                            ),
                        })
                      }
                    >
                      Overwrite selected on target
                    </Button>
                  )}
                </TabsContent>

                <TabsContent value="missing" className="mt-2 rounded-md border">
                  {category(
                    result.onlyInSourceDocs,
                    result.onlyInSource,
                    selMissing,
                    setSelMissing,
                    false,
                    "Nothing missing on the target.",
                    <Button
                      size="sm"
                      disabled={selMissing.size === 0 || syncing}
                      onClick={() =>
                        void runSync("copy", result.onlyInSourceDocs, selMissing, (n) =>
                          `Copied ${n} document${n === 1 ? "" : "s"} to the target`
                        )
                      }
                    >
                      {syncing && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      Copy selected to target
                    </Button>
                  )}
                </TabsContent>

                <TabsContent value="extra" className="mt-2 rounded-md border">
                  {category(
                    result.onlyInTargetDocs,
                    result.onlyInTarget,
                    selExtra,
                    setSelExtra,
                    false,
                    "No extra documents on the target.",
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={selExtra.size === 0 || syncing}
                      onClick={() =>
                        setConfirm({
                          title: "Delete from target?",
                          description: `This permanently deletes ${selExtra.size} document${selExtra.size === 1 ? "" : "s"} from ${targetName} / ${targetDb}.${targetColl}. This cannot be undone.`,
                          confirmLabel: "Delete",
                          destructive: true,
                          run: () =>
                            runSync("delete", result.onlyInTargetDocs, selExtra, (n) =>
                              `Deleted ${n} document${n === 1 ? "" : "s"} from the target`
                            ),
                        })
                      }
                    >
                      Delete selected from target
                    </Button>
                  )}
                </TabsContent>
              </Tabs>

              {result.truncated && (
                <p className="text-xs text-muted-foreground">
                  Detail lists are capped at 200 entries per category — counts are complete.
                  Sync applies to the listed entries; re-run the diff to work through the rest.
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {busy ? (
            <Button variant="outline" size="sm" onClick={cancel}>
              Cancel diff
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
          <Button size="sm" disabled={!canRun} onClick={() => void runDiff()}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {result ? "Re-run diff" : "Run diff"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && !syncing && setConfirm(null)}
        title={confirm?.title ?? ""}
        description={confirm?.description}
        confirmLabel={confirm?.confirmLabel ?? "Confirm"}
        destructive={confirm?.destructive}
        busy={syncing}
        onConfirm={() => {
          if (confirm) void confirm.run();
        }}
      />
    </Dialog>
  );
}
