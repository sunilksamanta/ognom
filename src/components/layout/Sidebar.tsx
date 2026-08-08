import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  CopyPlus,
  Database,
  Eraser,
  Eye,
  FolderOpen,
  GitCompare,
  Loader2,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Send,
  SquarePlus,
  Table2,
  Timer,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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
import { CopyCollectionDialog } from "@/components/explorer/CopyCollectionDialog";
import { DiffCollectionDialog } from "@/components/explorer/DiffCollectionDialog";
import { RelationsDialog } from "@/components/explorer/RelationsDialog";
import { DuplicateCollectionDialog } from "@/components/explorer/DuplicateCollectionDialog";
import { useExplorer } from "@/stores/explorer";
import { SIDEBAR_MAX, SIDEBAR_MIN, useSettings } from "@/stores/settings";
import { api, errMsg } from "@/lib/api";
import { formatBytes } from "@/lib/bson";
import { cn } from "@/lib/utils";

function CollIcon({ kind }: { kind: string }) {
  if (kind === "view") return <Eye className="h-3.5 w-3.5 shrink-0 text-info" />;
  if (kind === "timeseries") return <Timer className="h-3.5 w-3.5 shrink-0 text-info" />;
  return <Table2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

export function Sidebar() {
  const databases = useExplorer((s) => s.databases);
  const loadingDbs = useExplorer((s) => s.loadingDbs);
  const collections = useExplorer((s) => s.collections);
  const expanded = useExplorer((s) => s.expanded);
  const sidebarFilter = useExplorer((s) => s.sidebarFilter);
  const setSidebarFilter = useExplorer((s) => s.setSidebarFilter);
  const loadDatabases = useExplorer((s) => s.loadDatabases);
  const loadCollections = useExplorer((s) => s.loadCollections);
  const toggleDatabase = useExplorer((s) => s.toggleDatabase);
  const openCollection = useExplorer((s) => s.openCollection);
  const openCollectionInNewTab = useExplorer((s) => s.openCollectionInNewTab);
  const closeTabsForCollection = useExplorer((s) => s.closeTabsForCollection);
  const refreshTabsForCollection = useExplorer((s) => s.refreshTabsForCollection);
  // Select the active collection as primitives, not the whole tab object — so
  // typing in an editor (which mutates the active tab) doesn't re-render the
  // entire database/collection tree on every keystroke.
  const activeDb = useExplorer((s) => s.tabs.find((t) => t.id === s.activeTabId)?.database);
  const activeColl = useExplorer((s) => s.tabs.find((t) => t.id === s.activeTabId)?.collection);

  const copyName = (name: string) => {
    void navigator.clipboard.writeText(name);
    toast.success("Name copied");
  };

  // Destructive / duplicate collection actions are driven by a single set of
  // dialogs rendered once below, keyed off the target the menu item picks.
  type Target = { db: string; coll: string };
  const [dupTarget, setDupTarget] = useState<Target | null>(null);
  const [copyTarget, setCopyTarget] = useState<Target | null>(null);
  const [diffTarget, setDiffTarget] = useState<Target | null>(null);
  const [relationsDb, setRelationsDb] = useState<string | null>(null);
  const [clearTarget, setClearTarget] = useState<Target | null>(null);
  const [dropTarget, setDropTarget] = useState<Target | null>(null);
  const [busy, setBusy] = useState(false);

  const doClear = async () => {
    if (!clearTarget) return;
    setBusy(true);
    try {
      const deleted = await api.clearCollection(clearTarget.db, clearTarget.coll);
      toast.success(
        `Cleared ${clearTarget.coll} — ${deleted} document${deleted === 1 ? "" : "s"} removed`
      );
      refreshTabsForCollection(clearTarget.db, clearTarget.coll);
      setClearTarget(null);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const doDrop = async () => {
    if (!dropTarget) return;
    setBusy(true);
    try {
      await api.dropCollection(dropTarget.db, dropTarget.coll);
      toast.success(`Dropped ${dropTarget.coll}`);
      closeTabsForCollection(dropTarget.db, dropTarget.coll);
      await loadCollections(dropTarget.db);
      setDropTarget(null);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const { sidebarWidth, sidebarCollapsed, setSidebarWidth, toggleSidebar } = useSettings();
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    // The panel is keyed by the active workspace (see App.tsx), so this effect
    // remounts on every workspace switch. Always refetch the databases — and the
    // collections of any databases restored expanded from cache — so a workspace
    // we return to reflects current server state instead of a stale cached tree.
    // The hydrated cache still renders instantly while these run.
    void loadDatabases();
    for (const [name, open] of Object.entries(expanded)) {
      if (open) void loadCollections(name);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filter = sidebarFilter.trim().toLowerCase();

  const visibleDbs = databases.filter((db) => {
    if (!filter) return true;
    if (db.name.toLowerCase().includes(filter)) return true;
    return (collections[db.name] ?? []).some((c) => c.name.toLowerCase().includes(filter));
  });

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const clamp = (w: number) => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, w));
    const onMove = (ev: MouseEvent) => setLiveWidth(clamp(startWidth + ev.clientX - startX));
    const onUp = (ev: MouseEvent) => {
      dragging.current = false;
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setSidebarWidth(clamp(startWidth + ev.clientX - startX));
      setLiveWidth(null);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  if (sidebarCollapsed) {
    return (
      <aside className="no-select flex w-10 shrink-0 flex-col items-center border-r bg-card py-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleSidebar}>
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Expand sidebar (⌘B)</TooltipContent>
        </Tooltip>
        <Database className="mt-3 h-3.5 w-3.5 text-muted-foreground/50" />
      </aside>
    );
  }

  return (
    <aside
      className="no-select relative flex shrink-0 flex-col border-r bg-card"
      style={{ width: liveWidth ?? sidebarWidth }}
    >
      <div className="flex items-center gap-1 border-b px-2 py-2">
        <div className="relative min-w-0 flex-1">
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={toggleSidebar}>
              <PanelLeftClose className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Collapse sidebar (⌘B)</TooltipContent>
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
                <ContextMenu>
                  <ContextMenuTrigger asChild>
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
                      <span className="min-w-0 flex-1 truncate text-left font-medium">
                        {db.name}
                      </span>
                      <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground/70">
                        {formatBytes(db.sizeOnDisk)}
                      </span>
                    </button>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuLabel className="max-w-[200px] truncate">{db.name}</ContextMenuLabel>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onSelect={() => {
                        if (!expanded[db.name]) void toggleDatabase(db.name);
                        void loadCollections(db.name);
                      }}
                    >
                      <RefreshCw />
                      Refresh
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => copyName(db.name)}>
                      <Copy />
                      Copy name
                    </ContextMenuItem>
                    <ContextMenuItem onSelect={() => setRelationsDb(db.name)}>
                      <Network />
                      Schema map
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>

                {isOpen && (
                  <div className="ml-[1.05rem] flex flex-col gap-px border-l pl-1.5">
                    {!collections[db.name] && (
                      <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> loading…
                      </div>
                    )}
                    {colls.map((coll) => {
                      const isActive =
                        activeDb === db.name && activeColl === coll.name;
                      return (
                        // modal={false}: the destructive items below open a
                        // Dialog from a menu item — a modal menu leaves
                        // pointer-events stuck on <body> and freezes the app.
                        <ContextMenu key={coll.name} modal={false}>
                          <ContextMenuTrigger asChild>
                            <button
                              title={coll.name}
                              onClick={() => openCollection(db.name, coll.name)}
                              onAuxClick={(e) =>
                                e.button === 1 && openCollectionInNewTab(db.name, coll.name)
                              }
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
                          </ContextMenuTrigger>
                          <ContextMenuContent className="min-w-[13rem]">
                            <ContextMenuLabel className="max-w-[200px] truncate">
                              {coll.name}
                            </ContextMenuLabel>
                            <ContextMenuSeparator />
                            <ContextMenuItem onSelect={() => openCollection(db.name, coll.name)}>
                              <FolderOpen />
                              Open
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() => openCollectionInNewTab(db.name, coll.name)}
                            >
                              <SquarePlus />
                              Open in new tab
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => void loadCollections(db.name)}>
                              <RefreshCw />
                              Refresh
                            </ContextMenuItem>
                            <ContextMenuItem onSelect={() => copyName(coll.name)}>
                              <Copy />
                              Copy name
                            </ContextMenuItem>
                            <ContextMenuSeparator />
                            <ContextMenuItem
                              onSelect={() => setDupTarget({ db: db.name, coll: coll.name })}
                            >
                              <CopyPlus />
                              Duplicate Collection
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() => setCopyTarget({ db: db.name, coll: coll.name })}
                            >
                              <Send />
                              Copy to…
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() => setDiffTarget({ db: db.name, coll: coll.name })}
                            >
                              <GitCompare />
                              Diff with…
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() => setClearTarget({ db: db.name, coll: coll.name })}
                              className="text-destructive focus:text-destructive"
                            >
                              <Eraser />
                              Clear Collection
                            </ContextMenuItem>
                            <ContextMenuItem
                              onSelect={() => setDropTarget({ db: db.name, coll: coll.name })}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 />
                              Drop Collection
                            </ContextMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
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

      {/* resize handle */}
      <div
        onMouseDown={startResize}
        onDoubleClick={() => setSidebarWidth(256)}
        title="Drag to resize · double-click to reset"
        className="absolute -right-px inset-y-0 z-10 w-1 cursor-col-resize transition-colors hover:bg-primary/50 active:bg-primary/70"
      />

      <DuplicateCollectionDialog
        open={!!dupTarget}
        database={dupTarget?.db ?? ""}
        source={dupTarget?.coll ?? ""}
        onOpenChange={(o) => !o && setDupTarget(null)}
        onDuplicated={() => dupTarget && void loadCollections(dupTarget.db)}
      />

      <CopyCollectionDialog
        open={!!copyTarget}
        database={copyTarget?.db ?? ""}
        source={copyTarget?.coll ?? ""}
        onOpenChange={(o) => !o && setCopyTarget(null)}
        onCopied={(targetDb) => {
          // Target landed in this workspace — refresh the tree so it shows up.
          void loadDatabases();
          void loadCollections(targetDb);
        }}
      />

      <DiffCollectionDialog
        open={!!diffTarget}
        database={diffTarget?.db ?? ""}
        source={diffTarget?.coll ?? ""}
        onOpenChange={(o) => !o && setDiffTarget(null)}
      />

      <RelationsDialog
        open={!!relationsDb}
        database={relationsDb ?? ""}
        onOpenChange={(o) => !o && setRelationsDb(null)}
      />

      <ConfirmDialog
        open={!!clearTarget}
        onOpenChange={(o) => !o && setClearTarget(null)}
        title="Clear collection?"
        description={
          clearTarget && (
            <>
              This permanently deletes{" "}
              <span className="font-medium text-foreground">every document</span> in{" "}
              <span className="font-mono font-medium text-foreground">{clearTarget.coll}</span>. The
              collection and its indexes stay. This cannot be undone.
            </>
          )
        }
        confirmLabel="Clear collection"
        destructive
        busy={busy}
        confirmPhrase={clearTarget?.coll}
        onConfirm={doClear}
      />

      <ConfirmDialog
        open={!!dropTarget}
        onOpenChange={(o) => !o && setDropTarget(null)}
        title="Drop collection?"
        description={
          dropTarget && (
            <>
              This permanently deletes{" "}
              <span className="font-mono font-medium text-foreground">{dropTarget.coll}</span> and
              all of its documents and indexes. This cannot be undone.
            </>
          )
        }
        confirmLabel="Drop collection"
        destructive
        busy={busy}
        confirmPhrase={dropTarget?.coll}
        onConfirm={doDrop}
      />
    </aside>
  );
}
