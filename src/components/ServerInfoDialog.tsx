import { Fragment, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  Activity,
  Clock,
  Copy,
  Cpu,
  Database,
  Layers,
  Loader2,
  Network,
  Plug,
  RefreshCw,
  Server,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useConnections } from "@/stores/connections";
import { api, errMsg, type ServerInfoRaw } from "@/lib/api";
import { formatBytes, formatCount, toPlainJson, toPlainValue } from "@/lib/bson";

interface ServerInfoDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// --- safe accessors over the plain-JS server-info blob --------------------
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : null;
const num = (v: unknown): number | null => {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const count = (v: unknown): string | null => {
  const n = num(v);
  return n === null ? null : formatCount(n);
};
const bytes = (v: unknown): string | null => {
  const n = num(v);
  return n === null ? null : formatBytes(n);
};

function formatUptime(seconds: number | null): string | null {
  if (seconds === null || seconds < 0) return null;
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

type Row = [string, ReactNode];

function Section({
  icon: Icon,
  title,
  rows = [],
  children,
}: {
  icon: LucideIcon;
  title: string;
  rows?: Row[];
  children?: ReactNode;
}) {
  const visible = rows.filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (visible.length === 0 && !children) return null;
  return (
    <div className="rounded-lg border bg-card/40 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" />
        {title}
      </div>
      {visible.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
          {visible.map(([label, value]) => (
            <Fragment key={label}>
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-all text-right font-mono text-foreground/90">{value}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      {children}
    </div>
  );
}

export function ServerInfoDialog({ open, onOpenChange }: ServerInfoDialogProps) {
  const active = useConnections((s) => s.active);
  const [raw, setRaw] = useState<ServerInfoRaw | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    api
      .serverInfo()
      .then(setRaw)
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (open) load();
    else {
      setRaw(null);
      setError(null);
    }
  }, [open]);

  const copyJson = async () => {
    if (!raw) return;
    await navigator.clipboard.writeText(toPlainJson(raw));
    toast.success("Server details copied");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[540px]">
        {/* header */}
        <div className="flex items-start gap-3 border-b px-5 py-4 pr-12">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <Server className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <DialogTitle className="text-base">
              MongoDB {active?.serverVersion ?? ""}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Detailed MongoDB server status, build, and deployment information.
            </DialogDescription>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {active?.topology}
              {active?.hostSummary ? ` · ${active.hostSummary}` : ""}
            </p>
          </div>
        </div>

        {/* body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-2.5 px-5 py-4">
            {loading && (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Reading server status…
              </div>
            )}

            {error && !loading && (
              <div className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
                <Button variant="outline" size="sm" className="gap-1.5" onClick={load}>
                  <RefreshCw className="h-3.5 w-3.5" />
                  Retry
                </Button>
              </div>
            )}

            {!loading && !error && raw && <Body raw={raw} fallbackVersion={active?.serverVersion} fallbackTopology={active?.topology} />}
          </div>
        </div>

        {/* footer */}
        <div className="flex items-center justify-between gap-2 border-t bg-card/40 px-5 py-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-muted-foreground"
            disabled={!raw}
            onClick={() => void copyJson()}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy as JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={loading}
            onClick={load}
          >
            <RefreshCw className={loading ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
            Refresh
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Body({
  raw,
  fallbackVersion,
  fallbackTopology,
}: {
  raw: ServerInfoRaw;
  fallbackVersion?: string;
  fallbackTopology?: string;
}) {
  const plain = obj(toPlainValue(raw));
  const bi = obj(plain.buildInfo);
  const hello = obj(plain.hello);
  const ss = obj(plain.serverStatus);
  const hi = obj(plain.hostInfo);
  const cs = obj(plain.connectionStatus);

  // build
  const git = str(bi.gitVersion);
  const modules = arr(bi.modules)
    .map((m) => str(m))
    .filter(Boolean) as string[];
  const buildRows: Row[] = [
    ["Version", str(bi.version) ?? fallbackVersion ?? null],
    ["Git revision", git ? `${git.slice(0, 12)}…` : null],
    ["Storage engine", str(obj(ss.storageEngine).name)],
    ["JS engine", str(bi.javascriptEngine)],
    ["Allocator", str(bi.allocator)],
    ["Architecture", num(bi.bits) ? `${num(bi.bits)}-bit` : null],
    ["Max document size", bytes(bi.maxBsonObjectSize)],
    ["OpenSSL", str(obj(bi.openssl).running)],
    ["Modules", modules.length ? modules.join(", ") : null],
  ];

  // deployment
  const hosts = arr(hello.hosts)
    .map((h) => str(h))
    .filter(Boolean) as string[];
  const primary = str(hello.primary);
  const me = str(hello.me);
  const minW = num(hello.minWireVersion);
  const maxW = num(hello.maxWireVersion);
  const deployRows: Row[] = [
    ["Topology", fallbackTopology ?? null],
    ["Replica set", str(hello.setName)],
    ["Current node", me],
    ["Wire protocol", minW !== null && maxW !== null ? `v${minW}–v${maxW}` : null],
    ["Read only", hello.readOnly === true ? "yes" : null],
  ];

  // host system
  const sys = obj(hi.system);
  const os = obj(hi.os);
  const osName = str(os.name) ?? str(os.type);
  const osVersion = str(os.version);
  const cores = num(sys.numCores);
  const cpuArch = str(sys.cpuArch);
  const memMb = num(sys.memSizeMB);
  const hostRows: Row[] = [
    ["Hostname", str(sys.hostname)],
    ["OS", osName ? `${osName}${osVersion ? ` ${osVersion}` : ""}` : null],
    ["CPU", cores !== null ? `${cores} cores${cpuArch ? ` · ${cpuArch}` : ""}` : null],
    ["Memory", memMb !== null ? formatBytes(memMb * 1024 * 1024) : null],
  ];

  // runtime
  const runtimeRows: Row[] = [
    ["Host", str(ss.host) ?? me],
    ["Process", str(ss.process)],
    ["PID", str(ss.pid)],
    ["Uptime", formatUptime(num(ss.uptime))],
    ["Local time", str(hello.localTime)],
  ];

  // connections
  const conn = obj(ss.connections);
  const connRows: Row[] = [
    ["Current", count(conn.current)],
    ["Active", count(conn.active)],
    ["Available", count(conn.available)],
    ["Total created", count(conn.totalCreated)],
  ];

  // operations
  const ops = obj(ss.opcounters);
  const opRows: Row[] = [
    ["Insert", count(ops.insert)],
    ["Query", count(ops.query)],
    ["Update", count(ops.update)],
    ["Delete", count(ops.delete)],
    ["Getmore", count(ops.getmore)],
    ["Command", count(ops.command)],
  ];

  // network
  const net = obj(ss.network);
  const netRows: Row[] = [
    ["Bytes in", bytes(net.bytesIn)],
    ["Bytes out", bytes(net.bytesOut)],
    ["Requests", count(net.numRequests)],
  ];

  // authentication
  const authInfo = obj(cs.authInfo);
  const users = arr(authInfo.authenticatedUsers)
    .map((u) => {
      const o = obj(u);
      const user = str(o.user);
      return user ? `${user}${str(o.db) ? `@${str(o.db)}` : ""}` : null;
    })
    .filter(Boolean) as string[];
  const roles = arr(authInfo.authenticatedUserRoles)
    .map((r) => {
      const o = obj(r);
      const role = str(o.role);
      return role ? `${role}${str(o.db) ? `@${str(o.db)}` : ""}` : null;
    })
    .filter(Boolean) as string[];

  return (
    <>
      <Section icon={Database} title="Build" rows={buildRows} />

      <Section icon={Layers} title="Deployment" rows={deployRows}>
        {hosts.length > 0 && (
          <div className="mt-2 flex flex-col gap-1 border-t pt-2 text-[12px]">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              {hosts.length === 1 ? "Host" : `${hosts.length} hosts`}
            </span>
            {hosts.map((h) => (
              <div key={h} className="flex items-center justify-between gap-2 font-mono">
                <span className="break-all text-foreground/90">{h}</span>
                {h === primary ? (
                  <span className="shrink-0 rounded bg-primary/15 px-1.5 py-px text-[10px] font-medium text-primary">
                    primary
                  </span>
                ) : h === me ? (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-px text-[10px] text-muted-foreground">
                    connected
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section icon={Cpu} title="Host system" rows={hostRows} />
      <Section icon={Clock} title="Runtime" rows={runtimeRows} />
      <Section icon={Plug} title="Connections" rows={connRows} />
      <Section icon={Activity} title="Operations (since start)" rows={opRows} />
      <Section icon={Network} title="Network" rows={netRows} />

      <Section
        icon={ShieldCheck}
        title="Authentication"
        rows={[
          ["User", users.length ? users.join(", ") : "unauthenticated"],
          ["Roles", roles.length ? roles.join(", ") : null],
        ]}
      />
    </>
  );
}
