import { useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, LayoutGrid, Plus, Settings2, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConnections } from "@/stores/connections";
import { cn } from "@/lib/utils";

// Inline-pill budgeting. Estimates are deliberately conservative so the pills
// never push the right-side header controls; the zone also clips as a backstop.
const MAX_INLINE = 3;
const ACTIVE_RESERVE = 200; // px the active pill may occupy
const PILL_EST = 132; // px per inline quick-switch pill
const OVERFLOW_EST = 80; // px for the "N more" button

function StatusDot({ active }: { active?: boolean }) {
  if (active) {
    return (
      <span className="relative flex h-2 w-2 shrink-0">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-50" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
      </span>
    );
  }
  return <span className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40" />;
}

function SwitcherMenu({ onManage }: { onManage: () => void }) {
  const workspaces = useConnections((s) => s.workspaces);
  const activeId = useConnections((s) => s.activeId);
  const switchTo = useConnections((s) => s.switchTo);
  const disconnectWorkspace = useConnections((s) => s.disconnectWorkspace);

  return (
    <DropdownMenuContent align="start" className="w-72">
      <DropdownMenuLabel className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Connected workspaces
      </DropdownMenuLabel>
      {workspaces.map((w) => {
        const on = w.info.id === activeId;
        const host = (w.info.hostSummary ?? "").split(",")[0]?.replace(/:\d+$/, "") ?? "";
        return (
          <DropdownMenuItem
            key={w.info.id}
            className={cn("group/ws gap-2", on && "bg-accent/60")}
            onSelect={() => void switchTo(w.info.id)}
          >
            <StatusDot active={on} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{w.info.name}</div>
              {host && (
                <div className="truncate font-mono text-[10.5px] text-muted-foreground">{host}</div>
              )}
            </div>
            {on ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
            ) : (
              <button
                aria-label={`Disconnect ${w.info.name}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  void disconnectWorkspace(w.info.id);
                }}
                className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover/ws:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </DropdownMenuItem>
        );
      })}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onManage} className="gap-2 text-primary focus:text-primary">
        <Plus className="h-3.5 w-3.5" />
        New connection…
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onManage} className="gap-2">
        <Settings2 className="h-3.5 w-3.5" />
        Manage connections…
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}

export function WorkspaceBar({ onManage }: { onManage: () => void }) {
  const workspaces = useConnections((s) => s.workspaces);
  const activeId = useConnections((s) => s.activeId);
  const active = useConnections((s) => s.active);
  const switchTo = useConnections((s) => s.switchTo);

  // Available width for pills (the flex-1 zone) drives how many fit inline.
  const zoneRef = useRef<HTMLDivElement>(null);
  const [avail, setAvail] = useState(0);
  useLayoutEffect(() => {
    const el = zoneRef.current;
    if (!el) return;
    const update = () => setAvail(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const inactive = workspaces.filter((w) => w.info.id !== activeId);

  const fit = (reserve: number) => {
    const max = Math.min(MAX_INLINE, inactive.length);
    let n = 0;
    let budget = avail - ACTIVE_RESERVE - reserve;
    while (n < max && budget >= PILL_EST) {
      budget -= PILL_EST;
      n++;
    }
    return n;
  };
  let inlineCount = fit(0);
  if (inlineCount < inactive.length) inlineCount = fit(OVERFLOW_EST); // make room for "N more"
  const inline = inactive.slice(0, inlineCount);
  const overflow = inactive.slice(inlineCount);

  return (
    <div ref={zoneRef} className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden">
      {/* active workspace — click opens the switcher */}
      <DropdownMenu modal={false}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <button className="group flex min-w-0 items-center gap-2 rounded-md border border-transparent px-2 py-1 transition-colors hover:border-border hover:bg-accent">
                <StatusDot active />
                <span className="max-w-[180px] truncate text-sm font-medium">{active?.name}</span>
                <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent>Switch workspace</TooltipContent>
        </Tooltip>
        <SwitcherMenu onManage={onManage} />
      </DropdownMenu>

      {/* inline quick-switch pills */}
      {inline.map((w) => (
        <Tooltip key={w.info.id}>
          <TooltipTrigger asChild>
            <button
              onClick={() => void switchTo(w.info.id)}
              className="flex min-w-0 items-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground"
            >
              <StatusDot />
              <span className="max-w-[120px] truncate">{w.info.name}</span>
            </button>
          </TooltipTrigger>
          <TooltipContent>Switch to {w.info.name}</TooltipContent>
        </Tooltip>
      ))}

      {/* overflow switcher, or an add button when everything is inline */}
      {overflow.length > 0 ? (
        <DropdownMenu modal={false}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button className="flex shrink-0 items-center gap-1 rounded-md border border-transparent px-2 py-1 text-sm text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-foreground">
                  <LayoutGrid className="h-3.5 w-3.5" />
                  {overflow.length} more
                  <ChevronDown className="h-3 w-3 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>All workspaces</TooltipContent>
          </Tooltip>
          <SwitcherMenu onManage={onManage} />
        </DropdownMenu>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={onManage}
              aria-label="New connection"
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-border/60 text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>New connection</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
