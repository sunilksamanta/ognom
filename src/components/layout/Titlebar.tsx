import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Brush, Copy, Minus, Search, Settings, Square, X } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConnections } from "@/stores/connections";
import { tabNumber, useExplorer } from "@/stores/explorer";
import { useUi } from "@/stores/ui";
import { dragWindow } from "@/lib/window";
import { cn } from "@/lib/utils";

const PLATFORM = navigator.platform.toUpperCase();
const IS_MAC = PLATFORM.includes("MAC");
/** Windows runs without native decorations (tauri.windows.conf.json), so the
 *  bar draws the caption buttons itself. Linux keeps its native title bar. */
const IS_WINDOWS = PLATFORM.includes("WIN");

/** Minimize / maximize-restore / close, Windows style, flush with the right edge. */
function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let disposed = false;
    let unlisten: (() => void) | undefined;
    const sync = () => {
      void win.isMaximized().then((m) => !disposed && setMaximized(m)).catch(() => {});
    };
    sync();
    win
      .onResized(sync)
      .then((u) => (disposed ? u() : (unlisten = u)))
      .catch(() => {});
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const btn = "flex h-full w-[46px] items-center justify-center text-text-2 transition-colors [&>svg]:h-[15px] [&>svg]:w-[15px] [&>svg]:stroke-[1.5]";
  return (
    <div className="-mr-[14px] flex h-full self-stretch" data-no-drag>
      <button type="button" className={cn(btn, "hover:bg-hover hover:text-text")} onClick={() => void getCurrentWindow().minimize()} aria-label="Minimize">
        <Minus />
      </button>
      <button
        type="button"
        className={cn(btn, "hover:bg-hover hover:text-text [&>svg]:h-[13px] [&>svg]:w-[13px]")}
        onClick={() => void getCurrentWindow().toggleMaximize()}
        aria-label={maximized ? "Restore" : "Maximize"}
      >
        {maximized ? <Copy className="-scale-x-100" /> : <Square />}
      </button>
      <button
        type="button"
        className={cn(btn, "hover:bg-destructive hover:text-destructive-foreground")}
        onClick={() => void getCurrentWindow().close()}
        aria-label="Close"
      >
        <X />
      </button>
    </div>
  );
}

/**
 * Window chrome: traffic-light inset on macOS, caption buttons on Windows, a
 * mono breadcrumb title in the middle (collection · db · connection · host)
 * and the global affordances on the right. The whole bar is a drag region.
 */
export function Titlebar() {
  const active = useConnections((s) => s.active);
  const status = useConnections((s) => s.status);
  const readOnly = useConnections(
    (s) => s.workspaces.find((w) => w.info.id === s.activeId)?.readOnly ?? false
  );
  const tab = useExplorer((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const tabNo = useExplorer((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId);
    return t ? tabNumber(s.tabs, t) : null;
  });
  const setPalette = useUi((s) => s.setPalette);
  const ui = useUi((s) => s.set);

  const host = (active?.hostSummary ?? "").split(",")[0] ?? "";
  const dotClass = !active
    ? "off"
    : active.access === "production"
      ? "dgr"
      : readOnly
        ? "warn"
        : "";

  return (
    <div
      onMouseDown={dragWindow}
      className={cn("titlebar no-select", IS_MAC && "mac")}
    >
      <div className="wtitle">
        <i className={cn("dot", dotClass)} />
        {tab ? (
          <>
            <b>{tab.collection}</b>
            {tabNo && <span className="tabno">#{tabNo}</span>}· {tab.database} · {active?.name} · {host}
          </>
        ) : active ? (
          <>
            <b>{active.name}</b>· {host}
          </>
        ) : (
          <>
            <b>Ognom</b>· {status === "connecting" ? "connecting" : "not connected"}
          </>
        )}
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            className="ico"
            onClick={() => setPalette(true)}
            disabled={status !== "connected"}
            aria-label="Find anything"
          >
            <Search />
          </button>
        </TooltipTrigger>
        <TooltipContent>Find anything (⌘K)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="ico" onClick={() => ui({ appearance: true })} aria-label="Appearance">
            <Brush />
          </button>
        </TooltipTrigger>
        <TooltipContent>Themes and density (⌘⇧T cycles)</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <button className="ico" onClick={() => ui({ settings: true })} aria-label="Settings">
            <Settings />
          </button>
        </TooltipTrigger>
        <TooltipContent>Settings (⌘,)</TooltipContent>
      </Tooltip>
      {IS_WINDOWS && <WindowControls />}
    </div>
  );
}
