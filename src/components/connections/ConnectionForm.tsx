import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, ChevronRight, Eye, EyeOff, Loader2, XCircle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api, emptyFields, errMsg, type AccessMode, type ProfileInput, type ProfileSummary, type TestResult } from "@/lib/api";
import { useConnections } from "@/stores/connections";
import { cn } from "@/lib/utils";

/** Colour tags shown on the rail tile. Semantic first, then neutrals. */
export const PROFILE_COLORS = [
  "#00ED64", // spring green
  "#7FE1FF", // sky
  "#E9B44C", // amber
  "#F0705F", // coral
  "#C3A7F1", // violet
  "#F49AC1", // rose
  "#A2AEA8", // slate
];

const ACCESS: { id: AccessMode; label: string; hint: string; danger?: boolean }[] = [
  { id: "readwrite", label: "Read & write", hint: "full access, confirmations on destructive writes" },
  { id: "readonly", label: "Read-only", hint: "opens read-only, switch to edit mode from the status bar" },
  { id: "production", label: "Production", hint: "read-only by default, red tag on the rail, extra confirmation before edits", danger: true },
];

interface ConnectionFormProps {
  editing: ProfileSummary | null;
  onDone: () => void;
  onCancel: () => void;
}

/** Field wrapper in the design's `.fld` shape. */
function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="fld">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function ConnectionForm({ editing, onDone, onCancel }: ConnectionFormProps) {
  const { save, connect, connectAdhoc } = useConnections();

  const [name, setName] = useState(editing?.name ?? "");
  const [color, setColor] = useState(editing?.color ?? PROFILE_COLORS[0]);
  const [access, setAccess] = useState<AccessMode>(editing?.access ?? "readwrite");
  const [kind, setKind] = useState<"fields" | "uri">(editing?.kind ?? "uri");
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

  const defaultName = () => {
    if (kind === "uri") {
      const m = uri.match(/@([^/?,:]+)/) ?? uri.match(/\/\/([^/?,:]+)/);
      return m?.[1] ?? "New connection";
    }
    return `${fields.host || "localhost"}${srv ? "" : `:${fields.port ?? 27017}`}`;
  };

  const buildInput = (): ProfileInput => ({
    id: editing?.id ?? null,
    name: name.trim() || defaultName(),
    color,
    access,
    kind,
    fields,
    uri: kind === "uri" ? uri.trim() || null : null,
    password: password || null,
  });

  const validate = (): string | null => {
    if (kind === "uri" && !uri.trim() && !editing?.hasSecret) return "Paste a connection string first";
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
    <>
      <div className="mbd">
        <div className="seg self-start no-select">
          <button className={cn(kind === "uri" && "on")} onClick={() => { setKind("uri"); setTestResult(null); }}>
            Connection string
          </button>
          <button className={cn(kind === "fields" && "on")} onClick={() => { setKind("fields"); setTestResult(null); }}>
            Host and credentials
          </button>
        </div>

        {kind === "uri" ? (
          <Field
            label="Connection string"
            htmlFor="conn-uri"
            hint="Stored fully encrypted, credentials included. Ognom parses mongodb:// and mongodb+srv:// URIs."
          >
            <input
              id="conn-uri"
              className="in"
              placeholder={editing?.hasSecret ? "(stored - paste a new one to replace)" : "mongodb+srv://user:pass@cluster0.mongodb.net/?retryWrites=true"}
              value={uri}
              onChange={(e) => { setUri(e.target.value); setTestResult(null); }}
              spellCheck={false}
              autoComplete="off"
              autoFocus
            />
          </Field>
        ) : (
          <>
            <div className="two" style={{ gridTemplateColumns: srv ? "1fr" : "1fr 110px" }}>
              <Field label="Host" htmlFor="conn-host">
                <input id="conn-host" className="in" placeholder={srv ? "cluster0.abc.mongodb.net" : "localhost"} value={fields.host} onChange={(e) => f("host", e.target.value)} autoFocus />
              </Field>
              {!srv && (
                <Field label="Port" htmlFor="conn-port">
                  <input id="conn-port" className="in" inputMode="numeric" placeholder="27017" value={fields.port ?? ""} onChange={(e) => f("port", e.target.value ? parseInt(e.target.value, 10) || null : null)} />
                </Field>
              )}
            </div>
            <div className="two">
              <Field label="Username" htmlFor="conn-user">
                <input id="conn-user" className="in" placeholder="(none)" value={fields.username ?? ""} onChange={(e) => f("username", e.target.value || null)} autoCapitalize="off" autoCorrect="off" />
              </Field>
              <Field label="Password" htmlFor="conn-pass">
                <div className="in" style={{ padding: "0 4px 0 12px" }}>
                  <input
                    id="conn-pass"
                    type={showPassword ? "text" : "password"}
                    placeholder={editing?.hasSecret ? "(unchanged)" : "(none)"}
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setTestResult(null); }}
                    className="h-full min-w-0 flex-1 bg-transparent font-mono text-[12.5px] outline-none placeholder:text-text-3"
                  />
                  <button type="button" tabIndex={-1} className="ico sm" onClick={() => setShowPassword((s) => !s)} aria-label="Toggle password">
                    {showPassword ? <EyeOff /> : <Eye />}
                  </button>
                </div>
              </Field>
            </div>

            <button type="button" onClick={() => setAdvanced((a) => !a)} className="hstack self-start text-[12px] font-medium text-text-2 hover:text-text">
              {advanced ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
              Advanced options
            </button>

            {advanced && (
              <div className="stack rounded-[var(--r)] border border-line bg-panel p-4">
                <div className="two">
                  <Field label="Scheme">
                    <Select value={fields.scheme} onValueChange={(v) => f("scheme", v as never)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="mongodb">mongodb - standard</SelectItem>
                        <SelectItem value="mongodb+srv">mongodb+srv - DNS seed list</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Default database">
                    <input className="in" placeholder="(optional)" value={fields.defaultDatabase ?? ""} onChange={(e) => f("defaultDatabase", e.target.value || null)} />
                  </Field>
                </div>
                <div className="two">
                  <Field label="Auth source">
                    <input className="in" placeholder="admin" value={fields.authSource ?? ""} onChange={(e) => f("authSource", e.target.value || null)} />
                  </Field>
                  <Field label="Auth mechanism">
                    <Select value={fields.authMechanism ?? "DEFAULT"} onValueChange={(v) => f("authMechanism", v === "DEFAULT" ? null : v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="DEFAULT">Default (negotiated)</SelectItem>
                        <SelectItem value="SCRAM-SHA-256">SCRAM-SHA-256</SelectItem>
                        <SelectItem value="SCRAM-SHA-1">SCRAM-SHA-1</SelectItem>
                        <SelectItem value="MONGODB-X509">X.509 certificate</SelectItem>
                        <SelectItem value="PLAIN">LDAP (PLAIN)</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
                {!srv && (
                  <div className="two">
                    <Field label="Additional hosts">
                      <input className="in" placeholder="host2:27017, host3:27017" value={fields.extraHosts.join(", ")} onChange={(e) => f("extraHosts", e.target.value.split(",").map((h) => h.trim()).filter(Boolean))} />
                    </Field>
                    <Field label="Replica set">
                      <input className="in" placeholder="rs0" value={fields.replicaSet ?? ""} onChange={(e) => f("replicaSet", e.target.value || null)} />
                    </Field>
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                  <label className="hstack text-[12.5px] text-text-2"><Switch checked={fields.tlsEnabled} onCheckedChange={(v) => f("tlsEnabled", v)} /> TLS/SSL</label>
                  {(fields.tlsEnabled || srv) && (
                    <label className="hstack text-[12.5px] text-text-2"><Switch checked={fields.tlsInsecure} onCheckedChange={(v) => f("tlsInsecure", v)} /> Allow invalid certificates</label>
                  )}
                  {!srv && (
                    <label className="hstack text-[12.5px] text-text-2"><Switch checked={fields.directConnection} onCheckedChange={(v) => f("directConnection", v)} /> Direct connection</label>
                  )}
                </div>
                {(fields.tlsEnabled || srv) && (
                  <div className="two">
                    <Field label="CA file path">
                      <input className="in" placeholder="/path/to/ca.pem" value={fields.tlsCaFile ?? ""} onChange={(e) => f("tlsCaFile", e.target.value || null)} />
                    </Field>
                    <Field label="Client cert + key (PEM)">
                      <input className="in" placeholder="/path/to/client.pem" value={fields.tlsCertKeyFile ?? ""} onChange={(e) => f("tlsCertKeyFile", e.target.value || null)} />
                    </Field>
                  </div>
                )}
                <div className="three">
                  <Field label="Read preference">
                    <Select value={fields.readPreference ?? "primary"} onValueChange={(v) => f("readPreference", v === "primary" ? null : v)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {["primary", "primaryPreferred", "secondary", "secondaryPreferred", "nearest"].map((v) => (
                          <SelectItem key={v} value={v}>{v}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label="Connect timeout (ms)">
                    <input className="in" inputMode="numeric" placeholder="10000" value={fields.connectTimeoutMs ?? ""} onChange={(e) => f("connectTimeoutMs", e.target.value ? parseInt(e.target.value, 10) || null : null)} />
                  </Field>
                  <Field label="Max pool size">
                    <input className="in" inputMode="numeric" placeholder="10" value={fields.maxPoolSize ?? ""} onChange={(e) => f("maxPoolSize", e.target.value ? parseInt(e.target.value, 10) || null : null)} />
                  </Field>
                </div>
                <Field label="Extra URI options">
                  <input className="in" placeholder="retryWrites=true&w=majority" value={fields.extraOptions ?? ""} onChange={(e) => f("extraOptions", e.target.value || null)} />
                </Field>
              </div>
            )}
          </>
        )}

        <div className="two">
          <Field label="Name" htmlFor="conn-name">
            <input id="conn-name" className="in sans" placeholder={defaultName()} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Colour tag">
            <div className="in" style={{ gap: 7 }}>
              {PROFILE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`colour ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  style={{
                    width: 15,
                    height: 15,
                    borderRadius: 5,
                    background: c,
                    opacity: color === c ? 1 : 0.45,
                    outline: color === c ? "2px solid var(--text)" : "none",
                    outlineOffset: 1,
                    flex: "none",
                  }}
                />
              ))}
              <span className="ml-auto text-[11px] text-text-3">shows on the rail</span>
            </div>
          </Field>
        </div>

        <Field label="Session mode">
          <div className="opts">
            {ACCESS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={cn("opt", access === a.id && "on", a.danger && access === a.id && "dgr")}
                onClick={() => setAccess(a.id)}
                aria-pressed={access === a.id}
              >
                <b className={cn(a.danger && "text-danger")}>{a.label}</b>
                <span>{a.hint}</span>
              </button>
            ))}
          </div>
        </Field>

        <Field label="Test">
          {testing ? (
            <span className="hint hstack">
              <Loader2 className="spin h-3.5 w-3.5" /> connecting
            </span>
          ) : testResult ? (
            testResult.ok ? (
              <span className="hint hstack text-ok">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Reachable · {testResult.latencyMs} ms · {testResult.topology} · MongoDB {testResult.serverVersion}
              </span>
            ) : (
              <span className="hint hstack items-start text-danger">
                <XCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                <span className="break-all">{testResult.error}</span>
              </span>
            )
          ) : (
            <span className="hint">Not tested yet - "Test" opens a short-lived connection and closes it again.</span>
          )}
        </Field>
      </div>

      <div className="mft">
        <button className="btn qt" onClick={handleTest} disabled={testing || busy !== null}>
          {testing && <Loader2 className="spin" />}
          {testResult ? "Test again" : "Test"}
        </button>
        {!editing && (
          <button className="btn qt" onClick={handleAdhoc} disabled={busy !== null}>
            {busy === "adhoc" && <Loader2 className="spin" />}
            Connect without saving
          </button>
        )}
        <div className="r">
          <button className="btn" onClick={onCancel} disabled={busy !== null}>
            Cancel
          </button>
          <button className="btn" onClick={() => void handleSave(false)} disabled={busy !== null}>
            {busy === "save" && <Loader2 className="spin" />}
            Save
          </button>
          <button className="btn pri" onClick={() => void handleSave(true)} disabled={busy !== null}>
            {busy === "connect" && <Loader2 className="spin" />}
            {editing ? "Save & connect" : "Connect"}
          </button>
        </div>
      </div>
    </>
  );
}
