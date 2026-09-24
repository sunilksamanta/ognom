import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { save } from "@tauri-apps/plugin-dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  Braces,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  FileCode2,
  Layers,
  Loader2,
  Monitor,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Shrink,
  X,
} from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { api, errMsg } from "@/lib/api";
import { formatCount } from "@/lib/bson";
import {
  BSONISH,
  DEFAULT_OPTIONS,
  elemPath,
  fieldPath,
  generate,
  hasKind,
  isOptional,
  looksLikeMap,
  suggestsUnion,
  typeName,
  type CodeLine,
  type GenOptions,
  type Overrides,
  type SchemaTree,
  type ShapeNode,
} from "@/lib/tsgen";
import { cn } from "@/lib/utils";

/**
 * Export types: turns a sampled collection shape into TypeScript interfaces or
 * Zod schemas. Left: the structure, where objects can be pulled out into their
 * own interfaces and each field tuned (ObjectId vs string, literal unions,
 * optional). Right: the generated code, live and read-only, with copy and
 * download. Choices are remembered per collection.
 */

interface TypeExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  database: string;
  collection: string;
}

const DEFAULTS_KEY = "ognom-tsgen-defaults";
const scopeKey = (db: string, coll: string) => `ognom-tsgen:${db}.${coll}`;

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable - choices just aren't remembered
  }
}

/** Remembered across collections: everything but the root name. */
type SharedOptions = Omit<GenOptions, "rootName">;

const KIND_COLOR: Record<string, string> = {
  string: "text-bson-string",
  int: "text-bson-number",
  long: "text-bson-number",
  double: "text-bson-number",
  decimal: "text-bson-number",
  bool: "text-bson-boolean",
  null: "text-bson-null",
  objectId: "text-bson-oid",
  date: "text-bson-date",
};

const KIND_LABEL: Record<string, string> = {
  int: "number",
  long: "number",
  double: "number",
  decimal: "decimal",
  bool: "boolean",
};

const NATIVE_LABEL: Record<string, string> = {
  objectId: "ObjectId",
  date: "Date",
  decimal: "Decimal128",
  binary: "Binary",
  timestamp: "Timestamp",
  regex: "RegExp",
};

/** Short type label for a tree row: "string", "object[]", "date | null". */
function summary(n: ShapeNode): { label: string; kind: string }[] {
  const out: { label: string; kind: string }[] = [];
  const seen = new Set<string>();
  for (const [k] of Object.entries(n.kinds).sort((a, b) => b[1] - a[1])) {
    let label = KIND_LABEL[k] ?? k;
    let kind = k;
    if (k === "array") {
      const inner = n.items ? summary(n.items) : [];
      const first = inner[0];
      label = inner.length === 0 ? "[]" : inner.length === 1 ? `${first.label}[]` : "mixed[]";
      kind = first?.kind ?? "array";
    }
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label, kind });
  }
  return out;
}

/** First BSON-ish kind at a field or in its array elements, with the path the override lives on. */
function bsonTarget(n: ShapeNode, path: string): { kind: string; path: string } | null {
  const own = Object.keys(n.kinds).find((k) => BSONISH.has(k));
  if (own) return { kind: own, path };
  const el = n.items && Object.keys(n.items.kinds).find((k) => BSONISH.has(k));
  if (el) return { kind: el, path: elemPath(path) };
  return null;
}

interface Row {
  path: string;
  name: string;
  depth: number;
  node: ShapeNode;
  present: number;
  objects: number;
  /** Object to extract (the field itself or its array elements). */
  objPath: string | null;
  /** Map toggle applies here (object-valued fields). */
  mapPath: string | null;
  childCount: number;
}

