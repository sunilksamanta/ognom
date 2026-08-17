import { memo, useEffect, useState } from "react";
import { ChevronDown, Download, Loader2, Plus, Upload } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DocumentsPane } from "@/components/explorer/DocumentsPane";
import { AggregatePane } from "@/components/aggregation/AggregatePane";
import { ShellPane } from "@/components/shell/ShellPane";
import { IndexesPane } from "@/components/explorer/IndexesSheet";
import { SchemaPane } from "@/components/explorer/SchemaSheet";
import { Dock } from "@/components/explorer/Dock";
import { DropCollectionDialog } from "@/components/explorer/CollectionDangerDialogs";
import { useExplorer, type Tab, type TabMode } from "@/stores/explorer";
import { useSettings } from "@/stores/settings";
import { useConnections } from "@/stores/connections";
import { api, type CollectionStats } from "@/lib/api";
import { exportCollection, importDocuments } from "@/lib/files";
import { formatBytes, formatCount } from "@/lib/bson";
import { cn } from "@/lib/utils";

/** Views of the collection. Aggregate and Shell are query modes and live in
 *  the dock instead. */
const VIEWS: { id: TabMode; label: string }[] = [
  { id: "table", label: "Table" },
  { id: "documents", label: "Documents" },
  { id: "schema", label: "Schema" },
  { id: "indexes", label: "Indexes" },
];

/**
 * One open collection: context header (title + stat strip), the view row,
 * the view itself and the query dock. Mounted once per tab and kept alive.
 */
export const CollectionView = memo(function CollectionView({ tab, active }: { tab: Tab; active: boolean }) {
  const setTabMode = useExplorer((s) => s.setTabMode);
  const setDrawer = useExplorer((s) => s.setDrawer);
  const runFind = useExplorer((s) => s.runFind);
  const advancedMode = useSettings((s) => s.advancedMode);
  const readOnly = useConnections(
    (s) => s.workspaces.find((w) => w.info.id === s.activeId)?.readOnly ?? false
  );
  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [dropOpen, setDropOpen] = useState(false);
  const [importing, setImporting] = useState(false);

  // Collection stats for the header - refreshed after every successful run
  // and when the tab becomes active again.
  useEffect(() => {
    if (!active) return;
    let stale = false;
    api
      .collectionStats(tab.database, tab.collection)
      .then((s) => !stale && setStats(s))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [tab.database, tab.collection, tab.docs.ranAt, active]);

  const inFind = tab.mode === "table" || tab.mode === "documents";
  const count = stats?.count ?? tab.docs.count;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="ctx no-select">
        <div className="min-w-0">
          <h1 title={`${tab.database}.${tab.collection}`}>{tab.collection}</h1>
          <div className="sub">
            {tab.database} · {count === null || count === undefined ? "?" : formatCount(count)} documents
            {stats?.nindexes != null && (
              <button className="pill" onClick={() => setTabMode(tab.id, "indexes")}>
                {stats.nindexes} index{stats.nindexes === 1 ? "" : "es"}
              </button>
            )}
            {readOnly && <span className="pill warn">read-only</span>}
          </div>
        </div>
        <div className="stats">
          <div>
            <div className="l">Data</div>
            <div className="v">{formatBytes(stats?.size)}</div>
          </div>
          <div>
            <div className="l">Avg doc</div>
            <div className="v">{formatBytes(stats?.avgObjSize)}</div>
          </div>
          <div>
            <div className="l">Indexes</div>
            <div className="v">{formatBytes(stats?.totalIndexSize)}</div>
          </div>
          <div>
            <div className="l">Storage</div>
            <div className="v">{formatBytes(stats?.storageSize)}</div>
          </div>
        </div>
      </div>

      <div className="viewrow no-select">
        <div className="tabsl" role="tablist">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              role="tab"
              aria-selected={tab.mode === v.id}
              className={cn(tab.mode === v.id && "on")}
              onClick={() => setTabMode(tab.id, v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="r">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <button className="btn qt">
                Export
                <ChevronDown style={{ width: 12, height: 12, opacity: 0.7 }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuLabel>
                Export {tab.docs.filter.trim() ? "current filter" : "all documents"}
              </DropdownMenuLabel>
              {(["json", "ndjson", "csv", "bson"] as const).map((format) => (
                <DropdownMenuItem
                  key={format}
                  className="gap-2"
                  onClick={() =>
                    void exportCollection({
                      database: tab.database,
                      collection: tab.collection,
                      filter: tab.docs.filter,
                      sort: tab.docs.sort,
                      format,
                    })
                  }
                >
                  <Download className="h-3.5 w-3.5" />
                  {format === "bson" ? "BSON (mongodump)" : format.toUpperCase()}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="gap-2"
                disabled={readOnly || importing}
                onClick={() => {
                  setImporting(true);
                  void importDocuments(tab.database, tab.collection)
                    .then((ok) => {
                      if (ok) void runFind(tab.id);
                    })
                    .finally(() => setImporting(false));
                }}
              >
                {importing ? <Loader2 className="spin h-3.5 w-3.5" /> : <Upload className="h-3.5 w-3.5" />}
                Import documents (JSON / CSV / BSON)
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="btn dgr" disabled={readOnly} onClick={() => setDropOpen(true)}>
                Drop
              </button>
            </TooltipTrigger>
            <TooltipContent>{readOnly ? "Read-only workspace" : "Drop this collection"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="btn pri"
                disabled={readOnly}
                onClick={() => {
                  if (!inFind) setTabMode(tab.id, "documents");
                  setDrawer(tab.id, { kind: "insert" });
                }}
              >
                <Plus />
                Insert
              </button>
            </TooltipTrigger>
            <TooltipContent>
              {readOnly ? "Read-only workspace - switch to edit mode first" : "Insert a document (⌘N)"}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {inFind && <DocumentsPane tab={tab} />}
      {tab.mode === "schema" && <SchemaPane tab={tab} active={active} />}
      {tab.mode === "aggregate" && <AggregatePane tab={tab} />}
      {tab.mode === "indexes" && <IndexesPane tab={tab} active={active} readOnly={readOnly} />}
      {tab.mode === "shell" && advancedMode && <ShellPane tab={tab} />}

      {(inFind || tab.mode === "aggregate" || tab.mode === "shell") && <Dock tab={tab} />}

      <DropCollectionDialog
        target={dropOpen ? { db: tab.database, coll: tab.collection } : null}
        onOpenChange={(o) => {
          if (!o) setDropOpen(false);
        }}
      />
    </div>
  );
});
