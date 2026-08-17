import { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
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
import { api, errMsg } from "@/lib/api";

interface DuplicateCollectionDialogProps {
  open: boolean;
  database: string;
  source: string;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful duplicate so the caller can refresh its list. */
  onDuplicated: (newCollection: string) => void;
}

export function DuplicateCollectionDialog({
  open,
  database,
  source,
  onOpenChange,
  onDuplicated,
}: DuplicateCollectionDialogProps) {
  const nameId = useId();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  // Prefill "<source>_backup" each time the dialog opens for a collection.
  useEffect(() => {
    if (open) {
      setName(`${source}_backup`);
      setBusy(false);
    }
  }, [open, source]);

  const trimmed = name.trim();
  const canDuplicate = !busy && trimmed.length > 0 && trimmed !== source;

  const submit = async () => {
    if (!canDuplicate) return;
    setBusy(true);
    try {
      const { documents, indexes } = await api.duplicateCollection(database, source, trimmed);
      toast.success(
        `Duplicated to "${trimmed}" - ${documents} document${documents === 1 ? "" : "s"}` +
          (indexes > 0 ? `, ${indexes} index${indexes === 1 ? "" : "es"}` : "")
      );
      onDuplicated(trimmed);
      onOpenChange(false);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Duplicate collection</DialogTitle>
          <DialogDescription>
            {database}.{source}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          <p className="text-[12.5px] leading-relaxed text-text-2">
            Copy all documents and indexes of <span className="mono text-text">{source}</span> into a new
            collection.
          </p>
          <div className="fld">
            <label htmlFor={nameId}>New collection name</label>
            <input
              id={nameId}
              className={trimmed === source ? "in dgr" : "in"}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void submit()}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              autoFocus
            />
            {trimmed === source && <span className="hint text-danger">Pick a name different from the source.</span>}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={!canDuplicate} onClick={() => void submit()}>
            {busy && <Loader2 className="spin h-4 w-4 text-text-3" />}
            Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
