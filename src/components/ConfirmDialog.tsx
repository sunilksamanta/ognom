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
  onConfirm,
}: ConfirmDialogProps) {
  const ackId = useId();
  const [ack, setAck] = useState(false);

  // Reset the acknowledgement each time the dialog opens.
  useEffect(() => {
    if (open) setAck(false);
  }, [open]);

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

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={destructive ? "destructive" : "default"}
            size="sm"
            disabled={busy || (requireAck && !ack)}
            onClick={() => void onConfirm()}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
