import { memo, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Copy, CopyPlus, Eye, Pencil, Trash2 } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { CodeEditor } from "@/components/CodeEditor";
import { ValueTree } from "@/components/explorer/ValueTree";
import { idLabel, kindOf, leafText, toPlainJson, toShellText, type BsonKind } from "@/lib/bson";
import type { Doc } from "@/lib/api";
import type { ViewMode } from "@/stores/explorer";
import { cn } from "@/lib/utils";

interface FieldPreview {
  field: string;
  value: unknown;
  docLabel: string;
}

export interface DocActions {
  onView: (doc: Doc) => void;
  onEdit?: (doc: Doc) => void;
  onDuplicate?: (doc: Doc) => void;
  onDelete?: (doc: Doc) => void;
}

/** Multi-select support for the table view (documents tab only). Keys are
 *  `JSON.stringify(doc._id)`; docs without an `_id` aren't selectable. */
export interface DocSelection {
  selected: Set<string>;
  onToggle: (key: string, on: boolean) => void;
  onToggleAll: (keys: string[], on: boolean) => void;
}

export const docSelectionKey = (doc: Doc): string | null =>
  "_id" in doc ? JSON.stringify(doc._id) : null;

const copyText = async (text: string, label: string) => {
  await navigator.clipboard.writeText(text);
  toast.success(`${label} copied`);
};

// ---------------------------------------------------------------------------
// shared context menu
// ---------------------------------------------------------------------------

