import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api, errMsg, type ExplainSummary, type StageInput } from "@/lib/api";
import { formatCount } from "@/lib/bson";
import { cn } from "@/lib/utils";

export interface ExplainRequest {
  database: string;
  collection: string;
  filter: string;
  sort: string;
  projection: string;
  pipelineStages?: StageInput[];
}

interface ExplainSheetProps {
  request: ExplainRequest | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ExplainSheet({ request, open, onOpenChange }: ExplainSheetProps) {
  const [summary, setSummary] = useState<ExplainSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!open || !request) return;
    setSummary(null);
    setError(null);
    setShowRaw(false);
    setLoading(true);
    api
      .explainQuery({ verbosity: "executionStats", ...request })
      .then(setSummary)
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const ratio =
    summary && summary.nReturned && summary.totalDocsExamined
      ? summary.totalDocsExamined / Math.max(1, summary.nReturned)
      : null;
  // A scan that reads far more docs than it returns is the classic red flag.
  const inefficient = summary?.isCollectionScan || (ratio !== null && ratio > 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[640px]">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Explain plan</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {request?.database}.{request?.collection}
            {request?.pipelineStages ? " · aggregate" : " · find"}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
              {error}
            </p>
          ) : summary ? (
            <>
              <div
                className={cn(
                  "flex items-start gap-2.5 rounded-lg border px-3.5 py-3",
                  inefficient
                    ? "border-warning/40 bg-warning/10"
                    : "border-primary/40 bg-primary/10"
                )}
              >
                {inefficient ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                )}
                <div className="text-sm">
                  {summary.isCollectionScan ? (
                    <p className="font-medium">
                      Collection scan — no index used. Every document is read.
                    </p>
                  ) : (
                    <p className="font-medium">
                      Index used:{" "}
                      <code className="font-mono text-xs">{summary.indexName ?? "—"}</code>
                    </p>
                  )}
                  {ratio !== null && (
                    <p className="text-muted-foreground">
                      Examined {ratio.toFixed(1)}× the documents returned
                      {inefficient && !summary.isCollectionScan
                        ? " — consider a more selective index."
                        : "."}
                    </p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    ["Returned", summary.nReturned],
                    ["Docs examined", summary.totalDocsExamined],
                    ["Keys examined", summary.totalKeysExamined],
                    ["Time", summary.executionTimeMillis === null ? null : `${summary.executionTimeMillis} ms`],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-md border bg-muted/40 px-2.5 py-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {label}
                    </p>
                    <p className="text-sm font-semibold tabular-nums">
                      {value === null || value === undefined
                        ? "—"
                        : typeof value === "number"
                          ? formatCount(value)
                          : value}
                    </p>
                  </div>
                ))}
              </div>

              {summary.stages.length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">Plan stages</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {summary.stages.map((s, i) => (
                      <span key={i} className="flex items-center gap-1.5">
                        {i > 0 && <span className="text-muted-foreground">←</span>}
                        <code
                          className={cn(
                            "rounded border bg-card px-1.5 py-0.5 font-mono text-[11px]",
                            s === "COLLSCAN" && "border-warning/50 text-warning"
                          )}
                        >
                          {s}
                        </code>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => setShowRaw((v) => !v)}
                className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              >
                {showRaw ? "Hide" : "Show"} raw plan
              </button>
              {showRaw && (
                <pre className="max-h-72 overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
                  {JSON.stringify(summary.raw, null, 2)}
                </pre>
              )}
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
