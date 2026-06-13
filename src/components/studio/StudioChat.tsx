import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlignLeft,
  BarChart3,
  ChartLine,
  ChartPie,
  Code2,
  Copy,
  Cpu,
  Donut,
  Download,
  Gauge,
  History,
  ImageDown,
  Layers,
  Lightbulb,
  Loader2,
  MessageSquarePlus,
  SendHorizonal,
  ShieldCheck,
  Sparkles,
  Table2,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ResultsViewer } from "@/components/explorer/ResultsViewer";
import { ViewToggle } from "@/components/explorer/DocumentsPane";
import { DocumentDialogs, type DocDialogState } from "@/components/explorer/DocumentDialogs";
import {
  CanvasChart,
  type CanvasChartHandle,
  type ChartData,
  type ChartType,
} from "@/components/studio/CanvasChart";
import { useExplorer } from "@/stores/explorer";
import { useStudio } from "@/stores/studio";
import { useChat, WHOLE_DB, type ChatSession, type ChatTurn } from "@/stores/chat";
import { api, errMsg, type Doc } from "@/lib/api";
import {
  addUsage,
  generateVizPlan,
  selectCollections,
  suggestPrompts,
  summarizeResults,
  ZERO_USAGE,
  type DbSchema,
  type TokenUsage,
  type VizHistoryItem,
  type VizPlan,
} from "@/lib/ai";
import { TokenBadge } from "@/components/TokenBadge";
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

/** Render a plan as a copy-pastable mongosh statement against `collection`. */
function planToShell(plan: VizPlan, collection: string): string {
  const coll = /^[A-Za-z_][\w]*$/.test(collection)
    ? `db.${collection}`
    : `db.getCollection("${collection}")`;
  if (plan.kind === "aggregate" && plan.stages?.length) {
    const stages = plan.stages.map((s) => `  { ${s.op}: ${s.body.trim()} }`).join(",\n");
    return `${coll}.aggregate([\n${stages}\n])`;
  }
  let out = `${coll}.find(${plan.filter?.trim() || "{}"}`;
  if (plan.projection?.trim()) out += `, ${plan.projection.trim()}`;
  out += ")";
  if (plan.sort?.trim()) out += `.sort(${plan.sort.trim()})`;
  out += `.limit(${Math.min(plan.limit ?? 100, 500)})`;
  return out;
}

function relTime(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

const CHART_TYPES: { id: ChartType; icon: typeof BarChart3; label: string }[] = [
  { id: "bar", icon: BarChart3, label: "Bar" },
  { id: "line", icon: ChartLine, label: "Line" },
  { id: "pie", icon: ChartPie, label: "Pie" },
  { id: "donut", icon: Donut, label: "Donut" },
];

const SAMPLE_SINGLE = [
  "Count documents grouped by status",
  "Top 10 most recent documents",
  "Average value per category as a bar chart",
  "Documents created per day over the last 30 days",
];
const SAMPLE_MULTI = [
  "Orders per customer, top 10",
  "Total revenue by product category",
  "Users with no orders yet",
  "Average order value per month",
];

/** Build conversation context from a session's prior turns. */
function buildHistory(turns: ChatTurn[]): VizHistoryItem[] {
  const out: VizHistoryItem[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.role !== "user" || !t.text) continue;
    const next = turns[i + 1];
    out.push({ prompt: t.text, query: next?.role === "assistant" ? next.query : undefined });
  }
  return out;
}

// ---------------------------------------------------------------------------
// StudioChat — conversational query/visualize surface
// ---------------------------------------------------------------------------

