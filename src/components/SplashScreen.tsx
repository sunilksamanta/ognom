import { useEffect, useState } from "react";
import { OgnomMark } from "@/components/brand/OgnomMark";
import { cn } from "@/lib/utils";

const HOLD_MS = 1400;
const FADE_MS = 400;
const SESSION_KEY = "ognom-splash-shown";

/**
 * Brand moment on launch: the mark on the canvas surface, then out of the way.
 * Shows once per app session; a click skips it immediately.
 */
export function SplashScreen() {
  const [phase, setPhase] = useState<"visible" | "fading" | "gone">(() =>
    sessionStorage.getItem(SESSION_KEY) ? "gone" : "visible"
  );

  useEffect(() => {
    if (phase !== "visible") return;
    sessionStorage.setItem(SESSION_KEY, "1");
    const holdMs = Number(sessionStorage.getItem("ognom-splash-hold")) || HOLD_MS;
    const hold = setTimeout(() => setPhase("fading"), holdMs);
    return () => clearTimeout(hold);
  }, [phase]);

  useEffect(() => {
    if (phase !== "fading") return;
    const fade = setTimeout(() => setPhase("gone"), FADE_MS);
    return () => clearTimeout(fade);
  }, [phase]);

  if (phase === "gone") return null;

  return (
    <div
      onClick={() => setPhase("fading")}
      className={cn(
        "no-select fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-bg transition-opacity ease-out",
        phase === "fading" && "opacity-0"
      )}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      aria-hidden
    >
      <OgnomMark className="splash-mark h-[72px] w-[72px] text-primary" />
      <div className="splash-rise flex flex-col items-center gap-2 text-center" style={{ animationDelay: "0.15s" }}>
        <h1 className="font-display text-[34px] font-semibold leading-none tracking-[-0.03em] text-text">Ognom</h1>
        <p className="text-[13.5px] text-text-2">The free, no-nonsense MongoDB client.</p>
      </div>
      <p className="splash-rise font-mono text-[10.5px] tracking-[0.12em] text-text-3" style={{ animationDelay: "0.3s" }}>
        FREE AND OPEN SOURCE · NO ACCOUNT · NO TELEMETRY
      </p>
    </div>
  );
}
