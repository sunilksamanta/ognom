import { useEffect, useState } from "react";
import { Loader2, OctagonX, RefreshCw, ShieldOff } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { useExplorer } from "@/stores/explorer";
import { api, type Doc } from "@/lib/api";
import { friendlyError, isUnauthorized } from "@/lib/errors";

interface OpsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const asNum = (v: unknown): number | null => (typeof v === "number" ? v : null);
const get = (d: Doc | undefined | null, key: string): unknown =>
  d && typeof d === "object" ? (d as Record<string, unknown>)[key] : undefined;

/**
 * Inline "you can't see this" state for a tab: what the server refused, which
 * privilege / role would unlock it, and the raw error for support tickets.
 */
function PermissionNotice({
  what,
  privilege,
  roles,
  error,
  onRetry,
}: {
  what: string;
  privilege: string;
  roles: string;
  error: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center px-6 py-8">
      <div className="warnbox soft max-w-[520px] flex-col gap-2">
        <div className="hstack">
          <ShieldOff />
          <b>Your MongoDB user cannot view {what}</b>
        </div>
        <div className="text-text-2">
          The server refused the request: <span className="mono">{error}</span>
        </div>
        <div className="text-text-2">
          Ask your administrator for the <span className="mono">{privilege}</span> privilege - usually by granting the{" "}
          <span className="mono">{roles}</span> role - or reconnect with a user that has it. Everything else in Ognom
          keeps working; this only affects this view.
        </div>
        {onRetry && (
          <button type="button" className="btn sm self-start" onClick={onRetry}>
            <RefreshCw />
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

/** Centered placeholder inside a .tw scroller (loading / empty). */
function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-[200px] items-center justify-center gap-2 px-6 py-12 text-center text-[12.5px] text-text-3">
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Operations tab - currentOp with kill
// ---------------------------------------------------------------------------

function OperationsTab({ active }: { active: boolean }) {
  const [ops, setOps] = useState<Doc[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [denied, setDenied] = useState<string | null>(null);
  const [killing, setKilling] = useState<unknown | null>(null);

  const load = async () => {
    setLoading(true);
    setDenied(null);
    try {
      setOps(await api.currentOps());
    } catch (e) {
      setOps([]);
      if (isUnauthorized(e)) setDenied(friendlyError(e));
      else toast.error(friendlyError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (active) void load();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex h-[400px] flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="mono text-[11px] text-text-3">
          {denied ? "no access" : ops === null ? "..." : `${ops.length} active operation${ops.length === 1 ? "" : "s"}`}
        </span>
        <Button variant="outline" size="xs" onClick={() => void load()}>
          {loading ? <Loader2 className="spin h-4 w-4 text-text-3" /> : <RefreshCw />}
          Refresh
        </Button>
      </div>
      <div className="tw rounded-[var(--r-sm)] border border-line bg-panel">
        {denied ? (
          <PermissionNotice
            what="running operations"
            privilege="inprog (and killop to kill)"
            roles="clusterMonitor / hostManager"
            error={denied}
            onRetry={() => void load()}
          />
        ) : ops === null || ops.length === 0 ? (
          <Placeholder>
            {ops === null && <Loader2 className="spin h-4 w-4 text-text-3" />}
            {ops === null ? "Loading..." : "No active operations right now."}
          </Placeholder>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>op</th>
                <th>ns</th>
                <th>
                  running<span className="ty">s</span>
                </th>
                <th>command</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {ops.map((op, i) => {
                const opid = get(op, "opid");
                const secs = asNum(get(op, "secs_running"));
                return (
                  <tr key={i}>
                    <td className="text-text">{String(get(op, "op") ?? "?")}</td>
                    <td className="max-w-[200px] truncate">{String(get(op, "ns") ?? "")}</td>
                    <td>
                      {secs !== null ? (
                        <span className={secs >= 5 ? "pill warn" : "pill"}>{secs}s</span>
                      ) : (
                        <span className="text-text-3">-</span>
                      )}
                    </td>
                    <td className="max-w-[300px] truncate text-text-3">
                      {JSON.stringify(get(op, "command") ?? {}).slice(0, 160)}
                    </td>
                    <td className="text-right">
                      {opid !== undefined && (
                        <button type="button" className="btn dgr sm" onClick={() => setKilling(opid)}>
                          <OctagonX />
                          Kill
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

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
            toast.error(
              isUnauthorized(e)
                ? "Your MongoDB user cannot kill operations - it needs the killop privilege (hostManager role)."
                : friendlyError(e)
            );
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
  const [denied, setDenied] = useState<string | null>(null);

  useEffect(() => {
    if (active && !db && databases.length > 0) setDb(databases[0].name);
  }, [active, databases, db]);

  const load = async (database: string) => {
    if (!database) return;
    setLoading(true);
    setDenied(null);
    try {
      const [status, rows] = await Promise.all([
        api.profilerStatus(database),
        api.profilerEntries(database, 50).catch(() => []),
      ]);
      setLevel(asNum(get(status, "was")));
      setSlowMs(asNum(get(status, "slowms")));
      setEntries(rows);
    } catch (e) {
      setEntries([]);
      setLevel(null);
      if (isUnauthorized(e)) setDenied(friendlyError(e));
      else toast.error(friendlyError(e));
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
      toast.error(
        isUnauthorized(e)
          ? `Your MongoDB user cannot change the profiler on ${db} - it needs the enableProfiler privilege (dbAdmin role).`
          : friendlyError(e)
      );
    }
  };

  return (
    <div className="flex h-[400px] flex-col gap-3">
      <div className="flex items-end gap-3">
        <div className="fld w-[200px]">
          <label>Database</label>
          <Select value={db} onValueChange={setDb}>
            <SelectTrigger className="h-[34px] font-mono text-xs">
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
        </div>
        <div className="fld">
          <label>Profiling level</label>
          <div className="seg">
            {[
              { v: 0, label: "Off" },
              { v: 1, label: `Slow ops${slowMs != null ? ` (>${slowMs}ms)` : ""}` },
              { v: 2, label: "All ops" },
            ].map((o) => (
              <button
                key={o.v}
                type="button"
                className={level === o.v ? "on" : undefined}
                onClick={() => void changeLevel(o.v)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => void load(db)}>
          {loading ? <Loader2 className="spin h-4 w-4 text-text-3" /> : <RefreshCw />}
          Refresh
        </Button>
      </div>

      <div className="tw rounded-[var(--r-sm)] border border-line bg-panel">
        {denied ? (
          <PermissionNotice
            what={`the profiler on ${db}`}
            privilege="enableProfiler and read on system.profile"
            roles={`dbAdmin on ${db}`}
            error={denied}
            onRetry={() => void load(db)}
          />
        ) : !entries || entries.length === 0 ? (
          <Placeholder>
            {entries === null && <Loader2 className="spin h-4 w-4 text-text-3" />}
            {entries === null
              ? "Loading..."
              : "No profiler entries. Turn the profiler on (Slow ops) and run some queries - they'll show up here."}
          </Placeholder>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>op</th>
                <th>ns</th>
                <th>
                  time<span className="ty">ms</span>
                </th>
                <th>plan</th>
                <th>command</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => {
                const millis = asNum(get(e, "millis"));
                const collscan = String(get(e, "planSummary") ?? "").includes("COLLSCAN");
                return (
                  <tr key={i}>
                    <td className="text-text">{String(get(e, "op") ?? "?")}</td>
                    <td className="max-w-[200px] truncate">{String(get(e, "ns") ?? "")}</td>
                    <td>
                      {millis !== null ? (
                        <span className={millis >= 100 ? "pill warn" : "pill"}>{millis}ms</span>
                      ) : (
                        <span className="text-text-3">-</span>
                      )}
                    </td>
                    <td>{collscan ? <span className="pill dgr">COLLSCAN</span> : <span className="text-text-3">-</span>}</td>
                    <td className="max-w-[300px] truncate text-text-3">
                      {JSON.stringify(get(e, "command") ?? get(e, "query") ?? {}).slice(0, 160)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Live stats tab - 2s polling while visible
// ---------------------------------------------------------------------------

function LiveTab({ active }: { active: boolean }) {
  const [status, setStatus] = useState<Doc | null>(null);
  const [prev, setPrev] = useState<Doc | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (!active) return;
    let stale = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const tick = async () => {
      try {
        const s = await api.serverStatusLight();
        if (stale) return;
        setDenied(null);
        setStatus((cur) => {
          setPrev(cur);
          return s;
        });
      } catch (e) {
        if (stale) return;
        if (isUnauthorized(e)) {
          // No point polling every 2s against a permission wall.
          setDenied(friendlyError(e));
          if (timer) clearInterval(timer);
        }
        // otherwise: server hiccup, keep the last numbers
      }
    };
    void tick();
    timer = setInterval(() => void tick(), 2000);
    return () => {
      stale = true;
      if (timer) clearInterval(timer);
    };
  }, [active, retry]);

  const opc = (d: Doc | null) => (get(d, "opcounters") ?? {}) as Doc;
  // Per-second rates from the 2s polling delta.
  const rate = (key: string): string => {
    const now = asNum(get(opc(status), key));
    const before = asNum(get(opc(prev), key));
    if (now === null || before === null) return "-";
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
    ["Connections", asNum(get(conn, "current"))?.toLocaleString() ?? "-"],
    ["Available conns", asNum(get(conn, "available"))?.toLocaleString() ?? "-"],
    ["Resident mem", asNum(get(mem, "resident")) !== null ? `${asNum(get(mem, "resident"))} MB` : "-"],
    ["Virtual mem", asNum(get(mem, "virtual")) !== null ? `${asNum(get(mem, "virtual"))} MB` : "-"],
    [
      "Uptime",
      uptime !== null
        ? uptime > 86400
          ? `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h`
          : `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
        : "-",
    ],
    ["Server", String(get(status, "version") ?? "-")],
  ];

  return (
    <div className="flex h-[400px] flex-col gap-3">
      <p className="hint">
        Live server metrics - refreshed every 2 seconds while this tab is open. Op rates are
        per-second deltas.
      </p>
      {denied ? (
        <div className="tw rounded-[var(--r-sm)] border border-line bg-panel">
          <PermissionNotice
            what="live server metrics"
            privilege="serverStatus"
            roles="clusterMonitor"
            error={denied}
            onRetry={() => setRetry((n) => n + 1)}
          />
        </div>
      ) : (
      <div className="statgrid">
        {cards.map(([label, value]) => (
          <div key={label}>
            <div className="l">{label}</div>
            <div className="v mono truncate tabular-nums">{value}</div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function OpsDialog({ open, onOpenChange }: OpsDialogProps) {
  const [tab, setTab] = useState("operations");

  const tabs: [string, string][] = [
    ["operations", "Operations"],
    ["profiler", "Profiler"],
    ["live", "Live stats"],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[820px]">
        <DialogHeader>
          <DialogTitle>Server operations</DialogTitle>
          <DialogDescription>live operations · query profiler · real-time server metrics</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="seg self-start">
            {tabs.map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={tab === v ? "on" : undefined}
                onClick={() => setTab(v)}
              >
                {label}
              </button>
            ))}
          </div>
          {tab === "operations" && <OperationsTab active={open && tab === "operations"} />}
          {tab === "profiler" && <ProfilerTab active={open && tab === "profiler"} />}
          {tab === "live" && <LiveTab active={open && tab === "live"} />}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
