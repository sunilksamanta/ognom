import { useState } from "react";
import { ChevronDown, Cpu, PanelsTopLeft, PlugZap, Search, Settings2, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SettingsDialog } from "@/components/SettingsDialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { OgnomMark } from "@/components/WelcomeScreen";
import { ConnectionManager } from "@/components/connections/ConnectionManager";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useConnections } from "@/stores/connections";
import { useExplorer } from "@/stores/explorer";
import { useSettings } from "@/stores/settings";
import { useStudio } from "@/stores/studio";
import { dragWindow } from "@/lib/window";
import { cn } from "@/lib/utils";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const { active, disconnect } = useConnections();
  const resetExplorer = useExplorer((s) => s.reset);
  const advancedMode = useSettings((s) => s.advancedMode);
  const { terminator, setTerminator } = useStudio();
  const [managerOpen, setManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  return (
    <header
      onMouseDown={dragWindow}
      className={cn(
        "no-select flex h-11 shrink-0 items-center gap-2 border-b bg-card px-3",
        IS_MAC && "pl-[84px]"
      )}
    >
      <OgnomMark className="h-5 w-5 shrink-0" />

      {/* connection pill */}
      <button
        onClick={() => setManagerOpen(true)}
        className="group flex min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1 transition-colors hover:border-border hover:bg-accent"
        title="Manage connections"
      >
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-50" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
        </span>
        <span className="truncate text-sm font-medium">{active?.name}</span>
        <span className="hidden truncate font-mono text-xs text-muted-foreground md:inline">
          {active?.hostSummary}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
      </button>

      <div className="flex-1" />

      {/* mode switch — classic workspace vs Terminator mode (Ognom Studio) */}
      <div className="flex items-center rounded-md border bg-muted/60 p-0.5">
        {(
          [
            { on: false, label: "Normal", icon: PanelsTopLeft, hint: "Classic workspace" },
            { on: true, label: "Terminator", icon: Cpu, hint: "Ognom Studio — AI visualization & query optimization" },
          ] as const
        ).map((m) => (
          <Tooltip key={m.label}>
            <TooltipTrigger asChild>
              <button
                onClick={() => setTerminator(m.on)}
                className={cn(
                  "flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
                  terminator === m.on
                    ? m.on
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                <m.icon className="h-3.5 w-3.5" />
                {m.label}
              </button>
            </TooltipTrigger>
            <TooltipContent>{m.hint}</TooltipContent>
          </Tooltip>
        ))}
      </div>

      <div className="mx-1 h-5 w-px bg-border" />

      {/* command palette hint */}
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-2 text-xs text-muted-foreground"
        onClick={onOpenPalette}
      >
        <Search className="h-3.5 w-3.5" />
        Go to collection
        <kbd className="rounded border bg-muted px-1 font-mono text-[10px]">
          {IS_MAC ? "⌘K" : "Ctrl K"}
        </kbd>
      </Button>

      {advancedMode && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              <Terminal className="h-3 w-3" />
              Shell
            </span>
          </TooltipTrigger>
          <TooltipContent>Advanced mode is on — shell tab unlocked</TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setSettingsOpen(true)}>
            <Settings2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Settings</TooltipContent>
      </Tooltip>

      <ThemeToggle />

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={() => setConfirmDisconnect(true)}
          >
            <PlugZap className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Disconnect</TooltipContent>
      </Tooltip>

      <ConnectionManager open={managerOpen} onOpenChange={setManagerOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect?"
        description={`Close the connection to ${active?.name ?? "the server"} and all open tabs.`}
        confirmLabel="Disconnect"
        onConfirm={async () => {
          await disconnect();
          resetExplorer();
          setConfirmDisconnect(false);
        }}
      />
    </header>
  );
}
