import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { save } from "@tauri-apps/plugin-dialog";
import { ArrowDown, ArrowUp, Download, Loader2, RefreshCw, Search } from "lucide-react";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { api, errMsg, type CollectionOverview, type DbOverview } from "@/lib/api";
import { formatBytes, formatCount } from "@/lib/bson";
import { cn } from "@/lib/utils";

/**
 * Database overview: one row per collection with documents, sizes and index
 * footprint, plus the references inferred from sampled ObjectId fields.
 * Flags the things worth acting on (big collections with only the _id index,
 * empty collections, indexes larger than the data) and exports as CSV / JSON.
 */

interface DbOverviewDialogProps {
  open: boolean;
  database: string;
  onOpenChange: (open: boolean) => void;
  onOpenCollection: (name: string) => void;
}

type SortKey = "name" | "count" | "avgObjSize" | "size" | "storageSize" | "nindexes" | "totalIndexSize";
type Focus = "all" | "unindexed" | "empty" | "heavyIndexes";

/** Big enough that a collection scan hurts. */
const UNINDEXED_MIN_DOCS = 1000;

const isUnindexed = (c: CollectionOverview) =>
  c.kind === "collection" && (c.nindexes ?? 0) <= 1 && (c.count ?? 0) >= UNINDEXED_MIN_DOCS;
const isEmpty = (c: CollectionOverview) => c.kind !== "view" && c.count === 0;
const hasHeavyIndexes = (c: CollectionOverview) =>
  (c.size ?? 0) > 0 && (c.totalIndexSize ?? 0) > (c.size ?? 0);

const COLUMNS: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "name", label: "Collection" },
  { key: "count", label: "Documents", numeric: true },
  { key: "avgObjSize", label: "Avg doc", numeric: true },
  { key: "size", label: "Data", numeric: true },
  { key: "storageSize", label: "Storage", numeric: true },
  { key: "nindexes", label: "Indexes", numeric: true },
  { key: "totalIndexSize", label: "Index size", numeric: true },
];

