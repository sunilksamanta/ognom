import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Clock,
  Code2,
  EyeOff,
  Hash,
  Key,
  Layers,
  Loader2,
  MapPin,
  Plus,
  Type,
  LayoutList,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckRow } from "@/components/ui/check-row";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { api, errMsg, type CollectionStats, type IndexInfo } from "@/lib/api";
import { toShellText, formatBytes, formatCount } from "@/lib/bson";
import { cn } from "@/lib/utils";
import type { Tab } from "@/stores/explorer";

interface IndexesPaneProps {
  tab: Tab;
  /** Load when the pane becomes visible. */
  active: boolean;
  readOnly: boolean;
}

// ---------------------------------------------------------------------------
// Key builder model
// ---------------------------------------------------------------------------

type KeyType = "1" | "-1" | "text" | "2dsphere" | "2d" | "hashed";

const KEY_TYPES: { value: KeyType; label: string; hint: string }[] = [
  { value: "1", label: "Ascending (1)", hint: "Sort ascending" },
  { value: "-1", label: "Descending (-1)", hint: "Sort descending" },
  { value: "text", label: "Text", hint: "Full-text search" },
  { value: "2dsphere", label: "2dsphere", hint: "GeoJSON geospatial" },
  { value: "2d", label: "2d", hint: "Legacy coordinate pairs" },
  { value: "hashed", label: "Hashed", hint: "Sharding / even distribution" },
];

let keyId = 0;
interface KeyField {
  id: number;
  field: string;
  type: KeyType;
}
const newKey = (field = "", type: KeyType = "1"): KeyField => ({ id: keyId++, field, type });

interface Template {
  id: string;
  label: string;
  icon: typeof Hash;
  desc: string;
  keys: () => KeyField[];
  defaults?: Partial<FormOptions>;
}

interface FormOptions {
  name: string;
  unique: boolean;
  sparse: boolean;
  hidden: boolean;
  ttlEnabled: boolean;
  ttlSeconds: string;
  partialEnabled: boolean;
  partialText: string;
  caseInsensitive: boolean;
}

const emptyOptions: FormOptions = {
  name: "",
  unique: false,
  sparse: false,
  hidden: false,
  ttlEnabled: false,
  ttlSeconds: "3600",
  partialEnabled: false,
  partialText: '{ "status": "active" }',
  caseInsensitive: false,
};

const TEMPLATES: Template[] = [
  {
    id: "single",
    label: "Single field",
    icon: Key,
    desc: "One field, ascending or descending",
    keys: () => [newKey("", "1")],
  },
  {
    id: "compound",
    label: "Compound",
    icon: Layers,
    desc: "Multiple fields, order matters",
    keys: () => [newKey("", "1"), newKey("", "-1")],
  },
  {
    id: "text",
    label: "Text search",
    icon: Type,
    desc: "Full-text search across fields",
    keys: () => [newKey("", "text")],
  },
  {
    id: "geo",
    label: "Geospatial",
    icon: MapPin,
    desc: "2dsphere index for GeoJSON",
    keys: () => [newKey("location", "2dsphere")],
  },
  {
    id: "hashed",
    label: "Hashed",
    icon: Hash,
    desc: "Even distribution for sharding",
    keys: () => [newKey("", "hashed")],
  },
  {
    id: "ttl",
    label: "TTL (expiring)",
    icon: Clock,
    desc: "Auto-delete docs after a time",
    keys: () => [newKey("createdAt", "1")],
    defaults: { ttlEnabled: true },
  },
];

// Build the keys document text from the visual builder.
function buildKeysText(keys: KeyField[]): string {
  const parts = keys
    .filter((k) => k.field.trim())
    .map((k) => {
      const v = k.type === "1" || k.type === "-1" ? k.type : `"${k.type}"`;
      return `"${k.field.trim()}": ${v}`;
    });
  return `{ ${parts.join(", ")} }`;
}

// ---------------------------------------------------------------------------

