import { useEffect, useState } from "react";
import { OgnomMark } from "@/components/WelcomeScreen";
import { cn } from "@/lib/utils";

const HOLD_MS = 1900;
const FADE_MS = 450;
const SESSION_KEY = "ognom-splash-shown";

/**
 * Brand moment on launch: the narrative, loud and clear, then out of the way.
 * Shows once per app session; a click skips it immediately.
 */
export function SplashScreen() {
  const [phase, setPhase] = useState<"visible" | "fading" | "gone">(() =>
    sessionStorage.getItem(SESSION_KEY) ? "gone" : "visible"
  );

  useEffect(() => {
    if (phase !== "visible") return;
    sessionStorage.setItem(SESSION_KEY, "1");
    // QA override: sessionStorage.setItem("ognom-splash-hold", ms)
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
        "no-select fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5",
        "app-gradient bg-background transition-opacity ease-out",
        phase === "fading" && "opacity-0"
      )}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      aria-hidden
    >
      {/* soft halo behind the mark */}
      <div className="relative">
        <div className="splash-glow absolute -inset-10 rounded-full bg-primary/15 blur-3xl" />
        <OgnomMark className="splash-mark relative h-20 w-20 drop-shadow-xl" />
      </div>

      <div className="splash-rise flex flex-col items-center gap-2 text-center" style={{ animationDelay: "0.18s" }}>
        <h1 className="text-4xl font-bold tracking-tight">Ognom</h1>
        <p className="text-lg text-muted-foreground">
          The <span className="font-semibold text-primary">free</span>, no-nonsense MongoDB client.
        </p>
      </div>

      <p
        className="splash-rise text-xs tracking-wide text-muted-foreground/70"
        style={{ animationDelay: "0.38s" }}
      >
        Free & open source · no account · no telemetry · yours forever
      </p>
    </div>
  );
}