function buildRows(root: ShapeNode, ov: Overrides): Row[] {
  const rows: Row[] = [];
  const isMap = (n: ShapeNode, p: string) => ov[p]?.record ?? looksLikeMap(n);
  const walk = (obj: ShapeNode, parent: string, depth: number) => {
    for (const f of obj.fields) {
      const p = fieldPath(parent, f.name);
      const n = f.shape;
      const objectish = hasKind(n, "object") && n.fields.length > 0;
      const map = objectish && isMap(n, p);
      const elemObj = n.items && hasKind(n.items, "object") && n.items.fields.length > 0 ? n.items : null;
      const objPath = objectish && !map ? p : elemObj ? elemPath(p) : null;
      const childCount = (objectish && !map ? n.fields.length : 0) + (elemObj ? elemObj.fields.length : 0);
      rows.push({
        path: p,
        name: f.name,
        depth,
        node: n,
        present: f.present,
        objects: obj.objects,
        objPath,
        mapPath: objectish ? p : null,
        childCount,
      });
      if (objectish && !map) walk(n, p, depth + 1);
      if (elemObj) walk(elemObj, elemPath(p), depth + 1);
    }
  };
  walk(root, "", 0);
  return rows;
}

const isUnder = (path: string, parent: string) =>
  path === parent || path.startsWith(`${parent}.`) || path.startsWith(`${parent}[]`) || path.startsWith(`${parent}{}`);

