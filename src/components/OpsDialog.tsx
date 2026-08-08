import { useEffect, useState } from "react";
import { Activity, Loader2, OctagonX, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useExplorer } from "@/stores/explorer";
import { api, errMsg, type Doc } from "@/lib/api";

interface OpsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const asNum = (v: unknown): number | null => (typeof v === "number" ? v : null);
const get = (d: Doc | undefined | null, key: string): unknown =>
  d && typeof d === "object" ? (d as Record<string, unknown>)[key] : undefined;

// ---------------------------------------------------------------------------
// Operations tab — currentOp with kill
// ---------------------------------------------------------------------------

function OperationsTab({ active }: { active: boolean }) {
  const [ops, setOps] = useState<Doc[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [killing, setKilling] = useState<unknown | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      setOps(await api.currentOps());
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (active) void load();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-[380px] flex-col">
      <div className="flex items-center justify-between pb-2">
        <p className="text-xs text-muted-foreground">
          {ops === null ? "…" : `${ops.length} active operation${ops.length === 1 ? "" : "s"}`}
        </p>
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void load()}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </Button>
      </div>
      <ScrollArea className="flex-1 rounded-md border">
        {ops === null || ops.length === 0 ? (
          <p className="flex h-full items-center justify-center py-16 text-xs text-muted-foreground">
            {ops === null ? "Loading…" : "No active operations right now."}
          </p>
        ) : (
          <div className="divide-y">
            {ops.map((op, i) => {
              const opid = get(op, "opid");
              const secs = asNum(get(op, "secs_running"));
              return (
                <div key={i} className="flex items-start gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-medium">{String(get(op, "op") ?? "?")}</span>
                      <span className="truncate font-mono text-muted-foreground">
                        {String(get(op, "ns") ?? "")}
                      </span>
                      {secs !== null && (
                        <span
                          className={
                            secs >= 5
                              ? "rounded bg-warning/15 px-1.5 py-px text-[10px] font-medium text-warning"
                              : "text-[10px] text-muted-foreground"
                          }
                        >
                          {secs}s
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {JSON.stringify(get(op, "command") ?? {}).slice(0, 160)}
                    </p>
                  </div>
                  {opid !== undefined && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                      onClick={() => setKilling(opid)}
                    >
                      <OctagonX className="h-3 w-3" />
                      Kill
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      <ConfirmDialog
        open={killing !== null}
        onOpenChange={(o) => !o && setKilling(null)}
        title="Kill this operation?"
        description="The operation is interrupted server-side. The client that issued it will see an error."
        confirmLabel="Kill operation"
        destructive
        onConfirm={async () => {
          try {
            await api.killOp(killing);
            toast.success("Kill signal sent");
            setKilling(null);
            await load();
          } catch (e) {
            toast.error(errMsg(e));
          }
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Profiler tab
// ---------------------------------------------------------------------------

function ProfilerTab({ active }: { active: boolean }) {
  const databases = useExplorer((s) => s.databases);
  const [db, setDb] = useState("");
  const [level, setLevel] = useState<number | null>(null);
  const [slowMs, setSlowMs] = useState<number | null>(null);
  const [entries, setEntries] = useState<Doc[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (active && !db && databases.length > 0) setDb(databases[0].name);
  }, [active, databases, db]);

  const load = async (database: string) => {
    if (!database) return;
    setLoading(true);
    try {
      const [status, rows] = await Promise.all([
        api.profilerStatus(database),
        api.profilerEntries(database, 50).catch(() => []),
      ]);
      setLevel(asNum(get(status, "was")));
      setSlowMs(asNum(get(status, "slowms")));
      setEntries(rows);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (active && db) void load(db);
  }, [active, db]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeLevel = async (next: number) => {
    try {
      await api.setProfiler(db, next, slowMs ?? undefined);
      toast.success(
        next === 0 ? "Profiler off" : next === 1 ? `Profiling ops slower than ${slowMs ?? 100}ms` : "Profiling all operations"
      );
      await load(db);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  return (
    <div className="flex h-[380px] flex-col gap-2">
      <div className="flex items-center gap-2">
        <Select value={db} onValueChange={setDb}>
          <SelectTrigger className="h-7 w-44 font-mono text-xs">
            <SelectValue placeholder="Database" />
          </SelectTrigger>
          <SelectContent>
            {databases.map((d) => (
              <SelectItem key={d.name} value={d.name} className="font-mono text-xs">
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center rounded-md border bg-muted/60 p-0.5">
          {[
            { v: 0, label: "Off" },
            { v: 1, label: `Slow ops${slowMs != null ? ` (>${slowMs}ms)` : ""}` },
            { v: 2, label: "All ops" },
          ].map((o) => (
            <button
              key={o.v}
              onClick={() => void changeLevel(o.v)}
              className={
                level === o.v
                  ? "rounded-[5px] bg-background px-2 py-0.5 text-[11px] font-medium shadow-sm"
                  : "rounded-[5px] px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              }
            >
              {o.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void load(db)}>
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          Refresh
        </Button>
      </div>

      <ScrollArea className="flex-1 rounded-md border">
        {!entries || entries.length === 0 ? (
          <p className="flex h-full items-center justify-center px-6 py-16 text-center text-xs text-muted-foreground">
            {entries === null
              ? "Loading…"
              : "No profiler entries. Turn the profiler on (Slow ops) and run some queries — they'll show up here."}
          </p>
        ) : (
          <div className="divide-y">
            {entries.map((e, i) => {
              const millis = asNum(get(e, "millis"));
              return (
                <div key={i} className="px-3 py-2">
                  <p className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-mono font-medium">{String(get(e, "op") ?? "?")}</span>
                    <span className="truncate font-mono text-muted-foreground">
                      {String(get(e, "ns") ?? "")}
                    </span>
                    {millis !== null && (
                      <span
                        className={
                          millis >= 100
                            ? "rounded bg-warning/15 px-1.5 py-px text-[10px] font-medium text-warning"
                            : "text-[10px] text-muted-foreground"
                        }
                      >
                        {millis}ms
                      </span>
                    )}
                    {String(get(e, "planSummary") ?? "").includes("COLLSCAN") && (
                      <span className="rounded bg-destructive/15 px-1.5 py-px text-[10px] font-medium text-destructive">
                        COLLSCAN
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                    {JSON.stringify(get(e, "command") ?? get(e, "query") ?? {}).slice(0, 160)}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live stats tab — 2s polling while visible
// ---------------------------------------------------------------------------

function LiveTab({ active }: { active: boolean }) {
  const [status, setStatus] = useState<Doc | null>(null);
  const [prev, setPrev] = useState<Doc | null>(null);

  useEffect(() => {
    if (!active) return;
    let stale = false;
    const tick = async () => {
      try {
        const s = await api.serverStatusLight();
        if (stale) return;
        setStatus((cur) => {
          setPrev(cur);
          return s;
        });
      } catch {
        // server unreachable — keep last numbers
      }
    };
    void tick();
    const t = setInterval(() => void tick(), 2000);
    return () => {
      stale = true;
      clearInterval(t);
    };
  }, [active]);

  const opc = (d: Doc | null) => (get(d, "opcounters") ?? {}) as Doc;
  // Per-second rates from the 2s polling delta.
  const rate = (key: string): string => {
    const now = asNum(get(opc(status), key));
    const before = asNum(get(opc(prev), key));
    if (now === null || before === null) return "—";
    return `${Math.max(0, Math.round((now - before) / 2)).toLocaleString()}/s`;
  };

  const conn = (get(status, "connections") ?? {}) as Doc;
  const mem = (get(status, "mem") ?? {}) as Doc;
  const uptime = asNum(get(status, "uptime"));

  const cards: [string, string][] = [
    ["Queries", rate("query")],
    ["Inserts", rate("insert")],
    ["Updates", rate("update")],
    ["Deletes", rate("delete")],
    ["Commands", rate("command")],
    ["Getmores", rate("getmore")],
    ["Connections", asNum(get(conn, "current"))?.toLocaleString() ?? "—"],
    ["Available conns", asNum(get(conn, "available"))?.toLocaleString() ?? "—"],
    ["Resident mem", asNum(get(mem, "resident")) !== null ? `${asNum(get(mem, "resident"))} MB` : "—"],
    ["Virtual mem", asNum(get(mem, "virtual")) !== null ? `${asNum(get(mem, "virtual"))} MB` : "—"],
    [
      "Uptime",
      uptime !== null
        ? uptime > 86400
          ? `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h`
          : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
        : "—",
    ],
    ["Server", String(get(status, "version") ?? "—")],
  ];

  return (
    <div className="h-[380px]">
      <p className="pb-2 text-xs text-muted-foreground">
        Live server metrics — refreshed every 2 seconds while this tab is open. Op rates are
        per-second deltas.
      </p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-md border bg-muted/40 px-2.5 py-2">
            <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
            <p className="mt-0.5 truncate text-sm font-semibold tabular-nums">{value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function OpsDialog({ open, onOpenChange }: OpsDialogProps) {
  const [tab, setTab] = useState("operations");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px]">
        <DialogHeader className="border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Server operations
          </DialogTitle>
          <DialogDescription>
            Live operations, the query profiler, and real-time server metrics.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col px-5 pb-5">
          <TabsList className="mt-3 h-8 w-fit">
            <TabsTrigger value="operations" className="h-7 px-3 text-xs">
              Operations
            </TabsTrigger>
            <TabsTrigger value="profiler" className="h-7 px-3 text-xs">
              Profiler
            </TabsTrigger>
            <TabsTrigger value="live" className="h-7 px-3 text-xs">
              Live stats
            </TabsTrigger>
          </TabsList>
          <TabsContent value="operations" className="mt-3">
            <OperationsTab active={open && tab === "operations"} />
          </TabsContent>
          <TabsContent value="profiler" className="mt-3">
            <ProfilerTab active={open && tab === "profiler"} />
          </TabsContent>
          <TabsContent value="live" className="mt-3">
            <LiveTab active={open && tab === "live"} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
