import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlignLeft,
  ArrowRight,
  BarChart3,
  BrainCircuit,
  ChartLine,
  ChartPie,
  Check,
  Code2,
  Copy,
  Cpu,
  Database,
  Donut,
  Download,
  Gauge,
  ImageDown,
  KeyRound,
  Lightbulb,
  Loader2,
  SendHorizonal,
  Table2,
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
import { ResultsViewer } from "@/components/explorer/ResultsViewer";
import { ViewToggle } from "@/components/explorer/DocumentsPane";
import { DocumentDialogs, type DocDialogState } from "@/components/explorer/DocumentDialogs";
import { CanvasChart, type CanvasChartHandle, type ChartData, type ChartType } from "@/components/studio/CanvasChart";
import { useExplorer } from "@/stores/explorer";
import { useSettings } from "@/stores/settings";
import { useStudio, AI_MODE_META, DEFAULT_MODELS, type AiMode } from "@/stores/studio";
import { api, errMsg, type Doc } from "@/lib/api";
import {
  generateVizPlan,
  suggestPrompts,
  summarizeResults,
  type VizPlan,
} from "@/lib/ai";
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

export function StudioPane() {
  const { databases, collections, loadDatabases, loadCollections, openShellWithQuery } =
    useExplorer();
  const { apiKey, setApiKey, aiMode, setAiMode, modelNormal, modelDeep, setTerminator } =
    useStudio();
  const setAdvancedMode = useSettings((s) => s.setAdvancedMode);

  const [database, setDatabase] = useState("");
  const [collection, setCollection] = useState("");
  const [fields, setFields] = useState<string[]>([]);

  // Hand a generated query over to the developer Shell (normal mode) to
  // optimize it there. Studio (Terminator) stays purely no-code/visualize.
  const optimizeInShell = (query: string) => {
    setAdvancedMode(true);
    openShellWithQuery(database, collection, query);
    setTerminator(false);
  };

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
          <Cpu className="h-3.5 w-3.5" />
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

        <div className="flex-1" />

        {/* AI mode */}
        <div className="flex items-center rounded-md border bg-muted/60 p-0.5">
          {(Object.keys(AI_MODE_META) as AiMode[]).map((m) => (
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
                  {AI_MODE_META[m].label}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                {m === "normal" ? modelNormal : modelDeep} · {AI_MODE_META[m].hint}
              </TooltipContent>
            </Tooltip>
          ))}
        </div>

        <ApiKeyPopover apiKey={apiKey} setApiKey={setApiKey} />
      </div>

      {!ready ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="no-select flex flex-col items-center gap-3 text-center">
            <Cpu className="h-10 w-10 text-primary/40" />
            <p className="text-sm font-medium">Welcome to Ognom Studio</p>
            <p className="max-w-sm text-xs text-muted-foreground">
              Pick a database and collection above, then describe what you want to see — Studio
              writes the query, runs it, and visualizes the result.
            </p>
          </div>
        </div>
      ) : (
        <VisualizeTab
          database={database}
          collection={collection}
          fields={fields}
          onOptimize={optimizeInShell}
        />
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
            Models default to {DEFAULT_MODELS.normal} (Normal) and {DEFAULT_MODELS.deep} (Deep
            Think) — change them in Settings → Prompts &amp; AI.
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
  onOptimize,
}: {
  database: string;
  collection: string;
  fields: string[];
  onOptimize: (query: string) => void;
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
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [dialog, setDialog] = useState<DocDialogState>({ type: "closed" });
  const chartRef = useRef<CanvasChartHandle>(null);

  // Suggestions are per-collection; clear when the target changes.
  useEffect(() => {
    setSuggestions(null);
    setSummary(null);
  }, [database, collection]);

  const loadSuggestions = async () => {
    setSuggesting(true);
    try {
      setSuggestions(await suggestPrompts(database, collection, fields));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSuggesting(false);
    }
  };

  const summarize = async () => {
    if (!docs || docs.length === 0) return;
    setSummarizing(true);
    try {
      setSummary(await summarizeResults(prompt, docs));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSummarizing(false);
    }
  };

  const runPrompt = async (p?: string) => {
    const text = (p ?? prompt).trim();
    if (!text) return;
    if (p) setPrompt(p);
    setBusy(true);
    setError(null);
    setShowQuery(false);
    setSummary(null);
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
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && void runPrompt()}
            placeholder={`Ask anything about ${collection} — "count orders by status as a pie chart"`}
            className="h-10 flex-1 border-primary/30 text-sm shadow-sm focus-visible:ring-primary/40"
            disabled={busy}
          />
          <Button className="h-10 gap-2" disabled={busy || !prompt.trim()} onClick={() => void runPrompt()}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
            Generate
          </Button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <button
            disabled={busy || suggesting}
            onClick={() => void loadSuggestions()}
            className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
          >
            {suggesting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Lightbulb className="h-3 w-3" />
            )}
            Suggest questions
          </button>
          {(suggestions ?? SAMPLE_PROMPTS).map((p) => (
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
            <Cpu className="h-3.5 w-3.5 shrink-0 text-primary" />
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
                <div className="flex shrink-0 flex-col gap-1.5">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={async () => {
                          await navigator.clipboard.writeText(planToShell(plan, collection));
                          toast.success("Query copied");
                        }}
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Copy query</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => onOptimize(planToShell(plan, collection))}
                      >
                        <Gauge className="h-3 w-3" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Optimize in Shell</TooltipContent>
                  </Tooltip>
                </div>
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
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                disabled={summarizing || docs.length === 0}
                onClick={() => void summarize()}
              >
                {summarizing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <AlignLeft className="h-3.5 w-3.5" />
                )}
                Summarize
              </Button>
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
            {summary && (
              <div className="flex shrink-0 items-start gap-2 border-b bg-primary/5 px-3 py-2">
                <AlignLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <p className="text-xs leading-relaxed">{summary}</p>
              </div>
            )}
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
