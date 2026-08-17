import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DENSITIES, THEMES, useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");

/** Theme picker sheet: the theme kit's cards plus the density axis. */
export function AppearanceDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { theme, density, setTheme, setDensity } = useTheme();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[760px]">
        <DialogHeader>
          <DialogTitle>Appearance</DialogTitle>
          <DialogDescription>theme kit · 8 themes + follow OS · density is separate</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="themegrid">
            {THEMES.map((t) => (
              <button key={t.id} className={cn("tcard", theme === t.id && "on")} onClick={() => setTheme(t.id)} aria-pressed={theme === t.id}>
                <div className="prev">
                  {t.prev.map((c, i) => (
                    <i key={i} style={{ background: c }} />
                  ))}
                </div>
                <div className="nm">
                  {t.name}
                  {t.tag && <span>{t.tag}</span>}
                </div>
              </button>
            ))}
          </div>
          <div className="fld">
            <label>Density</label>
            <div className="opts">
              {DENSITIES.map((d) => (
                <button key={d.id} className={cn("opt", density === d.id && "on")} onClick={() => setDensity(d.id)} aria-pressed={density === d.id}>
                  <b>{d.label}</b>
                  <span>{d.hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="fld">
            <label>Theme kit</label>
            <div className="hint">
              A theme is one CSS block of the same 30 tokens - surfaces, hairlines, text, accent, semantics, syntax,
              watermark opacity. Nothing in the component layer knows which theme is on, so new themes ship without
              touching the app. Drop a block into <span className="mono">theme-kit.css</span> and it appears here.
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <span className="mr-auto font-mono text-[10.5px] text-text-3">{IS_MAC ? "⌘⇧T" : "Ctrl+Shift+T"} cycles themes</span>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
