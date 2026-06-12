import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { RefreshCw } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OgnomMark } from "@/components/WelcomeScreen";
import { checkForUpdates } from "@/lib/updater";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (open) getVersion().then(setVersion).catch(() => setVersion(""));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="app-gradient sm:max-w-[380px]">
        <DialogTitle className="sr-only">About Ognom</DialogTitle>
        <div className="no-select flex flex-col items-center gap-3 py-4 text-center">
          <OgnomMark className="h-16 w-16 drop-shadow-lg" />
          <div>
            <h2 className="text-2xl font-bold tracking-tight">Ognom</h2>
            {version && (
              <p className="mt-0.5 font-mono text-xs text-muted-foreground">v{version}</p>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            The <span className="font-medium text-primary">free</span>, no-nonsense MongoDB
            client.
          </p>
          <p className="max-w-[280px] text-xs leading-relaxed text-muted-foreground/80">
            Native, lightweight, and yours forever. No account, no telemetry, no paywalled tabs —
            MIT licensed, built in the open.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void checkForUpdates(true)}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Check for updates
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
