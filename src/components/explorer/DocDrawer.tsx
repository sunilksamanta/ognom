import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CodeEditor } from "@/components/CodeEditor";
import { useExplorer, type Tab } from "@/stores/explorer";
import { useConnections } from "@/stores/connections";
import { DRAWER_DEFAULT, DRAWER_MAX, DRAWER_MIN, useSettings } from "@/stores/settings";
import { api, errMsg, type Doc } from "@/lib/api";
import { docId, idLabel, kindOf, leafText, toShellText, dateOf, type BsonKind } from "@/lib/bson";
import { diffDocs, previewValue } from "@/lib/diff";
import { cn } from "@/lib/utils";

type Seg = "fields" | "json" | "diff";

const TYPE_ABBR: Partial<Record<BsonKind, string>> = {
  string: "str",
  number: "int",
  long: "long",
  double: "dbl",
  decimal: "dec",
  boolean: "bool",
  null: "null",
  objectId: "oid",
  uuid: "uuid",
  date: "date",
  binary: "bin",
  timestamp: "ts",
  regex: "regex",
  object: "obj",
  array: "arr",
  code: "code",
  minKey: "min",
  maxKey: "max",
};

const VALUE_CLASS: Partial<Record<BsonKind, string>> = {
  string: "st",
  number: "nu",
  long: "nu",
  double: "nu",
  decimal: "nu",
  boolean: "bo",
  null: "p",
  objectId: "oi",
  uuid: "oi",
  date: "dt",
  binary: "dt",
  timestamp: "dt",
  regex: "st",
};

/** Kinds that can be edited inline as text while preserving their type. */
const EDITABLE: BsonKind[] = ["string", "number", "long", "double", "decimal", "boolean", "null", "objectId", "date"];

/** Turn edited text back into a value of the same BSON kind, or throw. */
function parseLeaf(text: string, kind: BsonKind, original: unknown): unknown {
  const t = text.trim();
  switch (kind) {
    case "string":
      return text;
    case "number": {
      if (t === "") throw new Error("Enter a number");
      const n = Number(t);
      if (Number.isNaN(n)) throw new Error(`"${t}" is not a number`);
      return n;
    }
    case "long":
      if (!/^-?\d+$/.test(t)) throw new Error("Long needs an integer");
      return { $numberLong: t };
    case "double":
      if (Number.isNaN(Number(t))) throw new Error("Not a number");
      return { $numberDouble: t };
    case "decimal":
      if (Number.isNaN(Number(t))) throw new Error("Not a decimal");
      return { $numberDecimal: t };
    case "boolean":
      if (t === "true") return true;
      if (t === "false") return false;
      throw new Error("Use true or false");
    case "null":
      if (t === "null" || t === "") return null;
      // Typing into a null turns it into a string.
      return text;
    case "objectId":
      if (!/^[0-9a-fA-F]{24}$/.test(t)) throw new Error("ObjectId needs 24 hex characters");
      return { $oid: t.toLowerCase() };
    case "date": {
      const d = new Date(t);
      if (Number.isNaN(d.getTime())) throw new Error("Not a valid date - use ISO 8601");
      return { $date: d.toISOString() };
    }
    default:
      return original;
  }
}

/** Editable text for a leaf (ISO for dates so it round-trips). */
function editText(v: unknown, kind: BsonKind): string {
  if (kind === "date") return dateOf(v)?.toISOString() ?? leafText(v);
  return leafText(v);
}

const setAtPath = (root: Doc, path: (string | number)[], value: unknown): Doc => {
  const clone = structuredClone(root);
  let cur: unknown = clone;
  for (let i = 0; i < path.length - 1; i++) {
    cur = (cur as Record<string, unknown>)[path[i] as string];
  }
  (cur as Record<string, unknown>)[path[path.length - 1] as string] = value;
  return clone;
};

