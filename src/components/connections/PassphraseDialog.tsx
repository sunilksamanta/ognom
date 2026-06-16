import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
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

interface PassphraseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  /** Setting a new passphrase: show a second field that must match. */
  requireConfirm?: boolean;
  busy?: boolean;
  onSubmit: (passphrase: string) => void | Promise<void>;
}

export function PassphraseDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "Continue",
  requireConfirm = false,
  busy = false,
  onSubmit,
}: PassphraseDialogProps) {
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");

  useEffect(() => {
    if (open) {
      setPass("");
      setConfirm("");
    }
  }, [open]);

  const mismatch = requireConfirm && confirm.length > 0 && pass !== confirm;
  const ready = pass.length > 0 && (!requireConfirm || pass === confirm) && !busy;
  const submit = () => {
    if (ready) void onSubmit(pass);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Passphrase</Label>
            <Input
              type="password"
              autoFocus
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !requireConfirm && submit()}
              className="h-8"
            />
          </div>

          {requireConfirm && (
            <div className="space-y-1.5">
              <Label className="text-xs">Confirm passphrase</Label>
              <Input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                className="h-8"
              />
              {mismatch && <p className="text-xs text-destructive">Passphrases don&apos;t match.</p>}
            </div>
          )}

          {requireConfirm && (
            <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-muted-foreground">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
              There&apos;s no recovery — if you lose this passphrase the exported credentials are
              gone for good.
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" disabled={!ready} onClick={submit}>
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