export function StudioChat({
  database,
  scope,
  fields,
  onOptimize,
  onOpenSession,
}: {
  database: string;
  /** a collection name, or WHOLE_DB */
  scope: string;
  /** sampled fields for single-collection scope */
  fields: string[];
  onOptimize: (query: string, collection: string) => void;
  /** Restore a past chat's database + scope, then activate it. */
  onOpenSession: (session: ChatSession) => void;
}) {
  const { collections, loadCollections } = useExplorer();
  const apiKey = useStudio((s) => s.apiKey);
  const { sessions, activeId, newSession, setActive, addTurn, patchTurn, deleteSession, clearAll } =
    useChat();

  const [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);
  const [samplingSchema, setSamplingSchema] = useState(false);
  const [newTopicHint, setNewTopicHint] = useState(false);
  const [dialog, setDialog] = useState<DocDialogState>({ type: "closed" });

  // Per-collection caches (key: `${db}/${coll}`), reused across turns.
  const fieldCache = useRef<Record<string, string[]>>({});
  const docCache = useRef<Record<string, unknown>>({});
  const transcriptEnd = useRef<HTMLDivElement>(null);

  const multi = scope === WHOLE_DB;
  const active = sessions.find((s) => s.id === activeId) ?? null;
  // Only show the active session if it matches the current scope.
  const current = active && active.database === database && active.scope === scope ? active : null;
  const turns = current?.turns ?? [];

  // New scope ⇒ blank canvas (history stays available in the rail).
  useEffect(() => {
    if (active && (active.database !== database || active.scope !== scope)) setActive(null);
    setSuggestions(null);
    setNewTopicHint(false);
  }, [database, scope]); // eslint-disable-line react-hooks/exhaustive-deps

  const startNewChat = () => {
    setActive(null);
    setNewTopicHint(false);
  };

  useEffect(() => {
    transcriptEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, busy]);

  const allCollectionNames = async (): Promise<string[]> => {
    const colls = collections[database] ?? (await loadCollections(database));
    return colls.filter((c) => c.kind !== "view").map((c) => c.name);
  };

  /** Sample fields for the given collections (cached), returning a schema map. */
  const sampleFieldsFor = async (names: string[]): Promise<DbSchema> => {
    const schema: DbSchema = {};
    await Promise.all(
      names.map(async (name) => {
        const key = `${database}/${name}`;
        if (!fieldCache.current[key]) {
          try {
            fieldCache.current[key] = (await api.collectionFields(database, name, 200)).slice(0, 50);
          } catch {
            fieldCache.current[key] = [];
          }
        }
        schema[name] = fieldCache.current[key];
      })
    );
    return schema;
  };

  /** One real sample document per collection (cached), for the planner. */
  const sampleDocFor = async (name: string): Promise<unknown> => {
    const key = `${database}/${name}`;
    if (!(key in docCache.current)) {
      try {
        const page = await api.findDocuments({
          database,
          collection: name,
          filter: "{}",
          sort: "",
          projection: "",
          limit: 1,
          skip: 0,
        });
        docCache.current[key] = page.docs[0] ?? null;
      } catch {
        docCache.current[key] = null;
      }
    }
    return docCache.current[key];
  };

  /**
   * Whole-database mode: analyze the DB (sample every collection's fields),
   * let the AI pick the relevant collections incl. bridges, then attach a real
   * sample document per chosen collection so it can trace multi-hop joins.
   */
  const resolveSchema = async (
    prompt: string
  ): Promise<{ schema: DbSchema; samples: Record<string, unknown>; usage: TokenUsage }> => {
    setSamplingSchema(true);
    try {
      const names = await allCollectionNames();
      const fullSchema = await sampleFieldsFor(names.slice(0, 80));
      const selected = await selectCollections({ prompt, database, schema: fullSchema });
      let picked = selected.collections;
      if (picked.length === 0) picked = names.slice(0, 6);

      const schema: DbSchema = {};
      const samples: Record<string, unknown> = {};
      await Promise.all(
        picked.map(async (n) => {
          schema[n] = fullSchema[n] ?? (await sampleFieldsFor([n]))[n];
          const doc = await sampleDocFor(n);
          if (doc) samples[n] = doc;
        })
      );
      return { schema, samples, usage: selected.usage };
    } finally {
      setSamplingSchema(false);
    }
  };

  const loadSuggestions = async () => {
    if (!apiKey) {
      toast.error("Add your OpenAI API key to use AI suggestions");
      return;
    }
    setSuggesting(true);
    try {
      let schema: DbSchema | undefined;
      if (multi) {
        setSamplingSchema(true);
        try {
          const names = await allCollectionNames();
          schema = await sampleFieldsFor(names.slice(0, 15));
        } finally {
          setSamplingSchema(false);
        }
      }
      const res = await suggestPrompts({
        database,
        collection: multi ? undefined : scope,
        fields: multi ? undefined : fields,
        schema,
      });
      setSuggestions(res.prompts);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSuggesting(false);
    }
  };

  const send = async (raw: string) => {
    const prompt = raw.trim();
    if (!prompt || busy) return;
    if (!apiKey) {
      toast.error("Add your OpenAI API key in Settings → Prompts & AI to use Studio");
      return;
    }

    // Continue the active session if its scope matches; else start a new one.
    const existing =
      active && active.database === database && active.scope === scope ? active : null;
    const history = existing ? buildHistory(existing.turns) : [];
    const sid = existing ? existing.id : newSession(database, scope, prompt);

    addTurn(sid, { role: "user", text: prompt });
    const aid = addTurn(sid, { role: "assistant", pending: true });
    setSuggestions(null);
    setNewTopicHint(false);
    setBusy(true);

    try {
      const resolved = multi ? await resolveSchema(prompt) : null;
      const { plan, usage: planUsage } = await generateVizPlan({
        prompt,
        database,
        collection: multi ? undefined : scope,
        fields: multi ? undefined : fields,
        schema: resolved?.schema,
        samples: resolved?.samples,
        history,
      });
      const usage = addUsage(resolved?.usage ?? ZERO_USAGE, planUsage);

      // Read-only guard: a write/delete request never runs — show a friendly card.
      if (plan.writeIntent) {
        patchTurn(sid, aid, { pending: false, blocked: true, plan, usage });
        return;
      }

      const runColl = multi ? plan.collection ?? scope : scope;

      let page;
      if (plan.kind === "aggregate" && plan.stages?.length) {
        page = await api.aggregate(database, runColl, plan.stages, multi);
      } else {
        page = await api.findDocuments({
          database,
          collection: runColl,
          filter: plan.filter ?? "{}",
          sort: plan.sort ?? "",
          projection: plan.projection ?? "",
          limit: Math.min(plan.limit ?? 100, 500),
          skip: 0,
        });
      }
      patchTurn(sid, aid, {
        pending: false,
        plan,
        query: planToShell(plan, runColl),
        runCollection: runColl,
        docs: page.docs,
        docCount: page.docs.length,
        execMs: page.execMs,
        chartType: plan.chart?.type ?? null,
        usage,
      });
      // If this was a fresh topic on top of an existing thread, nudge the user
      // to start a new chat — continuing re-sends the whole conversation.
      if (history.length > 0 && plan.unrelatedToConversation) setNewTopicHint(true);
    } catch (e) {
      patchTurn(sid, aid, { pending: false, error: errMsg(e) });
    } finally {
      setBusy(false);
    }
  };

  const samples = multi ? SAMPLE_MULTI : SAMPLE_SINGLE;
  const scopeLabel = multi ? "Whole database" : scope;
  const sessionUsage = turns.reduce(
    (acc, t) => (t.usage ? addUsage(acc, t.usage) : acc),
    ZERO_USAGE
  );

  return (
    <div className="flex min-h-0 flex-1">
      {/* history rail */}
      {historyOpen && (
        <HistoryRail
          sessions={sessions}
          activeId={current?.id ?? null}
          onPick={onOpenSession}
          onNew={startNewChat}
          onDelete={deleteSession}
          onClear={clearAll}
          onClose={() => setHistoryOpen(false)}
        />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* chat toolbar */}
        <div className="no-select flex h-9 shrink-0 items-center gap-2 border-b px-3">
          <Button
            variant={historyOpen ? "secondary" : "ghost"}
            size="sm"
            className="h-7 gap-1.5 text-xs"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            <History className="h-3.5 w-3.5" />
            History
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={busy}
            onClick={startNewChat}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            New chat
          </Button>
          <div className="mx-1 h-4 w-px bg-border" />
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-0.5 font-mono text-xs",
              multi ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            )}
          >
            {multi ? <Layers className="h-3 w-3" /> : <Cpu className="h-3 w-3" />}
            {scopeLabel}
          </span>
          {samplingSchema && (
            <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> sampling collections…
            </span>
          )}
          <div className="flex-1" />
          {sessionUsage.total > 0 && (
            <TokenBadge usage={sessionUsage} label="tokens this chat" className="text-xs" />
          )}
        </div>

        {/* transcript */}
        <ScrollArea className="min-h-0 flex-1">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-5">
            {turns.length === 0 && !busy ? (
              <EmptyState multi={multi} scopeLabel={scopeLabel} />
            ) : (
              turns.map((t) =>
                t.role === "user" ? (
                  <UserBubble key={t.id} text={t.text ?? ""} />
                ) : (
                  <AssistantTurn
                    key={t.id}
                    sessionId={current!.id}
                    turn={t}
                    database={database}
                    onOptimize={onOptimize}
                    onView={(doc) => setDialog({ type: "view", doc })}
                  />
                )
              )
            )}
            <div ref={transcriptEnd} />
          </div>
        </ScrollArea>

        {/* new-topic nudge */}
        {newTopicHint && (
          <div className="mx-auto mb-0 flex w-full max-w-3xl items-center gap-2 px-4">
            <div className="flex w-full items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs">
              <Lightbulb className="h-3.5 w-3.5 shrink-0 text-warning" />
              <span className="min-w-0 flex-1 text-foreground">
                This looks like a new topic. Starting a fresh chat avoids re-sending this
                conversation — fewer input tokens, lower cost.
              </span>
              <Button size="sm" className="h-7 shrink-0 gap-1.5 text-xs" onClick={startNewChat}>
                <MessageSquarePlus className="h-3.5 w-3.5" />
                New chat
              </Button>
              <button
                onClick={() => setNewTopicHint(false)}
                className="shrink-0 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        <Composer
          busy={busy}
          multi={multi}
          database={database}
          scope={scope}
          suggestions={suggestions ?? samples}
          suggesting={suggesting}
          onSuggest={() => void loadSuggestions()}
          onSend={(t) => void send(t)}
        />
      </div>

      <DocumentDialogs
        database={database}
        collection={current?.scope === WHOLE_DB ? "" : current?.scope ?? ""}
        state={dialog}
        onClose={() => setDialog({ type: "closed" })}
        onMutated={() => {}}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// history rail
// ---------------------------------------------------------------------------

/** Reusable list of past chats. Picking returns the full session so the caller
 *  can restore its database + scope, not just the active id. */
export function RecentChats({
  sessions,
  activeId,
  onPick,
  onDelete,
  className,
}: {
  sessions: ChatSession[];
  activeId?: string | null;
  onPick: (session: ChatSession) => void;
  onDelete?: (id: string) => void;
  className?: string;
}) {
  const ordered = [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
  const totalFor = (s: ChatSession): TokenUsage =>
    s.turns.reduce((acc, t) => (t.usage ? addUsage(acc, t.usage) : acc), ZERO_USAGE);
  if (ordered.length === 0) {
    return (
      <p className={cn("px-2 py-6 text-center text-xs text-muted-foreground", className)}>
        No chats yet
      </p>
    );
  }
  return (
    <div className={cn("flex flex-col gap-0.5", className)}>
      {ordered.map((s) => (
        <div
          key={s.id}
          onClick={() => onPick(s)}
          className={cn(
            "group flex cursor-pointer flex-col rounded-md border px-2 py-1.5 transition-colors",
            s.id === activeId ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-accent"
          )}
        >
          <div className="flex items-center gap-1">
            <span className="min-w-0 flex-1 truncate text-xs font-medium">{s.title}</span>
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(s.id);
                }}
                className="shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 transition-all hover:text-destructive group-hover:opacity-100"
                aria-label="Delete chat"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            )}
          </div>
          <span className="truncate font-mono text-[10px] text-muted-foreground">
            {s.scope === WHOLE_DB ? `${s.database} · whole db` : `${s.database}.${s.scope}`} ·{" "}
            {relTime(s.updatedAt)}
          </span>
          {totalFor(s).total > 0 && (
            <TokenBadge usage={totalFor(s)} className="mt-0.5 text-[10px]" />
          )}
        </div>
      ))}
    </div>
  );
}

