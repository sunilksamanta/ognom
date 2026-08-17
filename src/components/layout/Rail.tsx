import { useState } from "react";
import { Activity, Brush, CircleHelp, Database, Loader2, Server, Settings } from "lucide-react";
import { OgnomMark } from "@/components/brand/OgnomMark";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useConnections } from "@/stores/connections";
import { useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import type { ProfileSummary } from "@/lib/api";
import { cn } from "@/lib/utils";

/** Two-letter tile label from a connection name: "staging-eu" -> "SE". */
export function initials(name: string): string {
  const parts = name
    .replace(/[^A-Za-z0-9\s_-]/g, " ")
    .split(/[\s_-]+/)
    .filter(Boolean);
  if (parts.length === 0) return "??";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/**
 * The rail: connection tiles first (saved profiles + any ad-hoc workspaces),
 * then the sections, then appearance / settings pinned to the bottom.
 * Tiles: colour tag top-left, live dot bottom-right, dashed border = read-only,
 * red border = production.
 */
export function Rail() {
  const profiles = useConnections((s) => s.profiles);
  const workspaces = useConnections((s) => s.workspaces);
  const activeId = useConnections((s) => s.activeId);
  const connectingId = useConnections((s) => s.connectingId);
  const connect = useConnections((s) => s.connect);
  const switchTo = useConnections((s) => s.switchTo);
  const disconnectWorkspace = useConnections((s) => s.disconnectWorkspace);
  const status = useConnections((s) => s.status);
  const openConnections = useUi((s) => s.openConnections);
  const ui = useUi((s) => s.set);
  const pickerCollapsed = useSettings((s) => s.pickerCollapsed);
  const togglePicker = useSettings((s) => s.togglePicker);
  const [confirmClose, setConfirmClose] = useState<{ id: string; name: string } | null>(null);

  // Saved profiles first (rail order = profile order), then ad-hoc workspaces.
  const adhoc = workspaces.filter((w) => !w.info.profileId);
  const byProfile = new Map(workspaces.map((w) => [w.info.profileId ?? "", w]));

  const tile = (p: ProfileSummary | null, wsId: string | null, name: string, color: string | null | undefined, access: string) => {
    const ws = wsId ? workspaces.find((w) => w.info.id === wsId) : null;
    const live = !!ws;
    const on = live && ws!.info.id === activeId;
    const busy = p ? connectingId === p.id : false;
    const readOnly = ws ? ws.readOnly : access !== "readwrite";
    const prod = access === "production";
    const label = `${name}${prod ? " · production" : access === "readonly" ? " · read-only" : ""}${live ? "" : " · disconnected"}`;
    const onClick = () => {
      if (ws) void switchTo(ws.info.id);
      else if (p) void connect(p.id);
    };
    return (
      <ContextMenu key={p?.id ?? wsId ?? name} modal={false}>
        <Tooltip>
          <TooltipTrigger asChild>
            <ContextMenuTrigger asChild>
              <button
                onClick={onClick}
                disabled={busy || (status === "connecting" && !ws)}
                className={cn(
                  "cx",
                  on && "on",
                  readOnly && live && "ro",
                  prod && "prod",
                  !live && "off",
                  busy && "busy"
                )}
                aria-label={label}
                aria-pressed={on}
              >
                {color && <span className="tag" style={{ background: color }} />}
                {busy ? <Loader2 className="spin" style={{ width: 13, height: 13 }} /> : initials(name)}
                <i />
              </button>
            </ContextMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
        <ContextMenuContent>
          <ContextMenuLabel className="max-w-[220px] truncate normal-case tracking-normal">
            {name}
          </ContextMenuLabel>
          <ContextMenuSeparator />
          {ws ? (
            <>
              <ContextMenuItem onSelect={() => void switchTo(ws.info.id)}>Switch to</ContextMenuItem>
              <ContextMenuItem onSelect={() => setConfirmClose({ id: ws.info.id, name })}>
                Disconnect
              </ContextMenuItem>
            </>
          ) : (
            p && <ContextMenuItem onSelect={() => void connect(p.id)}>Connect</ContextMenuItem>
          )}
          {p && (
            <ContextMenuItem onSelect={() => openConnections("form", p)}>Edit connection</ContextMenuItem>
          )}
          <ContextMenuItem onSelect={() => openConnections("list")}>Manage connections</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    );
  };

  const section = (
    label: string,
    icon: React.ReactNode,
    onClick: () => void,
    opts?: { on?: boolean; disabled?: boolean }
  ) => (
    <Tooltip key={label}>
      <TooltipTrigger asChild>
        <button
          className={cn("r", opts?.on && "on")}
          onClick={onClick}
          disabled={opts?.disabled}
          aria-label={label}
          style={opts?.disabled ? { opacity: 0.35, cursor: "default" } : undefined}
        >
          {icon}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  );

  const connected = status === "connected";

  return (
    <nav className="rail no-select" aria-label="Connections and sections">
      <div className="mk" title="Ognom">
        <OgnomMark />
      </div>
      <div className="conns">
        {profiles.map((p) =>
          tile(p, byProfile.get(p.id)?.info.id ?? null, p.name, p.color, p.access)
        )}
        {adhoc.map((w) => tile(null, w.info.id, w.info.name, w.info.color, w.info.access))}
        <Tooltip>
          <TooltipTrigger asChild>
            <button className="cx add" onClick={() => openConnections("form")} aria-label="New connection">
              ＋
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">New connection</TooltipContent>
        </Tooltip>
      </div>

      {section("Data (⌘B toggles the picker)", <Database />, togglePicker, {
        on: connected && !pickerCollapsed,
        disabled: !connected,
      })}
      {section("Server", <Server />, () => ui({ serverInfo: true }), { disabled: !connected })}
      {section("Operations", <Activity />, () => ui({ ops: true }), { disabled: !connected })}
      {section("Help", <CircleHelp />, () => ui({ help: true }))}
      <div className="sp" />
      {section("Appearance", <Brush />, () => ui({ appearance: true }))}
      {section("Settings", <Settings />, () => ui({ settings: true }))}

      <ConfirmDialog
        open={!!confirmClose}
        onOpenChange={(o) => !o && setConfirmClose(null)}
        title="Disconnect this workspace?"
        description={`Close the connection to ${confirmClose?.name ?? "the server"} and its open tabs. Other workspaces stay connected.`}
        confirmLabel="Disconnect"
        onConfirm={async () => {
          if (confirmClose) await disconnectWorkspace(confirmClose.id);
          setConfirmClose(null);
        }}
      />
    </nav>
  );
}
