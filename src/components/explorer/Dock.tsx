import { useEffect, useState } from "react";
import {
  BarChart3,
  Bookmark,
  ChevronLeft,
  Ellipsis,
  Pencil,
  Trash2,
  ChevronRight,
  Copy,
  Gauge,
  ListFilter,
  Loader2,
  Play,
  Rows3,
  Search,
  SlidersHorizontal,
  Terminal,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QueryBuilder } from "@/components/explorer/QueryBuilder";
import { QueryInput } from "@/components/explorer/QueryInput";
import { ExplainSheet, type ExplainRequest } from "@/components/explorer/ExplainSheet";
import { CheckRow } from "@/components/ui/check-row";
import { BulkDeleteDialog, BulkUpdateDialog } from "@/components/explorer/BulkDialogs";
import { useExplorer, type Tab } from "@/stores/explorer";
import { useSettings } from "@/stores/settings";
import { useConnections } from "@/stores/connections";
import { api } from "@/lib/api";
import { formatCount } from "@/lib/bson";
import { cn } from "@/lib/utils";

const IS_MAC = navigator.platform.toUpperCase().includes("MAC");
const RUN_KBD = IS_MAC ? "⌘⏎" : "Ctrl ⏎";
const NO_QUERIES: { name: string; filter: string; sort: string; projection: string }[] = [];

/**
 * The query transport. Find and Aggregate share the dock: match count,
 * timing and the winning plan sit above the input, so a query never hides
 * its cost. Table/Documents views are the "find" mode; Aggregate is its own.
 */
