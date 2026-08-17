import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OgnomMark } from "@/components/brand/OgnomMark";
import { markSeen, SLIDES } from "@/lib/whatsnew";
import { cn } from "@/lib/utils";

interface WhatsNewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Version-gated release notes slider. Closing (or skipping) marks the version seen. */
export function WhatsNewDialog({ open, onOpenChange }: WhatsNewDialogProps) {
  const [version, setVersion] = useState("");
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setIndex(0);
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, [open]);

  const close = () => {
    // Seen (or skipped) counts as seen; it stays reachable from About.
    if (version) markSeen(version);
    onOpenChange(false);
  };

  const slide = SLIDES[index];
  const last = index === SLIDES.length - 1;
  const many = SLIDES.length > 1;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <OgnomMark className="h-8 w-8 shrink-0 text-primary" />
            <div className="min-w-0">
              <DialogTitle>What&apos;s new</DialogTitle>
              <DialogDescription>{version ? `Ognom v${version}` : "Ognom"} · release notes</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <DialogBody>
          <div key={index} className="animate-in fade-in slide-in-from-right-2 flex flex-col gap-4 duration-200">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="pill acc">v{slide.version}</span>
                {many && (
                  <span className="font-mono text-[10.5px] text-text-3">
                    {index + 1} / {SLIDES.length}
                  </span>
                )}
              </div>
              <h3 className="font-display text-[26px] font-semibold leading-none tracking-tight text-text">{slide.title}</h3>
              <p className="text-[13px] leading-relaxed text-text-2">{slide.tagline}</p>
            </div>

            <ul className="card">
              {slide.points.map((p) => (
                <li key={p} className="row !py-[9px]">
                  <div className="flex items-start gap-[10px]">
                    <Check className="mt-[3px] h-[13px] w-[13px] shrink-0 text-primary" />
                    <span className="text-[12.5px] leading-snug text-text">{p}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </DialogBody>

        <DialogFooter>
          {many && (
            <div className="mr-auto flex items-center gap-1.5">
              {SLIDES.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Slide ${i + 1}`}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    i === index ? "w-5 bg-primary" : "w-1.5 bg-line-2 hover:bg-text-3"
                  )}
                />
              ))}
            </div>
          )}
          {index > 0 ? (
            <Button variant="ghost" size="sm" onClick={() => setIndex((i) => i - 1)}>
              <ArrowLeft />
              Back
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={close}>
              Skip
            </Button>
          )}
          {last ? (
            <Button size="sm" onClick={close}>
              <Check />
              Let&apos;s go
            </Button>
          ) : (
            <Button size="sm" onClick={() => setIndex((i) => i + 1)}>
              Next
              <ArrowRight />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
