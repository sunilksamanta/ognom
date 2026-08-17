import { useEffect, useMemo } from "react";
import { AlertCircle, CheckCircle2, Database, History, Info, Loader2, Play } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CodeEditor } from "@/components/CodeEditor";
import { ResultsViewer, docSelectionKey } from "@/components/explorer/ResultsViewer";
import { ViewToggle } from "@/components/explorer/ViewToggle";
import { ValueTree } from "@/components/explorer/ValueTree";
import { useExplorer, type Tab } from "@/stores/explorer";
import { useSettings } from "@/stores/settings";
import { api, type Doc } from "@/lib/api";
import { setShellCompletions } from "@/lib/monaco";

export function ShellPane({ tab }: { tab: Tab }) {
  const patchShell = useExplorer((s) => s.patchShell);
  const runShell = useExplorer((s) => s.runShell);
  const { shellHistory, clearShellHistory, shellEditorHeight, setShellEditorHeight } =
    useSettings();
  const setDrawer = useExplorer((s) => s.setDrawer);

  // Stable across keystrokes so the memoized ResultsViewer doesn't rebuild
  // the whole result set every time the query text changes.
  const docActions = useMemo(
    () => ({ onView: (doc: Doc) => setDrawer(tab.id, { kind: "doc", doc, source: "shell" }) }),
    [setDrawer, tab.id]
  );
  const activeKey =
    tab.drawer.kind === "doc" && tab.drawer.source === "shell" ? docSelectionKey(tab.drawer.doc) : null;

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

  const s = tab.shell;
  const outcome = s.outcome;

  // Sampled field paths feed the Monaco completion provider (keys inside
  // filter bodies).
  useEffect(() => {
    api
      .collectionFields(tab.database, tab.collection, 1000)
      .then((f) => setShellCompletions({ fields: f }))
      .catch(() => {});
  }, [tab.database, tab.collection]);

  // Collection names for `db.<tab>` completions in the shell editor.
  useEffect(() => {
    api
      .listCollections(tab.database)
      .then((cs) => setShellCompletions({ collections: cs.map((c) => c.name) }))
      .catch(() => {});
  }, [tab.database]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* toolbar */}
      <div className="no-select flex shrink-0 items-center gap-2 border-b border-line px-[var(--pad)] py-1.5">
        <span className="pill acc">
          <Database />
          {tab.database}
        </span>
        <span className="font-mono text-[11px] text-text-3">
          one statement at a time · db.collection.method(), show dbs, use other
        </span>
        <div className="flex-1" />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="btn qt sm">
              <History />
              History
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 w-96 overflow-y-auto">
            <DropdownMenuLabel className="text-xs">Recent statements</DropdownMenuLabel>
            {shellHistory.length === 0 && (
              <p className="px-2 py-3 text-center text-xs text-text-3">
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
                  className="text-xs text-text-3"
                  onClick={clearShellHistory}
                >
                  Clear history
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <button className="btn pri sm" disabled={s.loading} onClick={() => void runShell(tab.id)}>
          {s.loading ? <Loader2 className="spin" /> : <Play />}
          Run <span className="kbd">⌘⏎</span>
        </button>
      </div>

      {/* editor (drag the handle below to resize) */}
      <div className="shrink-0 px-[var(--pad)] pt-3">
        <CodeEditor
          value={s.text}
          onChange={(text) => patchShell(tab.id, { text })}
          onRun={() => void runShell(tab.id)}
          height={shellEditorHeight}
          autoFocus
          placeholder={`db.${tab.collection}.find({ status: "active" }).sort({ createdAt: -1 }).limit(20)`}
          path={`shell/${tab.id}`}
        />
        <div
          onPointerDown={startResize}
          className="group flex h-3 cursor-ns-resize items-center justify-center"
          title="Drag to resize the editor"
        >
          <div className="h-1 w-10 rounded-full bg-line-2 transition-colors group-hover:bg-accent-line" />
        </div>
      </div>

      {/* outcome */}
      {s.error && (
        <div className="notice dgr mono mx-[var(--pad)] mb-2 shrink-0">
          <AlertCircle />
          <span className="min-w-0 flex-1 break-all">{s.error}</span>
        </div>
      )}

      {outcome?.appliedDefaultLimit && !s.error && (
        <div className="notice mx-[var(--pad)] mb-2 shrink-0">
          <Info />
          <span>Results were capped - chain .limit(n) to control how many come back.</span>
        </div>
      )}

      {outcome?.kind === "docs" && outcome.docs && (
        <>
          <div className="no-select flex shrink-0 items-center gap-2 border-t border-line px-[var(--pad)] py-1.5">
            <span className="font-mono text-[11px] text-text-3">
              {outcome.docs.length} document{outcome.docs.length === 1 ? "" : "s"} ·{" "}
              {outcome.execMs}ms
            </span>
            <div className="flex-1" />
            <ViewToggle view={s.view} onChange={(view) => patchShell(tab.id, { view })} />
          </div>
          <ResultsViewer
            docs={outcome.docs}
            view={s.view}
            actions={docActions}
            emptyText="No documents returned"
            activeKey={activeKey}
          />
        </>
      )}

      {outcome?.kind === "value" && (
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-line">
          <div className="m-3 rounded-[var(--r)] border border-line bg-panel px-3 py-2">
            <ValueTree value={outcome.value} />
          </div>
        </div>
      )}

      {(outcome?.kind === "message" || outcome?.kind === "useDb") && (
        <div className="notice acc mono mx-[var(--pad)] shrink-0">
          <CheckCircle2 />
          <span>{outcome.message}</span>
        </div>
      )}

      {!outcome && !s.error && !s.loading && (
        <div className="no-select flex flex-1 items-center justify-center text-center">
          <div>
            <p className="text-[13px] font-medium text-text-2">Real shell syntax</p>
            <p className="mx-auto mt-1 max-w-[340px] text-[12px] text-text-3">
              find / aggregate / update / indexes - with ObjectId(), ISODate(), unquoted keys,
              comments and method chaining. This runs exactly what you type.
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
