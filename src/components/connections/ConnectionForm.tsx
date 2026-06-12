import { useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Loader2,
  XCircle,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { api, emptyFields, errMsg, type ProfileInput, type ProfileSummary, type TestResult } from "@/lib/api";
import { useConnections } from "@/stores/connections";
import { cn } from "@/lib/utils";

export const PROFILE_COLORS = [
  "#34D399", // emerald
  "#38BDF8", // sky
  "#A78BFA", // violet
  "#FBBF24", // amber
  "#FB7185", // rose
  "#94A3B8", // slate
];

interface ConnectionFormProps {
  editing: ProfileSummary | null;
  onDone: () => void;
}

export function ConnectionForm({ editing, onDone }: ConnectionFormProps) {
  const { save, connect, connectAdhoc } = useConnections();

  const [name, setName] = useState(editing?.name ?? "");
  const [color, setColor] = useState(editing?.color ?? PROFILE_COLORS[0]);
  const [kind, setKind] = useState<"fields" | "uri">(editing?.kind ?? "fields");
  const [uri, setUri] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fields, setFields] = useState(() => ({ ...emptyFields(), ...(editing?.fields ?? {}) }));
  const [advanced, setAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [busy, setBusy] = useState<"save" | "connect" | "adhoc" | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);

  const srv = fields.scheme === "mongodb+srv";
  const f = <K extends keyof typeof fields>(key: K, value: (typeof fields)[K]) => {
    setFields((prev) => ({ ...prev, [key]: value }));
    setTestResult(null);
  };

  const buildInput = (): ProfileInput => ({
    id: editing?.id ?? null,
    name: name.trim() || defaultName(),
    color,
    kind,
    fields,
    uri: kind === "uri" ? uri.trim() || null : null,
    password: password || null,
  });

  const defaultName = () =>
    kind === "uri"
      ? "New connection"
      : `${fields.host || "localhost"}${srv ? "" : `:${fields.port ?? 27017}`}`;

  const validate = (): string | null => {
    if (kind === "uri" && !uri.trim() && !editing?.hasSecret) {
      return "Paste a connection string first";
    }
    if (kind === "fields" && !fields.host.trim()) return "Host is required";
    return null;
  };

  const handleTest = async () => {
    const invalid = validate();
    if (invalid) return void toast.error(invalid);
    setTesting(true);
    setTestResult(null);
    try {
      setTestResult(await api.testConnection({ input: buildInput() }));
    } catch (e) {
      setTestResult({ ok: false, error: errMsg(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async (connectAfter: boolean) => {
    const invalid = validate();
    if (invalid) return void toast.error(invalid);
    setBusy(connectAfter ? "connect" : "save");
    try {
      const summary = await save(buildInput());
      if (connectAfter) {
        if (await connect(summary.id)) onDone();
      } else {
        toast.success(`Saved "${summary.name}"`);
        onDone();
      }
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  };

  const handleAdhoc = async () => {
    const invalid = validate();
    if (invalid) return void toast.error(invalid);
    setBusy("adhoc");
    try {
      if (await connectAdhoc(buildInput())) onDone();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* name + color */}
      <div className="flex items-end gap-3">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="conn-name">Name</Label>
          <Input
            id="conn-name"
            placeholder={defaultName()}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="flex gap-1.5 pb-2">
          {PROFILE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`color ${c}`}
              onClick={() => setColor(c)}
              className={cn(
                "h-4 w-4 rounded-full transition-transform hover:scale-110",
                color === c && "ring-2 ring-ring ring-offset-2 ring-offset-background"
              )}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>

      <Tabs value={kind} onValueChange={(v) => { setKind(v as "fields" | "uri"); setTestResult(null); }}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="fields">Standard</TabsTrigger>
          <TabsTrigger value="uri">Connection string</TabsTrigger>
        </TabsList>
      </Tabs>

      {kind === "uri" ? (
        <div className="space-y-1.5">
          <Label htmlFor="conn-uri">Connection string</Label>
          <Input
            id="conn-uri"
            className="font-mono text-xs"
            placeholder={
              editing?.hasSecret
                ? "(stored — paste a new one to replace)"
                : "mongodb+srv://user:pass@cluster.mongodb.net/db"
            }
            value={uri}
            onChange={(e) => { setUri(e.target.value); setTestResult(null); }}
          />
          <p className="text-xs text-muted-foreground">
            Stored fully encrypted — including any credentials inside it.
          </p>
        </div>
      ) : (
        <>
          {/* basic fields */}
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="conn-host">Host</Label>
              <Input
                id="conn-host"
                placeholder={srv ? "cluster0.abc.mongodb.net" : "localhost"}
                value={fields.host}
                onChange={(e) => f("host", e.target.value)}
              />
            </div>
            {!srv && (
              <div className="space-y-1.5">
                <Label htmlFor="conn-port">Port</Label>
                <Input
                  id="conn-port"
                  inputMode="numeric"
                  placeholder="27017"
                  value={fields.port ?? ""}
                  onChange={(e) =>
                    f("port", e.target.value ? parseInt(e.target.value, 10) || null : null)
                  }
                />
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="conn-user">Username</Label>
              <Input
                id="conn-user"
                placeholder="(none)"
                value={fields.username ?? ""}
                onChange={(e) => f("username", e.target.value || null)}
                autoCapitalize="off"
                autoCorrect="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="conn-pass">Password</Label>
              <div className="relative">
                <Input
                  id="conn-pass"
                  type={showPassword ? "text" : "password"}
                  placeholder={editing?.hasSecret ? "••••••••  (unchanged)" : "(none)"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setTestResult(null); }}
                  className="pr-9"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>

          {/* advanced */}
          <button
            type="button"
            onClick={() => setAdvanced((a) => !a)}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {advanced ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Advanced options
          </button>

          {advanced && (
            <div className="space-y-4 rounded-lg border bg-muted/40 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Scheme</Label>
                  <Select value={fields.scheme} onValueChange={(v) => f("scheme", v as never)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="mongodb">mongodb — standard</SelectItem>
                      <SelectItem value="mongodb+srv">mongodb+srv — DNS seed list</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Default database</Label>
                  <Input
                    placeholder="(optional)"
                    value={fields.defaultDatabase ?? ""}
                    onChange={(e) => f("defaultDatabase", e.target.value || null)}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Auth source</Label>
                  <Input
                    placeholder="admin"
                    value={fields.authSource ?? ""}
                    onChange={(e) => f("authSource", e.target.value || null)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Auth mechanism</Label>
                  <Select
                    value={fields.authMechanism ?? "DEFAULT"}
                    onValueChange={(v) => f("authMechanism", v === "DEFAULT" ? null : v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="DEFAULT">Default (negotiated)</SelectItem>
                      <SelectItem value="SCRAM-SHA-256">SCRAM-SHA-256</SelectItem>
                      <SelectItem value="SCRAM-SHA-1">SCRAM-SHA-1</SelectItem>
                      <SelectItem value="MONGODB-X509">X.509 certificate</SelectItem>
                      <SelectItem value="PLAIN">LDAP (PLAIN)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {!srv && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>Additional hosts</Label>
                    <Input
                      placeholder="host2:27017, host3:27017"
                      value={fields.extraHosts.join(", ")}
                      onChange={(e) =>
                        f(
                          "extraHosts",
                          e.target.value
                            .split(",")
                            .map((h) => h.trim())
                            .filter(Boolean)
                        )
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Replica set</Label>
                    <Input
                      placeholder="rs0"
                      value={fields.replicaSet ?? ""}
                      onChange={(e) => f("replicaSet", e.target.value || null)}
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <label className="flex items-center gap-2 text-sm">
                  <Switch
                    checked={fields.tlsEnabled}
                    onCheckedChange={(v) => f("tlsEnabled", v)}
                  />
                  TLS/SSL
                </label>
                {(fields.tlsEnabled || srv) && (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Switch
                      checked={fields.tlsInsecure}
                      onCheckedChange={(v) => f("tlsInsecure", v)}
                    />
                    Allow invalid certificates
                  </label>
                )}
                {!srv && (
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Switch
                      checked={fields.directConnection}
                      onCheckedChange={(v) => f("directConnection", v)}
                    />
                    Direct connection
                  </label>
                )}
              </div>

              {(fields.tlsEnabled || srv) && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label>CA file path</Label>
                    <Input
                      placeholder="/path/to/ca.pem"
                      value={fields.tlsCaFile ?? ""}
                      onChange={(e) => f("tlsCaFile", e.target.value || null)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Client cert + key (PEM)</Label>
                    <Input
                      placeholder="/path/to/client.pem"
                      value={fields.tlsCertKeyFile ?? ""}
                      onChange={(e) => f("tlsCertKeyFile", e.target.value || null)}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label>Read preference</Label>
                  <Select
                    value={fields.readPreference ?? "primary"}
                    onValueChange={(v) => f("readPreference", v === "primary" ? null : v)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="primary">primary</SelectItem>
                      <SelectItem value="primaryPreferred">primaryPreferred</SelectItem>
                      <SelectItem value="secondary">secondary</SelectItem>
                      <SelectItem value="secondaryPreferred">secondaryPreferred</SelectItem>
                      <SelectItem value="nearest">nearest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Connect timeout (ms)</Label>
                  <Input
                    inputMode="numeric"
                    placeholder="10000"
                    value={fields.connectTimeoutMs ?? ""}
                    onChange={(e) =>
                      f(
                        "connectTimeoutMs",
                        e.target.value ? parseInt(e.target.value, 10) || null : null
                      )
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Max pool size</Label>
                  <Input
                    inputMode="numeric"
                    placeholder="10"
                    value={fields.maxPoolSize ?? ""}
                    onChange={(e) =>
                      f("maxPoolSize", e.target.value ? parseInt(e.target.value, 10) || null : null)
                    }
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Extra URI options</Label>
                <Input
                  className="font-mono text-xs"
                  placeholder="retryWrites=true&w=majority"
                  value={fields.extraOptions ?? ""}
                  onChange={(e) => f("extraOptions", e.target.value || null)}
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* test result */}
      {testResult && (
        <div
          className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
            testResult.ok
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-destructive/30 bg-destructive/10 text-destructive"
          )}
        >
          {testResult.ok ? (
            <>
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                MongoDB {testResult.serverVersion} · {testResult.topology} ·{" "}
                {testResult.latencyMs}ms
              </span>
            </>
          ) : (
            <>
              <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="break-all">{testResult.error}</span>
            </>
          )}
        </div>
      )}

      <Separator />

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleTest} disabled={testing || busy !== null}>
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
          Test
        </Button>
        {!editing && (
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={handleAdhoc}
            disabled={busy !== null}
          >
            {busy === "adhoc" && <Loader2 className="h-4 w-4 animate-spin" />}
            Connect without saving
          </Button>
        )}
        <div className="flex-1" />
        <Button variant="secondary" size="sm" onClick={() => void handleSave(false)} disabled={busy !== null}>
          {busy === "save" && <Loader2 className="h-4 w-4 animate-spin" />}
          Save
        </Button>
        <Button size="sm" onClick={() => void handleSave(true)} disabled={busy !== null}>
          {busy === "connect" && <Loader2 className="h-4 w-4 animate-spin" />}
          Save & connect
        </Button>
      </div>
    </div>
  );
}
