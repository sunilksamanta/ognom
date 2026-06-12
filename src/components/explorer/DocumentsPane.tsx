import { useState } from "react";
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Download,
  FileJson2,
  Gauge,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Table2,
  Upload,
  ListFilter,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ResultsViewer } from "@/components/explorer/ResultsViewer";
import { DocumentDialogs, type DocDialogState } from "@/components/explorer/DocumentDialogs";
import { QueryBuilder } from "@/components/explorer/QueryBuilder";
import { ExplainSheet, type ExplainRequest } from "@/components/explorer/ExplainSheet";
import { useExplorer, type Tab, type ViewMode } from "@/stores/explorer";
import { formatCount } from "@/lib/bson";
import { exportCollection, importDocuments } from "@/lib/files";
import type { Doc } from "@/lib/api";
import { cn } from "@/lib/utils";

export function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
}) {
  return (
    <div className="flex items-center rounded-md border bg-muted/60 p-0.5">
      {(
        [
          { id: "json", icon: FileJson2, label: "JSON" },
          { id: "table", icon: Table2, label: "Table" },
        ] as const
      ).map((v) => (
        <button
          key={v.id}
          onClick={() => onChange(v.id)}
          className={cn(
            "flex items-center gap-1 rounded-[5px] px-2 py-0.5 text-xs font-medium transition-colors",
            view === v.id
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <v.icon className="h-3.5 w-3.5" />
          {v.label}
        </button>
      ))}
    </div>
  );
}

export function DocumentsPane({ tab }: { tab: Tab }) {
  const { patchDocs, runFind } = useExplorer();
  const [dialog, setDialog] = useState<DocDialogState>({ type: "closed" });
  const [builderOpen, setBuilderOpen] = useState(false);
  const [explain, setExplain] = useState<ExplainRequest | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const d = tab.docs;

  const run = (resetPage: boolean) => void runFind(tab.id, { resetPage });

  const openExplain = () => {
    setExplain({
      database: tab.database,
      collection: tab.collection,
      filter: d.filter,
      sort: d.sort,
      projection: d.projection,
    });
    setExplainOpen(true);
  };

  const hasMore =
    d.count !== null ? (d.page + 1) * d.limit < d.count : d.docs.length === d.limit;
  const from = d.page * d.limit + 1;
  const to = d.page * d.limit + d.docs.length;

  const actions = {
    onView: (doc: Doc) => setDialog({ type: "view", doc }),
    onEdit: (doc: Doc) => setDialog({ type: "edit", doc }),
    onDuplicate: (doc: Doc) => setDialog({ type: "insert", template: doc }),
    onDelete: (doc: Doc) => setDialog({ type: "delete", doc }),
  };

  const optionsActive = d.sort.trim() !== "" || d.projection.trim() !== "";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* query bar */}
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Input
          value={d.filter}
          onChange={(e) => patchDocs(tab.id, { filter: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && run(true)}
          placeholder={`{ field: "value" }   — ObjectId(…), ISODate(…), $gte… all work`}
          className="h-8 flex-1 font-mono text-xs"
          spellCheck={false}
        />

        <Popover open={builderOpen} onOpenChange={setBuilderOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
                  <ListFilter className="h-3.5 w-3.5" />
                  Build
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Visual query builder</TooltipContent>
          </Tooltip>
          <PopoverContent align="start" className="w-auto">
            <QueryBuilder
              database={tab.database}
              collection={tab.collection}
              onApply={(filter) => {
                patchDocs(tab.id, { filter });
                setBuilderOpen(false);
                void runFind(tab.id, { resetPage: true });
              }}
            />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={cn("h-8 gap-1.5 text-xs", optionsActive && "border-primary/50 text-primary")}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Options
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Sort</Label>
              <Input
                value={d.sort}
                onChange={(e) => patchDocs(tab.id, { sort: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && run(true)}
                placeholder="{ createdAt: -1 }"
                className="h-8 font-mono text-xs"
                spellCheck={false}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Projection</Label>
              <Input
                value={d.projection}
                onChange={(e) => patchDocs(tab.id, { projection: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && run(true)}
                placeholder="{ name: 1, email: 1 }"
                className="h-8 font-mono text-xs"
                spellCheck={false}
              />
            </div>
            <Button size="sm" className="w-full" onClick={() => run(true)}>
              Apply
            </Button>
          </PopoverContent>
        </Popover>

        <Button size="sm" className="h-8 gap-1.5" onClick={() => run(true)} disabled={d.loading}>
          {d.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run
        </Button>

        {(d.filter || optionsActive) && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  patchDocs(tab.id, { filter: "", sort: "", projection: "" });
                  void runFind(tab.id, { resetPage: true });
                }}
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Clear query</TooltipContent>
          </Tooltip>
        )}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={openExplain}>
              <Gauge className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Explain plan — index usage & timing</TooltipContent>
        </Tooltip>

        <div className="mx-1 h-5 w-px bg-border" />

        <ViewToggle view={d.view} onChange={(view) => patchDocs(tab.id, { view })} />

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Download className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent>Export / Import</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Export {d.filter.trim() ? "(current filter)" : "all"}</DropdownMenuLabel>
            <DropdownMenuItem
              className="gap-2"
              onClick={() =>
                void exportCollection({
                  database: tab.database,
                  collection: tab.collection,
                  filter: d.filter,
                  sort: d.sort,
                  format: "json",
                })
              }
            >
              <FileJson2 className="h-3.5 w-3.5" />
              Export as JSON
            </DropdownMenuItem>
            <DropdownMenuItem
              className="gap-2"
              onClick={() =>
                void exportCollection({
                  database: tab.database,
                  collection: tab.collection,
                  filter: d.filter,
                  sort: d.sort,
                  format: "csv",
                })
              }
            >
              <Table2 className="h-3.5 w-3.5" />
              Export as CSV
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2"
              onClick={() =>
                void importDocuments(tab.database, tab.collection).then(
                  (ok) => ok && run(false)
                )
              }
            >
              <Upload className="h-3.5 w-3.5" />
              Import documents…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs"
          onClick={() => setDialog({ type: "insert" })}
        >
          <Plus className="h-3.5 w-3.5" />
          Insert
        </Button>
      </div>

      {/* error */}
      {d.error && (
        <div className="mx-3 mt-2 flex shrink-0 items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-all font-mono">{d.error}</span>
        </div>
      )}

      {/* results */}
      {d.loading && d.docs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <ResultsViewer
          docs={d.docs}
          view={d.view}
          actions={actions}
          emptyText={
            d.filter.trim()
              ? "No documents match this filter"
              : "This collection is empty — Insert adds the first document"
          }
        />
      )}

      {/* pagination */}
      <div className="no-select flex h-9 shrink-0 items-center gap-2 border-t px-3 text-xs text-muted-foreground">
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          disabled={d.page === 0 || d.loading}
          onClick={() => {
            patchDocs(tab.id, { page: d.page - 1 });
            run(false);
          }}
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          disabled={!hasMore || d.loading}
          onClick={() => {
            patchDocs(tab.id, { page: d.page + 1 });
            run(false);
          }}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
        <span className="tabular-nums">
          {d.docs.length > 0 ? `${formatCount(from)}–${formatCount(to)}` : "0"}
          {d.count !== null && (
            <>
              {" of "}
              {d.countExact ? "" : "~"}
              {formatCount(d.count)}
            </>
          )}
        </span>

        <div className="flex-1" />

        {d.execMs !== null && <span className="tabular-nums">{d.execMs}ms</span>}
        <Select
          value={String(d.limit)}
          onValueChange={(v) => {
            patchDocs(tab.id, { limit: Number(v) });
            run(true);
          }}
        >
          <SelectTrigger className="h-6 w-[88px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {[10, 25, 50, 100, 500].map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} / page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DocumentDialogs
        database={tab.database}
        collection={tab.collection}
        state={dialog}
        onClose={() => setDialog({ type: "closed" })}
        onMutated={() => run(false)}
      />

      <ExplainSheet request={explain} open={explainOpen} onOpenChange={setExplainOpen} />
    </div>
  );
}
