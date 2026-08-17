import { ReactNode, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
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

/** Generic confirm in the design's modal shape: title, mono subline, body,
 *  outline-danger or primary action. */
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
  const [ack, setAck] = useState(false);
  const [phrase, setPhrase] = useState("");

  useEffect(() => {
    if (open) {
      setAck(false);
      setPhrase("");
    }
  }, [open]);

  const phraseOk = !confirmPhrase || phrase.trim() === confirmPhrase.trim();
  const canConfirm = !busy && (!requireAck || ack) && phraseOk;
  const hasBody = !!description || requireAck || !!confirmPhrase;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-w-[460px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">{title}</DialogDescription>
        </DialogHeader>
        {hasBody && (
          <DialogBody>
            {description && (
              <div className="text-[12.5px] leading-[1.55] text-text-2">
                {description}
              </div>
            )}
            {requireAck && (
              <div className="warnbox soft py-[9px]">
                <CheckRow on={ack} onChange={setAck} disabled={busy}>
                  {ackLabel}
                </CheckRow>
              </div>
            )}
            {confirmPhrase && (
              <div className="fld">
                <label>
                  {confirmPhraseLabel ?? (
                    <>
                      Type <span className="text-text">{confirmPhrase}</span> to confirm
                    </>
                  )}
                </label>
                <input
                  className="in"
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && canConfirm && void onConfirm()}
                  disabled={busy}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={confirmPhrase}
                  autoFocus
                />
              </div>
            )}
          </DialogBody>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant={destructive ? "destructive" : "default"} disabled={!canConfirm} onClick={() => void onConfirm()}>
            {busy && <Loader2 className="spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