export function IndexesPane({ tab, active, readOnly }: IndexesPaneProps) {
  const open = active;
  const [indexes, setIndexes] = useState<IndexInfo[] | null>(null);
  const [stats, setStats] = useState<CollectionStats | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dropping, setDropping] = useState<string | null>(null);

  // create form state
  const [rawMode, setRawMode] = useState(false);
  const [keys, setKeys] = useState<KeyField[]>([newKey()]);
  const [rawKeys, setRawKeys] = useState("{ field: 1 }");
  const [opts, setOpts] = useState<FormOptions>(emptyOptions);

  const load = async () => {
    try {
      const [idx, st] = await Promise.all([
        api.listIndexes(tab.database, tab.collection),
        api.collectionStats(tab.database, tab.collection).catch(() => null),
      ]);
      setIndexes(idx);
      setStats(st);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  useEffect(() => {
    if (open) {
      setIndexes(null);
      resetForm();
      setCreating(false);
      void load();
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const resetForm = () => {
    setRawMode(false);
    setKeys([newKey()]);
    setRawKeys("{ field: 1 }");
    setOpts(emptyOptions);
  };

  const applyTemplate = (t: Template) => {
    setRawMode(false);
    setKeys(t.keys());
    setOpts({ ...emptyOptions, ...t.defaults });
  };

  const keysText = rawMode ? rawKeys : buildKeysText(keys);

  // Live preview of the createIndex options.
  const preview = useMemo(() => {
    const o: Record<string, unknown> = {};
    if (opts.name.trim()) o.name = opts.name.trim();
    if (opts.unique) o.unique = true;
    if (opts.sparse) o.sparse = true;
    if (opts.hidden) o.hidden = true;
    if (opts.ttlEnabled && Number(opts.ttlSeconds) > 0)
      o.expireAfterSeconds = Number(opts.ttlSeconds);
    if (opts.partialEnabled && opts.partialText.trim())
      o.partialFilterExpression = "{...}";
    if (opts.caseInsensitive) o.collation = { locale: "en", strength: 2 };
    return o;
  }, [opts]);

  const canCreate = keysText.replace(/[{}\s]/g, "").length > 0;

  const handleCreate = async () => {
    setBusy(true);
    try {
      const created = await api.createIndex({
        database: tab.database,
        collection: tab.collection,
        keysText,
        name: opts.name.trim() || undefined,
        unique: opts.unique,
        sparse: opts.sparse || undefined,
        hidden: opts.hidden || undefined,
        ttlSeconds:
          opts.ttlEnabled && Number(opts.ttlSeconds) > 0 ? Number(opts.ttlSeconds) : undefined,
        partialFilterText: opts.partialEnabled ? opts.partialText : undefined,
        collationLocale: opts.caseInsensitive ? "en" : undefined,
      });
      toast.success(`Created index "${created}"`);
      setCreating(false);
      resetForm();
      await load();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[860px] flex-col gap-[14px] px-[var(--pad)] py-[var(--pad)]">
            {stats && (
              <div className="statgrid five">
                {(
                  [
                    ["Documents", formatCount(stats.count)],
                    ["Data", formatBytes(stats.size)],
                    ["Storage", formatBytes(stats.storageSize)],
                    ["Avg doc", formatBytes(stats.avgObjSize)],
                    ["Index size", formatBytes(stats.totalIndexSize)],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <div className="l">{label}</div>
                    <div className="v">{value}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="lbl">
                Indexes{indexes ? ` · ${indexes.length}` : ""}
              </span>
              {!creating && (
                <Button variant="outline" size="sm" disabled={readOnly} onClick={() => setCreating(true)}>
                  <Plus className="h-3.5 w-3.5" />
                  New index
                </Button>
              )}
            </div>

            {creating && (
              <CreateForm
                collection={tab.collection}
                rawMode={rawMode}
                setRawMode={setRawMode}
                keys={keys}
                setKeys={setKeys}
                rawKeys={rawKeys}
                setRawKeys={setRawKeys}
                opts={opts}
                setOpts={setOpts}
                keysText={keysText}
                preview={preview}
                applyTemplate={applyTemplate}
                canCreate={canCreate}
                busy={busy}
                onCreate={() => void handleCreate()}
                onCancel={() => {
                  setCreating(false);
                  resetForm();
                }}
              />
            )}

            {indexes === null ? (
              <div className="flex justify-center py-6">
                <Loader2 className="spin h-5 w-5 text-text-3" />
              </div>
            ) : (
              <div className="flex flex-col gap-[7px]">
                {indexes.map((idx) => (
                  <div key={idx.name} className="idxrow group">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="n">{idx.name}</span>
                        {idx.unique && <IdxBadge>unique</IdxBadge>}
                        {idx.sparse && <IdxBadge>sparse</IdxBadge>}
                        {idx.hidden && <IdxBadge>hidden</IdxBadge>}
                        {idx.partialFilter && <IdxBadge>partial</IdxBadge>}
                        {idx.ttlSeconds != null && <IdxBadge>ttl {idx.ttlSeconds}s</IdxBadge>}
                        {idx.usageOps === 0 && idx.name !== "_id_" && (
                          <span
                            className="pill warn"
                            title={
                              idx.usageSince
                                ? `No operations have used this index since ${new Date(idx.usageSince).toLocaleString()}`
                                : "No operations have used this index since stats began"
                            }
                          >
                            unused
                          </span>
                        )}
                      </div>
                      <p className="mt-1 truncate font-mono text-[11px] text-text-3">
                        {toShellText(idx.keys)}
                      </p>
                      {idx.usageOps != null && idx.usageOps > 0 && (
                        <p
                          className="mt-0.5 font-mono text-[10px] tabular-nums text-text-3"
                          title={
                            idx.usageSince
                              ? `Counting since ${new Date(idx.usageSince).toLocaleString()}`
                              : undefined
                          }
                        >
                          {idx.usageOps.toLocaleString()} op{idx.usageOps === 1 ? "" : "s"} served
                        </p>
                      )}
                    </div>
                    {idx.name !== "_id_" && !readOnly && (
                      <button
                        className="ico dgr opacity-0 transition-opacity group-hover:opacity-100"
                        onClick={() => setDropping(idx.name)}
                        aria-label={`Drop index ${idx.name}`}
                      >
                        <X />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
        </div>
      </div>

      <ConfirmDialog
        open={dropping !== null}
        onOpenChange={(o) => !o && setDropping(null)}
        title={`Drop index “${dropping}”?`}
        description="Queries relying on this index may slow down. This cannot be undone."
        confirmLabel="Drop index"
        destructive
        requireAck
        busy={busy}
        onConfirm={async () => {
          if (!dropping) return;
          setBusy(true);
          try {
            await api.dropIndex(tab.database, tab.collection, dropping);
            toast.success(`Dropped "${dropping}"`);
            setDropping(null);
            await load();
          } catch (e) {
            toast.error(errMsg(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

function IdxBadge({ children }: { children: React.ReactNode }) {
  return <span className="pill">{children}</span>;
}

// ---------------------------------------------------------------------------
// Create form
// ---------------------------------------------------------------------------

interface CreateFormProps {
  collection: string;
  rawMode: boolean;
  setRawMode: (v: boolean) => void;
  keys: KeyField[];
  setKeys: React.Dispatch<React.SetStateAction<KeyField[]>>;
  rawKeys: string;
  setRawKeys: (v: string) => void;
  opts: FormOptions;
  setOpts: React.Dispatch<React.SetStateAction<FormOptions>>;
  keysText: string;
  preview: Record<string, unknown>;
  applyTemplate: (t: Template) => void;
  canCreate: boolean;
  busy: boolean;
  onCreate: () => void;
  onCancel: () => void;
}

function CreateForm({
  collection,
  rawMode,
  setRawMode,
  keys,
  setKeys,
  rawKeys,
  setRawKeys,
  opts,
  setOpts,
  keysText,
  preview,
  applyTemplate,
  canCreate,
  busy,
  onCreate,
  onCancel,
}: CreateFormProps) {
  const set = <K extends keyof FormOptions>(k: K, v: FormOptions[K]) =>
    setOpts((o) => ({ ...o, [k]: v }));

  return (
    <div className="stack rounded-[var(--r)] border border-line bg-panel p-4">
      <div className="fld">
        <label>Start from a template</label>
        <div className="opts">
          {TEMPLATES.map((t) => (
            <button key={t.id} type="button" onClick={() => applyTemplate(t)} className="opt">
              <b>
                <t.icon className="text-primary" />
                {t.label}
              </b>
              <span>{t.desc}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="fld">
        <div className="flex items-center justify-between">
          <label>Index fields</label>
          <button
            type="button"
            onClick={() => setRawMode(!rawMode)}
            className="flex items-center gap-1 text-[11px] text-text-3 transition-colors hover:text-text"
          >
            {rawMode ? <LayoutList className="h-3 w-3" /> : <Code2 className="h-3 w-3" />}
            {rawMode ? "Visual builder" : "Raw JSON"}
          </button>
        </div>
        {rawMode ? (
          <input
            className="in"
            value={rawKeys}
            onChange={(e) => setRawKeys(e.target.value)}
            placeholder="{ email: 1, createdAt: -1 }"
            spellCheck={false}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-1.5">
                <input
                  className="in flex-1"
                  value={k.field}
                  onChange={(e) => setKeys((ks) => ks.map((x) => (x.id === k.id ? { ...x, field: e.target.value } : x)))}
                  placeholder="field name (e.g. email)"
                  spellCheck={false}
                />
                <Select value={k.type} onValueChange={(v) => setKeys((ks) => ks.map((x) => (x.id === k.id ? { ...x, type: v as KeyType } : x)))}>
                  <SelectTrigger className="w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KEY_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <button
                  type="button"
                  className="ico dgr shrink-0"
                  disabled={keys.length === 1}
                  onClick={() => setKeys((ks) => ks.filter((x) => x.id !== k.id))}
                  aria-label="Remove field"
                >
                  <X />
                </button>
              </div>
            ))}
            <button type="button" className="btn qt sm self-start" onClick={() => setKeys((ks) => [...ks, newKey()])}>
              <Plus />
              Add field
            </button>
          </div>
        )}
      </div>

      <div className="fld">
        <label htmlFor="idx-name">Name (optional)</label>
        <input id="idx-name" className="in" value={opts.name} onChange={(e) => set("name", e.target.value)} placeholder="auto-generated" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <OptToggle label="Unique" hint="Reject duplicate values" checked={opts.unique} onChange={(v) => set("unique", v)} />
        <OptToggle label="Sparse" hint="Skip docs missing the field" checked={opts.sparse} onChange={(v) => set("sparse", v)} />
        <OptToggle label="Case-insensitive" hint="Collation strength 2 (locale en)" checked={opts.caseInsensitive} onChange={(v) => set("caseInsensitive", v)} />
        <OptToggle
          label={
            <span className="flex items-center gap-1">
              <EyeOff className="h-3 w-3" /> Hidden
            </span>
          }
          hint="Built but ignored by the planner"
          checked={opts.hidden}
          onChange={(v) => set("hidden", v)}
        />
      </div>

      <div className="rounded-[var(--r-sm)] border border-line bg-bg p-2.5">
        <OptToggle label="TTL - expire documents" hint="Single ascending field on a Date" checked={opts.ttlEnabled} onChange={(v) => set("ttlEnabled", v)} />
        {opts.ttlEnabled && (
          <div className="mt-2 flex items-center gap-2">
            <input className="in w-32" type="number" min={1} value={opts.ttlSeconds} onChange={(e) => set("ttlSeconds", e.target.value)} />
            <span className="text-[11.5px] text-text-3">seconds after the date value</span>
          </div>
        )}
      </div>

      <div className="rounded-[var(--r-sm)] border border-line bg-bg p-2.5">
        <OptToggle label="Partial filter expression" hint="Only index docs matching a query" checked={opts.partialEnabled} onChange={(v) => set("partialEnabled", v)} />
        {opts.partialEnabled && (
          <input className="in mt-2" value={opts.partialText} onChange={(e) => set("partialText", e.target.value)} placeholder='{ "status": "active" }' spellCheck={false} />
        )}
      </div>

      <div className="fld">
        <label>Preview</label>
        <div className="notice mono">
          <code className="block break-all">
            db.{collection}.createIndex(<span className={cn(!canCreate && "text-danger")}>{keysText}</span>
            {Object.keys(preview).length > 0 && <>, {JSON.stringify(preview).replace(/"([^"]+)":/g, "$1: ")}</>})
          </code>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={onCreate} disabled={busy || !canCreate}>
          {busy && <Loader2 className="spin" />}
          Create index
        </Button>
      </div>
    </div>
  );
}

function OptToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: React.ReactNode;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <CheckRow on={checked} onChange={onChange} className="items-start">
      <span className="min-w-0 text-left">
        <span className="block text-[12px] font-medium leading-tight text-text">{label}</span>
        <span className="block text-[10.5px] leading-tight text-text-3">{hint}</span>
      </span>
    </CheckRow>
  );
}
