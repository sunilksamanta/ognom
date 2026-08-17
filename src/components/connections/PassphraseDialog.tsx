import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
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
import { cn } from "@/lib/utils";

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
      <DialogContent className="max-w-[420px]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <DialogBody>
          <div className="fld">
            <label htmlFor="pp-pass">Passphrase</label>
            <input
              id="pp-pass"
              className="in"
              type="password"
              autoFocus
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !requireConfirm && submit()}
            />
          </div>
          {requireConfirm && (
            <div className="fld">
              <label htmlFor="pp-confirm">Confirm passphrase</label>
              <input
                id="pp-confirm"
                className={cn("in", mismatch && "dgr")}
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
              {mismatch && <span className="hint text-danger">Passphrases don't match.</span>}
            </div>
          )}
          {requireConfirm && (
            <div className="warnbox soft">
              <ShieldAlert />
              <div>There is no recovery - if you lose this passphrase the exported credentials are gone for good.</div>
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={submit}>
            {busy && <Loader2 className="spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
