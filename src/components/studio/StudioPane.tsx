import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  BarChart3,
  Bot,
  BrainCircuit,
  ChartLine,
  ChartPie,
  Check,
  Code2,
  Copy,
  Database,
  Donut,
  Download,
  Gauge,
  ImageDown,
  KeyRound,
  Loader2,
  Play,
  SendHorizonal,
  Table2,
  Wand2,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { CanvasChart, type CanvasChartHandle, type ChartData, type ChartType } from "@/components/studio/CanvasChart";
import { useExplorer } from "@/stores/explorer";
import { useStudio, AI_MODELS, type AiMode } from "@/stores/studio";
import { api, errMsg, type Doc, type ShellOutcome } from "@/lib/api";
import { generateVizPlan, optimizeQuery, QUICK_PROMPTS, type VizPlan } from "@/lib/ai";
import { save } from "@tauri-apps/plugin-dialog";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

async function saveAs(name: string, ext: string, base64: string) {
  const path = await save({
    defaultPath: `${name}.${ext}`,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (!path) return false;
  await api.saveFile(path, base64);
  return true;
}

/** Resolve a dotted path; falls back to stringified `_id` members for groups. */
function getPath(doc: Doc, path: string): unknown {
  let cur: unknown = doc;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function asLabel(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("$oid" in o) return String(o.$oid).slice(-6);
    if ("$date" in o) return String(o.$date);
    return JSON.stringify(v);
  }
  return String(v);
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("$numberLong" in o) return Number(o.$numberLong);
    if ("$numberDecimal" in o) return Number(o.$numberDecimal);
    if ("$numberInt" in o) return Number(o.$numberInt);
    if ("$numberDouble" in o) return Number(o.$numberDouble);
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function chartFromDocs(
  docs: Doc[],
  labelField: string,
  valueField: string,
  type: ChartType,
  title?: string
): ChartData | null {
  const labels: string[] = [];
  const values: number[] = [];
  for (const doc of docs.slice(0, 60)) {
    const v = asNumber(getPath(doc, valueField));
    if (v === null) continue;
    labels.push(asLabel(getPath(doc, labelField)));
    values.push(v);
  }
  if (values.length === 0) return null;
  return { type, labels, values, title };
}

function docsToCsv(docs: Doc[]): string {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const d of docs) {
    for (const k of Object.keys(d)) {
      if (!seen.has(k)) {
        seen.add(k);
        cols.push(k);
      }
    }
  }
  const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const cell = (v: unknown) =>
    v === undefined || v === null
      ? ""
      : typeof v === "object"
        ? esc(JSON.stringify(v))
        : esc(String(v));
  return [
    cols.map(esc).join(","),
    ...docs.map((d) => cols.map((c) => cell(d[c])).join(",")),
  ].join("\n");
}

const CHART_TYPES: { id: ChartType; icon: typeof BarChart3; label: string }[] = [
  { id: "bar", icon: BarChart3, label: "Bar" },
  { id: "line", icon: ChartLine, label: "Line" },
  { id: "pie", icon: ChartPie, label: "Pie" },
  { id: "donut", icon: Donut, label: "Donut" },
];

/** Render the AI's plan as a copy-pastable mongosh statement. */
function planToShell(plan: VizPlan, collection: string): string {
  const coll = /^[A-Za-z_][\w]*$/.test(collection) ? `db.${collection}` : `db.getCollection("${collection}")`;
  if (plan.kind === "aggregate" && plan.stages?.length) {
    const stages = plan.stages
      .map((s) => `  { ${s.op}: ${s.body.trim()} }`)
      .join(",\n");
    return `${coll}.aggregate([\n${stages}\n])`;
  }
  let out = `${coll}.find(${plan.filter?.trim() || "{}"}`;
  if (plan.projection?.trim()) out += `, ${plan.projection.trim()}`;
  out += ")";
  if (plan.sort?.trim()) out += `.sort(${plan.sort.trim()})`;
  out += `.limit(${Math.min(plan.limit ?? 100, 500)})`;
  return out;
}

const SAMPLE_PROMPTS = [
  "Count documents grouped by status",
  "Top 10 most recent documents",
  "Average value per category as a bar chart",
  "Documents created per day over the last 30 days",
];

// ---------------------------------------------------------------------------
// Studio
// ---------------------------------------------------------------------------

type StudioTab = "visualize" | "optimize";

export function StudioPane() {
  const { databases, collections, loadDatabases, loadCollections } = useExplorer();
  const { apiKey, setApiKey, aiMode, setAiMode } = useStudio();

  const [database, setDatabase] = useState("");
  const [collection, setCollection] = useState("");
  const [fields, setFields] = useState<string[]>([]);
  const [tab, setTab] = useState<StudioTab>("visualize");

  useEffect(() => {
    if (databases.length === 0) void loadDatabases();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (database && !collections[database]) void loadCollections(database);
  }, [database]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setFields([]);
    if (database && collection) {
      api
        .collectionFields(database, collection, 1000)
        .then(setFields)
        .catch(() => {});
    }
  }, [database, collection]);

  const colls = collections[database] ?? [];
  const ready = Boolean(database && collection);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-gradient-to-b from-primary/[0.04] to-transparent">
      {/* studio header */}
      <div className="no-select flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <span className="flex items-center gap-1.5 rounded-md bg-primary/10 px-2 py-1 text-xs font-semibold text-primary">
          <Bot className="h-3.5 w-3.5" />
          Ognom Studio
        </span>

        <div className="mx-1 h-5 w-px bg-border" />

        <Database className="h-3.5 w-3.5 text-muted-foreground" />
        <Select value={database} onValueChange={(v) => { setDatabase(v); setCollection(""); }}>
          <SelectTrigger className="h-7 w-[160px] text-xs">
            <SelectValue placeholder="Database" />
          </SelectTrigger>
          <SelectContent>
            {databases.map((db) => (
              <SelectItem key={db.name} value={db.name} className="text-xs">
                {db.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={collection} onValueChange={setCollection} disabled={!database}>
          <SelectTrigger className="h-7 w-[180px] text-xs">
            <SelectValue placeholder="Collection" />
          </SelectTrigger>
          <SelectContent>
            {colls.map((c) => (
              <SelectItem key={c.name} value={c.name} className="text-xs">
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="mx-1 h-5 w-px bg-border" />

        {/* tab switch */}
        <div className="flex items-center rounded-md border bg-muted/60 p-0.5">
          {(
            [
              { id: "visualize", label: "Visualize", icon: Wand2 },
              { id: "optimize", label: "Optimize", icon: Gauge },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
                tab === t.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <t.icon className="h-3.5 w-3.5" />
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* AI mode */}
        <div className="flex items-center rounded-md border bg-muted/60 p-0.5">
          {(Object.keys(AI_MODELS) as AiMode[]).map((m) => (
            <Tooltip key={m}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setAiMode(m)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-[5px] px-2.5 py-1 text-xs font-medium transition-colors",
                    aiMode === m
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m === "normal" ? (
                    <Zap className="h-3.5 w-3.5" />
                  ) : (
                    <BrainCircuit className="h-3.5 w-3.5" />
                  )}
                  {AI_MODELS[m].label}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {AI_MODELS[m].model}
                {AI_MODELS[m].reasoning ? " · reasoning" : " · fast"}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        <ApiKeyPopover apiKey={apiKey} setApiKey={setApiKey} />
      </div>

      {!ready ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="no-select flex flex-col items-center gap-3 text-center">
            <Bot className="h-10 w-10 text-primary/40" />
            <p className="text-sm font-medium">Welcome to Ognom Studio</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Pick a database and collection above, then describe what you want to see — Studio
              writes the query, runs it, and visualizes the result.
            </p>
          </div>
        </div>
      ) : tab === "visualize" ? (
        <VisualizeTab database={database} collection={collection} fields={fields} />
      ) : (
        <OptimizeTab database={database} collection={collection} fields={fields} />
      )}
    </div>
  );
}

function ApiKeyPopover({
  apiKey,
  setApiKey,
}: {
  apiKey: string;
  setApiKey: (k: string) => void;
}) {
  const [draft, setDraft] = useState(apiKey);
  return (
    <Popover onOpenChange={(o) => o && setDraft(apiKey)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant={apiKey ? "ghost" : "outline"}
              size="sm"
              className={cn("h-7 gap-1.5 text-xs", !apiKey && "border-warning/60 text-warning")}
            >
              <KeyRound className="h-3.5 w-3.5" />
              {apiKey ? "API key" : "Set API key"}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>OpenAI API key — required for Studio AI</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-96 space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">OpenAI API key</Label>
          <Input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="sk-…"
            className="h-8 font-mono text-xs"
            spellCheck={false}
          />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            Stored locally on this machine and sent only to api.openai.com from the Ognom backend.
            Normal mode uses {AI_MODELS.normal.model}; Deep Think uses {AI_MODELS.deep.model} with
            reasoning.
          </p>
        </div>
        <Button
          size="sm"
          className="w-full"
          onClick={() => {
            setApiKey(draft);
            toast.success(draft.trim() ? "API key saved" : "API key cleared");
          }}
        >
          <Check className="h-3.5 w-3.5" />
          Save key
        </Button>
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Visualize — prompt → data → chart
// ---------------------------------------------------------------------------

function VisualizeTab({
  database,
  collection,
  fields,
}: {
  database: string;
  collection: string;
  fields: string[];
}) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<VizPlan | null>(null);
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [execMs, setExecMs] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<"json" | "table">("table");
  const [chartType, setChartType] = useState<ChartType | null>(null);
  const [showQuery, setShowQuery] = useState(false);
  const [dialog, setDialog] = useState<DocDialogState>({ type: "closed" });
  const chartRef = useRef<CanvasChartHandle>(null);

  const runPrompt = async (p?: string) => {
    const text = (p ?? prompt).trim();
    if (!text) return;
    if (p) setPrompt(p);
    setBusy(true);
    setError(null);
    setShowQuery(false);
    try {
      const vizPlan = await generateVizPlan(text, database, collection, fields);
      setPlan(vizPlan);
      let page;
      if (vizPlan.kind === "aggregate" && vizPlan.stages?.length) {
        page = await api.aggregate(database, collection, vizPlan.stages, false);
      } else {
        page = await api.findDocuments({
          database,
          collection,
          filter: vizPlan.filter ?? "{}",
          sort: vizPlan.sort ?? "",
          projection: vizPlan.projection ?? "",
          limit: Math.min(vizPlan.limit ?? 100, 500),
          skip: 0,
        });
      }
      setDocs(page.docs);
      setExecMs(page.execMs);
      setChartType(vizPlan.chart?.type ?? null);
    } catch (e) {
      setError(errMsg(e));
      setDocs(null);
    } finally {
      setBusy(false);
    }
  };

  const chartData = useMemo(() => {
    if (!plan?.chart || !docs || !chartType) return null;
    return chartFromDocs(docs, plan.chart.labelField, plan.chart.valueField, chartType, plan.chart.title);
  }, [plan, docs, chartType]);

  const exportPng = async () => {
    const png = chartRef.current?.toPng();
    if (!png) return;
    const ok = await saveAs(`${collection}-chart`, "png", png.split(",")[1]);
    if (ok) toast.success("Chart exported");
  };
  const exportData = async (format: "json" | "csv") => {
    if (!docs) return;
    const content = format === "json" ? JSON.stringify(docs, null, 2) : docsToCsv(docs);
    const ok = await saveAs(`${collection}-results`, format, b64(content));
    if (ok) toast.success(`Results exported as ${format.toUpperCase()}`);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* prompt bar */}
      <div className="shrink-0 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Wand2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
            <Input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && void runPrompt()}
              placeholder={`Ask anything about ${collection} — "count orders by status as a pie chart"`}
              className="h-10 border-primary/30 pl-9 text-sm shadow-sm focus-visible:ring-primary/40"
              disabled={busy}
            />
          </div>
          <Button className="h-10 gap-2" disabled={busy || !prompt.trim()} onClick={() => void runPrompt()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
            Generate
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {SAMPLE_PROMPTS.map((p) => (
            <button
              key={p}
              disabled={busy}
              onClick={() => void runPrompt(p)}
              className="rounded-full border bg-card px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
          {error}
        </div>
      )}

      {plan && !error && (
        <div className="mx-4 mt-3 shrink-0 rounded-md border border-primary/25 bg-primary/5 text-xs">
          <div className="flex items-center gap-2 px-3 py-2">
            <Bot className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">{plan.explanation}</span>
            <Badge variant="secondary" className="h-4 shrink-0 px-1 font-mono text-[10px]">
              {plan.kind}
            </Badge>
            {execMs !== null && (
              <span className="shrink-0 tabular-nums text-muted-foreground">{execMs}ms</span>
            )}
            <button
              onClick={() => setShowQuery((v) => !v)}
              className="flex shrink-0 items-center gap-1 rounded-md border bg-card px-2 py-0.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              <Code2 className="h-3 w-3" />
              {showQuery ? "Hide query" : "View query"}
            </button>
          </div>
          {showQuery && (
            <div className="border-t border-primary/20 px-3 py-2.5">
              <div className="flex items-start gap-2">
                <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap rounded-md border bg-card p-2.5 font-mono text-[11px] leading-relaxed">
                  {planToShell(plan, collection)}
                </pre>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  onClick={async () => {
                    await navigator.clipboard.writeText(planToShell(plan, collection));
                    toast.success("Query copied");
                  }}
                >
                  <Copy className="h-3 w-3" />
                </Button>
              </div>
              <p className="mt-2 leading-relaxed text-muted-foreground">
                <span className="font-medium text-foreground">What it does: </span>
                {plan.explanation}
                {plan.chart && (
                  <>
                    {" "}
                    Charted with <code className="font-mono">{plan.chart.labelField}</code> as
                    labels and <code className="font-mono">{plan.chart.valueField}</code> as
                    values.
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {docs === null && !busy && !error ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="no-select flex flex-col items-center gap-2 text-center text-muted-foreground">
            <ArrowRight className="h-6 w-6 -rotate-90 opacity-40" />
            <p className="text-sm">Describe what you want to see, or try a suggestion</p>
          </div>
        </div>
      ) : busy && docs === null ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : docs ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 p-4 pt-3">
          {/* chart */}
          {chartData && (
            <div className="flex h-[42%] min-h-[220px] shrink-0 flex-col rounded-lg border bg-card shadow-sm">
              <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
                {CHART_TYPES.map((t) => (
                  <Tooltip key={t.id}>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setChartType(t.id)}
                        className={cn(
                          "rounded-md p-1.5 transition-colors",
                          chartType === t.id
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground"
                        )}
                      >
                        <t.icon className="h-3.5 w-3.5" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{t.label}</TooltipContent>
                  </Tooltip>
                ))}
                <div className="flex-1" />
                <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void exportPng()}>
                  <ImageDown className="h-3.5 w-3.5" />
                  PNG
                </Button>
              </div>
              <div className="min-h-0 flex-1 p-2">
                <CanvasChart ref={chartRef} data={chartData} />
              </div>
            </div>
          )}

          {/* results */}
          <div className="flex min-h-0 flex-1 flex-col rounded-lg border bg-card shadow-sm">
            <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
              <span className="text-xs text-muted-foreground">
                {docs.length} result{docs.length === 1 ? "" : "s"}
              </span>
              <div className="flex-1" />
              <ViewToggle view={view} onChange={setView} />
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void exportData("json")}>
                <Download className="h-3.5 w-3.5" />
                JSON
              </Button>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void exportData("csv")}>
                <Table2 className="h-3.5 w-3.5" />
                CSV
              </Button>
            </div>
            <ResultsViewer
              docs={docs}
              view={view}
              actions={{ onView: (doc) => setDialog({ type: "view", doc }) }}
              emptyText="The query ran but returned no documents"
            />
          </div>
        </div>
      ) : null}

      <DocumentDialogs
        database={database}
        collection={collection}
        state={dialog}
        onClose={() => setDialog({ type: "closed" })}
        onMutated={() => {}}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Optimize — run a query, then improve it with AI
// ---------------------------------------------------------------------------

function OptimizeTab({
  database,
  collection,
  fields,
}: {
  database: string;
  collection: string;
  fields: string[];
}) {
  const [query, setQuery] = useState(`db.${collection}.find({})`);
  const [outcome, setOutcome] = useState<ShellOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [view, setView] = useState<"json" | "table">("json");
  const [dialog, setDialog] = useState<DocDialogState>({ type: "closed" });

  // Follow collection switches, but never clobber user edits.
  const lastColl = useRef(collection);
  useEffect(() => {
    if (collection !== lastColl.current) {
      lastColl.current = collection;
      setQuery(`db.${collection}.find({})`);
      setOutcome(null);
      setError(null);
      setNotes(null);
      setSuggested(null);
    }
  }, [collection]);

  const run = async (text?: string) => {
    const q = text ?? query;
    setRunning(true);
    setError(null);
    try {
      setOutcome(await api.runShell(database, q));
    } catch (e) {
      setError(errMsg(e));
      setOutcome(null);
    } finally {
      setRunning(false);
    }
  };

  const ask = async (instruction: string) => {
    setThinking(true);
    setNotes(null);
    setSuggested(null);
    try {
      const result = await optimizeQuery({
        query,
        instruction,
        database,
        collection,
        fields,
        error,
      });
      setNotes(result.notes);
      setSuggested(result.query && result.query.trim() !== query.trim() ? result.query : null);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setThinking(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 gap-3 p-4">
      {/* left: query + AI */}
      <div className="flex w-[46%] min-w-[380px] flex-col gap-3">
        <div className="flex flex-col rounded-lg border bg-card shadow-sm">
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
            <span className="text-xs font-medium">Query</span>
            <div className="flex-1" />
            <Button size="sm" className="h-7 gap-1.5 text-xs" disabled={running} onClick={() => void run()}>
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Run
            </Button>
          </div>
          <CodeEditor value={query} onChange={setQuery} onRun={() => void run()} height="180px" />
        </div>

        {/* quick AI actions */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PROMPTS.map((p) => (
            <button
              key={p.id}
              disabled={thinking}
              onClick={() => void ask(p.instruction)}
              className="flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
            >
              <Bot className="h-3 w-3 text-primary" />
              {p.label}
            </button>
          ))}
        </div>

        {/* AI output */}
        <div className="flex min-h-0 flex-1 flex-col rounded-lg border bg-card shadow-sm">
          <div className="flex shrink-0 items-center gap-1.5 border-b px-3 py-1.5">
            <Bot className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-medium">AI assistant</span>
            {thinking && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {!notes && !thinking && (
              <p className="text-xs text-muted-foreground">
                Run your query, then pick an action above — fix errors, optimize, explain, or get
                index suggestions. The last error (if any) is sent along automatically.
              </p>
            )}
            {thinking && (
              <p className="text-xs text-muted-foreground">Analyzing your query…</p>
            )}
            {notes && (
              <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed">{notes}</pre>
            )}
            {suggested && (
              <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-2.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  Suggested query
                </p>
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                  {suggested}
                </pre>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    className="h-7 gap-1.5 text-xs"
                    onClick={() => {
                      setQuery(suggested);
                      void run(suggested);
                    }}
                  >
                    <Play className="h-3 w-3" />
                    Apply & run
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => setQuery(suggested)}
                  >
                    Apply only
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* right: results */}
      <div className="flex min-w-0 flex-1 flex-col rounded-lg border bg-card shadow-sm">
        <div className="flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
          <span className="text-xs text-muted-foreground">
            {outcome?.docs
              ? `${outcome.docs.length} result${outcome.docs.length === 1 ? "" : "s"}`
              : "Results"}
            {outcome && ` · ${outcome.execMs}ms`}
          </span>
          <div className="flex-1" />
          <ViewToggle view={view} onChange={setView} />
        </div>
        {error && (
          <div className="mx-3 mt-2 shrink-0 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
            {error}
          </div>
        )}
        {outcome?.docs ? (
          <ResultsViewer
            docs={outcome.docs}
            view={view}
            actions={{ onView: (doc) => setDialog({ type: "view", doc }) }}
            emptyText="No documents returned"
          />
        ) : outcome ? (
          <pre className="flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed">
            {outcome.message ?? JSON.stringify(outcome.value, null, 2)}
          </pre>
        ) : (
          <div className="flex flex-1 items-center justify-center text-muted-foreground">
            <p className="no-select text-sm">Run a query to see results here</p>
          </div>
        )}
      </div>

      <DocumentDialogs
        database={database}
        collection={collection}
        state={dialog}
        onClose={() => setDialog({ type: "closed" })}
        onMutated={() => void run()}
      />
    </div>
  );
}