function HistoryRail({
  sessions,
  activeId,
  onPick,
  onNew,
  onDelete,
  onClear,
  onClose,
}: {
  sessions: ChatSession[];
  activeId: string | null;
  onPick: (session: ChatSession) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r bg-card/50">
      <div className="no-select flex h-9 shrink-0 items-center gap-2 border-b px-3">
        <History className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">History</span>
        <div className="flex-1" />
        <button
          onClick={onClose}
          className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Hide history"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="p-2">
        <Button variant="outline" size="sm" className="w-full gap-1.5 text-xs" onClick={onNew}>
          <MessageSquarePlus className="h-3.5 w-3.5" />
          New chat
        </Button>
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <RecentChats
          sessions={sessions}
          activeId={activeId}
          onPick={onPick}
          onDelete={onDelete}
          className="px-2 pb-2"
        />
      </ScrollArea>
      {sessions.length > 0 && (
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full gap-1.5 text-xs text-muted-foreground hover:text-destructive"
            onClick={onClear}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Clear all history
          </Button>
        </div>
      )}
    </aside>
  );
}

// ---------------------------------------------------------------------------
// turns
// ---------------------------------------------------------------------------

/**
 * Isolated composer: holds its own draft state so keystrokes re-render only
 * this box, never the (potentially huge) transcript above it.
 */
