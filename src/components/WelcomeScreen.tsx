import { useState } from "react";
import { Feather, Loader2, Lock, Plus, ShieldCheck, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConnectionManager } from "@/components/connections/ConnectionManager";
import { PROFILE_COLORS } from "@/components/connections/ConnectionForm";
import { ThemeToggle } from "@/components/theme-toggle";
import { useConnections } from "@/stores/connections";
import { timeAgo } from "@/lib/bson";
import { dragWindow } from "@/lib/window";
import { cn } from "@/lib/utils";

export function OgnomMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="ognom-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#34D399" />
          <stop offset="100%" stopColor="#0E9F6E" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="15" fill="url(#ognom-g)" />
      <path
        d="M25 18c-5 0-7 2.6-7 7v4.4c0 2.4-1.2 3.6-3.6 3.6 2.4 0 3.6 1.2 3.6 3.6V41c0 4.4 2 7 7 7"
        fill="none"
        stroke="#06281A"
        strokeWidth="4.4"
        strokeLinecap="round"
      />
      <path
        d="M39 18c5 0 7 2.6 7 7v4.4c0 2.4 1.2 3.6 3.6 3.6-2.4 0-3.6 1.2-3.6 3.6V41c0 4.4-2 7-7 7"
        fill="none"
        stroke="#06281A"
        strokeWidth="4.4"
        strokeLinecap="round"
      />
      <circle cx="32" cy="33" r="4.6" fill="#06281A" />
    </svg>
  );
}

export function WelcomeScreen() {
  const { profiles, connect, connectingId, status } = useConnections();
  const [managerOpen, setManagerOpen] = useState(false);

  return (
    <div className="flex h-full flex-col">
      {/* titlebar drag strip (overlay traffic lights on macOS) */}
      <div onMouseDown={dragWindow} className="flex h-10 shrink-0 items-center justify-end px-3">
        <ThemeToggle />
      </div>

      <div className="flex flex-1 items-center justify-center overflow-y-auto px-8 pb-12">
        <div className="grid w-full max-w-4xl gap-12 lg:grid-cols-[1.1fr_1fr]">
          {/* brand */}
          <div onMouseDown={dragWindow} className="no-select flex flex-col justify-center gap-6">
            <OgnomMark className="h-16 w-16 drop-shadow-lg" />
            <div>
              <h1 className="text-4xl font-bold tracking-tight">Ognom</h1>
              <p className="mt-2 text-lg text-muted-foreground">
                The free, no-nonsense MongoDB client.
              </p>
            </div>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li className="flex items-center gap-3">
                <Feather className="h-4 w-4 shrink-0 text-primary" />
                Native and lightweight — no Electron, no lag, tiny footprint.
              </li>
              <li className="flex items-center gap-3">
                <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
                Credentials AES-256 encrypted at rest — OS keychain optional.
              </li>
              <li className="flex items-center gap-3">
                <Zap className="h-4 w-4 shrink-0 text-primary" />
                JSON & table views, aggregation builder, real shell syntax.
              </li>
            </ul>
            <p className="text-xs text-muted-foreground/70">
              Free & open source · no account · no telemetry
            </p>
          </div>

          {/* connections */}
          <div className="flex flex-col justify-center gap-3">
            <div className="flex items-center justify-between">
              <h2 className="no-select text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Connections
              </h2>
              <Button size="sm" onClick={() => setManagerOpen(true)}>
                <Plus className="h-4 w-4" />
                New
              </Button>
            </div>

            {profiles.length === 0 ? (
              <button
                onClick={() => setManagerOpen(true)}
                className="group flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center transition-colors hover:border-primary/50 hover:bg-accent/30"
              >
                <div className="rounded-full bg-primary/10 p-3 transition-transform group-hover:scale-110">
                  <Plus className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="font-medium">Connect to MongoDB</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    localhost, a replica set, or Atlas — takes ten seconds.
                  </p>
                </div>
              </button>
            ) : (
              <ScrollArea className="max-h-[420px] rounded-xl border bg-card/50">
                <div className="flex flex-col gap-1 p-2">
                  {profiles.map((p) => (
                    <button
                      key={p.id}
                      disabled={status === "connecting"}
                      onClick={() => void connect(p.id)}
                      className={cn(
                        "flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        "hover:bg-accent disabled:opacity-60",
                        connectingId === p.id && "bg-accent"
                      )}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: p.color ?? PROFILE_COLORS[0] }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">{p.name}</span>
                          {p.srv && (
                            <Badge variant="outline" className="h-4 px-1 text-[10px]">
                              SRV
                            </Badge>
                          )}
                          {p.tls && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                        </div>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {p.hostSummary || "(connection string)"}
                        </p>
                      </div>
                      {connectingId === p.id ? (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                      ) : (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {timeAgo(p.lastUsedAt)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </ScrollArea>
            )}

            {profiles.length > 0 && (
              <button
                onClick={() => setManagerOpen(true)}
                className="self-start text-xs text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Manage connections…
              </button>
            )}
          </div>
        </div>
      </div>

      <ConnectionManager open={managerOpen} onOpenChange={setManagerOpen} />
    </div>
  );
}
