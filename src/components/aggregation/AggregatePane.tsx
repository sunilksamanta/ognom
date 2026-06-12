import { toast } from "sonner";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Info,
  ListEnd,
  Loader2,
  Gauge,
  Play,
  Plus,
  SquareTerminal,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { CodeEditor } from "@/components/CodeEditor";
import { ResultsViewer } from "@/components/explorer/ResultsViewer";
import { ViewToggle } from "@/components/explorer/DocumentsPane";
import { DocumentDialogs, type DocDialogState } from "@/components/explorer/DocumentDialogs";
import { ExplainSheet, type ExplainRequest } from "@/components/explorer/ExplainSheet";
import { newStage, useExplorer, type Stage, type Tab } from "@/stores/explorer";
import { useSettings } from "@/stores/settings";
import { useState } from "react";
import type { Doc } from "@/lib/api";
import { cn } from "@/lib/utils";

const STAGE_OPS = [
  "$match",
  "$group",
  "$sort",
  "$project",
  "$limit",
  "$skip",
  "$lookup",
  "$unwind",
  "$addFields",
  "$set",
  "$unset",
  "$count",
  "$facet",
  "$bucket",
  "$bucketAuto",
  "$sortByCount",
  "$replaceRoot",
  "$replaceWith",
  "$sample",
  "$graphLookup",
  "$unionWith",
  "$geoNear",
  "$out",
  "$merge",
];

const SNIPPETS: Record<string, string> = {
  $match: '{\n  status: "active"\n}',
  $group: '{\n  _id: "$category",\n  total: { $sum: 1 }\n}',
  $sort: "{ createdAt: -1 }",
  $project: "{\n  name: 1,\n  email: 1\n}",
  $limit: "20",
  $skip: "0",
  $lookup:
    '{\n  from: "otherCollection",\n  localField: "fieldA",\n  foreignField: "_id",\n  as: "joined"\n}',
  $unwind: '"$items"',
  $addFields: '{\n  fullName: { $concat: ["$first", " ", "$last"] }\n}',
  $set: '{\n  updated: true\n}',
  $unset: '["tempField"]',
  $count: '"total"',
  $sample: "{ size: 10 }",
  $sortByCount: '"$category"',
  $replaceRoot: '{\n  newRoot: "$nested"\n}',
  $replaceWith: '"$nested"',
  $unionWith: '{\n  coll: "otherCollection"\n}',
};

