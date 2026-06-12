import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api, errMsg, type CollectionStats, type IndexInfo } from "@/lib/api";
import { toShellText, formatBytes, formatCount } from "@/lib/bson";
import type { Tab } from "@/stores/explorer";

interface IndexesSheetProps {
  tab: Tab;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function IndexesSheet({ tab, open, onOpenChange }: IndexesSheetProps) {
  const [indexes, setIndexes] = useState<IndexInfo[] | null>(null);
  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [creating, setCreating] = useState(false);
  const [keysText, setKeysText] = useState("{ field: 1 }");
  const [name, setName] = useState("");
  const [unique, setUnique] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dropping, setDropping] = useState<string | null>(null);

  const load = async () => {
    try {
      const [idx, st] = await Promise.all([
        api.listIndexes(tab.database, tab.collection),
        api.collectionStats(tab.database, tab.collection).catch(() => null),
      ]);
      setIndexes(idx);
      setStats(st);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  useEffect(() => {
    if (open) {
      setIndexes(null);
      setCreating(false);
      void load();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = async () => {
    setBusy(true);
    try {
      const created = await api.createIndex({
        database: tab.database,
        collection: tab.collection,
        keysText,
        name: name.trim() || undefined,
        unique,
      });
      toast.success(`Created index "${created}"`);
      setCreating(false);
      setKeysText("{ field: 1 }");
      setName("");
      setUnique(false);
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle>Indexes & stats</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {tab.database}.{tab.collection}
            </DialogDescription>
          </DialogHeader>

          {stats && (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
              {(
                [
                  ["Documents", formatCount(stats.count)],
                  ["Data", formatBytes(stats.size)],
                  ["Storage", formatBytes(stats.storageSize)],
                  ["Avg doc", formatBytes(stats.avgObjSize)],
                  ["Index size", formatBytes(stats.totalIndexSize)],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="rounded-md border bg-muted/40 px-2.5 py-1.5">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    {label}
                  </p>
                  <p className="text-sm font-semibold tabular-nums">{value}</p>
                </div>
              ))}
            </div>
          )}

          <Separator />

          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">
              Indexes{indexes ? ` (${indexes.length})` : ""}
            </h4>
            <Button variant="outline" size="sm" onClick={() => setCreating((c) => !c)}>
              <Plus className="h-3.5 w-3.5" />
              New index
            </Button>
          </div>

          {creating && (
            <div className="space-y-3 rounded-lg border bg-muted/40 p-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Keys</Label>
                <Input
                  value={keysText}
                  onChange={(e) => setKeysText(e.target.value)}
                  className="h-8 font-mono text-xs"
                  placeholder='{ email: 1, createdAt: -1 } or { location: "2dsphere" }'
                  spellCheck={false}
                />
              </div>
              <div className="flex items-end gap-3">
                <div className="flex-1 space-y-1.5">
                  <Label className="text-xs">Name (optional)</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="auto-generated"
                  />
                </div>
                <label className="flex items-center gap-2 pb-2 text-xs">
                  <Checkbox checked={unique} onCheckedChange={(v) => setUnique(v === true)} />
                  Unique
                </label>
                <Button size="sm" onClick={() => void handleCreate()} disabled={busy}>
                  {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Create
                </Button>
              </div>
            </div>
          )}

          {indexes === null ? (
            <div className="flex justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {indexes.map((idx) => (
                <div
                  key={idx.name}
                  className="group flex items-center gap-2 rounded-md border bg-card px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{idx.name}</span>
                      {idx.unique && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                          unique
                        </Badge>
                      )}
                      {idx.sparse && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                          sparse
                        </Badge>
                      )}
                      {idx.ttlSeconds !== null && idx.ttlSeconds !== undefined && (
                        <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                          ttl {idx.ttlSeconds}s
                        </Badge>
                      )}
                    </div>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {toShellText(idx.keys)}
                    </p>
                  </div>
                  {idx.name !== "_id_" && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      onClick={() => setDropping(idx.name)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={dropping !== null}
        onOpenChange={(o) => !o && setDropping(null)}
        title={`Drop index “${dropping}”?`}
        description="Queries relying on this index may slow down. This cannot be undone."
        confirmLabel="Drop index"
        destructive
        busy={busy}
        onConfirm={async () => {
          if (!dropping) return;
          setBusy(true);
          try {
            await api.dropIndex(tab.database, tab.collection, dropping);
            toast.success(`Dropped "${dropping}"`);
            setDropping(null);
            await load();
          } catch (e) {
            toast.error(errMsg(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
