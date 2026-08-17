import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { ExternalLink, Feather, Github, Lock, RefreshCw, ShieldCheck, Sparkles, Star } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OgnomTile } from "@/components/brand/OgnomMark";
import { checkForUpdates } from "@/lib/updater";
import { openExternal, REPO_URL, REPO_LABEL, WEBSITE_URL, WEBSITE_LABEL } from "@/lib/links";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open the What's New slider (closes About first). */
  onWhatsNew?: () => void;
}

const PROPS = [
  { icon: Feather, title: "Native and light", hint: "A Rust core with a small footprint. Starts fast, stays out of the way." },
  { icon: Lock, title: "Private by design", hint: "No account, no sign-in, no telemetry. Nothing leaves your machine." },
  { icon: ShieldCheck, title: "Encrypted at rest", hint: "Credentials are AES-256-GCM encrypted; the key lives in your OS keychain." },
] as const;

export function AboutDialog({ open, onOpenChange, onWhatsNew }: AboutDialogProps) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    if (open) getVersion().then(setVersion).catch(() => setVersion(""));
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle className="sr-only">About Ognom</DialogTitle>
          <DialogDescription className="sr-only">Version, licence and project links.</DialogDescription>
        </DialogHeader>

        <DialogBody className="gap-4">
          {/* identity */}
          <div className="no-select flex flex-col items-center gap-3 pt-2 text-center">
            <OgnomTile size={72} />
            <div className="flex flex-col items-center gap-1">
              <h2 className="font-display text-[30px] font-semibold leading-none tracking-tight text-text">Ognom</h2>
              {version && <span className="pill">v{version}</span>}
            </div>
            <div className="flex flex-col items-center gap-1">
              <p className="text-[13px] text-text-2">The free, no-nonsense MongoDB client.</p>
              <button
                type="button"
                onClick={() => void openExternal(WEBSITE_URL)}
                className="inline-flex items-center gap-1 font-mono text-[11.5px] text-primary hover:underline"
              >
                {WEBSITE_LABEL}
                <ExternalLink className="h-3 w-3" />
              </button>
            </div>
          </div>

          {/* what makes it different */}
          <div className="opts">
            {PROPS.map(({ icon: Icon, title, hint }) => (
              <div key={title} className="opt cursor-default">
                <Icon className="mb-2 h-4 w-4 text-primary" />
                <b>{title}</b>
                <span>{hint}</span>
              </div>
            ))}
          </div>

          {/* star ask */}
          <div className="card border-accent-line bg-accent-soft">
            <div className="row">
              <div className="flex min-w-0 items-start gap-3">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-[var(--r-sm)] bg-accent-soft text-primary">
                  <Star className="h-4 w-4" />
                </div>
                <div className="l">
                  <b>Enjoying Ognom?</b>
                  <span>It is free and MIT-licensed. A star on GitHub helps more people find it, and means a lot to a solo developer.</span>
                </div>
              </div>
              <div className="rr">
                <Button size="sm" onClick={() => void openExternal(REPO_URL)}>
                  <Github />
                  Star
                </Button>
              </div>
            </div>
          </div>
        </DialogBody>

        <DialogFooter>
          <button
            type="button"
            onClick={() => void openExternal(REPO_URL)}
            className="mr-auto flex min-w-0 flex-col items-start text-left font-mono text-[10.5px] leading-tight text-text-3 hover:text-primary"
          >
            <span>MIT licensed</span>
            <span className="inline-flex max-w-full items-center gap-1">
              <span className="truncate">{REPO_LABEL}</span>
              <ExternalLink className="h-3 w-3 shrink-0" />
            </span>
          </button>
          {onWhatsNew && (
            <Button variant="outline" size="sm" onClick={onWhatsNew}>
              <Sparkles />
              What&apos;s new
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => void checkForUpdates(true)}>
            <RefreshCw />
            Check for updates
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
