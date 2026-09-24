import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  Copy,
  CopyPlus,
  Database,
  Eraser,
  Eye,
  FolderOpen,
  GitCompare,
  Loader2,
  BarChart3,
  FileCode2,
  Pin,
  PinOff,
  RefreshCw,
  Search,
  Send,
  SquarePlus,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CopyCollectionDialog } from "@/components/explorer/CopyCollectionDialog";
import { DiffCollectionDialog } from "@/components/explorer/DiffCollectionDialog";
import { DbOverviewDialog } from "@/components/explorer/DbOverviewDialog";
import { TypeExportDialog } from "@/components/explorer/TypeExportDialog";
import { DuplicateCollectionDialog } from "@/components/explorer/DuplicateCollectionDialog";
import { DropCollectionDialog, ClearCollectionDialog } from "@/components/explorer/CollectionDangerDialogs";
import { tabNumber, useExplorer } from "@/stores/explorer";
import { useConnections } from "@/stores/connections";
import { PICKER_DEFAULT, PICKER_MAX, PICKER_MIN, useSettings } from "@/stores/settings";
import { useUi } from "@/stores/ui";
import { api, errMsg } from "@/lib/api";
import { formatBytes, formatCount } from "@/lib/bson";
import { cn } from "@/lib/utils";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const NONE: string[] = [];

/** Live round-trip time to the active server, re-measured every 15 s while
 *  the window is visible. Local state only, so the tick re-renders just this. */
function Latency({ workspaceId, host, ssh }: { workspaceId: string; host: string; ssh?: string | null }) {
  const [ms, setMs] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (document.hidden) return;
      api
        .pingWorkspace(workspaceId)
        .then((v) => {
          if (alive) {
            setMs(v);
            setFailed(null);
          }
        })
        .catch((e) => alive && setFailed(errMsg(e)));
    };
    tick();
    const t = window.setInterval(tick, 15_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [workspaceId]);

  const tone = failed ? "dgr" : ms === null ? "off" : ms > 400 ? "dgr" : ms > 120 ? "warn" : "";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 tabular-nums">
          <i className={cn("dot", tone)} />
          {failed ? "unreachable" : ms === null ? "..." : `${ms} ms`}
          {ssh && <span className="text-text-3">· ssh</span>}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="font-mono text-[11px]">
          <div>{failed ? `Ping failed: ${failed}` : "Round trip to the server, checked every 15 s"}</div>
          <div className="text-text-3">{host}</div>
          {ssh && <div className="text-text-3">via SSH {ssh}</div>}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

function CollIcon({ kind }: { kind: string }) {
  if (kind === "view") return <Eye className="text-accent-2" />;
  if (kind === "timeseries") return <Timer className="text-accent-2" />;
  return <i className="sw" />;
}

/**
 * Picker column: database button, one search, then Open / Pinned /
 * Collections / Saved queries. Width is drag-resizable (persisted).
 */
