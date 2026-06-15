import { memo, useMemo, type ReactNode } from "react";
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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ValueTree } from "@/components/explorer/ValueTree";
import { idLabel, kindOf, leafText, toPlainJson, toShellText, type BsonKind } from "@/lib/bson";
import type { Doc } from "@/lib/api";
import type { ViewMode } from "@/stores/explorer";
import { cn } from "@/lib/utils";

export interface DocActions {
  onView: (doc: Doc) => void;
  onEdit?: (doc: Doc) => void;
  onDuplicate?: (doc: Doc) => void;
  onDelete?: (doc: Doc) => void;
}

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
    <ContextMenu>
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

const MAX_COLUMNS = 40;

function TableView({ docs, actions }: { docs: Doc[]; actions: DocActions }) {
  const columns = useMemo(() => {
    const freq = new Map<string, number>();
    for (const doc of docs) {
      for (const key of Object.keys(doc)) {
        freq.set(key, (freq.get(key) ?? 0) + 1);
      }
    }
    const keys = [...freq.keys()].filter((k) => k !== "_id");
    keys.sort((a, b) => freq.get(b)! - freq.get(a)! || a.localeCompare(b));
    const ordered = freq.has("_id") ? ["_id", ...keys] : keys;
    return { visible: ordered.slice(0, MAX_COLUMNS), hidden: Math.max(0, ordered.length - MAX_COLUMNS) };
  }, [docs]);

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full border-separate border-spacing-0 font-data">
        <thead className="sticky top-0 z-10">
          <tr>
            {columns.visible.map((col) => (
              <th
                key={col}
                className="whitespace-nowrap border-b border-r bg-card px-2.5 py-1.5 text-left text-[11px] font-semibold text-muted-foreground last:border-r-0"
              >
                {col}
              </th>
            ))}
            {columns.hidden > 0 && (
              <th className="whitespace-nowrap border-b bg-card px-2.5 py-1.5 text-left text-[11px] font-normal text-muted-foreground/60">
                +{columns.hidden} more
              </th>
            )}
            <th className="sticky right-0 w-0 border-b bg-card" />
          </tr>
        </thead>
        <tbody>
          {docs.map((doc, i) => (
            <DocContextMenu key={i} doc={doc} actions={actions} asChild>
            <tr
              onDoubleClick={() => actions.onView(doc)}
              className="group transition-colors odd:bg-muted/30 hover:bg-accent/60"
            >
              {columns.visible.map((col) => (
                <td
                  key={col}
                  className="whitespace-nowrap border-b border-r border-border/60 px-2.5 py-1 align-top last:border-r-0"
                >
                  {col in doc ? <Cell value={doc[col]} /> : <span className="text-muted-foreground/40">—</span>}
                </td>
              ))}
              {columns.hidden > 0 && <td className="border-b border-border/60" />}
              <td className="sticky right-0 border-b border-border/60 bg-background px-1 py-0.5 align-top">
                <RowActions
                  doc={doc}
                  actions={actions}
                  className="opacity-0 transition-opacity group-hover:opacity-100"
                />
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
}

export const ResultsViewer = memo(function ResultsViewer({
  docs,
  view,
  actions,
  emptyText,
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

  if (view === "table") return <TableView docs={docs} actions={actions} />;

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
