import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Info,
  ListEnd,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
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
import { ResultsViewer, docSelectionKey } from "@/components/explorer/ResultsViewer";
import { ViewToggle } from "@/components/explorer/ViewToggle";
import { newStage, pipelineSig, useExplorer, type Stage, type Tab } from "@/stores/explorer";
import { useMemo } from "react";
import { type Doc, type StageStat } from "@/lib/api";
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

/** Per-stage profile row shown under a stage after "Stage stats" ran. */
function StageStatBadge({ stat, prevDocs }: { stat: StageStat; prevDocs: number | null }) {
  const stageMs = stat.cumulativeMs;
  const drop =
    prevDocs !== null && prevDocs > 0 && stat.docs <= prevDocs
      ? Math.round(((prevDocs - stat.docs) / prevDocs) * 100)
      : null;
  return (
    <div className="mx-2 mb-1.5 flex items-center gap-2 rounded-[var(--r-xs)] bg-panel-2 px-2 py-1 font-mono text-[10px] tabular-nums text-text-3">
      <span className="text-text">{stat.docs.toLocaleString()}</span>
      docs out
      {drop !== null && drop > 0 && (
        <span className={cn("pill", drop >= 90 ? "acc" : "")}>-{drop}%</span>
      )}
      <span className="ml-auto">{stageMs.toLocaleString()} ms cumulative</span>
    </div>
  );
}

function StageCard({
  tab,
  stage,
  index,
  total,
  stat,
  prevDocs,
}: {
  tab: Tab;
  stage: Stage;
  index: number;
  total: number;
  stat?: StageStat;
  prevDocs: number | null;
}) {
  const patchAgg = useExplorer((s) => s.patchAgg);
  const runAggregate = useExplorer((s) => s.runAggregate);
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
        "rounded-[var(--r)] border border-line bg-panel transition-opacity",
        !stage.enabled && "opacity-50"
      )}
    >
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button
          onClick={() => update({ collapsed: !stage.collapsed })}
          className="ico sm"
          aria-label={stage.collapsed ? "Expand stage" : "Collapse stage"}
        >
          {stage.collapsed ? <ChevronRight /> : <ChevronDown />}
        </button>
        <span className="w-4 text-center font-mono text-[11px] tabular-nums text-text-3">
          {index + 1}
        </span>
        <Select
          value={stage.op}
          onValueChange={(op) =>
            update({ op, body: stage.body.trim() === "" || stage.body === SNIPPETS[stage.op] || stage.body === "{\n  \n}" ? SNIPPETS[op] ?? "{\n  \n}" : stage.body })
          }
        >
          <SelectTrigger className="h-7 w-[150px] text-xs">
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
            <button className="ico sm" onClick={() => void runAggregate(tab.id, index)} aria-label="Run to here">
              <ListEnd />
            </button>
          </TooltipTrigger>
          <TooltipContent>Run pipeline up to this stage</TooltipContent>
        </Tooltip>
        <button className="ico sm" disabled={index === 0} onClick={() => move(-1)} aria-label="Move up">
          <ArrowUp />
        </button>
        <button className="ico sm" disabled={index === total - 1} onClick={() => move(1)} aria-label="Move down">
          <ArrowDown />
        </button>
        <Switch
          checked={stage.enabled}
          onCheckedChange={(enabled) => update({ enabled })}
          className="mx-1 scale-90"
        />
        <button
          className="ico sm dgr"
          onClick={() => patchAgg(tab.id, { stages: stages.filter((s) => s.id !== stage.id) })}
          aria-label="Remove stage"
        >
          <Trash2 />
        </button>
      </div>
      {!stage.collapsed && (
        <div className="px-2 pb-2">
          <CodeEditor
            value={stage.body}
            onChange={(body) => update({ body })}
            onRun={() => void runAggregate(tab.id)}
            height={Math.min(220, Math.max(64, stage.body.split("\n").length * 19 + 20))}
            lineNumbers={false}
            path={`agg/${tab.id}/${stage.id}`}
          />
        </div>
      )}
      {stat && <StageStatBadge stat={stat} prevDocs={prevDocs} />}
    </div>
  );
}

