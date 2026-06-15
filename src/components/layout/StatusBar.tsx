import { useEffect, useState } from "react";
import { KeyRound, Server } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConnections } from "@/stores/connections";
import { useExplorer } from "@/stores/explorer";
import { formatCount } from "@/lib/bson";

export function StatusBar({ onAbout }: { onAbout?: () => void }) {
  const { active, security } = useConnections();
  const { tabs, activeTabId } = useExplorer();
  const tab = tabs.find((t) => t.id === activeTabId);
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion().then(setVersion).catch(() => setVersion(""));
  }, []);

  const hosts = (active?.hostSummary ?? "")
    .split(",")
    .map((h) => h.trim())
    .filter(Boolean);

  let stats: string | null = null;
  if (tab) {
    if (tab.mode === "documents" && tab.docs.execMs !== null) {
      const total = tab.docs.count !== null ? ` of ${tab.docs.countExact ? "" : "~"}${formatCount(tab.docs.count)}` : "";
      stats = `${tab.docs.docs.length}${total} docs · ${tab.docs.execMs}ms`;
    } else if (tab.mode === "aggregate" && tab.agg.docs) {
      stats = `${tab.agg.docs.length} results · ${tab.agg.execMs}ms`;
    } else if (tab.mode === "shell" && tab.shell.outcome) {
      stats = `${tab.shell.outcome.execMs}ms`;
    }
  }

  return (
    <footer className="no-select flex h-6 shrink-0 items-center gap-3 overflow-hidden whitespace-nowrap border-t bg-card px-3 text-[11px] text-muted-foreground">
      <span className="flex shrink-0 items-center gap-1.5">
        <Server className="h-3 w-3 text-primary" />
        MongoDB {active?.serverVersion}
      </span>
      {active?.topology && (
        hosts.length > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex shrink-0 cursor-default items-center gap-1.5">
                {active.topology}
                <span className="rounded bg-muted px-1.5 py-px font-mono text-[10px] text-foreground/70">
                  {hosts.length} {hosts.length === 1 ? "node" : "nodes"}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-none">
              <div className="flex flex-col gap-0.5 font-mono text-[11px]">
                {hosts.map((h) => (
                  <span key={h}>{h}</span>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        ) : (
          <span className="shrink-0">{active.topology}</span>
        )
      )}

      {security?.degraded && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 text-warning">
              <KeyRound className="h-3 w-3" />
              keychain unavailable
            </span>
          </TooltipTrigger>
          <TooltipContent>
            You opted into the OS keychain, but it isn't reachable — the encrypted local key file
            is being used instead.
          </TooltipContent>
        </Tooltip>
      )}

      <div className="flex-1" />
      {stats && <span className="shrink-0 tabular-nums">{stats}</span>}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onAbout}
            className="shrink-0 font-medium text-primary/90 transition-colors hover:text-primary"
          >
            Ognom{version ? ` ${version}` : ""}
          </button>
        </TooltipTrigger>
        <TooltipContent>About Ognom</TooltipContent>
      </Tooltip>
    </footer>
  );
}
