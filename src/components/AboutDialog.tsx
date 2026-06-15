import { useEffect, useState, type ReactNode } from "react";
import { getVersion } from "@tauri-apps/api/app";
import {
  ExternalLink,
  Feather,
  Github,
  Heart,
  Lock,
  RefreshCw,
  ShieldCheck,
  Star,
} from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OgnomMark } from "@/components/WelcomeScreen";
import { checkForUpdates } from "@/lib/updater";
import { openExternal, REPO_URL, REPO_LABEL } from "@/lib/links";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function Prop({ icon: Icon, label }: { icon: typeof Feather; label: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border bg-card/60 px-2 py-3 text-center">
      <Icon className="h-4 w-4 text-primary" />
      <span className="text-[11px] font-medium leading-tight text-muted-foreground">{label}</span>
    </div>
  );
}

export function AboutDialog({ open, onOpenChange }: AboutDialogProps) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (open) getVersion().then(setVersion).catch(() => setVersion(""));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="app-gradient flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[440px]">
        <DialogTitle className="sr-only">About Ognom</DialogTitle>

        {/* identity */}
        <div className="no-select flex flex-col items-center gap-3 px-6 pb-5 pt-9 text-center">
          <OgnomMark className="h-16 w-16 drop-shadow-lg" />
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-primary">Ognom</h2>
            {version && (
              <p className="mt-0.5 font-mono text-xs font-medium text-primary/80">v{version}</p>
            )}
          </div>
          <p className="text-sm text-muted-foreground">The free, no-nonsense MongoDB client.</p>
        </div>

        {/* Free & Open — the heart of it */}
        <div className="mx-6 rounded-xl border border-primary/25 bg-primary/[0.06] p-4 text-center">
          <div className="mb-1.5 flex items-center justify-center gap-1.5 text-primary">
            <Heart className="h-3.5 w-3.5 fill-current" />
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em]">
              Free &amp; Open, for real
            </span>
          </div>
          <p className="text-[13px] leading-relaxed text-foreground/90">
            No license keys. No locked “pro” tabs. No account, no sign-in, no telemetry watching
            over your shoulder. Ognom is MIT-licensed and built in the open — yours to use, read,
            fork, and keep, <span className="font-medium text-primary">forever</span>.
          </p>
        </div>

        {/* what makes it different */}
        <div className="grid grid-cols-3 gap-2 px-6 pt-4">
          <Prop icon={Feather} label="Native & light" />
          <Prop icon={Lock} label="Private by design" />
          <Prop icon={ShieldCheck} label="Encrypted at rest" />
        </div>

        {/* star ask */}
        <div className="mx-6 mt-4 rounded-xl border border-primary/25 bg-primary/[0.06] p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
              <Star className="h-4 w-4 fill-current" />
            </div>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-foreground">Enjoying Ognom?</p>
              <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">
                It’s free and open source. A star on GitHub helps more people find it — and means a
                lot to a solo developer.
              </p>
            </div>
          </div>
          <Button className="mt-3 w-full gap-2" onClick={() => void openExternal(REPO_URL)}>
            <Github className="h-4 w-4" />
            Star on GitHub
            <Star className="h-3.5 w-3.5 fill-current" />
          </Button>
        </div>

        {/* footer */}
        <div className="mt-6 flex items-center justify-between gap-3 border-t bg-card/40 px-6 py-3">
          <button
            type="button"
            onClick={() => void openExternal(REPO_URL)}
            className="group flex flex-col items-start text-left font-mono text-[11px] leading-tight text-muted-foreground transition-colors hover:text-primary"
          >
            <span>MIT licensed</span>
            <span className="inline-flex items-center gap-1 group-hover:underline">
              {REPO_LABEL}
              <ExternalLink className="h-3 w-3" />
            </span>
          </button>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 gap-1.5"
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
