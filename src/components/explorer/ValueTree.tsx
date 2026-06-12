import { memo, useState } from "react";
import { kindOf, leafText, type BsonKind } from "@/lib/bson";
import { cn } from "@/lib/utils";

const LEAF_CLASS: Partial<Record<BsonKind, string>> = {
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
  regex: "text-bson-string",
  timestamp: "text-bson-date",
  minKey: "text-bson-null italic",
  maxKey: "text-bson-null italic",
};

const MAX_STRING = 220;

function Leaf({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false);
  const kind = kindOf(value);
  const cls = LEAF_CLASS[kind];

  if (kind === "string") {
    const s = value as string;
    const long = s.length > MAX_STRING;
    const shown = expanded || !long ? s : s.slice(0, MAX_STRING);
    return (
      <span className={cls}>
        "{shown}
        {long && !expanded && (
          <button
            className="mx-1 rounded bg-muted px-1 text-[10px] text-muted-foreground hover:text-foreground"
            onClick={() => setExpanded(true)}
          >
            +{s.length - MAX_STRING} chars
          </button>
        )}
        "
      </span>
    );
  }
  if (kind === "objectId") {
    return (
      <span className={cls}>
        ObjectId(<span className="opacity-90">"{leafText(value)}"</span>)
      </span>
    );
  }
  if (kind === "date") {
    return (
      <span className={cls} title={leafText(value)}>
        {leafText(value)}
      </span>
    );
  }
  return <span className={cls}>{leafText(value)}</span>;
}

interface NodeProps {
  value: unknown;
  depth: number;
  /** Trailing comma for all but the last entry. */
  comma?: boolean;
  name?: string;
}

function Node({ value, depth, comma, name }: NodeProps) {
  const kind = kindOf(value);
  const isContainer = kind === "object" || kind === "array";
  const entries: [string, unknown][] = !isContainer
    ? []
    : kind === "array"
      ? (value as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
      : Object.entries(value as Record<string, unknown>);

  const [open, setOpen] = useState(depth < 2 || entries.length <= 8);

  const keyNode =
    name !== undefined ? (
      <>
        <span className="text-bson-key">{name}</span>
        <span className="text-muted-foreground">: </span>
      </>
    ) : null;

  if (!isContainer) {
    return (
      <div className="pl-4">
        {keyNode}
        <Leaf value={value} />
        {comma && <span className="text-muted-foreground">,</span>}
      </div>
    );
  }

  const [openCh, closeCh] = kind === "array" ? ["[", "]"] : ["{", "}"];

  if (entries.length === 0) {
    return (
      <div className="pl-4">
        {keyNode}
        <span className="text-muted-foreground">
          {openCh}
          {closeCh}
        </span>
        {comma && <span className="text-muted-foreground">,</span>}
      </div>
    );
  }

  if (!open) {
    return (
      <div className="pl-4">
        {keyNode}
        <button
          onClick={() => setOpen(true)}
          className="rounded bg-muted/70 px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="Expand"
        >
          {openCh} {entries.length} {kind === "array" ? (entries.length === 1 ? "item" : "items") : entries.length === 1 ? "field" : "fields"}{" "}
          {closeCh}
        </button>
        {comma && <span className="text-muted-foreground">,</span>}
      </div>
    );
  }

  return (
    <div className="pl-4">
      <span
        role="button"
        tabIndex={-1}
        className="cursor-pointer"
        onClick={() => setOpen(false)}
        title="Collapse"
      >
        {keyNode}
        <span className="text-muted-foreground">{openCh}</span>
      </span>
      <div className={cn(depth > 0 && "border-l border-border/50")}>
        {entries.map(([k, v], i) => (
          <Node
            key={k}
            name={kind === "object" ? k : undefined}
            value={v}
            depth={depth + 1}
            comma={i < entries.length - 1}
          />
        ))}
      </div>
      <span className="text-muted-foreground">{closeCh}</span>
      {comma && <span className="text-muted-foreground">,</span>}
    </div>
  );
}

export const ValueTree = memo(function ValueTree({ value }: { value: unknown }) {
  return (
    <div className="font-data -ml-4 break-all">
      <Node value={value} depth={0} />
    </div>
  );
});