export function TypeExportDialog({ open, onOpenChange, database, collection }: TypeExportDialogProps) {
  const [tree, setTree] = useState<SchemaTree | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sample, setSample] = useState(1000);
  const [opts, setOpts] = useState<GenOptions>({ ...DEFAULT_OPTIONS, rootName: typeName(collection, true) });
  const [ov, setOv] = useState<Overrides>({});
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  /** Skip the save pass that runs in the same commit as the restore (stale state). */
  const skipSave = useRef(true);

  const load = (size = sample) => {
    setLoading(true);
    setError(null);
    api
      .inferSchemaTree(database, collection, size)
      .then(setTree)
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  };

  // Open: restore remembered choices, then sample.
  useEffect(() => {
    if (!open) return;
    skipSave.current = true;
    const shared = readJson<Partial<SharedOptions>>(DEFAULTS_KEY) ?? {};
    const scoped = readJson<{ rootName?: string; ov?: Overrides }>(scopeKey(database, collection)) ?? {};
    setOpts({ ...DEFAULT_OPTIONS, ...shared, rootName: scoped.rootName || typeName(collection, true) });
    setOv(scoped.ov ?? {});
    setSelected(null);
    setFilter("");
    setCollapsed(new Set());
    setTree(null);
    load();
  }, [open, database, collection]); // eslint-disable-line react-hooks/exhaustive-deps

  // Remember choices.
  useEffect(() => {
    if (!open) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const { rootName, ...shared } = opts;
    writeJson(DEFAULTS_KEY, shared);
    writeJson(scopeKey(database, collection), { rootName, ov });
  }, [opts, ov, open, database, collection]);

  const result = useMemo(() => (tree ? generate(tree, opts, ov) : null), [tree, opts, ov]);
  const rows = useMemo(() => (tree ? buildRows(tree.root, ov) : []), [tree, ov]);

  const visibleRows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (f) {
      // Matches plus their ancestors, so every hit keeps its context.
      const hits = rows.filter((r) => r.name.toLowerCase().includes(f));
      return rows.filter((r) => hits.some((h) => isUnder(h.path, r.path)));
    }
    return rows.filter((r) => ![...collapsed].some((c) => r.path !== c && isUnder(r.path, c)));
  }, [rows, filter, collapsed]);

  const patch = useCallback((path: string, p: Partial<Overrides[string]>) =>
    setOv((cur) => {
      const next = { ...(cur[path] ?? {}), ...p };
      for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined) delete next[k];
      const out = { ...cur };
      if (Object.keys(next).length === 0) delete out[path];
      else out[path] = next;
      return out;
    }), []);
  const toggleCollapse = useCallback(
    (path: string) =>
      setCollapsed((c) => {
        const n = new Set(c);
        if (n.has(path)) n.delete(path);
        else n.add(path);
        return n;
      }),
    []
  );
  const set = <K extends keyof GenOptions>(k: K, v: GenOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));

  const extractAll = (on: boolean) =>
    setOv((cur) => {
      const out = { ...cur };
      for (const r of rows) {
        if (!r.objPath) continue;
        out[r.objPath] = { ...(out[r.objPath] ?? {}), extract: on || undefined };
        if (!on) delete out[r.objPath].extract;
        if (Object.keys(out[r.objPath]).length === 0) delete out[r.objPath];
      }
      return out;
    });

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      window.setTimeout(() => setCopied((c) => (c === what ? null : c)), 1400);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const fileName = `${collection.replace(/[^A-Za-z0-9_-]+/g, "-")}.${opts.format === "zod" ? "schema" : "types"}.ts`;
  const download = async () => {
    if (!result) return;
    const path = await save({ title: "Save types", defaultPath: fileName, filters: [{ name: "TypeScript", extensions: ["ts"] }] }).catch(() => null);
    if (!path) return;
    try {
      await api.saveTextFile(path, result.text);
      toast.success(`Saved ${path.split(/[\\/]/).pop()}`);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  const extractedCount = result ? result.decls.length - 1 : 0;
  const declText = (name: string) =>
    result ? result.lines.filter((l) => l.decl === name).map((l) => l.toks.map((t) => t.v).join("")).join("\n") + "\n" : "";

  // Selecting a field scrolls both panes to it.
  const codeRef = useRef<HTMLDivElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const reveal = useCallback((path: string, from: "tree" | "code") => {
    setSelected(path);
    requestAnimationFrame(() => {
      if (from === "tree") codeRef.current?.querySelector(`[data-path="${CSS.escape(path)}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      else treeRef.current?.querySelector(`[data-row="${CSS.escape(path)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, []);
  const pickFromTree = useCallback((path: string) => reveal(path, "tree"), [reveal]);
  const pickFromCode = useCallback((path: string) => reveal(path, "code"), [reveal]);
  const scrollToLine = (line: number) =>
    codeRef.current?.querySelector(`[data-ln="${line}"]`)?.scrollIntoView({ block: "start", behavior: "smooth" });

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dlg-ov fixed inset-0 z-50" />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <DialogPrimitive.Content
            className="dlg tg flex h-[min(88vh,900px)] w-full max-w-[1320px] flex-col overflow-hidden outline-none"
            onInteractOutside={(e) => e.preventDefault()}
            aria-describedby={undefined}
          >
            {/* header */}
            <div className="tg-hd">
              <div className="tg-mark">
                <FileCode2 />
              </div>
              <div className="min-w-0">
                <DialogPrimitive.Title className="tg-title">Export types</DialogPrimitive.Title>
                <div className="tg-sub">
                  {database}.{collection}
                  {tree && (
                    <>
                      {" "}· sampled {formatCount(tree.sampled)} docs · {rows.length} fields · {result?.decls.length ?? 1}{" "}
                      {opts.format === "zod" ? "schema" : opts.declaration === "type" ? "type" : "interface"}
                      {(result?.decls.length ?? 1) === 1 ? "" : "s"}
                    </>
                  )}
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Select
                  value={String(sample)}
                  onValueChange={(v) => {
                    setSample(Number(v));
                    load(Number(v));
                  }}
                >
                  <SelectTrigger className="h-8 w-auto min-w-[130px] text-xs">
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
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className="btn qt" style={{ height: 32, width: 32, padding: 0, justifyContent: "center" }} onClick={() => load()} disabled={loading} aria-label="Resample">
                      {loading ? <Loader2 className="spin" /> : <RefreshCw />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Take a fresh random sample</TooltipContent>
                </Tooltip>
              </div>
              <DialogPrimitive.Close className="ico" aria-label="Close">
                <X />
              </DialogPrimitive.Close>
            </div>

            {/* toolbar */}
            <div className="tg-bar">
              <div className="seg no-select">
                <button className={cn(opts.format === "typescript" && "on")} onClick={() => set("format", "typescript")}>
                  TypeScript
                </button>
                <button className={cn(opts.format === "zod" && "on")} onClick={() => set("format", "zod")}>
                  Zod
                </button>
              </div>
              <div className="seg no-select">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className={cn(opts.target === "backend" && "on")} onClick={() => set("target", "backend")}>
                      <Server /> Node.js backend
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>ObjectId, Date, Decimal128 as the driver returns them</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button className={cn(opts.target === "frontend" && "on")} onClick={() => set("target", "frontend")}>
                      <Monitor /> Frontend
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>JSON over the wire: ObjectId and dates as strings</TooltipContent>
                </Tooltip>
              </div>
              {opts.target === "backend" && (
                <Select value={opts.oidSource} onValueChange={(v) => set("oidSource", v as GenOptions["oidSource"])}>
                  <SelectTrigger className="h-8 w-auto min-w-[150px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mongodb" className="text-xs">from "mongodb"</SelectItem>
                    <SelectItem value="bson" className="text-xs">from "bson"</SelectItem>
                    <SelectItem value="mongoose" className="text-xs">from "mongoose"</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <span className="tg-sep" />
              {opts.format === "typescript" && (
                <div className="seg no-select">
                  <button className={cn(opts.declaration === "interface" && "on")} onClick={() => set("declaration", "interface")}>
                    interface
                  </button>
                  <button className={cn(opts.declaration === "type" && "on")} onClick={() => set("declaration", "type")}>
                    type
                  </button>
                </div>
              )}
              <Toggle on={opts.exported} onClick={() => set("exported", !opts.exported)} tip="Prefix declarations with export">
                export
              </Toggle>
              <Toggle on={opts.optional} onClick={() => set("optional", !opts.optional)} tip="Fields missing from some sampled documents become optional">
                optional ?
              </Toggle>
              <Toggle on={opts.nullable} onClick={() => set("nullable", !opts.nullable)} tip="Keep null in the type when a field was null in the sample">
                | null
              </Toggle>
              <Toggle on={opts.comments} onClick={() => set("comments", !opts.comments)} tip="Coverage and example values as comments">
                comments
              </Toggle>
            </div>

            {error ? (
              <div className="p-6">
                <div className="notice dgr mono">{error}</div>
              </div>
            ) : !tree || !result ? (
              <LoadingState sample={sample} />
            ) : tree.sampled === 0 ? (
              <div className="grid flex-1 place-items-center text-[12.5px] text-text-3">This collection is empty - nothing to infer types from.</div>
            ) : (
              <div className="tg-grid">
                {/* structure */}
                <aside className="tg-side">
                  <div className="tg-side-hd">
                    <label className="tg-lbl">Root type</label>
                    <div className="in sans" style={{ height: 32 }}>
                      <Braces className="h-3.5 w-3.5 shrink-0 text-accent" />
                      <input
                        className="h-full min-w-0 flex-1 bg-transparent font-mono text-[12.5px] outline-none"
                        value={opts.rootName}
                        onChange={(e) => set("rootName", e.target.value)}
                        onBlur={() => set("rootName", typeName(opts.rootName || collection, !opts.rootName))}
                        spellCheck={false}
                      />
                    </div>

                    <div className="tg-decls">
                      {result.decls.map((d) => (
                        <div key={d.path || "root"} className={cn("tg-decl", d.path === "" && "root")}>
                          <button className="tg-decl-name" onClick={() => scrollToLine(d.line)} title="Jump to declaration">
                            {d.name}
                            <span>{d.fields}</span>
                          </button>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button className="tg-decl-act" onClick={() => void copy(declText(d.name), d.name)} aria-label={`Copy ${d.name}`}>
                                {copied === d.name ? <Check /> : <Copy />}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Copy {d.name}</TooltipContent>
                          </Tooltip>
                          {d.path !== "" && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button className="tg-decl-act" onClick={() => patch(d.path, { extract: undefined, name: undefined })} aria-label={`Inline ${d.name}`}>
                                  <Shrink />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>Inline back into its parent</TooltipContent>
                            </Tooltip>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="flex items-center gap-1.5">
                      <div className="in sans flex-1" style={{ height: 30, gap: 7 }}>
                        <Search className="h-3.5 w-3.5 shrink-0 text-text-3" />
                        <input
                          className="h-full min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-text-3"
                          placeholder="Filter fields"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        />
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button className="tg-mini" onClick={() => extractAll(true)} aria-label="Extract all">
                            <Layers />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Extract every nested object into its own {opts.format === "zod" ? "schema" : "interface"}</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button className="tg-mini" onClick={() => extractAll(false)} disabled={extractedCount === 0} aria-label="Inline all">
                            <Shrink />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Inline everything into one nested type</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button className="tg-mini" onClick={() => setOv({})} disabled={Object.keys(ov).length === 0} aria-label="Reset">
                            <RotateCcw />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent>Reset every per-field choice</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>

                  <div className="tg-tree" ref={treeRef} onMouseLeave={() => setHover(null)}>
                    {visibleRows.map((r) => (
                      <TreeRow
                        key={r.path}
                        row={r}
                        opts={opts}
                        ov={ov}
                        declName={r.objPath ? result.decls.find((d) => d.path === r.objPath)?.name : undefined}
                        selected={selected !== null && isUnder(r.path, selected)}
                        exact={selected === r.path}
                        hovered={hover === r.path}
                        collapsed={collapsed.has(r.path)}
                        onToggleCollapse={toggleCollapse}
                        onSelect={pickFromTree}
                        onHover={setHover}
                        patch={patch}
                      />
                    ))}
                    {visibleRows.length === 0 && <p className="py-6 text-center text-[12px] text-text-3">No matching fields</p>}
                  </div>
                </aside>

                {/* code */}
                <section className="tg-main">
                  <div className="tg-code-hd">
                    <span className="tg-file">
                      <FileCode2 />
                      {fileName}
                    </span>
                    <span className="tg-meta">{result.lines.length} lines</span>
                    <div className="ml-auto flex items-center gap-2">
                      <button className="btn qt" onClick={() => void download()}>
                        <Download />
                        Save .ts
                      </button>
                      <button className={cn("btn pri", copied === "all" && "tg-copied")} onClick={() => void copy(result.text, "all")}>
                        {copied === "all" ? <Check /> : <Copy />}
                        {copied === "all" ? "Copied" : "Copy code"}
                      </button>
                    </div>
                  </div>
                  <CodeView lines={result.lines} selected={selected} hover={hover} codeRef={codeRef} onPick={pickFromCode} onHover={setHover} />
                </section>
              </div>
            )}

            <div className="tg-ft">
              <span>
                Inferred from a random sample - fields missing from some documents are optional. Click a field on either side to
                find it on the other.
              </span>
              <DialogPrimitive.Close className="btn ml-auto">Close</DialogPrimitive.Close>
            </div>
          </DialogPrimitive.Content>
        </div>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function Toggle({ on, onClick, tip, children }: { on: boolean; onClick: () => void; tip: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button className={cn("tg-tog", on && "on")} onClick={onClick} aria-pressed={on}>
          <i />
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  );
}

function LoadingState({ sample }: { sample: number }) {
  return (
    <div className="tg-grid">
      <aside className="tg-side p-4">
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="tg-skel" style={{ width: `${55 + ((i * 37) % 40)}%`, marginLeft: (i % 3) * 14 }} />
        ))}
      </aside>
      <section className="tg-main grid place-items-center">
        <div className="flex items-center gap-2 text-[12.5px] text-text-3">
          <Loader2 className="spin h-4 w-4" />
          Sampling {formatCount(sample)} documents...
        </div>
      </section>
    </div>
  );
}

interface TreeRowProps {
  row: Row;
  opts: GenOptions;
  ov: Overrides;
  declName?: string;
  selected: boolean;
  exact: boolean;
  hovered: boolean;
  collapsed: boolean;
  onToggleCollapse: (path: string) => void;
  onSelect: (path: string) => void;
  onHover: (path: string | null) => void;
  patch: (path: string, p: Partial<Overrides[string]>) => void;
}

const TreeRow = memo(function TreeRow({ row, opts, ov, declName, selected, exact, hovered, collapsed, onToggleCollapse, onSelect, onHover, patch }: TreeRowProps) {
  const { node, path, objPath } = row;
  const kinds = summary(node);
  const coverage = row.objects ? row.present / row.objects : 1;
  const optional = isOptional({ opts, ov }, path, row.present, row.objects);
  const autoOptional = opts.optional && row.present < row.objects;
  const extracted = !!(objPath && ov[objPath]?.extract);
  const bson = bsonTarget(node, path);
  const bsonAs = bson ? ov[bson.path]?.as ?? (opts.target === "backend" ? "native" : "string") : null;
  const unionable = !!node.values && node.values.length >= 2 && hasKind(node, "string");
  const union = !!ov[path]?.union;
  const map = row.mapPath ? ov[row.mapPath]?.record ?? looksLikeMap(node) : false;
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  return (
    <div
      className={cn("tg-row", selected && "sel", exact && "exact", hovered && "hov", extracted && "ext")}
      data-row={path}
      onClick={() => onSelect(path)}
      onMouseEnter={() => onHover(path)}
    >
      <div className="tg-row-main" style={{ paddingLeft: 8 + row.depth * 16 }}>
        {Array.from({ length: row.depth }, (_, i) => (
          <span key={i} className="tg-guide" style={{ left: 15 + i * 16 }} />
        ))}
        {row.childCount > 0 ? (
          <button
            className="tg-chev"
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(path);
            }}
            aria-label={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronRight /> : <ChevronDown />}
          </button>
        ) : (
          <span className="tg-chev" />
        )}
        <span className="tg-name">{row.name}</span>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={cn("tg-opt", optional && "on", ov[path]?.optional !== undefined && "set")}
              onClick={(e) => {
                e.stopPropagation();
                const next = !optional;
                patch(path, { optional: next === autoOptional ? undefined : next });
              }}
              aria-label="Toggle optional"
            >
              ?
            </button>
          </TooltipTrigger>
          <TooltipContent>
            {optional ? "Optional" : "Required"} - in {Math.round(coverage * 100)}% of documents. Click to make it {optional ? "required" : "optional"}.
          </TooltipContent>
        </Tooltip>
        <span className="tg-kinds">
          {kinds.slice(0, 3).map((k) => (
            <span key={k.label} className={cn("tt", KIND_COLOR[k.kind])}>
              {k.label}
            </span>
          ))}
        </span>
        {coverage < 1 && <span className="tg-cov">{Math.round(coverage * 100)}%</span>}
      </div>

      {(objPath || bson || unionable || row.mapPath) && (
        <div className="tg-row-ctl" onClick={(e) => e.stopPropagation()} style={{ paddingLeft: 30 + row.depth * 16 }}>
          {objPath && (
            <button
              className={cn("tg-chip", extracted && "on")}
              onClick={() => patch(objPath, { extract: extracted ? undefined : true })}
              title={extracted ? "Inline it back" : `Extract into its own ${opts.format === "zod" ? "schema" : "interface"}`}
            >
              <Braces />
              {extracted ? "extracted" : "extract"}
            </button>
          )}
          {extracted && (
            <span className="tg-as">
              →
              <input
                value={nameDraft ?? declName ?? ""}
                onChange={(e) => setNameDraft(e.target.value)}
                onFocus={() => setNameDraft(declName ?? "")}
                onBlur={() => {
                  if (nameDraft !== null) patch(objPath!, { name: nameDraft.trim() ? typeName(nameDraft) : undefined });
                  setNameDraft(null);
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                spellCheck={false}
                size={Math.max(4, (nameDraft ?? declName ?? "").length)}
              />
            </span>
          )}
          {row.mapPath && !extracted && (map || looksLikeMap(node) || node.fields.length >= 8) && (
            <button
              className={cn("tg-chip", map && "on")}
              onClick={() => patch(row.mapPath!, { record: !map === looksLikeMap(node) ? undefined : !map })}
              title="Dynamic keys: type it as Record<string, T>"
            >
              {"Record<>"}
            </button>
          )}
          {bson && bsonAs && (
            <span className="tg-sw">
              {(["native", "string"] as const).map((v) => (
                <button
                  key={v}
                  className={cn(bsonAs === v && "on")}
                  onClick={() => {
                    const auto = opts.target === "backend" ? "native" : "string";
                    patch(bson.path, { as: v === auto ? undefined : v });
                  }}
                >
                  {v === "native" ? NATIVE_LABEL[bson.kind] ?? "native" : "string"}
                </button>
              ))}
            </span>
          )}
          {unionable && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className={cn("tg-chip", union && "on", !union && suggestsUnion(node) && "hint")}
                  onClick={() => patch(path, { union: union ? undefined : true })}
                >
                  {opts.format === "zod" ? "z.enum" : "union"} · {node.values!.length}
                </button>
              </TooltipTrigger>
              <TooltipContent>
                <div className="max-w-[280px] font-mono text-[11px]">
                  {node.values!.slice(0, 12).map(([v, n]) => (
                    <div key={v} className="flex gap-3">
                      <span className="truncate">{JSON.stringify(v)}</span>
                      <span className="ml-auto text-text-3">{formatCount(n)}</span>
                    </div>
                  ))}
                  {!union && <div className="mt-1 text-text-3">Click to emit these as a literal union</div>}
                </div>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      )}
    </div>
  );
});

interface CodeViewProps {
  lines: CodeLine[];
  selected: string | null;
  hover: string | null;
  codeRef: React.RefObject<HTMLDivElement | null>;
  onPick: (path: string) => void;
  onHover: (path: string | null) => void;
}

/** Highlighted, read-only code. Lines that changed since the last render
 *  flash briefly, so each click on the left visibly lands on the right. */
function CodeView({ lines, selected, hover, codeRef, onPick, onHover }: CodeViewProps) {
  const prev = useRef<Map<string, number> | null>(null);
  const texts = useMemo(() => lines.map((l) => l.toks.map((t) => t.v).join("")), [lines]);
  const changed = useMemo(() => {
    const before = prev.current;
    const out = new Set<number>();
    if (before) {
      const pool = new Map(before);
      texts.forEach((t, i) => {
        const n = pool.get(t) ?? 0;
        if (n > 0) pool.set(t, n - 1);
        else if (t.trim()) out.add(i);
      });
    }
    // A wholesale change (format / target switch) reads better without a flash.
    return out.size > texts.length * 0.4 ? new Set<number>() : out;
  }, [texts]);
  useEffect(() => {
    const m = new Map<string, number>();
    for (const t of texts) m.set(t, (m.get(t) ?? 0) + 1);
    prev.current = m;
  }, [texts]);

  const width = String(lines.length).length;
  return (
    <div className="tg-code" ref={codeRef} onMouseLeave={() => onHover(null)}>
      {lines.map((l, i) => {
        const sel = selected !== null && l.path !== undefined && isUnder(l.path, selected);
        return (
          <div
            key={`${i}:${texts[i]}`}
            data-ln={i}
            data-path={l.path}
            className={cn("tg-line", sel && "sel", l.path !== undefined && hover === l.path && "hov", changed.has(i) && "flash", l.path && "tg-pick")}
            onClick={() => l.path && onPick(l.path)}
            onMouseEnter={() => onHover(l.path ?? null)}
          >
            <span className="tg-ln">{String(i + 1).padStart(width, " ")}</span>
            <span className="tg-src">
              {l.toks.length === 0 ? " " : l.toks.map((t, j) => <span key={j} className={`k-${t.k}`}>{t.v}</span>)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