function DocContextMenu({
  doc,
  actions,
  asChild,
  children,
}: {
  doc: Doc;
  actions: DocActions;
  asChild?: boolean;
  children: ReactNode;
}) {
  const canMutate = "_id" in doc;
  return (
    // modal={false}: items open dialogs; a modal menu would leave
    // pointer-events stuck on <body> (see memory: radix-menu-dialog-freeze).
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild={asChild}>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => actions.onView(doc)}>
          <Eye /> Open
        </ContextMenuItem>
        {actions.onEdit && canMutate && (
          <ContextMenuItem onSelect={() => actions.onEdit!(doc)}>
            <Pencil /> Edit
          </ContextMenuItem>
        )}
        {actions.onDuplicate && (
          <ContextMenuItem onSelect={() => actions.onDuplicate!(doc)}>
            <CopyPlus /> Duplicate
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void copyText(toShellText(doc), "Document")}>
          <Copy /> Copy document
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void copyText(toPlainJson(doc), "Document")}>
          <Copy /> Copy as JSON
        </ContextMenuItem>
        {"_id" in doc && (
          <ContextMenuItem onSelect={() => void copyText(toShellText(doc._id), "_id")}>
            <Copy /> Copy _id
          </ContextMenuItem>
        )}
        {actions.onDelete && canMutate && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-danger focus:text-danger" onSelect={() => actions.onDelete!(doc)}>
              <Trash2 /> Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ---------------------------------------------------------------------------
// Documents view (cards)
// ---------------------------------------------------------------------------

const DocCard = memo(function DocCard({
  doc,
  index,
  actions,
  active,
}: {
  doc: Doc;
  index: number;
  actions: DocActions;
  active: boolean;
}) {
  return (
    <DocContextMenu doc={doc} actions={actions} asChild>
      <div
        className={cn(
          "group rounded-[var(--r)] border bg-panel transition-colors",
          active ? "border-accent-line shadow-[0_0_0_3px_var(--accent-soft)]" : "border-line hover:border-line-2"
        )}
        onDoubleClick={() => actions.onView(doc)}
      >
        <div
          className="flex cursor-pointer items-center gap-2 border-b border-line px-3 py-1.5 font-mono text-[11px] text-text-3"
          onClick={() => actions.onView(doc)}
        >
          <span className="tabular-nums">#{index + 1}</span>
          <span className="truncate text-text-2">{idLabel(doc)}</span>
          <div className="flex-1" />
          <span className="opacity-0 transition-opacity group-hover:opacity-100">open ›</span>
        </div>
        <div className="overflow-x-auto px-3 py-2">
          <ValueTree value={doc} />
        </div>
      </div>
    </DocContextMenu>
  );
});

// ---------------------------------------------------------------------------
// Table view
// ---------------------------------------------------------------------------

const CELL_CLASS: Partial<Record<BsonKind, string>> = {
  string: "st",
  number: "nu",
  long: "nu",
  double: "nu",
  decimal: "nu",
  boolean: "bo",
  null: "p italic",
  objectId: "oi",
  uuid: "oi",
  date: "dt",
  binary: "dt",
  timestamp: "dt",
  regex: "st",
};

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
};

function Cell({ value }: { value: unknown }) {
  const kind = kindOf(value);
  if (kind === "object" || kind === "array") {
    return <span className="p">{leafText(value)}</span>;
  }
  const text = leafText(value);
  return (
    <span className={cn("block max-w-[320px] truncate", CELL_CLASS[kind])} title={text}>
      {kind === "string" ? `"${text}"` : text}
    </span>
  );
}

function FieldValueDialog({ preview, onClose }: { preview: FieldPreview | null; onClose: () => void }) {
  const text = useMemo(() => (preview ? toShellText(preview.value) : ""), [preview]);
  const kind = preview ? kindOf(preview.value) : null;
  const summary =
    kind === "array"
      ? `array · ${(preview!.value as unknown[]).length} items`
      : kind === "object"
        ? `object · ${Object.keys(preview!.value as object).length} fields`
        : (kind ?? "");

  return (
    <Dialog open={!!preview} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="font-mono text-[14px]">{preview?.field ?? ""}</DialogTitle>
          <DialogDescription>
            {summary}
            {preview ? ` · ${preview.docLabel}` : ""}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {preview && <CodeEditor value={text} readOnly height="50vh" path={`dialog/field-preview/${preview.field}`} />}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => void copyText(text, "Field")}>
            <Copy />
            Copy value
          </Button>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TableView({
  docs,
  actions,
  selection,
  activeKey,
}: {
  docs: Doc[];
  actions: DocActions;
  selection?: DocSelection;
  activeKey?: string | null;
}) {
  const [preview, setPreview] = useState<FieldPreview | null>(null);
  const selectableKeys = useMemo(
    () => docs.map(docSelectionKey).filter((k): k is string => k !== null),
    [docs]
  );
  const allSelected =
    selection !== undefined && selectableKeys.length > 0 && selectableKeys.every((k) => selection.selected.has(k));

  // Every field across the page becomes a column, ordered by frequency then
  // name; the dominant BSON type of each column is shown in the header.
  const columns = useMemo(() => {
    const freq = new Map<string, number>();
    const types = new Map<string, Map<BsonKind, number>>();
    for (const doc of docs) {
      for (const key of Object.keys(doc)) {
        freq.set(key, (freq.get(key) ?? 0) + 1);
        const k = kindOf(doc[key]);
        const m = types.get(key) ?? new Map<BsonKind, number>();
        m.set(k, (m.get(k) ?? 0) + 1);
        types.set(key, m);
      }
    }
    const keys = [...freq.keys()].filter((k) => k !== "_id");
    keys.sort((a, b) => freq.get(b)! - freq.get(a)! || a.localeCompare(b));
    const ordered = freq.has("_id") ? ["_id", ...keys] : keys;
    return ordered.map((name) => {
      const m = types.get(name)!;
      const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      return { name, type: top ? TYPE_ABBR[top] ?? top : "" };
    });
  }, [docs]);

  return (
    <div className="tw">
      <FieldValueDialog preview={preview} onClose={() => setPreview(null)} />
      <table className="tbl">
        <thead>
          <tr>
            {selection && (
              <th className="chk">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(v) => selection.onToggleAll(selectableKeys, v === true)}
                  aria-label="Select all on this page"
                  className="translate-y-px"
                />
              </th>
            )}
            {columns.map((col) => (
              <th key={col.name}>
                {col.name}
                {col.type && <span className="ty">{col.type}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {docs.map((doc, i) => {
            const key = docSelectionKey(doc);
            const isSelected = !!selection && key !== null && selection.selected.has(key);
            const isActive = !!activeKey && key === activeKey;
            return (
              <DocContextMenu key={i} doc={doc} actions={actions} asChild>
                <tr
                  onClick={() => actions.onView(doc)}
                  className={cn((isSelected || isActive) && "on")}
                >
                  {selection && (
                    <td
                      className="chk"
                      onClick={(e) => e.stopPropagation()}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      {key !== null && (
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(v) => selection.onToggle(key, v === true)}
                          aria-label="Select document"
                          className="translate-y-px"
                        />
                      )}
                    </td>
                  )}
                  {columns.map((col) => {
                    const present = col.name in doc;
                    const value = present ? doc[col.name] : undefined;
                    const kind = present ? kindOf(value) : null;
                    const expandable = kind === "object" || kind === "array";
                    return (
                      <td
                        key={col.name}
                        onClick={
                          expandable
                            ? (e) => {
                                e.stopPropagation();
                                setPreview({ field: col.name, value, docLabel: `_id ${idLabel(doc)}` });
                              }
                            : undefined
                        }
                        title={expandable ? "Click to inspect field" : undefined}
                        className={cn(expandable && "cursor-pointer")}
                      >
                        {present ? <Cell value={value} /> : <span className="p">-</span>}
                      </td>
                    );
                  })}
                </tr>
              </DocContextMenu>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface ResultsViewerProps {
  docs: Doc[];
  view: ViewMode;
  actions: DocActions;
  emptyText?: string;
  /** Enables the checkbox column in table view. */
  selection?: DocSelection;
  /** Selection key of the document open in the drawer (highlighted). */
  activeKey?: string | null;
}

export const ResultsViewer = memo(function ResultsViewer({
  docs,
  view,
  actions,
  emptyText,
  selection,
  activeKey,
}: ResultsViewerProps) {
  if (docs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-text-3">
        <p className="no-select text-[12.5px]">{emptyText ?? "No documents match"}</p>
      </div>
    );
  }

  if (view === "table") return <TableView docs={docs} actions={actions} selection={selection} activeKey={activeKey} />;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-2 p-[calc(var(--pad)-8px)]">
        {docs.map((doc, i) => (
          <DocCard key={i} doc={doc} index={i} actions={actions} active={!!activeKey && docSelectionKey(doc) === activeKey} />
        ))}
      </div>
    </div>
  );
});
