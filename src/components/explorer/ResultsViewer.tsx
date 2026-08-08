import { memo, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Copy, CopyPlus, Eye, FileX2, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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

function CopyMenu({ doc }: { doc: Doc }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-6 w-6">
          <Copy className="h-3 w-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void copyText(toShellText(doc), "Document")}>
          Copy Document
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void copyText(toPlainJson(doc), "Document")}>
          Copy Document as JSON
        </DropdownMenuItem>
        {"_id" in doc && (
          <DropdownMenuItem onClick={() => void copyText(toShellText(doc._id), "_id")}>
            Copy _id
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function RowActions({ doc, actions, className }: { doc: Doc; actions: DocActions; className?: string }) {
  const canMutate = "_id" in doc;
  return (
    <div className={cn("flex items-center gap-0.5", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => actions.onView(doc)}>
            <Eye className="h-3 w-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>View</TooltipContent>
      </Tooltip>
      <CopyMenu doc={doc} />
      {actions.onEdit && canMutate && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => actions.onEdit!(doc)}>
              <Pencil className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Edit</TooltipContent>
        </Tooltip>
      )}
      {actions.onDuplicate && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => actions.onDuplicate!(doc)}>
              <CopyPlus className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Duplicate</TooltipContent>
        </Tooltip>
      )}
      {actions.onDelete && canMutate && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={() => actions.onDelete!(doc)}
            >
              <Trash2 className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Delete</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// JSON view
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
    // `modal={false}`: every item here opens a Dialog (View/Edit/Duplicate) or
    // AlertDialog (Delete). A modal menu sets `pointer-events: none` on <body>
    // and only restores it after its exit animation; the dialog mounts its own
    // layer before then, the two race over the shared body style, and the body
    // is left permanently unclickable — the whole app "hangs". Non-modal menus
    // never touch <body>, so the dialog (modal, self-contained) opens cleanly.
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild={asChild}>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={() => actions.onView(doc)}>
          <Eye />
          View
        </ContextMenuItem>
        {actions.onEdit && canMutate && (
          <ContextMenuItem onSelect={() => actions.onEdit!(doc)}>
            <Pencil />
            Edit
          </ContextMenuItem>
        )}
        {actions.onDuplicate && (
          <ContextMenuItem onSelect={() => actions.onDuplicate!(doc)}>
            <CopyPlus />
            Duplicate
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => void copyText(toShellText(doc), "Document")}>
          <Copy />
          Copy Document
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void copyText(toPlainJson(doc), "Document")}>
          <Copy />
          Copy Document as JSON
        </ContextMenuItem>
        {"_id" in doc && (
          <ContextMenuItem onSelect={() => void copyText(toShellText(doc._id), "_id")}>
            <Copy />
            Copy _id
          </ContextMenuItem>
        )}
        {actions.onDelete && canMutate && (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => actions.onDelete!(doc)}
            >
              <Trash2 />
              Delete
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

const DocCard = memo(function DocCard({
  doc,
  index,
  actions,
}: {
  doc: Doc;
  index: number;
  actions: DocActions;
}) {
  return (
    <DocContextMenu doc={doc} actions={actions} asChild>
      <div className="group rounded-lg border bg-card transition-colors hover:border-border/80">
        <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5">
          <span className="text-[11px] tabular-nums text-muted-foreground/70">#{index + 1}</span>
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {idLabel(doc)}
          </span>
          <div className="flex-1" />
          <RowActions
            doc={doc}
            actions={actions}
            className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
          />
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
  string: "text-bson-string",
  number: "text-bson-number",
  long: "text-bson-number",
  double: "text-bson-number",
  decimal: "text-bson-number",
  boolean: "text-bson-boolean",
  null: "text-bson-null italic",
  objectId: "text-bson-oid",
  uuid: "text-bson-oid",
  date: "text-bson-date",
  binary: "text-bson-date",
  timestamp: "text-bson-date",
  regex: "text-bson-string",
};

function Cell({ value }: { value: unknown }) {
  const kind = kindOf(value);
  if (kind === "object" || kind === "array") {
    return (
      <span className="rounded bg-muted/70 px-1.5 py-0.5 text-[10.5px] text-muted-foreground">
        {leafText(value)}
      </span>
    );
  }
  const text = leafText(value);
  return (
    <span className={cn("block max-w-[280px] truncate", CELL_CLASS[kind])} title={text}>
      {kind === "string" ? `"${text}"` : text}
    </span>
  );
}

function FieldValueDialog({
  preview,
  onClose,
}: {
  preview: FieldPreview | null;
  onClose: () => void;
}) {
  const text = useMemo(
    () => (preview ? toShellText(preview.value) : ""),
    [preview],
  );
  const kind = preview ? kindOf(preview.value) : null;
  const summary =
    kind === "array"
      ? `Array · ${(preview!.value as unknown[]).length} items`
      : kind === "object"
        ? `Object · ${Object.keys(preview!.value as object).length} fields`
        : kind ?? "";

  return (
    <Dialog open={!!preview} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[80vh] flex-col sm:max-w-[640px]">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">
            {preview?.field ?? ""}
          </DialogTitle>
          <DialogDescription className="font-mono text-xs">
            {summary}
            {preview ? ` · ${preview.docLabel}` : ""}
          </DialogDescription>
        </DialogHeader>

        {preview && (
          <CodeEditor
            value={text}
            readOnly
            height="50vh"
            path={`dialog/field-preview/${preview.field}`}
          />
        )}

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              await navigator.clipboard.writeText(text);
              toast.success("Field copied");
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            Copy value
          </Button>
          <Button size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TableView({
  docs,
  actions,
  selection,
}: {
  docs: Doc[];
  actions: DocActions;
  selection?: DocSelection;
}) {
  const [preview, setPreview] = useState<FieldPreview | null>(null);
  const selectableKeys = useMemo(
    () => docs.map(docSelectionKey).filter((k): k is string => k !== null),
    [docs]
  );
  const allSelected =
    selection !== undefined &&
    selectableKeys.length > 0 &&
    selectableKeys.every((k) => selection.selected.has(k));
  // Every field across the page becomes a column, ordered by how often it
  // appears (then alphabetically). Row count is already capped by the page
  // size, so the full column set stays cheap to render inside the scroller.
  const columns = useMemo(() => {
    const freq = new Map<string, number>();
    for (const doc of docs) {
      for (const key of Object.keys(doc)) {
        freq.set(key, (freq.get(key) ?? 0) + 1);
      }
    }
    const keys = [...freq.keys()].filter((k) => k !== "_id");
    keys.sort((a, b) => freq.get(b)! - freq.get(a)! || a.localeCompare(b));
    return freq.has("_id") ? ["_id", ...keys] : keys;
  }, [docs]);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <FieldValueDialog preview={preview} onClose={() => setPreview(null)} />
      <table className="w-full border-separate border-spacing-0 font-data">
        <thead className="sticky top-0 z-10">
          <tr>
            {selection && (
              <th className="w-8 border-b border-r bg-card px-2 py-1.5">
                <Checkbox
                  checked={allSelected}
                  onCheckedChange={(v) => selection.onToggleAll(selectableKeys, v === true)}
                  aria-label="Select all on this page"
                  className="translate-y-px"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col}
                className="whitespace-nowrap border-b border-r bg-card px-2.5 py-1.5 text-left text-[11px] font-semibold text-muted-foreground last:border-r-0"
              >
                {col}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {docs.map((doc, i) => (
            <DocContextMenu key={i} doc={doc} actions={actions} asChild>
            <tr
              onDoubleClick={() => actions.onView(doc)}
              className={cn(
                "group transition-colors odd:bg-muted/30 hover:bg-accent/60",
                selection &&
                  docSelectionKey(doc) !== null &&
                  selection.selected.has(docSelectionKey(doc)!) &&
                  "bg-primary/10 odd:bg-primary/10"
              )}
            >
              {selection && (
                <td
                  className="w-8 border-b border-r border-border/60 px-2 py-1 align-top"
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  {docSelectionKey(doc) !== null && (
                    <Checkbox
                      checked={selection.selected.has(docSelectionKey(doc)!)}
                      onCheckedChange={(v) =>
                        selection.onToggle(docSelectionKey(doc)!, v === true)
                      }
                      aria-label="Select document"
                      className="translate-y-px"
                    />
                  )}
                </td>
              )}
              {columns.map((col) => {
                const present = col in doc;
                const value = present ? doc[col] : undefined;
                const kind = present ? kindOf(value) : null;
                const expandable = kind === "object" || kind === "array";
                return (
                  <td
                    key={col}
                    onClick={
                      expandable
                        ? (e) => {
                            e.stopPropagation();
                            setPreview({ field: col, value, docLabel: `_id ${idLabel(doc)}` });
                          }
                        : undefined
                    }
                    title={expandable ? "Click to inspect field" : undefined}
                    className={cn(
                      "whitespace-nowrap border-b border-r border-border/60 px-2.5 py-1 align-top last:border-r-0",
                      expandable && "cursor-pointer hover:bg-accent/40",
                    )}
                  >
                    {present ? <Cell value={value} /> : <span className="text-muted-foreground/40">—</span>}
                  </td>
                );
              })}
              <td className="sticky right-0 w-0 border-b border-border/60 p-0">
                <div className="pointer-events-none absolute right-0 top-1/2 flex -translate-y-1/2 items-center rounded-l-md bg-accent/95 px-1 opacity-0 shadow-sm ring-1 ring-border/60 backdrop-blur-sm transition-opacity group-hover:pointer-events-auto group-hover:opacity-100">
                  <RowActions doc={doc} actions={actions} />
                </div>
              </td>
            </tr>
            </DocContextMenu>
          ))}
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
}

export const ResultsViewer = memo(function ResultsViewer({
  docs,
  view,
  actions,
  emptyText,
  selection,
}: ResultsViewerProps) {
  if (docs.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center text-muted-foreground">
        <div className="no-select flex flex-col items-center gap-2 text-center">
          <FileX2 className="h-8 w-8 opacity-40" />
          <p className="text-sm">{emptyText ?? "No documents match"}</p>
        </div>
      </div>
    );
  }

  if (view === "table") return <TableView docs={docs} actions={actions} selection={selection} />;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-2 p-3">
        {docs.map((doc, i) => (
          <DocCard key={i} doc={doc} index={i} actions={actions} />
        ))}
      </div>
    </div>
  );
});