export function AggregatePane({ tab }: { tab: Tab }) {
  const patchAgg = useExplorer((s) => s.patchAgg);
  const setDrawer = useExplorer((s) => s.setDrawer);
  const a = tab.agg;

  // Map enabled-stage order to stage id, valid only while the signature holds.
  const statByStageId = useMemo(() => {
    const stats = a.stats;
    if (!stats || stats.sig !== pipelineSig(a.stages)) return {};
    const map: Record<string, { stat: StageStat; prevDocs: number | null }> = {};
    let i = 0;
    let prev: number | null = null;
    for (const s of a.stages) {
      if (!s.enabled) continue;
      const row = stats.rows[i++];
      if (!row) break;
      map[s.id] = { stat: row, prevDocs: prev };
      prev = row.docs;
    }
    return map;
  }, [a.stats, a.stages]);

  // Stable so the memoized ResultsViewer doesn't rebuild on stage-body edits.
  const docActions = useMemo(
    () => ({ onView: (doc: Doc) => setDrawer(tab.id, { kind: "doc", doc, source: "agg" }) }),
    [setDrawer, tab.id]
  );
  const activeKey = tab.drawer.kind === "doc" && tab.drawer.source === "agg" ? docSelectionKey(tab.drawer.doc) : null;

  return (
    <div className="flex min-h-0 flex-1">
      {/* stages column */}
      <div className="flex w-[400px] shrink-0 flex-col border-r border-line">
        <div className="no-select flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
          <span className="lbl">Pipeline</span>
          <span className="font-mono text-[10.5px] text-text-3">
            {a.stages.filter((s) => s.enabled).length} active
          </span>
          <div className="flex-1" />
          <button
            className="btn qt sm"
            onClick={() => patchAgg(tab.id, { stages: [...a.stages, newStage("$match", SNIPPETS.$match)] })}
          >
            <Plus />
            Add stage
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-2 p-3">
            {a.stages.map((stage, i) => (
              <StageCard
                key={stage.id}
                tab={tab}
                stage={stage}
                index={i}
                total={a.stages.length}
                stat={statByStageId[stage.id]?.stat}
                prevDocs={statByStageId[stage.id]?.prevDocs ?? null}
              />
            ))}
            <button
              className="btn"
              style={{ borderStyle: "dashed", justifyContent: "center", color: "var(--text-3)" }}
              onClick={() => patchAgg(tab.id, { stages: [...a.stages, newStage("$match", SNIPPETS.$match)] })}
            >
              <Plus />
              Add stage
            </button>
          </div>
        </div>
      </div>

      {/* results column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="no-select flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
          <span className="font-mono text-[11px] text-text-3">
            {a.docs === null
              ? "Results"
              : `${a.docs.length} result${a.docs.length === 1 ? "" : "s"}${a.execMs !== null ? ` · ${a.execMs}ms` : ""}`}
          </span>
          {a.ranToStage !== null && <span className="pill acc">after stage {a.ranToStage + 1}</span>}
          <div className="flex-1" />
          <ViewToggle view={a.view} onChange={(view) => patchAgg(tab.id, { view })} />
        </div>

        {a.error && (
          <div className="notice dgr mono mx-3 mt-2 shrink-0">
            <AlertCircle />
            <span className="min-w-0 break-all">{a.error}</span>
          </div>
        )}
        {a.appliedDefaultLimit && !a.error && (
          <div className="notice mx-3 mt-2 shrink-0">
            <Info />
            <span>Preview capped at 500 documents - add a $limit / $out stage to control output.</span>
          </div>
        )}

        {a.loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="spin h-5 w-5 text-text-3" />
          </div>
        ) : a.docs === null ? (
          <div className="no-select flex flex-1 items-center justify-center text-center">
            <div>
              <p className="text-[13px] font-medium text-text-2">Build, then run</p>
              <p className="mt-1 max-w-[280px] text-[12px] text-text-3">
                Compose stages on the left and press Run pipeline in the dock, or run partway with the
                stage-preview button on a stage.
              </p>
            </div>
          </div>
        ) : (
          <ResultsViewer
            docs={a.docs}
            view={a.view}
            actions={docActions}
            emptyText="Pipeline returned no documents"
            activeKey={activeKey}
          />
        )}
      </div>
    </div>
  );
}