export function Dock({ tab }: { tab: Tab }) {
  const patchDocs = useExplorer((s) => s.patchDocs);
  const patchAgg = useExplorer((s) => s.patchAgg);
  const runFind = useExplorer((s) => s.runFind);
  const runAggregate = useExplorer((s) => s.runAggregate);
  const runStageStats = useExplorer((s) => s.runStageStats);
  const setTabMode = useExplorer((s) => s.setTabMode);
  const patchShell = useExplorer((s) => s.patchShell);
  const setAdvancedMode = useSettings((s) => s.setAdvancedMode);
  const active = useConnections((s) => s.active);
  const scope = active?.profileId ?? active?.id ?? "adhoc";
  const saveQuery = useSettings((s) => s.saveQuery);
  const savedQueries = useSettings(
    (s) => s.savedQueries[`${scope}/${tab.database}.${tab.collection}`] ?? NO_QUERIES
  );
  const removeQuery = useSettings((s) => s.removeQuery);

  // Sampled field paths of the collection feed the query completions.
  const [fields, setFields] = useState<string[]>([]);
  useEffect(() => {
    let stale = false;
    api
      .collectionFields(tab.database, tab.collection, 1000)
      .then((f) => !stale && setFields(f))
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, [tab.database, tab.collection]);

  const [builderOpen, setBuilderOpen] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [explain, setExplain] = useState<ExplainRequest | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const [lastFindView, setLastFindView] = useState<"table" | "documents">("table");

  const isAgg = tab.mode === "aggregate";
  const isShell = tab.mode === "shell";
  const advancedMode = useSettings((s) => s.advancedMode);
  const d = tab.docs;
  const a = tab.agg;

  useEffect(() => {
    if (tab.mode === "table" || tab.mode === "documents") setLastFindView(tab.mode);
  }, [tab.mode]);

  const run = (resetPage: boolean) => void runFind(tab.id, { resetPage });

  const openExplain = () => {
    if (isAgg) {
      const stages = a.stages.filter((s) => s.enabled).map((s) => ({ op: s.op, body: s.body }));
      if (stages.length === 0) return void toast.error("Add at least one enabled stage");
      setExplain({ database: tab.database, collection: tab.collection, filter: "", sort: "", projection: "", pipelineStages: stages });
    } else {
      setExplain({ database: tab.database, collection: tab.collection, filter: d.filter, sort: d.sort, projection: d.projection });
    }
    setExplainOpen(true);
  };

  const pipelineText = () => {
    const parts = a.stages
      .filter((s) => s.enabled)
      .map((s) => `  { ${s.op}: ${s.body.trim().split("\n").join("\n  ")} }`);
    return `[\n${parts.join(",\n")}\n]`;
  };

  const openInShell = () => {
    setAdvancedMode(true);
    const coll = /^[A-Za-z_]\w*$/.test(tab.collection) ? tab.collection : `getCollection("${tab.collection}")`;
    patchShell(tab.id, {
      text: isAgg
        ? `db.${coll}.aggregate(${pipelineText()})`
        : `db.${coll}.find(${d.filter.trim() || "{}"})${d.sort.trim() ? `.sort(${d.sort})` : ""}${
            d.projection.trim() ? `.project(${d.projection})` : ""
          }.limit(${d.limit})`,
    });
    setTabMode(tab.id, "shell");
  };

  const hasMore = d.count !== null ? (d.page + 1) * d.limit < d.count : d.docs.length === d.limit;
  const from = d.page * d.limit + 1;
  const to = d.page * d.limit + d.docs.length;
  const optionsActive = d.sort.trim() !== "" || d.projection.trim() !== "";
  const enabledStages = a.stages.filter((s) => s.enabled).length;

  const readOnly = useConnections(
    (s) => s.workspaces.find((w) => w.info.id === s.activeId)?.readOnly ?? false
  );
  const [bulkUpdateOpen, setBulkUpdateOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const saveCurrent = () => {
    const name = saveName.trim();
    if (!name) return;
    saveQuery(`${scope}/${tab.database}.${tab.collection}`, {
      name,
      filter: d.filter,
      sort: d.sort,
      projection: d.projection,
    });
    toast.success(`Saved "${name}"`);
    setSaveName("");
    setSaveOpen(false);
  };

  return (
    <div className="dock">
      <div className="modes no-select">
        <button
          className={cn("mode", !isAgg && !isShell && "on")}
          onClick={() => (isAgg || isShell) && setTabMode(tab.id, lastFindView)}
        >
          <Search />
          Find
        </button>
        <button className={cn("mode", isAgg && "on")} onClick={() => !isAgg && setTabMode(tab.id, "aggregate")}>
          <Rows3 />
          Aggregate
        </button>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={cn("mode", isShell && "on")}
              style={!advancedMode && !isShell ? { opacity: 0.55 } : undefined}
              onClick={() => {
                if (isShell) return;
                setAdvancedMode(true);
                setTabMode(tab.id, "shell");
              }}
            >
              <Terminal />
              Shell
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {advancedMode ? "Raw shell statements, one at a time" : "Raw shell statements - enables advanced mode"}
          </TooltipContent>
        </Tooltip>
        <div className="r">
          {isShell ? (
            <>
              {tab.shell.outcome && <span>{tab.shell.outcome.execMs} ms</span>}
              <span>{tab.database}</span>
            </>
          ) : isAgg ? (
            <>
              <span>{enabledStages} stage{enabledStages === 1 ? "" : "s"}</span>
              {a.docs && <span>{formatCount(a.docs.length)} results</span>}
              {a.execMs !== null && <span>{a.execMs} ms</span>}
              {a.ranToStage !== null && <span className="pill acc">after stage {a.ranToStage + 1}</span>}
              {a.appliedDefaultLimit && <span className="pill warn">capped at 500</span>}
            </>
          ) : (
            <>
              {d.count !== null && (
                <span>
                  {d.countExact ? "" : "~"}
                  {formatCount(d.count)} matched
                </span>
              )}
              {d.execMs !== null && <span>{d.execMs} ms</span>}
              {d.plan && (
                <span className={cn(d.plan === "COLLSCAN" && "text-warn")} title="Winning plan">
                  {d.plan}
                </span>
              )}
              <span className="inline-flex items-center gap-1">
                <button
                  className="ico sm"
                  disabled={d.page === 0 || d.loading}
                  onClick={() => {
                    patchDocs(tab.id, { page: d.page - 1 });
                    run(false);
                  }}
                  aria-label="Previous page"
                >
                  <ChevronLeft />
                </button>
                <span className="tabular-nums">
                  {d.docs.length > 0 ? `${formatCount(from)}-${formatCount(to)}` : "0"}
                </span>
                <button
                  className="ico sm"
                  disabled={!hasMore || d.loading}
                  onClick={() => {
                    patchDocs(tab.id, { page: d.page + 1 });
                    run(false);
                  }}
                  aria-label="Next page"
                >
                  <ChevronRight />
                </button>
              </span>
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button className="hover:text-text">{d.limit} / page</button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {[10, 25, 50, 100, 500].map((n) => (
                    <DropdownMenuItem
                      key={n}
                      className={cn("font-mono", n === d.limit && "text-primary")}
                      onSelect={() => {
                        patchDocs(tab.id, { limit: n });
                        run(true);
                      }}
                    >
                      {n} per page
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
      </div>

      {isShell ? null : isAgg ? (
        <div className="qline">
          <CheckRow on={a.allowDiskUse} onChange={(v) => patchAgg(tab.id, { allowDiskUse: v })}>
            Allow disk use
          </CheckRow>
          <div className="grow" />
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="btn qt"
                onClick={() => {
                  void navigator.clipboard.writeText(pipelineText());
                  toast.success("Pipeline copied");
                }}
              >
                <Copy />
                Copy
              </button>
            </TooltipTrigger>
            <TooltipContent>Copy pipeline as shell syntax</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="btn qt" onClick={openInShell}>
                <Terminal />
                Shell
              </button>
            </TooltipTrigger>
            <TooltipContent>Open this pipeline in the shell</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <button className="btn qt" disabled={a.profiling} onClick={() => void runStageStats(tab.id)}>
                {a.profiling ? <Loader2 className="spin" /> : <BarChart3 />}
                Stage stats
              </button>
            </TooltipTrigger>
            <TooltipContent>Doc counts, drop-off and timing per stage</TooltipContent>
          </Tooltip>
          <button className="btn qt" onClick={openExplain}>
            <Gauge />
            Explain
          </button>
          <button className="btn pri" disabled={a.loading} onClick={() => void runAggregate(tab.id)}>
            {a.loading ? <Loader2 className="spin" /> : <Play />}
            Run pipeline <span className="kbd">{RUN_KBD}</span>
          </button>
        </div>
      ) : (
        <>
          <div className="qline" style={{ alignItems: "flex-start" }}>
            <QueryInput
              value={d.filter}
              onChange={(v) => patchDocs(tab.id, { filter: v })}
              placeholder={`{ status: "paid", total: { $gt: 100 } }   -   ObjectId(), ISODate(), new Date(), /regex/i, new RegExp() all work`}
              fields={fields}
              ariaLabel="Filter"
              className="grow"
              maxLines={12}
            />
            <Popover open={builderOpen} onOpenChange={setBuilderOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <button className="btn qt">
                      <ListFilter />
                      Build
                    </button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>Visual query builder</TooltipContent>
              </Tooltip>
              <PopoverContent align="end" side="top" className="w-auto">
                <QueryBuilder
                  database={tab.database}
                  collection={tab.collection}
                  onApply={(filter) => {
                    patchDocs(tab.id, { filter });
                    setBuilderOpen(false);
                    run(true);
                  }}
                />
              </PopoverContent>
            </Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={cn("btn qt", (optionsOpen || optionsActive) && "on")}
                  onClick={() => setOptionsOpen((o) => !o)}
                >
                  <SlidersHorizontal />
                  Sort · Project
                </button>
              </TooltipTrigger>
              <TooltipContent>Sort order and projection for this query</TooltipContent>
            </Tooltip>
            <button className="btn qt" onClick={openExplain}>
              <Gauge />
              Explain
            </button>
            <Popover open={saveOpen} onOpenChange={setSaveOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <button className="btn qt">
                      <Bookmark />
                      Save
                    </button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent>Saved queries for this collection</TooltipContent>
              </Tooltip>
              <PopoverContent align="end" side="top" className="w-80 p-3">
                <div className="fld">
                  <label htmlFor="save-q-name">Save current query as</label>
                  <div className="hstack">
                    <input
                      id="save-q-name"
                      className="in sans"
                      value={saveName}
                      onChange={(e) => setSaveName(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && saveCurrent()}
                      placeholder="paid · last 24h"
                      autoFocus
                    />
                    <button className="btn pri" disabled={!saveName.trim()} onClick={saveCurrent}>
                      Save
                    </button>
                  </div>
                  <span className="hint">Filter, sort and projection are stored for this collection.</span>
                </div>
                {savedQueries.length > 0 && (
                  <div className="mt-3 flex flex-col gap-px">
                    <div className="lbl mb-1">Saved</div>
                    {savedQueries.map((q) => (
                      <div key={q.name} className="it" style={{ height: 30 }}>
                        <button
                          className="flex min-w-0 flex-1 items-center gap-2 text-left"
                          onClick={() => {
                            patchDocs(tab.id, { filter: q.filter, sort: q.sort, projection: q.projection });
                            run(true);
                            setSaveOpen(false);
                          }}
                        >
                          <span className="n">{q.name}</span>
                          <span className="c truncate">{q.filter || "{}"}</span>
                        </button>
                        <button
                          className="ico sm"
                          aria-label="Delete saved query"
                          onClick={() => removeQuery(`${scope}/${tab.database}.${tab.collection}`, q.name)}
                        >
                          <X />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button className="ico" aria-label="More">
                  <Ellipsis />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuItem className="gap-2" onSelect={openInShell}>
                  <Terminal className="h-3.5 w-3.5" /> Open in shell
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2"
                  onSelect={() => {
                    const coll = /^[A-Za-z_]\w*$/.test(tab.collection)
                      ? tab.collection
                      : `getCollection("${tab.collection}")`;
                    void navigator.clipboard.writeText(`db.${coll}.find(${d.filter.trim() || "{}"})`);
                    toast.success("Query copied");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" /> Copy as shell
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Bulk · {d.filter.trim() ? "current filter" : "no filter"}</DropdownMenuLabel>
                <DropdownMenuItem className="gap-2" disabled={readOnly} onSelect={() => setBulkUpdateOpen(true)}>
                  <Pencil className="h-3.5 w-3.5" /> Update matching documents
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="gap-2 text-danger focus:text-danger"
                  disabled={readOnly}
                  onSelect={() => setBulkDeleteOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete matching documents
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button className="btn pri" disabled={d.loading} onClick={() => run(true)}>
              {d.loading ? <Loader2 className="spin" /> : <Play />}
              Run
            </button>
          </div>
          {optionsOpen && (
            <div className="qline" style={{ alignItems: "flex-start" }}>
              <span className="lbl" style={{ flex: "none", paddingTop: 14 }}>Sort</span>
              <QueryInput
                value={d.sort}
                onChange={(v) => patchDocs(tab.id, { sort: v })}
                placeholder="{ createdAt: -1 }"
                fields={fields}
                ariaLabel="Sort"
                className="grow"
                maxLines={4}
              />
              <span className="lbl" style={{ flex: "none", paddingTop: 14 }}>Project</span>
              <QueryInput
                value={d.projection}
                onChange={(v) => patchDocs(tab.id, { projection: v })}
                placeholder="{ name: 1, email: 1 }"
                fields={fields}
                ariaLabel="Projection"
                className="grow"
                maxLines={4}
              />
              <button className="btn qt" onClick={openInShell}>
                <Terminal />
                Shell
              </button>
              <button
                className="btn qt"
                onClick={() => {
                  patchDocs(tab.id, { sort: "", projection: "" });
                  run(true);
                }}
              >
                Reset
              </button>
            </div>
          )}
        </>
      )}

      <ExplainSheet request={explain} open={explainOpen} onOpenChange={setExplainOpen} />
      <BulkUpdateDialog
        open={bulkUpdateOpen}
        database={tab.database}
        collection={tab.collection}
        filter={d.filter}
        onOpenChange={setBulkUpdateOpen}
        onDone={() => run(false)}
      />
      <BulkDeleteDialog
        open={bulkDeleteOpen}
        database={tab.database}
        collection={tab.collection}
        filter={d.filter}
        onOpenChange={setBulkDeleteOpen}
        onDone={() => run(true)}
      />
    </div>
  );
}
