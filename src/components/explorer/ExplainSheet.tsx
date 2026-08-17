import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
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
  const [creating, setCreating] = useState(false);
  const [createdIndex, setCreatedIndex] = useState<string | null>(null);

  const createSuggested = async () => {
    if (!request || !summary?.suggestedIndex) return;
    setCreating(true);
    try {
      const name = await api.createIndex({
        database: request.database,
        collection: request.collection,
        keysText: JSON.stringify(summary.suggestedIndex),
        unique: false,
      });
      setCreatedIndex(name);
      toast.success(`Index "${name}" created - re-run the query to use it`);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setCreating(false);
    }
  };

  useEffect(() => {
    if (!open || !request) return;
    setSummary(null);
    setError(null);
    setShowRaw(false);
    setCreatedIndex(null);
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
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle>Explain plan</DialogTitle>
          <DialogDescription>
            {request?.database}.{request?.collection}
            {request?.pipelineStages ? " · aggregate" : " · find"}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="spin h-5 w-5 text-text-3" />
            </div>
          ) : error ? (
            <div className="notice dgr mono">
              <span className="break-all">{error}</span>
            </div>
          ) : summary ? (
            <>
              <div className={cn("warnbox", inefficient ? "soft" : "ok")}>
                {inefficient ? <AlertTriangle /> : <CheckCircle2 />}
                <div>
                  {summary.isCollectionScan ? (
                    <b>Collection scan - no index used. Every document is read.</b>
                  ) : (
                    <>
                      <b>Index used:</b> <span className="mono">{summary.indexName ?? "-"}</span>
                    </>
                  )}
                  {ratio !== null && (
                    <div className="mt-1 text-text-3">
                      Examined {ratio.toFixed(1)}x the documents returned
                      {inefficient && !summary.isCollectionScan ? " - consider a more selective index." : "."}
                    </div>
                  )}
                </div>
              </div>

              <div className="statgrid">
                {(
                  [
                    ["Returned", summary.nReturned],
                    ["Docs examined", summary.totalDocsExamined],
                    ["Keys examined", summary.totalKeysExamined],
                    ["Time", summary.executionTimeMillis === null ? null : `${summary.executionTimeMillis} ms`],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <div className="l">{label}</div>
                    <div className="v">
                      {value === null || value === undefined ? "-" : typeof value === "number" ? formatCount(value) : value}
                    </div>
                  </div>
                ))}
              </div>

              {summary.isCollectionScan && summary.suggestedIndex && (
                <div className="idxrow acc">
                  <span className="pill acc">suggested</span>
                  <div className="min-w-0 flex-1">
                    <div className="n">{JSON.stringify(summary.suggestedIndex)}</div>
                    <div className="mt-1 text-[10.5px] text-text-3">
                      Equality, sort, range field order - derived from this query's shape.
                    </div>
                  </div>
                  <div className="r">
                    {createdIndex ? (
                      <span className="pill ok">
                        <CheckCircle2 /> created
                      </span>
                    ) : (
                      <Button size="sm" disabled={creating} onClick={() => void createSuggested()}>
                        {creating && <Loader2 className="spin" />}
                        Create index
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {summary.stages.length > 0 && (
                <div className="fld">
                  <label>Plan stages</label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {summary.stages.map((st, i) => (
                      <span key={i} className="flex items-center gap-1.5">
                        {i > 0 && <span className="text-text-3">‹</span>}
                        <span className={cn("pill", st === "COLLSCAN" && "warn")}>{st}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <button
                onClick={() => setShowRaw((v) => !v)}
                className="self-start text-[11.5px] text-text-3 underline-offset-2 hover:text-text hover:underline"
              >
                {showRaw ? "Hide" : "Show"} raw plan
              </button>
              {showRaw && (
                <pre className="mono max-h-72 overflow-auto rounded-[var(--r-sm)] border border-line bg-panel-2 p-3 text-[11px] leading-relaxed">
                  {JSON.stringify(summary.raw, null, 2)}
                </pre>
              )}
            </>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
