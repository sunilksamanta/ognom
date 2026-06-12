import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Code2,
  EyeOff,
  Hash,
  Loader2,
  MapPin,
  Plus,
  Sparkles,
  Type,
  Wand2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
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

interface IndexesSheetProps {
  tab: Tab;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
    icon: Sparkles,
    desc: "One field, ascending or descending",
    keys: () => [newKey("", "1")],
  },
  {
    id: "compound",
    label: "Compound",
    icon: Hash,
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
    icon: Sparkles,
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

export function IndexesSheet({ tab, open, onOpenChange }: IndexesSheetProps) {
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
      o.partialFilterExpression = "{…}";
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
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[680px]">
          <DialogHeader className="border-b px-5 py-4">
            <DialogTitle>Indexes &amp; stats</DialogTitle>
            <DialogDescription className="font-mono text-xs">
              {tab.database}.{tab.collection}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
            {stats && (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {(
                  [
                    ["Documents", formatCount(stats.count)],
                    ["Data", formatBytes(stats.size)],
                    ["Storage", formatBytes(stats.storageSize)],
                    ["Avg doc", formatBytes(stats.avgObjSize)],
                    ["Index size", formatBytes(stats.totalIndexSize)],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label} className="rounded-md border bg-muted/40 px-2.5 py-1.5">
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      {label}
                    </p>
                    <p className="text-sm font-semibold tabular-nums">{value}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">
                Indexes{indexes ? ` (${indexes.length})` : ""}
              </h4>
              {!creating && (
                <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
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
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {indexes.map((idx) => (
                  <div
                    key={idx.name}
                    className="group flex items-center gap-2 rounded-md border bg-card px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-sm font-medium">{idx.name}</span>
                        {idx.unique && <IdxBadge>unique</IdxBadge>}
                        {idx.sparse && <IdxBadge>sparse</IdxBadge>}
                        {idx.hidden && <IdxBadge>hidden</IdxBadge>}
                        {idx.partialFilter && <IdxBadge>partial</IdxBadge>}
                        {idx.ttlSeconds != null && <IdxBadge>ttl {idx.ttlSeconds}s</IdxBadge>}
                      </div>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {toShellText(idx.keys)}
                      </p>
                    </div>
                    {idx.name !== "_id_" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                        onClick={() => setDropping(idx.name)}
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
  return (
    <Badge variant="secondary" className="h-4 px-1 text-[10px] font-normal">
      {children}
    </Badge>
  );
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
    <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
      {/* Templates */}
      <div>
        <Label className="mb-2 block text-xs text-muted-foreground">Start from a template</Label>
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => applyTemplate(t)}
              className="flex items-start gap-2 rounded-md border bg-background px-2.5 py-2 text-left transition-colors hover:border-primary/50 hover:bg-accent"
            >
              <t.icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="text-xs font-medium leading-tight">{t.label}</p>
                <p className="truncate text-[10px] text-muted-foreground">{t.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      <Separator />

      {/* Keys */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-xs">Index fields</Label>
          <button
            onClick={() => setRawMode(!rawMode)}
            className="flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            {rawMode ? <Wand2 className="h-3 w-3" /> : <Code2 className="h-3 w-3" />}
            {rawMode ? "Visual builder" : "Raw JSON"}
          </button>
        </div>

        {rawMode ? (
          <Input
            value={rawKeys}
            onChange={(e) => setRawKeys(e.target.value)}
            className="h-8 font-mono text-xs"
            placeholder='{ email: 1, createdAt: -1 }'
            spellCheck={false}
          />
        ) : (
          <div className="space-y-1.5">
            {keys.map((k) => (
              <div key={k.id} className="flex items-center gap-1.5">
                <Input
                  value={k.field}
                  onChange={(e) =>
                    setKeys((ks) =>
                      ks.map((x) => (x.id === k.id ? { ...x, field: e.target.value } : x))
                    )
                  }
                  className="h-8 flex-1 font-mono text-xs"
                  placeholder="field name (e.g. email)"
                  spellCheck={false}
                />
                <Select
                  value={k.type}
                  onValueChange={(v) =>
                    setKeys((ks) =>
                      ks.map((x) => (x.id === k.id ? { ...x, type: v as KeyType } : x))
                    )
                  }
                >
                  <SelectTrigger className="h-8 w-[150px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {KEY_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value} className="text-xs">
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={keys.length === 1}
                  onClick={() => setKeys((ks) => ks.filter((x) => x.id !== k.id))}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={() => setKeys((ks) => [...ks, newKey()])}
            >
              <Plus className="h-3.5 w-3.5" />
              Add field
            </Button>
          </div>
        )}
      </div>

      <Separator />

      {/* Options */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label className="text-xs">Name (optional)</Label>
          <Input
            value={opts.name}
            onChange={(e) => set("name", e.target.value)}
            className="h-8 text-xs"
            placeholder="auto-generated"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <OptToggle
            label="Unique"
            hint="Reject duplicate values"
            checked={opts.unique}
            onChange={(v) => set("unique", v)}
          />
          <OptToggle
            label="Sparse"
            hint="Skip docs missing the field"
            checked={opts.sparse}
            onChange={(v) => set("sparse", v)}
          />
          <OptToggle
            label="Case-insensitive"
            hint="Collation strength 2 (locale en)"
            checked={opts.caseInsensitive}
            onChange={(v) => set("caseInsensitive", v)}
          />
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

        {/* TTL */}
        <div className="rounded-md border bg-background p-2.5">
          <OptToggle
            label="TTL — expire documents"
            hint="Single ascending field on a Date"
            checked={opts.ttlEnabled}
            onChange={(v) => set("ttlEnabled", v)}
          />
          {opts.ttlEnabled && (
            <div className="mt-2 flex items-center gap-2">
              <Input
                type="number"
                min={1}
                value={opts.ttlSeconds}
                onChange={(e) => set("ttlSeconds", e.target.value)}
                className="h-8 w-32 text-xs"
              />
              <span className="text-xs text-muted-foreground">seconds after the date value</span>
            </div>
          )}
        </div>

        {/* Partial filter */}
        <div className="rounded-md border bg-background p-2.5">
          <OptToggle
            label="Partial filter expression"
            hint="Only index docs matching a query"
            checked={opts.partialEnabled}
            onChange={(v) => set("partialEnabled", v)}
          />
          {opts.partialEnabled && (
            <Input
              value={opts.partialText}
              onChange={(e) => set("partialText", e.target.value)}
              className="mt-2 h-8 font-mono text-xs"
              placeholder='{ "status": "active" }'
              spellCheck={false}
            />
          )}
        </div>
      </div>

      {/* Preview */}
      <div className="rounded-md border border-dashed bg-background/60 px-3 py-2">
        <p className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">Preview</p>
        <code className="block break-all font-mono text-[11px] leading-relaxed text-foreground/90">
          db.{collection}.createIndex(
          <span className={cn(!canCreate && "text-destructive")}>{keysText}</span>
          {Object.keys(preview).length > 0 && (
            <>, {JSON.stringify(preview).replace(/"([^"]+)":/g, "$1: ")}</>
          )}
          )
        </code>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button size="sm" onClick={onCreate} disabled={busy || !canCreate}>
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
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
    <label className="flex cursor-pointer items-start gap-2">
      <Checkbox
        checked={checked}
        onCheckedChange={(v) => onChange(v === true)}
        className="mt-0.5"
      />
      <span className="min-w-0">
        <span className="block text-xs font-medium leading-tight">{label}</span>
        <span className="block text-[10px] leading-tight text-muted-foreground">{hint}</span>
      </span>
    </label>
  );
}