export function Picker() {
  const databases = useExplorer((s) => s.databases);
  const loadingDbs = useExplorer((s) => s.loadingDbs);
  const collections = useExplorer((s) => s.collections);
  const selectedDb = useExplorer((s) => s.selectedDb);
  const counts = useExplorer((s) => s.counts);
  const sidebarFilter = useExplorer((s) => s.sidebarFilter);
  const setSidebarFilter = useExplorer((s) => s.setSidebarFilter);
  const loadDatabases = useExplorer((s) => s.loadDatabases);
  const loadCollections = useExplorer((s) => s.loadCollections);
  const selectDatabase = useExplorer((s) => s.selectDatabase);
  const openCollection = useExplorer((s) => s.openCollection);
  const openCollectionInNewTab = useExplorer((s) => s.openCollectionInNewTab);
  const closeTab = useExplorer((s) => s.closeTab);
  const setActiveTab = useExplorer((s) => s.setActiveTab);
  const patchDocs = useExplorer((s) => s.patchDocs);
  const runFind = useExplorer((s) => s.runFind);
  const tabs = useExplorer((s) => s.tabs);
  const activeTabId = useExplorer((s) => s.activeTabId);
  const activeDb = useExplorer((s) => s.tabs.find((t) => t.id === s.activeTabId)?.database);
  const activeColl = useExplorer((s) => s.tabs.find((t) => t.id === s.activeTabId)?.collection);

  const active = useConnections((s) => s.active);
  const readOnly = useConnections(
    (s) => s.workspaces.find((w) => w.info.id === s.activeId)?.readOnly ?? false
  );
  const setPalette = useUi((s) => s.setPalette);

  const scope = active?.profileId ?? active?.id ?? "adhoc";
  const pinned = useSettings((s) => s.pinned[scope] ?? NONE);
  const togglePin = useSettings((s) => s.togglePin);
  const savedQueries = useSettings((s) => s.savedQueries);
  const removeQuery = useSettings((s) => s.removeQuery);
  const { pickerWidth, setPickerWidth } = useSettings();
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Remounts on every workspace switch (keyed in App): refetch databases and
  // the collections of the selected db so cached trees never go stale.
  useEffect(() => {
    void loadDatabases();
    if (selectedDb) void loadCollections(selectedDb);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  type Target = { db: string; coll: string };
  const [dupTarget, setDupTarget] = useState<Target | null>(null);
  const [copyTarget, setCopyTarget] = useState<Target | null>(null);
  const [diffTarget, setDiffTarget] = useState<Target | null>(null);
  const [overviewDb, setOverviewDb] = useState<string | null>(null);
  const [typesTarget, setTypesTarget] = useState<Target | null>(null);
  const [clearTarget, setClearTarget] = useState<Target | null>(null);
  const [dropTarget, setDropTarget] = useState<Target | null>(null);

  const copyName = (name: string) => {
    void navigator.clipboard.writeText(name);
    toast.success("Name copied");
  };

  const filter = sidebarFilter.trim().toLowerCase();
  const colls = useMemo(() => {
    const list = selectedDb ? collections[selectedDb] ?? null : null;
    if (!list) return null;
    return list.filter((c) => !filter || c.name.toLowerCase().includes(filter));
  }, [collections, selectedDb, filter]);

  const dbInfo = databases.find((d) => d.name === selectedDb);
  const allColls = selectedDb ? collections[selectedDb] ?? null : null;
  const viewCount = allColls?.filter((c) => c.kind === "view").length ?? 0;

  const pinnedItems = pinned
    .map((key) => {
      const i = key.indexOf(".");
      return { key, db: key.slice(0, i), coll: key.slice(i + 1) };
    })
    .filter((p) => !filter || p.coll.toLowerCase().includes(filter));

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = pickerWidth;
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const clamp = (w: number) => Math.min(PICKER_MAX, Math.max(PICKER_MIN, w));
    const onMove = (ev: MouseEvent) => setLiveWidth(clamp(startWidth + ev.clientX - startX));
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setPickerWidth(clamp(startWidth + ev.clientX - startX));
      setLiveWidth(null);
      setDragging(false);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const collMenu = (db: string, coll: string, kind?: string) => (
    <ContextMenuContent className="min-w-[13rem]">
      <ContextMenuLabel className="max-w-[220px] truncate normal-case tracking-normal">
        {db}.{coll}
      </ContextMenuLabel>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => openCollection(db, coll)}>
        <FolderOpen /> Open
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => openCollectionInNewTab(db, coll)}>
        <SquarePlus /> Open in new tab
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => togglePin(scope, `${db}.${coll}`)}>
        {pinned.includes(`${db}.${coll}`) ? (
          <>
            <PinOff /> Unpin
          </>
        ) : (
          <>
            <Pin /> Pin
          </>
        )}
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => void loadCollections(db)}>
        <RefreshCw /> Refresh
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => copyName(coll)}>
        <Copy /> Copy name
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={readOnly} onSelect={() => setDupTarget({ db, coll })}>
        <CopyPlus /> Duplicate collection
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => setCopyTarget({ db, coll })}>
        <Send /> Copy to another workspace
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => setDiffTarget({ db, coll })}>
        <GitCompare /> Diff with
      </ContextMenuItem>
      <ContextMenuItem onSelect={() => setTypesTarget({ db, coll })}>
        <FileCode2 /> Export TypeScript types
      </ContextMenuItem>
      {kind !== "view" && (
        <>
          <ContextMenuSeparator />
          <ContextMenuItem
            disabled={readOnly}
            onSelect={() => setClearTarget({ db, coll })}
            className="text-danger focus:text-danger"
          >
            <Eraser /> Clear collection
          </ContextMenuItem>
        </>
      )}
      <ContextMenuItem
        disabled={readOnly}
        onSelect={() => setDropTarget({ db, coll })}
        className="text-danger focus:text-danger"
      >
        <Trash2 /> Drop collection
      </ContextMenuItem>
    </ContextMenuContent>
  );

  return (
    <aside className="pick no-select" style={{ width: liveWidth ?? pickerWidth }}>
      <div className="ph">
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button className="db" aria-label="Choose database">
              <Database />
              <b>{selectedDb ?? (loadingDbs ? "Loading" : "No database")}</b>
              <span>{dbInfo ? formatBytes(dbInfo.sizeOnDisk) : ""}</span>
              {loadingDbs ? (
                <Loader2 className="spin" />
              ) : (
                <svg viewBox="0 0 24 24" style={{ width: 12 }}>
                  <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-[260px]">
            <DropdownMenuLabel>Databases · {databases.length}</DropdownMenuLabel>
            <div className="max-h-[320px] overflow-auto">
              {databases.map((d) => (
                <DropdownMenuItem
                  key={d.name}
                  onSelect={() => void selectDatabase(d.name)}
                  className="gap-2 font-mono"
                >
                  <span className="truncate">{d.name}</span>
                  <span className="ml-auto text-[10.5px] text-text-3">{formatBytes(d.sizeOnDisk)}</span>
                  {d.name === selectedDb && <Check className="h-3.5 w-3.5 text-primary" />}
                </DropdownMenuItem>
              ))}
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void loadDatabases()} className="gap-2">
              <RefreshCw className="h-3.5 w-3.5" /> Refresh databases
            </DropdownMenuItem>
            {selectedDb && (
              <DropdownMenuItem onSelect={() => setOverviewDb(selectedDb)} className="gap-2">
                <BarChart3 className="h-3.5 w-3.5" /> Overview of {selectedDb}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="sr">
        <Search />
        <input
          ref={searchRef}
          value={sidebarFilter}
          onChange={(e) => setSidebarFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setSidebarFilter("");
            if (e.key === "Enter" && colls && colls.length > 0 && selectedDb) {
              openCollection(selectedDb, colls[0].name);
            }
          }}
          placeholder="Collections and fields"
          spellCheck={false}
        />
        {sidebarFilter ? (
          <button className="ico sm" onClick={() => setSidebarFilter("")} aria-label="Clear">
            <X />
          </button>
        ) : (
          <button className="kbd" onClick={() => setPalette(true)} title="Find anything">
            {IS_MAC ? "⌘K" : "Ctrl K"}
          </button>
        )}
      </div>

      <div className="list">
        {tabs.length > 0 && (
          <>
            <div className="gh">
              Open<span className="n">{tabs.length}</span>
            </div>
            {tabs
              .filter((t) => !filter || t.collection.toLowerCase().includes(filter))
              .map((t) => (
                <ContextMenu key={t.id} modal={false}>
                  <ContextMenuTrigger asChild>
                    <button
                      className={cn("it", t.id === activeTabId && "on")}
                      onClick={() => setActiveTab(t.id)}
                      onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
                      title={`${t.database}.${t.collection}`}
                    >
                      <i className="sw" />
                      <span className="n">
                        {t.database !== selectedDb && <span className="text-text-3">{t.database}.</span>}
                        {t.collection}
                      </span>
                      {(() => {
                        const no = tabNumber(tabs, t);
                        return no && <span className="tabno" title={`Tab ${no} of ${t.collection}`}>#{no}</span>;
                      })()}
                      <span
                        className="x"
                        role="button"
                        aria-label="Close tab"
                        onClick={(e) => {
                          e.stopPropagation();
                          closeTab(t.id);
                        }}
                      >
                        <X style={{ width: 11, height: 11 }} />
                      </span>
                    </button>
                  </ContextMenuTrigger>
                  {collMenu(t.database, t.collection)}
                </ContextMenu>
              ))}
          </>
        )}

        {pinnedItems.length > 0 && (
          <>
            <div className="gh">Pinned</div>
            {pinnedItems.map((p) => (
              <ContextMenu key={p.key} modal={false}>
                <ContextMenuTrigger asChild>
                  <button
                    className={cn("it", activeDb === p.db && activeColl === p.coll && "on")}
                    onClick={() => openCollection(p.db, p.coll)}
                    title={p.key}
                  >
                    <svg className="star" viewBox="0 0 24 24" fill="currentColor">
                      <path d="m12 3 2.6 5.6 6 .8-4.4 4.2 1.1 6-5.3-3-5.3 3 1.1-6L3.4 9.4l6-.8Z" />
                    </svg>
                    <span className="n">
                      {p.db !== selectedDb && <span className="text-text-3">{p.db}.</span>}
                      {p.coll}
                    </span>
                    {counts[p.key] !== undefined && <span className="c">{formatCount(counts[p.key])}</span>}
                  </button>
                </ContextMenuTrigger>
                {collMenu(p.db, p.coll)}
              </ContextMenu>
            ))}
          </>
        )}

        <div className="gh">
          Collections{colls && <span className="n">{colls.length}</span>}
        </div>
        {!selectedDb && !loadingDbs && (
          <p className="px-2 py-3 text-center text-[11.5px] text-text-3">
            {databases.length === 0 ? "No databases visible" : "Pick a database above"}
          </p>
        )}
        {selectedDb && colls === null && (
          <div className="flex items-center gap-2 px-3 py-2 text-[11.5px] text-text-3">
            <Loader2 className="spin" style={{ width: 12, height: 12 }} /> loading
          </div>
        )}
        {colls?.map((c) => {
          const key = `${selectedDb}.${c.name}`;
          const on = activeDb === selectedDb && activeColl === c.name;
          return (
            <ContextMenu key={c.name} modal={false}>
              <ContextMenuTrigger asChild>
                <button
                  className={cn("it", on && "on")}
                  onClick={() => openCollection(selectedDb!, c.name)}
                  onAuxClick={(e) => e.button === 1 && openCollectionInNewTab(selectedDb!, c.name)}
                  title={c.name}
                >
                  <CollIcon kind={c.kind} />
                  <span className="n">{c.name}</span>
                  {c.kind === "view" ? (
                    <span className="c">view</span>
                  ) : c.kind === "timeseries" ? (
                    <span className="c">ts</span>
                  ) : counts[key] !== undefined ? (
                    <span className="c">{formatCount(counts[key])}</span>
                  ) : null}
                </button>
              </ContextMenuTrigger>
              {collMenu(selectedDb!, c.name, c.kind)}
            </ContextMenu>
          );
        })}
        {colls && colls.length === 0 && (
          <p className="px-2 py-2 text-[11.5px] text-text-3">{filter ? "No matches" : "Empty database"}</p>
        )}

        {(() => {
          const entries = Object.entries(savedQueries)
            .filter(([k]) => k.startsWith(`${scope}/`))
            .flatMap(([k, list]) => list.map((q) => ({ key: k, q })));
          if (entries.length === 0) return null;
          return (
            <>
              <div className="gh">Saved queries</div>
              {entries.map(({ key, q }) => {
                const ns = key.slice(scope.length + 1);
                const i = ns.indexOf(".");
                const db = ns.slice(0, i);
                const coll = ns.slice(i + 1);
                return (
                  <ContextMenu key={key + q.name} modal={false}>
                    <ContextMenuTrigger asChild>
                      <button
                        className="it"
                        title={`${ns} · ${q.filter}`}
                        onClick={() => {
                          openCollection(db, coll);
                          const t = useExplorer
                            .getState()
                            .tabs.find((x) => x.database === db && x.collection === coll);
                          if (t) {
                            patchDocs(t.id, { filter: q.filter, sort: q.sort, projection: q.projection });
                            void runFind(t.id, { resetPage: true });
                          }
                        }}
                      >
                        <Search />
                        <span className="n">{q.name}</span>
                        <span className="c">{coll}</span>
                      </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent>
                      <ContextMenuItem onSelect={() => removeQuery(key, q.name)} className="text-danger focus:text-danger">
                        <Trash2 /> Delete saved query
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })}
            </>
          );
        })()}
      </div>

      <div className="pickfoot">
        <span className="min-w-0 truncate">
          {allColls
            ? `${formatCount(allColls.length - viewCount)} collection${allColls.length - viewCount === 1 ? "" : "s"}${viewCount ? ` · ${viewCount} view${viewCount === 1 ? "" : "s"}` : ""}`
            : `${formatCount(databases.length)} database${databases.length === 1 ? "" : "s"}`}
        </span>
        {active && <Latency workspaceId={active.id} host={active.hostSummary} ssh={active.ssh} />}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={cn("ico sm", !active && "ml-auto")}
              onClick={() => {
                void loadDatabases();
                if (selectedDb) void loadCollections(selectedDb);
              }}
              aria-label="Refresh"
            >
              {loadingDbs ? <Loader2 className="spin" /> : <RefreshCw />}
            </button>
          </TooltipTrigger>
          <TooltipContent>Refresh databases and collections</TooltipContent>
        </Tooltip>
      </div>

      <div
        className={cn("rz", dragging && "on")}
        onMouseDown={startResize}
        onDoubleClick={() => setPickerWidth(PICKER_DEFAULT)}
        title="Drag to resize · double-click to reset"
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
      <TypeExportDialog
        open={!!typesTarget}
        database={typesTarget?.db ?? ""}
        collection={typesTarget?.coll ?? ""}
        onOpenChange={(o) => !o && setTypesTarget(null)}
      />
      <DbOverviewDialog
        open={!!overviewDb}
        database={overviewDb ?? ""}
        onOpenChange={(o) => !o && setOverviewDb(null)}
        onOpenCollection={(name) => {
          if (overviewDb) openCollection(overviewDb, name);
          setOverviewDb(null);
        }}
      />
      <ClearCollectionDialog
        target={clearTarget}
        onOpenChange={(o) => !o && setClearTarget(null)}
      />
      <DropCollectionDialog
        target={dropTarget}
        onOpenChange={(o) => !o && setDropTarget(null)}
      />
    </aside>
  );
}