function Composer({
  busy,
  multi,
  database,
  scope,
  suggestions,
  suggesting,
  onSuggest,
  onSend,
}: {
  busy: boolean;
  multi: boolean;
  database: string;
  scope: string;
  suggestions: string[];
  suggesting: boolean;
  onSuggest: () => void;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const submit = () => {
    const t = text.trim();
    if (!t || busy) return;
    setText("");
    onSend(t);
  };
  return (
    <div className="shrink-0 border-t bg-card/40 px-4 py-3">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            disabled={busy || suggesting}
            onClick={onSuggest}
            className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/10 disabled:opacity-50"
          >
            {suggesting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Lightbulb className="h-3 w-3" />
            )}
            Suggest questions
          </button>
          {suggestions.map((p) => (
            <button
              key={p}
              disabled={busy}
              onClick={() => onSend(p)}
              className="rounded-full border bg-card px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
            >
              {p}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            rows={1}
            placeholder={
              multi
                ? `Ask across ${database} — "orders per customer as a bar chart"`
                : `Ask anything about ${scope} — "count orders by status as a pie chart"`
            }
            className="max-h-32 min-h-[40px] flex-1 resize-none rounded-md border border-primary/30 bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            disabled={busy}
          />
          <Button className="h-10 gap-2" disabled={busy || !text.trim()} onClick={submit}>
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <SendHorizonal className="h-4 w-4" />
            )}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground shadow-sm">
        {text}
      </div>
    </div>
  );
}

function EmptyState({ multi, scopeLabel }: { multi: boolean; scopeLabel: string }) {
  return (
    <div className="no-select flex flex-col items-center gap-3 py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10">
        {multi ? (
          <Layers className="h-6 w-6 text-primary" />
        ) : (
          <Sparkles className="h-6 w-6 text-primary" />
        )}
      </div>
      <div>
        <p className="text-sm font-medium">
          {multi ? "Ask across your whole database" : `Ask anything about ${scopeLabel}`}
        </p>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          {multi
            ? "Studio samples every collection so it can join them — “orders per customer”, “revenue by category”. Read-only, always."
            : "Describe what you want to see. Studio writes the query, runs it, and charts the result."}
        </p>
      </div>
    </div>
  );
}

function AssistantTurn({
  sessionId,
  turn,
  database,
  onOptimize,
  onView,
}: {
  sessionId: string;
  turn: ChatTurn;
  database: string;
  onOptimize: (query: string, collection: string) => void;
  onView: (doc: Doc) => void;
}) {
  const patchTurn = useChat((s) => s.patchTurn);
  const [showQuery, setShowQuery] = useState(false);
  const [view, setView] = useState<"json" | "table">("table");
  const [summarizing, setSummarizing] = useState(false);
  const chartRef = useRef<CanvasChartHandle>(null);

  const plan = turn.plan;
  const docs = turn.docs ?? null;
  const coll = turn.runCollection ?? "";

  const chartData = useMemo(() => {
    if (!plan?.chart || !docs || !turn.chartType) return null;
    return chartFromDocs(docs, plan.chart.labelField, plan.chart.valueField, turn.chartType, plan.chart.title);
  }, [plan, docs, turn.chartType]);

  if (turn.pending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Thinking…
      </div>
    );
  }

  if (turn.error) {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
        {turn.error}
      </div>
    );
  }

  if (turn.blocked) {
    return (
      <div className="overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/[0.07] to-transparent">
        <div className="flex items-start gap-3 p-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
            <ShieldCheck className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold">This is a look-but-don't-touch space</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
              Ognom Studio explores and visualizes your data — it never changes it, so inserts,
              updates, and deletes are off the table here. Ask me to find, count, compare, or chart
              instead.
            </p>
            <p className="mt-2 text-xs text-muted-foreground/80">
              Need to write? Switch to <span className="font-medium text-foreground">Normal</span>{" "}
              mode and use the <span className="font-medium text-foreground">Shell</span>.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const summarize = async () => {
    if (!docs || docs.length === 0) return;
    setSummarizing(true);
    try {
      const { summary, usage } = await summarizeResults(turn.query ?? "", docs);
      patchTurn(sessionId, turn.id, {
        summary,
        usage: addUsage(turn.usage ?? ZERO_USAGE, usage),
      });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSummarizing(false);
    }
  };

  const exportPng = async () => {
    const png = chartRef.current?.toPng();
    if (!png) return;
    const ok = await saveAs(`${coll || "chart"}-chart`, "png", png.split(",")[1]);
    if (ok) toast.success("Chart exported");
  };
  const exportData = async (format: "json" | "csv") => {
    if (!docs) return;
    const content = format === "json" ? JSON.stringify(docs, null, 2) : docsToCsv(docs);
    const ok = await saveAs(`${coll || "results"}-results`, format, b64(content));
    if (ok) toast.success(`Results exported as ${format.toUpperCase()}`);
  };

  return (
    <div className="flex flex-col gap-2.5">
      {/* explanation + query */}
      <div className="rounded-lg border border-primary/25 bg-primary/5 text-xs">
        <div className="flex items-center gap-2 px-3 py-2">
          <Cpu className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">{plan?.explanation}</span>
          {plan && (
            <Badge variant="secondary" className="h-4 shrink-0 px-1 font-mono text-[10px]">
              {plan.kind}
            </Badge>
          )}
          {turn.execMs !== undefined && (
            <span className="shrink-0 tabular-nums text-muted-foreground">{turn.execMs}ms</span>
          )}
          {turn.usage && <TokenBadge usage={turn.usage} className="shrink-0 text-[11px]" />}
          <button
            onClick={() => setShowQuery((v) => !v)}
            className="flex shrink-0 items-center gap-1 rounded-md border bg-card px-2 py-0.5 font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <Code2 className="h-3 w-3" />
            {showQuery ? "Hide query" : "View query"}
          </button>
        </div>
        {showQuery && turn.query && (
          <div className="border-t border-primary/20 px-3 py-2.5">
            <div className="flex items-start gap-2">
              <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre-wrap rounded-md border bg-card p-2.5 font-mono text-[11px] leading-relaxed">
                {turn.query}
              </pre>
              <div className="flex shrink-0 flex-col gap-1.5">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={async () => {
                        await navigator.clipboard.writeText(turn.query!);
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
                      onClick={() => onOptimize(turn.query!, coll)}
                    >
                      <Gauge className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Optimize in Shell</TooltipContent>
                </Tooltip>
              </div>
            </div>
            <p className="mt-2 leading-relaxed text-muted-foreground">
              Runs on <code className="font-mono">{database}.{coll}</code>.
              {plan?.chart && (
                <>
                  {" "}
                  Charted with <code className="font-mono">{plan.chart.labelField}</code> as labels
                  and <code className="font-mono">{plan.chart.valueField}</code> as values.
                </>
              )}
            </p>
          </div>
        )}
      </div>

      {/* chart */}
      {chartData && (
        <div className="flex h-72 flex-col rounded-lg border bg-card shadow-sm">
          <div className="flex shrink-0 items-center gap-1 border-b px-3 py-1.5">
            {CHART_TYPES.map((ct) => (
              <Tooltip key={ct.id}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => patchTurn(sessionId, turn.id, { chartType: ct.id })}
                    className={cn(
                      "rounded-md p-1.5 transition-colors",
                      turn.chartType === ct.id
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:bg-accent hover:text-foreground"
                    )}
                  >
                    <ct.icon className="h-3.5 w-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{ct.label}</TooltipContent>
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
      {docs && (
        <div className="flex max-h-[28rem] flex-col rounded-lg border bg-card shadow-sm">
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
          {turn.summary && (
            <div className="flex shrink-0 items-start gap-2 border-b bg-primary/5 px-3 py-2">
              <AlignLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <p className="text-xs leading-relaxed">{turn.summary}</p>
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col">
            <ResultsViewer
              docs={docs}
              view={view}
              actions={{ onView }}
              emptyText="The query ran but returned no documents"
            />
          </div>
        </div>
      )}
    </div>
  );
}
