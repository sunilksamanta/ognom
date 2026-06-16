import { ReactNode, useEffect, useId, useState } from "react";
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

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  /** Require an explicit "I know what I am doing" acknowledgement before confirming. */
  requireAck?: boolean;
  ackLabel?: string;
  /** Require the user to type this exact phrase (e.g. the name) before confirming. */
  confirmPhrase?: string;
  confirmPhraseLabel?: ReactNode;
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Confirm",
  destructive = false,
  busy = false,
  requireAck = false,
  ackLabel = "I know what I am doing",
  confirmPhrase,
  confirmPhraseLabel,
  onConfirm,
}: ConfirmDialogProps) {
  const ackId = useId();
  const phraseId = useId();
  const [ack, setAck] = useState(false);
  const [phrase, setPhrase] = useState("");

  // Reset the guards each time the dialog opens.
  useEffect(() => {
    if (open) {
      setAck(false);
      setPhrase("");
    }
  }, [open]);

  const phraseOk = !confirmPhrase || phrase.trim() === confirmPhrase.trim();
  const canConfirm = !busy && (!requireAck || ack) && phraseOk;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription asChild={typeof description !== "string"}>
            {typeof description === "string" ? description : <div>{description}</div>}
          </DialogDescription>}
        </DialogHeader>

        {requireAck && (
          <Label
            htmlFor={ackId}
            className="flex cursor-pointer items-center gap-2.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm font-normal"
          >
            <Checkbox
              id={ackId}
              checked={ack}
              onCheckedChange={(c) => setAck(c === true)}
              disabled={busy}
            />
            {ackLabel}
          </Label>
        )}

        {confirmPhrase && (
          <div className="space-y-1.5">
            <Label htmlFor={phraseId} className="text-xs font-normal text-muted-foreground">
              {confirmPhraseLabel ?? (
                <>
                  Type <span className="font-mono font-medium text-foreground">{confirmPhrase}</span>{" "}
                  to confirm
                </>
              )}
            </Label>
            <Input
              id={phraseId}
              value={phrase}
              onChange={(e) => setPhrase(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && canConfirm && void onConfirm()}
              disabled={busy}
              autoComplete="off"
              spellCheck={false}
              className="h-8"
            />
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            size="sm"
            disabled={!canConfirm}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
