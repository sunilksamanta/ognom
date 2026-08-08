import { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CodeEditor } from "@/components/CodeEditor";
import { api, errMsg, type Doc } from "@/lib/api";
import { previewValue } from "@/lib/diff";

/**
 * Bulk update / delete against the tab's current filter, with an
 * affected-document preview (count + sample ids) before anything runs.
 */

interface BulkProps {
  open: boolean;
  database: string;
  collection: string;
  /** The documents tab's current filter (mongosh-flavored). */
  filter: string;
  onOpenChange: (open: boolean) => void;
  /** Refresh the documents view after a successful mutation. */
  onDone: () => void;
}

/** Matched-count + sample-ids preview shared by both dialogs. */
function AffectedPreview({
  database,
  collection,
  filter,
  active,
}: {
  database: string;
  collection: string;
  filter: string;
  active: boolean;
}) {
  const [count, setCount] = useState<number | null>(null);
  const [exact, setExact] = useState(true);
  const [sample, setSample] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active) return;
    let stale = false;
    setLoading(true);
    setCount(null);
    setSample([]);
    void (async () => {
      try {
        const [c, page] = await Promise.all([
          api.countDocuments(database, collection, filter),
          api.findDocuments({
            database,
            collection,
            filter,
            sort: "",
            projection: "{ _id: 1 }",
            limit: 5,
            skip: 0,
          }),
        ]);
        if (stale) return;
        setCount(c.count ?? null);
        setExact(c.exact);
        setSample(page.docs);
      } catch {
        if (!stale) setCount(null);
      } finally {
        if (!stale) setLoading(false);
      }
    })();
    return () => {
      stale = true;
    };
  }, [active, database, collection, filter]);

  return (
    <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
      {loading ? (
        <span className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> counting matching documents…
        </span>
      ) : count === null ? (
        <span className="text-muted-foreground">Match count unavailable (slow count?)</span>
      ) : (
        <>
          <p>
            <span className="font-semibold tabular-nums">{count.toLocaleString()}</span>
            {!exact && "+"} document{count === 1 ? "" : "s"} will be affected
          </p>
          {sample.length > 0 && (
            <p className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
              e.g. {sample.map((d) => previewValue(d._id)).join(", ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function BulkUpdateDialog({
  open,
  database,
  collection,
  filter,
  onOpenChange,
  onDone,
}: BulkProps) {
  const [update, setUpdate] = useState("{\n  $set: {\n    \n  }\n}");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setUpdate("{\n  $set: {\n    \n  }\n}");
      setBusy(false);
    }
  }, [open]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.bulkUpdate(database, collection, filter, update);
      toast.success(
        `Updated ${r.modified.toLocaleString()} of ${r.matched.toLocaleString()} matched document${r.matched === 1 ? "" : "s"} · ${r.execMs}ms`
      );
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Bulk update</DialogTitle>
          <DialogDescription asChild>
            <div>
              Apply an operator update to every document in{" "}
              <span className="font-mono font-medium text-foreground">{collection}</span> matching
              the current filter.
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-normal text-muted-foreground">Filter</Label>
            <Input
              value={filter.trim() || "{ } — matches every document"}
              readOnly
              className="h-8 font-mono text-xs text-muted-foreground"
            />
          </div>
          <AffectedPreview
            database={database}
            collection={collection}
            filter={filter}
            active={open}
          />
          <div className="space-y-1.5">
            <Label className="text-xs font-normal text-muted-foreground">
              Update (operator syntax: $set, $unset, $inc, …)
            </Label>
            <CodeEditor value={update} onChange={setUpdate} height={120} path="bulk/update" />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void run()}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Update matching
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BulkDeleteDialog({
  open,
  database,
  collection,
  filter,
  onOpenChange,
  onDone,
}: BulkProps) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const emptyFilter = !filter.trim() || filter.trim() === "{}";

  useEffect(() => {
    if (open) {
      setConfirm("");
      setBusy(false);
    }
  }, [open]);

  const run = async () => {
    setBusy(true);
    try {
      const r = await api.bulkDelete(database, collection, filter);
      toast.success(`Deleted ${r.deleted.toLocaleString()} document${r.deleted === 1 ? "" : "s"} · ${r.execMs}ms`);
      onDone();
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Bulk delete
          </DialogTitle>
          <DialogDescription asChild>
            <div>
              Permanently delete every document in{" "}
              <span className="font-mono font-medium text-foreground">{collection}</span> matching
              the current filter. This cannot be undone.
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs font-normal text-muted-foreground">Filter</Label>
            <Input
              value={filter.trim() || "{ }"}
              readOnly
              className="h-8 font-mono text-xs text-muted-foreground"
            />
          </div>
          {emptyFilter ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              The filter is empty — bulk delete refuses to wipe a whole collection. Use
              right-click → Clear Collection for that.
            </p>
          ) : (
            <>
              <AffectedPreview
                database={database}
                collection={collection}
                filter={filter}
                active={open}
              />
              <div className="space-y-1.5">
                <Label className="text-xs font-normal text-muted-foreground">
                  Type <span className="font-mono font-medium text-foreground">{collection}</span>{" "}
                  to confirm
                </Label>
                <Input
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  className="h-8 font-mono text-xs"
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy || emptyFilter || confirm !== collection}
            onClick={() => void run()}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Delete matching
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