const deleteAtPath = (root: Doc, path: (string | number)[]): Doc => {
  const clone = structuredClone(root);
  let cur: unknown = clone;
  for (let i = 0; i < path.length - 1; i++) {
    cur = (cur as Record<string, unknown>)[path[i] as string];
  }
  const last = path[path.length - 1];
  if (Array.isArray(cur)) cur.splice(last as number, 1);
  else delete (cur as Record<string, unknown>)[last as string];
  return clone;
};

// ---------------------------------------------------------------------------
// Field rows
// ---------------------------------------------------------------------------

function FieldRow({
  name,
  value,
  path,
  depth,
  readOnly,
  onChange,
  onRemove,
}: {
  name: string;
  value: unknown;
  path: (string | number)[];
  depth: number;
  readOnly: boolean;
  onChange: (path: (string | number)[], value: unknown) => void;
  onRemove: (path: (string | number)[]) => void;
}) {
  const kind = kindOf(value);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(depth < 1);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isId = path.length === 1 && path[0] === "_id";
  const canEdit = !readOnly && !isId && EDITABLE.includes(kind);

  const start = () => {
    if (!canEdit) return;
    setText(editText(value, kind));
    setEditing(true);
  };
  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    if (!editing) return;
    try {
      const next = parseLeaf(text, kind, value);
      if (JSON.stringify(next) !== JSON.stringify(value)) onChange(path, next);
      setEditing(false);
    } catch (e) {
      toast.error(errMsg(e));
    }
  };

  if (kind === "object" || kind === "array") {
    const entries: [string | number, unknown][] =
      kind === "array"
        ? (value as unknown[]).map((v, i) => [i, v])
        : Object.entries(value as Record<string, unknown>);
    return (
      <>
        <div className="fgroup" onClick={() => setOpen((o) => !o)} style={{ paddingLeft: 6 + depth * 14 }}>
          {open ? <ChevronDown /> : <ChevronRight />}
          <span className="ky">{name}</span>
          <span className="tt">
            {TYPE_ABBR[kind]} · {entries.length}
          </span>
          {!readOnly && !isId && (
            <button
              className="ico sm ml-auto opacity-0 hover:!opacity-100 [.fgroup:hover_&]:opacity-60"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(path);
              }}
              aria-label="Remove field"
            >
              <X />
            </button>
          )}
        </div>
        {open &&
          entries.map(([k, v]) => (
            <FieldRow
              key={String(k)}
              name={String(k)}
              value={v}
              path={[...path, k]}
              depth={depth + 1}
              readOnly={readOnly}
              onChange={onChange}
              onRemove={onRemove}
            />
          ))}
      </>
    );
  }

  return (
    <div className={cn("frow group/row", editing && "edit", !canEdit && "ro")}>
      <div className="fk" style={{ paddingLeft: depth * 14 }} title={name}>
        <span className="truncate">{name}</span>
        <span className="tt">{TYPE_ABBR[kind] ?? kind}</span>
      </div>
      <div className="relative">
        <div
          className={cn("fv", VALUE_CLASS[kind])}
          onClick={start}
          onKeyDown={(e) => e.key === "Enter" && !editing && start()}
          tabIndex={canEdit ? 0 : -1}
          title={canEdit ? "Click to edit" : undefined}
        >
          {editing ? (
            <textarea
              ref={inputRef}
              value={text}
              rows={Math.min(6, Math.max(1, text.split("\n").length))}
              onChange={(e) => setText(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  commit();
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setEditing(false);
                }
              }}
              spellCheck={false}
            />
          ) : kind === "string" ? (
            `"${leafText(value)}"`
          ) : (
            leafText(value)
          )}
        </div>
        {!readOnly && !isId && !editing && (
          <button
            className="ico sm absolute -right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/row:opacity-60 hover:!opacity-100"
            onClick={() => onRemove(path)}
            aria-label="Remove field"
            tabIndex={-1}
          >
            <X />
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Drawer
// ---------------------------------------------------------------------------

/**
 * Document drawer: Fields (inline editing that preserves BSON types), JSON
 * (full editor in shell syntax) and Diff against the loaded document. Insert
 * mode opens straight into JSON.
 */
export function DocDrawer({ tab }: { tab: Tab }) {
  const setDrawer = useExplorer((s) => s.setDrawer);
  const runFind = useExplorer((s) => s.runFind);
  const runAggregate = useExplorer((s) => s.runAggregate);
  const runShell = useExplorer((s) => s.runShell);
  const readOnly = useConnections(
    (s) => s.workspaces.find((w) => w.info.id === s.activeId)?.readOnly ?? false
  );
  const { drawerWidth, setDrawerWidth } = useSettings();
  const [liveWidth, setLiveWidth] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const drawer = tab.drawer;
  const isInsert = drawer.kind === "insert";
  const original: Doc | null = drawer.kind === "doc" ? drawer.doc : null;

  const [seg, setSeg] = useState<Seg>("fields");
  const [draft, setDraft] = useState<Doc>({});
  const [text, setText] = useState("");
  const [jsonDirty, setJsonDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addValue, setAddValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset when the drawer target changes.
  const targetKey = drawer.kind === "doc" ? JSON.stringify(drawer.doc._id ?? drawer.doc) : drawer.kind === "insert" ? `insert:${JSON.stringify(drawer.template?._id ?? Math.random())}` : "closed";
  useEffect(() => {
    setError(null);
    setJsonDirty(false);
    setAddOpen(false);
    if (drawer.kind === "doc") {
      setDraft(structuredClone(drawer.doc));
      setText(toShellText(drawer.doc));
      setSeg(drawer.view ?? "fields");
    } else if (drawer.kind === "insert") {
      const base: Doc = drawer.template ? (({ _id: _drop, ...rest }) => rest)(drawer.template) : {};
      setDraft(base);
      setText(drawer.template ? toShellText(base) : "{\n  \n}");
      setSeg("json");
    }
  }, [targetKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const fieldsDirty = useMemo(
    () => (original ? JSON.stringify(original) !== JSON.stringify(draft) : false),
    [original, draft]
  );
  const changes = useMemo(() => (original && !jsonDirty ? diffDocs(original, draft) : []), [original, draft, jsonDirty]);
  const dirty = jsonDirty || fieldsDirty || isInsert;

  // Entering the JSON view re-serialises field edits; leaving it with text
  // edits keeps the text as the source of truth (fields become read-only).
  const goTo = (next: Seg) => {
    if (next === "json" && !jsonDirty) setText(toShellText(draft));
    setSeg(next);
  };

  const close = () => setDrawer(tab.id, { kind: "closed" });

  const refresh = () => {
    if (drawer.kind === "doc" && drawer.source === "agg") void runAggregate(tab.id);
    else if (drawer.kind === "doc" && drawer.source === "shell") void runShell(tab.id);
    else void runFind(tab.id);
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = jsonDirty || seg === "json" || isInsert ? text : toShellText(draft);
      if (isInsert) {
        await api.insertDocument(tab.database, tab.collection, body);
        toast.success("Document inserted");
        close();
      } else if (original) {
        await api.replaceDocument(tab.database, tab.collection, docId(original), body);
        toast.success("Document saved");
        close();
      }
      refresh();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const discard = () => {
    if (isInsert) return close();
    if (original) {
      setDraft(structuredClone(original));
      setText(toShellText(original));
      setJsonDirty(false);
      setError(null);
    }
  };

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = drawerWidth;
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const clamp = (w: number) => Math.min(DRAWER_MAX, Math.max(DRAWER_MIN, w));
    const onMove = (ev: MouseEvent) => setLiveWidth(clamp(startWidth - (ev.clientX - startX)));
    const onUp = (ev: MouseEvent) => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDrawerWidth(clamp(startWidth - (ev.clientX - startX)));
      setLiveWidth(null);
      setDragging(false);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // Keyboard: Cmd/Ctrl+S saves, Esc closes when clean.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty && !busy && !readOnly) void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }); // intentionally re-bound each render to capture the latest closures

  if (drawer.kind === "closed") return null;

  const rootEntries = Object.entries(draft);
  const idText = original ? idLabel(original) : "new document";

  const addField = () => {
    const name = addName.trim();
    if (!name) return;
    if (name in draft) return void toast.error(`"${name}" already exists`);
    // Best-effort typing of the new value: number, boolean, null, else string.
    const v = addValue.trim();
    let value: unknown = addValue;
    if (v === "true" || v === "false") value = v === "true";
    else if (v === "null") value = null;
    else if (v !== "" && !Number.isNaN(Number(v))) value = Number(v);
    else if (/^[0-9a-fA-F]{24}$/.test(v)) value = { $oid: v.toLowerCase() };
    setDraft((d) => ({ ...d, [name]: value }));
    setAddName("");
    setAddValue("");
    setAddOpen(false);
  };

  return (
    <aside className="drawer" style={{ width: liveWidth ?? drawerWidth }}>
      <div className={cn("rz", dragging && "on")} onMouseDown={startResize} onDoubleClick={() => setDrawerWidth(DRAWER_DEFAULT)} />
      <div className="dhd no-select">
        <div className="t">
          {tab.collection}
          <span title={idText}>{isInsert ? "new document" : idText}</span>
        </div>
        <div className="r">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="ico"
                onClick={() => {
                  void navigator.clipboard.writeText(jsonDirty || seg === "json" ? text : toShellText(draft));
                  toast.success("Document copied");
                }}
                aria-label="Copy document"
              >
                <Copy />
              </button>
            </TooltipTrigger>
            <TooltipContent>Copy document</TooltipContent>
          </Tooltip>
          {!isInsert && !readOnly && original && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="ico dgr" onClick={() => setConfirmDelete(true)} aria-label="Delete document">
                  <Trash2 />
                </button>
              </TooltipTrigger>
              <TooltipContent>Delete this document</TooltipContent>
            </Tooltip>
          )}
          <button className="ico" onClick={close} aria-label="Close drawer">
            <X />
          </button>
        </div>
      </div>

      <div className="dseg no-select">
        <button className={cn(seg === "fields" && "on")} onClick={() => goTo("fields")}>
          Fields
        </button>
        <button className={cn(seg === "json" && "on")} onClick={() => goTo("json")}>
          JSON
        </button>
        {!isInsert && (
          <button className={cn(seg === "diff" && "on")} onClick={() => goTo("diff")}>
            Diff{changes.length > 0 && ` · ${changes.length}`}
          </button>
        )}
      </div>

      {seg === "fields" && (
        <div className="dbody">
          {jsonDirty ? (
            <div className="notice warn m-1">
              <span>
                You edited this document as JSON. Save or discard those changes to go back to field editing.
              </span>
            </div>
          ) : (
            <>
              {rootEntries.length === 0 && (
                <p className="px-2 py-6 text-center text-[12px] text-text-3">
                  {isInsert ? "Add fields below, or switch to JSON." : "Empty document"}
                </p>
              )}
              {rootEntries.map(([k, v]) => (
                <FieldRow
                  key={k}
                  name={k}
                  value={v}
                  path={[k]}
                  depth={0}
                  readOnly={readOnly}
                  onChange={(path, value) => setDraft((d) => setAtPath(d, path, value))}
                  onRemove={(path) => setDraft((d) => deleteAtPath(d, path))}
                />
              ))}
              {!readOnly &&
                (addOpen ? (
                  <div className="frow edit">
                    <div className="fk">
                      <input
                        className="in"
                        style={{ height: 28, padding: "0 8px", fontSize: 11.5 }}
                        placeholder="field"
                        value={addName}
                        onChange={(e) => setAddName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addField()}
                        autoFocus
                      />
                    </div>
                    <div className="hstack">
                      <input
                        className="in"
                        style={{ height: 28, padding: "0 8px", fontSize: 11.5 }}
                        placeholder="value"
                        value={addValue}
                        onChange={(e) => setAddValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addField();
                          if (e.key === "Escape") setAddOpen(false);
                        }}
                      />
                      <button className="btn pri sm" onClick={addField} disabled={!addName.trim()}>
                        Add
                      </button>
                    </div>
                  </div>
                ) : (
                  <button className="frow w-full text-left" style={{ opacity: 0.6 }} onClick={() => setAddOpen(true)}>
                    <div className="fk">
                      <Plus style={{ width: 12, height: 12 }} /> add field
                    </div>
                    <div className="fv" style={{ background: "transparent" }}>
                      value
                    </div>
                  </button>
                ))}
            </>
          )}
        </div>
      )}

      {seg === "json" && (
        <div className="flex min-h-0 flex-1 flex-col">
          <CodeEditor
            bare
            className="h-full min-h-0 flex-1"
            value={text}
            readOnly={readOnly}
            onChange={(v) => {
              setText(v);
              setJsonDirty(true);
              if (error) setError(null);
            }}
            onRun={() => dirty && !busy && !readOnly && void save()}
            height="100%"
            autoFocus={isInsert}
            path={`drawer/${tab.id}/${targetKey}`}
          />
        </div>
      )}

      {seg === "diff" && (
        <div className="dbody">
          {jsonDirty ? (
            <div className="notice m-1">
              <span>Structural diff is available for field edits. JSON edits are compared on save.</span>
            </div>
          ) : changes.length === 0 ? (
            <p className="px-2 py-6 text-center text-[12px] text-text-3">No changes yet</p>
          ) : (
            changes.map((c) => (
              <div key={c.path} className="frow ro" style={{ gridTemplateColumns: "1fr" }}>
                <div className="fk">{c.path}</div>
                <div className="flex flex-col gap-1">
                  {c.left !== undefined && (
                    <div className="fv" style={{ borderColor: "color-mix(in oklab, var(--danger) 35%, transparent)" }}>
                      <span className="text-danger">- </span>
                      {previewValue(c.left)}
                    </div>
                  )}
                  {c.right !== undefined && (
                    <div className="fv" style={{ borderColor: "color-mix(in oklab, var(--ok) 35%, transparent)" }}>
                      <span className="text-ok">+ </span>
                      {previewValue(c.right)}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {error && (
        <div className="notice dgr mono mx-3 mb-2 shrink-0">
          <span className="min-w-0 break-all">{error}</span>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete document?"
        description={
          <>
            <span className="mono">_id {idText}</span> will be removed from {tab.database}.{tab.collection}. It cannot
            be undone from Ognom.
          </>
        }
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={async () => {
          if (!original) return;
          setBusy(true);
          try {
            await api.deleteDocument(tab.database, tab.collection, docId(original));
            toast.success("Document deleted");
            setConfirmDelete(false);
            close();
            refresh();
          } catch (e) {
            toast.error(errMsg(e));
          } finally {
            setBusy(false);
          }
        }}
      />

      <div className="dfoot no-select">
        <span className="chg">
          {readOnly
            ? "read-only"
            : isInsert
              ? "new document"
              : jsonDirty
                ? "edited as JSON"
                : changes.length > 0
                  ? `${changes.length} field${changes.length === 1 ? "" : "s"} changed`
                  : ""}
        </span>
        <div className="r">
          <button className="btn qt" onClick={discard} disabled={busy || (!dirty && !isInsert)}>
            {isInsert ? "Cancel" : "Discard"}
          </button>
          <button className="btn pri" onClick={() => void save()} disabled={busy || readOnly || (!dirty && !isInsert)}>
            {busy && <Loader2 className="spin" />}
            {isInsert ? "Insert" : "Save"} <span className="kbd">⌘S</span>
          </button>
        </div>
      </div>
    </aside>
  );
}
