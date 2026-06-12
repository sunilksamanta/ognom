import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, RefreshCw, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, errMsg, type SchemaReport } from "@/lib/api";
import { formatCount } from "@/lib/bson";
import { cn } from "@/lib/utils";
import type { Tab } from "@/stores/explorer";

interface SchemaSheetProps {
  tab: Tab;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const TYPE_COLOR: Record<string, string> = {
  string: "text-bson-string",
  int: "text-bson-number",
  long: "text-bson-number",
  double: "text-bson-number",
  decimal: "text-bson-number",
  bool: "text-bson-boolean",
  null: "text-bson-null",
  objectId: "text-bson-oid",
  date: "text-bson-date",
  object: "text-muted-foreground",
  array: "text-muted-foreground",
};

export function SchemaSheet({ tab, open, onOpenChange }: SchemaSheetProps) {
  const [report, setReport] = useState<SchemaReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [sampleSize, setSampleSize] = useState(1000);
  const [filter, setFilter] = useState("");

  const load = async (size = sampleSize) => {
    setLoading(true);
    try {
      setReport(await api.analyzeSchema(tab.database, tab.collection, size));
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setReport(null);
      setFilter("");
      void load();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const f = filter.trim().toLowerCase();
  const fields = (report?.fields ?? []).filter((x) => !f || x.path.toLowerCase().includes(f));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[720px]">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle>Schema analysis</DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {tab.database}.{tab.collection}
            {report && (
              <span className="ml-2 text-muted-foreground">
                · sampled {formatCount(report.sampled)} docs · {report.fields.length} fields
              </span>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center gap-2 border-b px-5 py-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter fields…"
              className="h-8 pl-7 text-xs"
            />
          </div>
          <Select
            value={String(sampleSize)}
            onValueChange={(v) => {
              setSampleSize(Number(v));
              void load(Number(v));
            }}
          >
            <SelectTrigger className="h-8 w-[130px] text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[100, 500, 1000, 5000, 10000].map((n) => (
                <SelectItem key={n} value={String(n)} className="text-xs">
                  sample {formatCount(n)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && !report ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : fields.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {report ? "No matching fields" : "No data"}
            </p>
          ) : (
            <div className="flex flex-col gap-1">
              {fields.map((field) => {
                const pct = Math.round(field.coverage * 100);
                const depth = field.path.split(".").length - 1;
                return (
                  <div
                    key={field.path}
                    className="grid grid-cols-[1fr_auto] items-center gap-3 rounded-md border bg-card px-3 py-2"
                  >
                    <div className="min-w-0" style={{ paddingLeft: depth * 14 }}>
                      <div className="flex items-center gap-2">
                        <span className="truncate font-mono text-xs font-medium">{field.path}</span>
                        <span className="flex flex-wrap gap-1">
                          {field.types.map((t) => (
                            <span
                              key={t.type}
                              className={cn(
                                "rounded bg-muted px-1 text-[10px] font-medium",
                                TYPE_COLOR[t.type] ?? "text-muted-foreground"
                              )}
                            >
                              {t.type}
                              {field.types.length > 1 && ` ${Math.round((t.count / field.present) * 100)}%`}
                            </span>
                          ))}
                        </span>
                      </div>
                      {field.examples.length > 0 && (
                        <p className="mt-0.5 truncate font-mono text-[10.5px] text-muted-foreground">
                          e.g. {field.examples.map((x) => JSON.stringify(x)).join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
                        <div
                          className={cn(
                            "h-full rounded-full",
                            pct === 100 ? "bg-primary" : "bg-primary/60"
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="w-9 text-right text-[11px] tabular-nums text-muted-foreground">
                        {pct}%
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