function toCsv(rows: CollectionOverview[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ["collection", "kind", "documents", "avgDocBytes", "dataBytes", "storageBytes", "indexes", "indexBytes", "capped", "validated", "references"];
  const lines = rows.map((c) =>
    [
      c.name,
      c.kind,
      c.count,
      c.avgObjSize,
      c.size,
      c.storageSize,
      c.nindexes,
      c.totalIndexSize,
      c.capped,
      c.validated,
      c.refs.map((r) => `${r.field}->${r.to}`).join("; "),
    ]
      .map(esc)
      .join(",")
  );
  return [head.join(","), ...lines].join("\n") + "\n";
}

export function DbOverviewDialog({ open, database, onOpenChange, onOpenCollection }: DbOverviewDialogProps) {
  const [data, setData] = useState<DbOverview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [focus, setFocus] = useState<Focus>("all");
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "storageSize", desc: true });

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .dbOverview(database)
      .then(setData)
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!open || !database) return;
    setData(null);
    setFilter("");
    setFocus("all");
    load();
  }, [open, database]); // eslint-disable-line react-hooks/exhaustive-deps

  const colls = data?.collections ?? [];
  const totals = useMemo(() => {
    const sum = (k: keyof CollectionOverview) => colls.reduce((a, c) => a + (Number(c[k]) || 0), 0);
    return {
      count: sum("count"),
      size: sum("size"),
      storage: sum("storageSize"),
      index: sum("totalIndexSize"),
      refs: colls.reduce((a, c) => a + c.refs.length, 0),
    };
  }, [colls]);

  const insights = useMemo(
    () => ({
      unindexed: colls.filter(isUnindexed).length,
      empty: colls.filter(isEmpty).length,
      heavyIndexes: colls.filter(hasHeavyIndexes).length,
    }),
    [colls]
  );

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    const pass = (c: CollectionOverview) =>
      (!f || c.name.toLowerCase().includes(f)) &&
      (focus === "all" ||
        (focus === "unindexed" && isUnindexed(c)) ||
        (focus === "empty" && isEmpty(c)) ||
        (focus === "heavyIndexes" && hasHeavyIndexes(c)));
    const out = colls.filter(pass);
    out.sort((a, b) => {
      const dir = sort.desc ? -1 : 1;
      if (sort.key === "name") return dir * a.name.localeCompare(b.name);
      return dir * ((a[sort.key] ?? -1) - (b[sort.key] ?? -1));
    });
    return out;
  }, [colls, filter, focus, sort]);

  const exportAs = async (format: "csv" | "json") => {
    if (!data) return;
    const path = await save({
      title: `Export overview of ${database}`,
      defaultPath: `${database}-overview.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    }).catch(() => null);
    if (!path) return;
    const content =
      format === "csv"
        ? toCsv(rows)
        : JSON.stringify({ database, exportedAt: new Date().toISOString(), collections: rows }, null, 2);
    try {
      await api.saveTextFile(path, content);
      toast.success(`Exported ${rows.length} collection${rows.length === 1 ? "" : "s"}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== "name" }));

  const chip = (id: Focus, n: number, label: string, tone: "warn" | "dgr" | "") =>
    n > 0 && (
      <button
        type="button"
        className={cn("pill", tone, focus === id && "ring-1 ring-current")}
        onClick={() => setFocus((f) => (f === id ? "all" : id))}
        title={focus === id ? "Show all collections" : "Show only these"}
      >
        {n} {label}
      </button>
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[980px]">
        <DialogHeader>
          <DialogTitle>Database overview</DialogTitle>
          <DialogDescription>
            {database} · storage, indexes and references per collection · click a row to open it
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {error ? (
            <div className="notice dgr mono">{error}</div>
          ) : !data ? (
            <div className="flex h-[360px] items-center justify-center gap-2 text-[12.5px] text-text-3">
              <Loader2 className="spin h-4 w-4 text-text-3" />
              Reading collection stats...
            </div>
          ) : (
            <>
              <div className="statgrid five">
                {[
                  ["Collections", formatCount(colls.length)],
                  ["Documents", formatCount(totals.count)],
                  ["Data", formatBytes(totals.size)],
                  ["Storage", formatBytes(totals.storage)],
                  ["Indexes", formatBytes(totals.index)],
                ].map(([l, v]) => (
                  <div key={l}>
                    <div className="l">{l}</div>
                    <div className="v mono truncate tabular-nums">{v}</div>
                  </div>
                ))}
              </div>

              <div className="hstack flex-wrap">
                <div className="in sans" style={{ maxWidth: 240, gap: 8 }}>
                  <Search className="h-3.5 w-3.5 shrink-0 text-text-3" />
                  <input
                    className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-text-3"
                    placeholder="Filter collections"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
                {chip("unindexed", insights.unindexed, `with only the _id index (${formatCount(UNINDEXED_MIN_DOCS)}+ docs)`, "warn")}
                {chip("heavyIndexes", insights.heavyIndexes, "with indexes larger than data", "warn")}
                {chip("empty", insights.empty, "empty", "")}
                <div className="ml-auto flex shrink-0 gap-2">
                  <button className="btn qt" onClick={load} disabled={loading}>
                    {loading ? <Loader2 className="spin" /> : <RefreshCw />}
                    Refresh
                  </button>
                  <DropdownMenu modal={false}>
                    <DropdownMenuTrigger asChild>
                      <button className="btn qt" disabled={rows.length === 0}>
                        <Download />
                        Export
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => void exportAs("csv")}>CSV (spreadsheet)</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void exportAs("json")}>JSON</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="max-h-[48vh] overflow-auto rounded-[var(--r-sm)] border border-line">
                <table className="tbl">
                  <thead>
                    <tr>
                      {COLUMNS.map((c) => (
                        <th
                          key={c.key}
                          onClick={() => toggleSort(c.key)}
                          className={cn("cursor-pointer select-none hover:text-text", c.numeric && "text-right")}
                        >
                          <span className="inline-flex items-center gap-1">
                            {c.label}
                            {sort.key === c.key &&
                              (sort.desc ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
                          </span>
                        </th>
                      ))}
                      <th>References</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((c) => (
                      <tr key={c.name} className="cursor-pointer" onClick={() => onOpenCollection(c.name)}>
                        <td className="text-text">
                          <span className="inline-flex items-center gap-1.5">
                            {c.name}
                            {c.kind !== "collection" && <span className="pill">{c.kind === "timeseries" ? "ts" : c.kind}</span>}
                            {c.capped && <span className="pill">capped</span>}
                            {c.validated && <span className="pill ok">validated</span>}
                            {isUnindexed(c) && <span className="pill warn">_id only</span>}
                          </span>
                        </td>
                        <td className="text-right tabular-nums">{c.count == null ? "-" : formatCount(c.count)}</td>
                        <td className="text-right tabular-nums">{c.avgObjSize == null ? "-" : formatBytes(c.avgObjSize)}</td>
                        <td className="text-right tabular-nums">{c.size == null ? "-" : formatBytes(c.size)}</td>
                        <td className="text-right tabular-nums">{c.storageSize == null ? "-" : formatBytes(c.storageSize)}</td>
                        <td className="text-right tabular-nums">{c.nindexes ?? "-"}</td>
                        <td className={cn("text-right tabular-nums", hasHeavyIndexes(c) && "text-warn")}>
                          {c.totalIndexSize == null ? "-" : formatBytes(c.totalIndexSize)}
                        </td>
                        <td>
                          <span className="inline-flex flex-wrap gap-1">
                            {c.refs.map((r) => (
                              <button
                                key={r.field}
                                type="button"
                                className="pill hover:text-text"
                                title={`${c.name}.${r.field} looks like a reference to ${r.to} - open ${r.to}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onOpenCollection(r.to);
                                }}
                              >
                                {r.field} → {r.to}
                              </button>
                            ))}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={COLUMNS.length + 1} className="py-8 text-center text-text-3">
                          {colls.length === 0 ? "No collections in this database." : "No matches."}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="font-mono text-[11px] text-text-3">
                {formatCount(totals.refs)} inferred reference{totals.refs === 1 ? "" : "s"} (ObjectId fields named after
                another collection, from a 25-document sample)
                {data.refsSkipped > 0 && ` · references not sampled for the last ${data.refsSkipped} collections`}
              </div>
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
