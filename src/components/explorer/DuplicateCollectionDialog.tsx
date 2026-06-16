import { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
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
        `Duplicated to "${trimmed}" — ${documents} document${documents === 1 ? "" : "s"}` +
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
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Duplicate collection</DialogTitle>
          <DialogDescription asChild>
            <div>
              Copy all documents and indexes of{" "}
              <span className="font-mono font-medium text-foreground">{source}</span> into a new
              collection.
            </div>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor={nameId} className="text-xs font-normal text-muted-foreground">
            New collection name
          </Label>
          <Input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            disabled={busy}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            className="h-8 font-mono"
          />
          {trimmed === source && (
            <p className="text-xs text-destructive">Pick a name different from the source.</p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" disabled={!canDuplicate} onClick={() => void submit()}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Duplicate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
