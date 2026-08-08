import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { ArrowLeft, ArrowRight, Check, Sparkles } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OgnomMark } from "@/components/WelcomeScreen";
import { markSeen, SLIDES } from "@/lib/whatsnew";
import { cn } from "@/lib/utils";

interface WhatsNewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function WhatsNewDialog({ open, onOpenChange }: WhatsNewDialogProps) {
  const [version, setVersion] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, [open]);

  const close = () => {
    // Seen (or skipped) counts as seen — it stays reachable from About.
    if (version) markSeen(version);
    onOpenChange(false);
  };

  const slide = SLIDES[index];
  const last = index === SLIDES.length - 1;
  const Icon = slide.icon;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="app-gradient flex flex-col gap-0 overflow-hidden p-0 sm:max-w-[460px]">
        <DialogTitle className="sr-only">What&apos;s new in Ognom</DialogTitle>

        {/* header */}
        <div className="no-select flex items-center gap-3 px-6 pb-4 pt-6">
          <OgnomMark className="h-9 w-9 drop-shadow" />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              What&apos;s new
            </p>
            {version && (
              <p className="font-mono text-xs text-muted-foreground">Ognom v{version}</p>
            )}
          </div>
        </div>

        {/* slide */}
        <div className="no-select min-h-[300px] px-6">
          <div
            key={index}
            className="animate-in fade-in slide-in-from-right-4 rounded-xl border border-primary/25 bg-primary/[0.06] p-5 duration-300"
          >
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/15 text-primary">
              <Icon className="h-5 w-5" />
            </div>
            <h3 className="text-lg font-bold leading-tight tracking-tight">{slide.title}</h3>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              {slide.tagline}
            </p>
            <ul className="mt-4 space-y-2">
              {slide.points.map((p) => (
                <li key={p} className="flex items-start gap-2 text-[13px] leading-snug">
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <span className="text-foreground/90">{p}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* controls */}
        <div className="flex items-center justify-between gap-3 px-6 py-4">
          <div className="flex items-center gap-1.5">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setIndex(i)}
                aria-label={`Slide ${i + 1}`}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === index ? "w-5 bg-primary" : "w-1.5 bg-primary/25 hover:bg-primary/50"
                )}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {index > 0 ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => setIndex((i) => i - 1)}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-muted-foreground"
                onClick={close}
              >
                Skip
              </Button>
            )}
            {last ? (
              <Button size="sm" className="h-8 gap-1.5 text-xs" onClick={close}>
                <Check className="h-3.5 w-3.5" />
                Let&apos;s go
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-8 gap-1 text-xs"
                onClick={() => setIndex((i) => i + 1)}
              >
                Next
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
