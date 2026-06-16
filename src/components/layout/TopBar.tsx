import { useState } from "react";
import { CircleHelp, Cpu, PanelsTopLeft, PlugZap, Search, Settings2, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SettingsDialog } from "@/components/SettingsDialog";
import { HelpDialog } from "@/components/HelpDialog";
import { ThemeToggle } from "@/components/theme-toggle";
import { OgnomMark } from "@/components/WelcomeScreen";
import { WorkspaceBar } from "@/components/layout/WorkspaceBar";
import { ConnectionManager } from "@/components/connections/ConnectionManager";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useConnections } from "@/stores/connections";
import { useSettings } from "@/stores/settings";
import { dragWindow } from "@/lib/window";
import { cn } from "@/lib/utils";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");

export function TopBar({ onOpenPalette }: { onOpenPalette: () => void }) {
  const active = useConnections((s) => s.active);
  const activeId = useConnections((s) => s.activeId);
  const disconnectWorkspace = useConnections((s) => s.disconnectWorkspace);
  const advancedMode = useSettings((s) => s.advancedMode);
  // Terminator (Ognom Studio) mode is remembered per workspace.
  const terminator = useConnections((s) => {
    const ws = s.workspaces.find((w) => w.info.id === s.activeId);
    return ws?.terminator ?? false;
  });
  const setTerminator = useConnections((s) => s.setTerminator);
  const [managerOpen, setManagerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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

      {/* workspace switcher — name-only active pill, quick-switch pills, overflow */}
      <WorkspaceBar onManage={() => setManagerOpen(true)} />

      {/* right-side controls stay put; the workspace bar takes the slack */}
      <div className="flex shrink-0 items-center gap-2">
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
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setHelpOpen(true)}>
            <CircleHelp className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Help &amp; examples</TooltipContent>
      </Tooltip>

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
        <TooltipContent>Disconnect this workspace</TooltipContent>
      </Tooltip>
      </div>

      <ConnectionManager open={managerOpen} onOpenChange={setManagerOpen} />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
      <HelpDialog open={helpOpen} onOpenChange={setHelpOpen} />
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect this workspace?"
        description={`Close the connection to ${active?.name ?? "the server"} and its open tabs. Other workspaces stay connected.`}
        confirmLabel="Disconnect"
        onConfirm={async () => {
          if (activeId) await disconnectWorkspace(activeId);
          setConfirmDisconnect(false);
        }}
      />
    </header>
  );
}
