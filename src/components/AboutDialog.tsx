import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { ExternalLink, Feather, Github, Heart, Lock, RefreshCw, ShieldCheck, Sparkles, Star } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OgnomMark, OgnomTile } from "@/components/brand/OgnomMark";
import { useVersionLine } from "@/components/layout/Blank";
import { useConnections } from "@/stores/connections";
import { checkForUpdates } from "@/lib/updater";
import { openExternal, REPO_URL, REPO_LABEL, WEBSITE_URL, WEBSITE_LABEL } from "@/lib/links";

interface AboutDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Open the What's New slider (closes About first). */
  onWhatsNew?: () => void;
}

const PROPS = [
  { icon: Feather, title: "Native and light", hint: "A Rust core and your OS webview. Starts fast, stays out of the way." },
  { icon: Lock, title: "Private by design", hint: "No account, no sign-in, no telemetry. Nothing leaves your machine." },
  { icon: ShieldCheck, title: "Encrypted at rest", hint: "Credentials are AES-256-GCM encrypted; the key can live in your OS keychain." },
] as const;

/**
 * About: a hero panel on the left (mark on the chrome surface with the outline
 * watermark behind it) and a mono spec sheet on the right.
 */
export function AboutDialog({ open, onOpenChange, onWhatsNew }: AboutDialogProps) {
  const [version, setVersion] = useState("");
  const { env } = useVersionLine();
  const active = useConnections((s) => s.active);

  useEffect(() => {
    if (open) getVersion().then(setVersion).catch(() => setVersion(""));
  }, [open]);

  const specs: [string, React.ReactNode][] = [
    ["Version", <span className="pill acc">v{version || "?"}</span>],
    ["Platform", env || "-"],
    ["Engine", "Tauri 2 · Rust · React"],
    ["Server", active ? `MongoDB ${active.serverVersion}` : "not connected"],
    ["Licence", "MIT - free for everyone, forever"],
    ["Updates", "signed builds from GitHub releases"],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[860px]">
        <DialogTitle className="sr-only">About Ognom</DialogTitle>
        <DialogDescription className="sr-only">Version, licence and project links.</DialogDescription>

        <div className="grid min-h-0 grid-cols-[320px_1fr]">
          {/* hero */}
          <div className="no-select relative flex flex-col items-center justify-center overflow-hidden border-r border-line bg-chrome px-8 py-10 text-center">
            <div
              className="pointer-events-none absolute -left-24 -top-24 h-[420px] w-[420px]"
              style={{ color: "var(--text)", opacity: "var(--wm)" }}
              aria-hidden
            >
              <OgnomMark outline className="h-full w-full" />
            </div>
            <div
              className="pointer-events-none absolute left-1/2 top-[38%] h-[260px] w-[260px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              style={{ background: "radial-gradient(closest-side, var(--accent-glow), transparent 70%)", opacity: 0.55 }}
              aria-hidden
            />
            <div className="relative flex flex-col items-center gap-4">
              <OgnomTile size={96} />
              <div className="flex flex-col items-center gap-2">
                <h2 className="font-display text-[40px] font-semibold leading-none tracking-[-0.03em] text-text">Ognom</h2>
                <p className="max-w-[220px] text-[13px] leading-snug text-text-2">The free, no-nonsense MongoDB client.</p>
              </div>
              <button
                type="button"
                onClick={() => void openExternal(WEBSITE_URL)}
                className="pill acc hover:brightness-110"
              >
                {WEBSITE_LABEL}
                <ExternalLink />
              </button>
            </div>
            <div className="absolute inset-x-0 bottom-5 font-mono text-[10px] tracking-[0.14em] text-text-3">
              FREE · OPEN SOURCE · NO TELEMETRY
            </div>
          </div>

          {/* spec sheet */}
          <div className="relative flex min-h-0 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto px-7 pb-6 pt-7">
              <div className="fld">
                <label>Build</label>
                <div className="card">
                  {specs.map(([k, v]) => (
                    <div key={k} className="row" style={{ padding: "8px 12px" }}>
                      <span className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-text-3">{k}</span>
                      <span className="font-mono text-[11.5px] text-text-2">{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="fld">
                <label>What it stands for</label>
                <div className="flex flex-col gap-[7px]">
                  {PROPS.map(({ icon: Icon, title, hint }) => (
                    <div key={title} className="idxrow" style={{ padding: "10px 12px" }}>
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-[var(--r-sm)] bg-accent-soft text-primary">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium text-text">{title}</div>
                        <div className="text-[11px] leading-snug text-text-3">{hint}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="warnbox info items-center">
                <Heart />
                <div className="min-w-0 flex-1">
                  <b>Enjoying Ognom?</b>{" "}
                  <span className="text-text-2">
                    A star on GitHub helps more people find it, and means a lot to a solo developer.
                  </span>
                </div>
                <Button size="sm" onClick={() => void openExternal(REPO_URL)}>
                  <Star />
                  Star
                </Button>
              </div>
            </div>

            <div className="dlg-ft flex shrink-0 items-center gap-2 px-7 py-3">
              <button
                type="button"
                onClick={() => void openExternal(REPO_URL)}
                className="mr-auto inline-flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] text-text-3 hover:text-primary"
              >
                <Github className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{REPO_LABEL}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
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
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
