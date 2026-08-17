import { Brush, Search, Settings } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useConnections } from "@/stores/connections";
import { useExplorer } from "@/stores/explorer";
import { useUi } from "@/stores/ui";
import { dragWindow } from "@/lib/window";
import { cn } from "@/lib/utils";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");

/**
 * Window chrome: traffic-light inset on macOS, a mono breadcrumb title in the
 * middle (collection · db · connection · host) and the global affordances on
 * the right. The whole bar is a drag region.
 */
export function Titlebar() {
  const active = useConnections((s) => s.active);
  const status = useConnections((s) => s.status);
  const readOnly = useConnections(
    (s) => s.workspaces.find((w) => w.info.id === s.activeId)?.readOnly ?? false
  );
  const tab = useExplorer((s) => s.tabs.find((t) => t.id === s.activeTabId));
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
      {!IS_MAC && (
        <div className="lights" aria-hidden>
          <i />
          <i />
          <i />
        </div>
      )}
      <div className="wtitle">
        <i className={cn("dot", dotClass)} />
        {tab ? (
          <>
            <b>{tab.collection}</b>· {tab.database} · {active?.name} · {host}
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
    </div>
  );
}
