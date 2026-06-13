import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Database,
  History,
  Info,
  Loader2,
  Play,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CodeEditor } from "@/components/CodeEditor";
import { ResultsViewer } from "@/components/explorer/ResultsViewer";
import { ViewToggle } from "@/components/explorer/DocumentsPane";
import { ValueTree } from "@/components/explorer/ValueTree";
import { DocumentDialogs, type DocDialogState } from "@/components/explorer/DocumentDialogs";
import { useExplorer, type Tab } from "@/stores/explorer";
import { useSettings } from "@/stores/settings";
import { useStudio } from "@/stores/studio";
import { api, errMsg, type Doc } from "@/lib/api";
import { optimizeQuery, QUICK_PROMPTS, type TokenUsage } from "@/lib/ai";
import { TokenBadge } from "@/components/TokenBadge";

const FIX_INSTRUCTION =
  QUICK_PROMPTS.find((p) => p.id === "fix")?.instruction ??
  "Fix any syntax or semantic errors in this query so it runs correctly.";

export function ShellPane({ tab }: { tab: Tab }) {
  const { patchShell, runShell } = useExplorer();
  const { shellHistory, clearShellHistory, shellEditorHeight, setShellEditorHeight } =
    useSettings();
  const apiKey = useStudio((s) => s.apiKey);
  const [dialog, setDialog] = useState<DocDialogState>({ type: "closed" });

  // Drag the handle under the editor to resize it (height persists in settings).
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = shellEditorHeight;
    const onMove = (ev: PointerEvent) => setShellEditorHeight(startH + (ev.clientY - startY));
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.userSelect = "";
    };
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ── AI optimizer state (developer-facing; lives here, not in Studio) ──
  const [fields, setFields] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [notes, setNotes] = useState<string | null>(null);
  const [suggested, setSuggested] = useState<string | null>(null);
  const [usage, setUsage] = useState<TokenUsage | null>(null);

  const s = tab.shell;
  const outcome = s.outcome;

  // Schema fields sharpen the AI's index/optimization suggestions.
  useEffect(() => {
    setFields([]);
    api
      .collectionFields(tab.database, tab.collection, 1000)
      .then(setFields)
      .catch(() => {});
  }, [tab.database, tab.collection]);

  const ask = async (instruction: string) => {
    if (!s.text.trim()) return;
    if (!apiKey) {
      toast.error("Add your OpenAI API key in Settings → Prompts & AI to use AI assist");
      return;
    }
    setThinking(true);
    setNotes(null);
    setSuggested(null);
    setUsage(null);
    try {
      const result = await optimizeQuery({
        query: s.text,
        instruction,
        database: tab.database,
        collection: tab.collection,
        fields,
        error: s.error,
      });
      setNotes(result.notes);
      setUsage(result.usage);
      setSuggested(
        result.query && result.query.trim() !== s.text.trim() ? result.query : null
      );
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setThinking(false);
    }
  };

  const apply = (run: boolean) => {
    if (!suggested) return;
    patchShell(tab.id, { text: suggested });
    setSuggested(null);
    setNotes(null);
    if (run) void runShell(tab.id);
  };

  const dismissAi = () => {
    setNotes(null);
    setSuggested(null);
    setUsage(null);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* toolbar */}
      <div className="no-select flex shrink-0 items-center gap-2 border-b px-3 py-1.5">
        <span className="flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
          <Database className="h-3 w-3 text-primary" />
          {tab.database}
        </span>
        <span className="text-xs text-muted-foreground/70">
          one statement at a time · <code className="font-mono">db.collection.method()</code>,{" "}
          <code className="font-mono">show dbs</code>, <code className="font-mono">use other</code>
        </span>
        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs text-muted-foreground">
              <History className="h-3.5 w-3.5" />
              History
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-96 overflow-y-auto">
            <DropdownMenuLabel className="text-xs">Recent statements</DropdownMenuLabel>
            {shellHistory.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                Nothing run yet
              </p>
            )}
            {shellHistory.map((h, i) => (
              <DropdownMenuItem
                key={i}
                className="font-mono text-xs"
                onClick={() => patchShell(tab.id, { text: h })}
              >
                <span className="block max-w-full truncate">{h.replace(/\s+/g, " ")}</span>
              </DropdownMenuItem>
            ))}
            {shellHistory.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-xs text-muted-foreground"
                  onClick={clearShellHistory}
                >
                  Clear history
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Button size="sm" className="h-7 gap-1.5" disabled={s.loading} onClick={() => void runShell(tab.id)}>
          {s.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Run
          <kbd className="rounded border border-primary-foreground/30 px-1 font-mono text-[10px] opacity-70">
            ⌘↵
          </kbd>
        </Button>
      </div>

      {/* editor (drag the handle below to resize) */}
      <div className="shrink-0 px-3 pt-3">
        <CodeEditor
          value={s.text}
          onChange={(text) => patchShell(tab.id, { text })}
          onRun={() => void runShell(tab.id)}
          height={shellEditorHeight}
          autoFocus
          placeholder={`db.${tab.collection}.find({ status: "active" }).sort({ createdAt: -1 }).limit(20)`}
        />
        <div
          onPointerDown={startResize}
          className="group flex h-3 cursor-ns-resize items-center justify-center"
          title="Drag to resize the editor"
        >
          <div className="h-1 w-10 rounded-full bg-border transition-colors group-hover:bg-primary/50" />
        </div>
      </div>

      {/* outcome */}
      {s.error && (
        <div className="mx-3 mb-2 flex shrink-0 items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 break-all font-mono">{s.error}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-6 shrink-0 gap-1 border-destructive/40 text-xs text-destructive hover:text-destructive"
            disabled={thinking}
            onClick={() => void ask(FIX_INSTRUCTION)}
          >
            {thinking ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            Fix with AI
          </Button>
        </div>
      )}

      {/* quick AI actions — fix / optimize / explain / indexes on the spot */}
      <div className="no-select flex shrink-0 flex-wrap items-center gap-1.5 px-3 pb-2">
        <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <Cpu className="h-3 w-3 text-primary" />
          AI assist
        </span>
        {QUICK_PROMPTS.map((p) => (
          <button
            key={p.id}
            disabled={thinking || !s.text.trim()}
            onClick={() => void ask(p.instruction)}
            className="rounded-full border bg-card px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* AI output */}
      {(thinking || notes) && (
        <div className="mx-3 mb-2 flex max-h-[45%] shrink-0 flex-col overflow-hidden rounded-md border border-primary/25 bg-primary/5 text-xs">
          <div className="flex shrink-0 items-center gap-1.5 border-b border-primary/20 px-3 py-1.5">
            <Cpu className="h-3.5 w-3.5 text-primary" />
            <span className="font-medium">AI assistant</span>
            {thinking && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
            <div className="flex-1" />
            {usage && <TokenBadge usage={usage} className="mr-1 text-[11px]" />}
            {!thinking && (
              <button
                onClick={dismissAi}
                className="rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {thinking && <p className="text-muted-foreground">Analyzing your query…</p>}
            {notes && (
              <pre className="whitespace-pre-wrap font-sans leading-relaxed">{notes}</pre>
            )}
            {suggested && (
              <div className="mt-3 rounded-md border border-primary/30 bg-card p-2.5">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                  Suggested query
                </p>
                <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed">
                  {suggested}
                </pre>
                <div className="mt-2 flex gap-2">
                  <Button size="sm" className="h-7 gap-1.5 text-xs" onClick={() => apply(true)}>
                    <Play className="h-3 w-3" />
                    Apply &amp; run
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => apply(false)}
                  >
                    Apply only
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {outcome?.appliedDefaultLimit && !s.error && (
        <div className="mx-3 mb-2 flex shrink-0 items-center gap-2 rounded-md border border-info/30 bg-info/10 px-3 py-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 shrink-0 text-info" />
          Results were capped — chain <code className="font-mono">.limit(n)</code> to control how
          many come back.
        </div>
      )}

      {outcome?.kind === "docs" && outcome.docs && (
        <>
          <div className="no-select flex shrink-0 items-center gap-2 border-t px-3 py-1.5">
            <span className="text-xs text-muted-foreground">
              {outcome.docs.length} document{outcome.docs.length === 1 ? "" : "s"} ·{" "}
              {outcome.execMs}ms
            </span>
            <div className="flex-1" />
            <ViewToggle view={s.view} onChange={(view) => patchShell(tab.id, { view })} />
          </div>
          <ResultsViewer
            docs={outcome.docs}
            view={s.view}
            actions={{ onView: (doc: Doc) => setDialog({ type: "view", doc }) }}
            emptyText="No documents returned"
          />
        </>
      )}

      {outcome?.kind === "value" && (
        <div className="min-h-0 flex-1 overflow-y-auto border-t">
          <div className="m-3 rounded-lg border bg-card px-3 py-2">
            <ValueTree value={outcome.value} />
          </div>
        </div>
      )}

      {(outcome?.kind === "message" || outcome?.kind === "useDb") && (
        <div className="mx-3 flex shrink-0 items-center gap-2 rounded-md border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span className="font-mono">{outcome.message}</span>
        </div>
      )}

      {!outcome && !s.error && !s.loading && (
        <div className="no-select flex flex-1 items-center justify-center text-center text-muted-foreground">
          <div>
            <p className="text-sm font-medium text-foreground">Real shell syntax</p>
            <p className="mx-auto mt-1 max-w-[340px] text-xs">
              find / aggregate / update / indexes — with ObjectId(…), ISODate(…), unquoted keys,
              comments, and method chaining. Cap writes with care: this runs exactly what you
              type.
            </p>
          </div>
        </div>
      )}

      <DocumentDialogs
        database={tab.database}
        collection={tab.collection}
        state={dialog}
        onClose={() => setDialog({ type: "closed" })}
        onMutated={() => void runShell(tab.id)}
      />
    </div>
  );
}