function StageCard({
  tab,
  stage,
  index,
  total,
}: {
  tab: Tab;
  stage: Stage;
  index: number;
  total: number;
}) {
  const { patchAgg, runAggregate } = useExplorer();
  const stages = tab.agg.stages;

  const update = (patch: Partial<Stage>) =>
    patchAgg(tab.id, { stages: stages.map((s) => (s.id === stage.id ? { ...s, ...patch } : s)) });

  const move = (dir: -1 | 1) => {
    const next = [...stages];
    const j = index + dir;
    [next[index], next[j]] = [next[j], next[index]];
    patchAgg(tab.id, { stages: next });
  };

  return (
    <div
      className={cn(
        "rounded-lg border bg-card transition-opacity",
        !stage.enabled && "opacity-50"
      )}
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          onClick={() => update({ collapsed: !stage.collapsed })}
          className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {stage.collapsed ? (
            <ChevronRight className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        <span className="w-4 text-center text-[11px] tabular-nums text-muted-foreground">
          {index + 1}
        </span>
        <Select
          value={stage.op}
          onValueChange={(op) =>
            update({ op, body: stage.body.trim() === "" || stage.body === SNIPPETS[stage.op] || stage.body === "{\n  \n}" ? SNIPPETS[op] ?? "{\n  \n}" : stage.body })
          }
        >
          <SelectTrigger className="h-7 w-[150px] font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {STAGE_OPS.map((op) => (
              <SelectItem key={op} value={op} className="font-mono text-xs">
                {op}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6"
              onClick={() => void runAggregate(tab.id, index)}
            >
              <ListEnd className="h-3.5 w-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Run pipeline up to this stage</TooltipContent>
        </Tooltip>
        <Button variant="ghost" size="icon" className="h-6 w-6" disabled={index === 0} onClick={() => move(-1)}>
          <ArrowUp className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          disabled={index === total - 1}
          onClick={() => move(1)}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </Button>
        <Switch
          checked={stage.enabled}
          onCheckedChange={(enabled) => update({ enabled })}
          className="mx-1 scale-90"
        />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={() => patchAgg(tab.id, { stages: stages.filter((s) => s.id !== stage.id) })}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
      {!stage.collapsed && (
        <div className="px-2 pb-2">
          <CodeEditor
            value={stage.body}
            onChange={(body) => update({ body })}
            onRun={() => void runAggregate(tab.id)}
            height={Math.min(220, Math.max(64, stage.body.split("\n").length * 19 + 20))}
            lineNumbers={false}
          />
        </div>
      )}
    </div>
  );
}

export function AggregatePane({ tab }: { tab: Tab }) {
  const { patchAgg, runAggregate, setTabMode, patchShell } = useExplorer();
  const setAdvancedMode = useSettings((s) => s.setAdvancedMode);
  const [dialog, setDialog] = useState<DocDialogState>({ type: "closed" });
  const [explain, setExplain] = useState<ExplainRequest | null>(null);
  const [explainOpen, setExplainOpen] = useState(false);
  const a = tab.agg;

  const openExplain = () => {
    const stages = a.stages
      .filter((s) => s.enabled)
      .map((s) => ({ op: s.op, body: s.body }));
    if (stages.length === 0) {
      toast.error("Add at least one enabled stage");
      return;
    }
    setExplain({
      database: tab.database,
      collection: tab.collection,
      filter: "",
      sort: "",
      projection: "",
      pipelineStages: stages,
    });
    setExplainOpen(true);
  };

  const pipelineText = () => {
    const parts = a.stages
      .filter((s) => s.enabled)
      .map((s) => {
        const body = s.body.trim().split("\n").join("\n  ");
        return `  { ${s.op}: ${body} }`;
      });
    return `[\n${parts.join(",\n")}\n]`;
  };

  const copyPipeline = async () => {
    await navigator.clipboard.writeText(pipelineText());
    toast.success("Pipeline copied");
  };

  const openInShell = () => {
    setAdvancedMode(true);
    const coll = /^[A-Za-z_]\w*$/.test(tab.collection)
      ? tab.collection
      : `getCollection("${tab.collection}")`;
    patchShell(tab.id, { text: `db.${coll}.aggregate(${pipelineText()})` });
    setTabMode(tab.id, "shell");
  };

  return (
    <div className="flex min-h-0 flex-1">
      {/* stages column */}
      <div className="flex w-[400px] shrink-0 flex-col border-r">
        <div className="no-select flex shrink-0 items-center gap-2 border-b px-3 py-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Pipeline
          </span>
          <span className="text-xs text-muted-foreground/70">
            {a.stages.filter((s) => s.enabled).length} active
          </span>
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void copyPipeline()}>
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy pipeline as shell syntax</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={openInShell}>
                <SquareTerminal className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Open in shell</TooltipContent>
          </Tooltip>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-2 p-3">
            {a.stages.map((stage, i) => (
              <StageCard key={stage.id} tab={tab} stage={stage} index={i} total={a.stages.length} />
            ))}
            <Button
              variant="outline"
              size="sm"
              className="border-dashed text-muted-foreground"
              onClick={() =>
                patchAgg(tab.id, { stages: [...a.stages, newStage("$match", SNIPPETS.$match)] })
              }
            >
              <Plus className="h-3.5 w-3.5" />
              Add stage
            </Button>
          </div>
        </div>

        <div className="no-select flex shrink-0 items-center gap-3 border-t px-3 py-2">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Checkbox
              checked={a.allowDiskUse}
              onCheckedChange={(v) => patchAgg(tab.id, { allowDiskUse: v === true })}
            />
            Allow disk use
          </label>
          <div className="flex-1" />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={openExplain}>
                <Gauge className="h-3.5 w-3.5" />
                Explain
              </Button>
            </TooltipTrigger>
            <TooltipContent>Explain plan — index usage & timing</TooltipContent>
          </Tooltip>
          <Button size="sm" className="h-7 gap-1.5" disabled={a.loading} onClick={() => void runAggregate(tab.id)}>
            {a.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            Run pipeline
          </Button>
        </div>
      </div>

      {/* results column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="no-select flex h-9 shrink-0 items-center gap-2 border-b px-3">
          <span className="text-xs text-muted-foreground">
            {a.docs === null
              ? "Results"
              : `${a.docs.length} result${a.docs.length === 1 ? "" : "s"}${a.execMs !== null ? ` · ${a.execMs}ms` : ""}`}
          </span>
          {a.ranToStage !== null && (
            <span className="rounded bg-info/15 px-1.5 py-0.5 text-[10px] font-medium text-info">
              after stage {a.ranToStage + 1}
            </span>
          )}
          <div className="flex-1" />
          <ViewToggle view={a.view} onChange={(view) => patchAgg(tab.id, { view })} />
        </div>

        {a.error && (
          <div className="mx-3 mt-2 flex shrink-0 items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="break-all font-mono">{a.error}</span>
          </div>
        )}
        {a.appliedDefaultLimit && !a.error && (
          <div className="mx-3 mt-2 flex shrink-0 items-center gap-2 rounded-md border border-info/30 bg-info/10 px-3 py-1.5 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0 text-info" />
            Preview capped at 500 documents — add a $limit / $out stage to control output.
          </div>
        )}

        {a.loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : a.docs === null ? (
          <div className="no-select flex flex-1 items-center justify-center text-center text-muted-foreground">
            <div>
              <p className="text-sm font-medium text-foreground">Build, then run</p>
              <p className="mt-1 max-w-[280px] text-xs">
                Compose stages on the left and hit Run pipeline — or run partway with the
                stage-preview button.
              </p>
            </div>
          </div>
        ) : (
          <ResultsViewer
            docs={a.docs}
            view={a.view}
            actions={{ onView: (doc: Doc) => setDialog({ type: "view", doc }) }}
            emptyText="Pipeline returned no documents"
          />
        )}
      </div>

      <DocumentDialogs
        database={tab.database}
        collection={tab.collection}
        state={dialog}
        onClose={() => setDialog({ type: "closed" })}
        onMutated={() => void runAggregate(tab.id)}
      />

      <ExplainSheet request={explain} open={explainOpen} onOpenChange={setExplainOpen} />
    </div>
  );
}
