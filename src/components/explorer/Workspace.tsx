import { MousePointerClick, X } from "lucide-react";
import { useExplorer } from "@/stores/explorer";
import { CollectionTab } from "@/components/explorer/CollectionTab";
import { dragWindow } from "@/lib/window";
import { cn } from "@/lib/utils";

export function Workspace() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useExplorer();

  if (tabs.length === 0) {
    return (
      <main className="app-gradient flex flex-1 items-center justify-center bg-background">
        <div className="no-select flex flex-col items-center gap-3 text-center text-muted-foreground">
          <MousePointerClick className="h-10 w-10 opacity-40" />
          <div>
            <p className="font-medium text-foreground">Pick a collection</p>
            <p className="mt-1 text-sm">
              Choose one from the sidebar, or press{" "}
              <kbd className="rounded border bg-muted px-1 font-mono text-[11px]">⌘K</kbd> to jump.
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col bg-background">
      {/* tab strip — empty area doubles as a window drag surface */}
      <div
        onMouseDown={dragWindow}
        className="no-select flex h-9 shrink-0 items-end gap-px overflow-x-auto border-b bg-card px-1.5 pt-1.5"
      >
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              onClick={() => setActiveTab(tab.id)}
              onKeyDown={(e) => e.key === "Enter" && setActiveTab(tab.id)}
              onAuxClick={(e) => e.button === 1 && closeTab(tab.id)}
              className={cn(
                "group flex max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 py-1.5 text-xs transition-colors",
                isActive
                  ? "border-border bg-background font-medium text-foreground"
                  : "border-transparent bg-transparent text-muted-foreground hover:bg-accent/60"
              )}
            >
              <span className="truncate">
                <span className="text-muted-foreground">{tab.database}.</span>
                {tab.collection}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
                className={cn(
                  "rounded-sm p-0.5 text-muted-foreground transition-all hover:bg-muted hover:text-foreground",
                  !isActive && "opacity-0 group-hover:opacity-100"
                )}
                aria-label="Close tab"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>

      {/* keep every tab mounted so its state survives switching */}
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={cn(
            "min-h-0 flex-1 flex-col",
            tab.id === activeTabId ? "flex" : "hidden"
          )}
        >
          <CollectionTab tab={tab} />
        </div>
      ))}
    </main>
  );
}
