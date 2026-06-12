import { useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  Loader2,
  RefreshCw,
  Search,
  Table2,
  Timer,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useExplorer } from "@/stores/explorer";
import { formatBytes } from "@/lib/bson";
import { cn } from "@/lib/utils";

function CollIcon({ kind }: { kind: string }) {
  if (kind === "view") return <Eye className="h-3.5 w-3.5 shrink-0 text-info" />;
  if (kind === "timeseries") return <Timer className="h-3.5 w-3.5 shrink-0 text-info" />;
  return <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

export function Sidebar() {
  const {
    databases,
    loadingDbs,
    collections,
    expanded,
    sidebarFilter,
    setSidebarFilter,
    loadDatabases,
    toggleDatabase,
    openCollection,
    tabs,
    activeTabId,
  } = useExplorer();

  useEffect(() => {
    if (databases.length === 0) void loadDatabases();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const activeTab = tabs.find((t) => t.id === activeTabId);
  const filter = sidebarFilter.trim().toLowerCase();

  const visibleDbs = databases.filter((db) => {
    if (!filter) return true;
    if (db.name.toLowerCase().includes(filter)) return true;
    return (collections[db.name] ?? []).some((c) => c.name.toLowerCase().includes(filter));
  });

  return (
    <aside className="no-select flex w-64 shrink-0 flex-col border-r bg-card">
      <div className="flex items-center gap-1.5 border-b px-3 py-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={sidebarFilter}
            onChange={(e) => setSidebarFilter(e.target.value)}
            placeholder="Filter…"
            className="h-7 pl-7 text-xs"
          />
        </div>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => void loadDatabases()}
            >
              {loadingDbs ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh databases</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-px p-1.5">
          {visibleDbs.length === 0 && !loadingDbs && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {databases.length === 0 ? "No databases visible" : "No matches"}
            </p>
          )}
          {visibleDbs.map((db) => {
            const isOpen = expanded[db.name] || (!!filter && !!collections[db.name]);
            const colls = (collections[db.name] ?? []).filter(
              (c) =>
                !filter ||
                db.name.toLowerCase().includes(filter) ||
                c.name.toLowerCase().includes(filter)
            );
            return (
              <div key={db.name}>
                <button
                  onClick={() => void toggleDatabase(db.name)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent"
                >
                  {isOpen ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <Database className="h-3.5 w-3.5 shrink-0 text-primary/80" />
                  <span className="min-w-0 flex-1 truncate text-left font-medium">{db.name}</span>
                  <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                    {formatBytes(db.sizeOnDisk)}
                  </span>
                </button>

                {isOpen && (
                  <div className="ml-[1.05rem] flex flex-col gap-px border-l pl-1.5">
                    {!collections[db.name] && (
                      <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> loading…
                      </div>
                    )}
                    {colls.map((coll) => {
                      const isActive =
                        activeTab?.database === db.name && activeTab?.collection === coll.name;
                      return (
                        <button
                          key={coll.name}
                          onClick={() => openCollection(db.name, coll.name)}
                          className={cn(
                            "flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-[13px] transition-colors",
                            isActive
                              ? "bg-primary/15 font-medium text-primary"
                              : "text-foreground/90 hover:bg-accent"
                          )}
                        >
                          <CollIcon kind={coll.kind} />
                          <span className="truncate">{coll.name}</span>
                        </button>
                      );
                    })}
                    {collections[db.name] && colls.length === 0 && (
                      <p className="px-2 py-1 text-xs text-muted-foreground">empty</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </aside>
  );
}
