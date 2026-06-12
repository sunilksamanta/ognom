import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  History,
  Info,
  Loader2,
  Play,
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
import type { Doc } from "@/lib/api";

export function ShellPane({ tab }: { tab: Tab }) {
  const { patchShell, runShell } = useExplorer();
  const { shellHistory, clearShellHistory } = useSettings();
  const [dialog, setDialog] = useState<DocDialogState>({ type: "closed" });
  const s = tab.shell;
  const outcome = s.outcome;

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

      {/* editor */}
      <div className="shrink-0 p-3 pb-2">
        <CodeEditor
          value={s.text}
          onChange={(text) => patchShell(tab.id, { text })}
          onRun={() => void runShell(tab.id)}
          height={150}
          autoFocus
          placeholder={`db.${tab.collection}.find({ status: "active" }).sort({ createdAt: -1 }).limit(20)`}
        />
      </div>

      {/* outcome */}
      {s.error && (
        <div className="mx-3 mb-2 flex shrink-0 items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="break-all font-mono">{s.error}</span>
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
