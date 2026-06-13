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
    <footer className="no-select flex h-6 shrink-0 items-center gap-3 border-t bg-card px-3 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <Server className="h-3 w-3 text-primary" />
        MongoDB {active?.serverVersion}
      </span>
      <span>{active?.topology}</span>
      <span className="hidden font-mono lg:inline">{active?.hostSummary}</span>

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
      {stats && <span className="tabular-nums">{stats}</span>}
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onAbout}
            className="font-medium text-primary/90 transition-colors hover:text-primary"
          >
            Ognom{version ? ` ${version}` : ""}
          </button>
        </TooltipTrigger>
        <TooltipContent>About Ognom</TooltipContent>
      </Tooltip>
    </footer>
  );
}
