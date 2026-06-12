import { useEffect, useId, useMemo, useState } from "react";
import { ListFilter, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

type Op =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "regex"
  | "in"
  | "nin"
  | "type"
  | "exists"
  | "notexists";

const OPS: { value: Op; label: string }[] = [
  { value: "eq", label: "= equals" },
  { value: "ne", label: "≠ not equals" },
  { value: "gt", label: "> greater" },
  { value: "gte", label: "≥ greater or eq" },
  { value: "lt", label: "< less" },
  { value: "lte", label: "≤ less or eq" },
  { value: "between", label: "between" },
  { value: "contains", label: "contains" },
  { value: "startsWith", label: "starts with" },
  { value: "endsWith", label: "ends with" },
  { value: "regex", label: "regex" },
  { value: "in", label: "in (a, b)" },
  { value: "nin", label: "not in (a, b)" },
  { value: "type", label: "is type" },
  { value: "exists", label: "exists" },
  { value: "notexists", label: "not exists" },
];

const VALUELESS: Op[] = ["exists", "notexists"];
const BSON_TYPES = [
  "string",
  "int",
  "long",
  "double",
  "decimal",
  "bool",
  "date",
  "objectId",
  "array",
  "object",
  "null",
  "binData",
  "timestamp",
];

let rid = 0;
interface Row {
  id: number;
  field: string;
  op: Op;
  value: string;
  value2: string; // second operand for "between"
}
const newRow = (): Row => ({ id: rid++, field: "", op: "eq", value: "", value2: "" });

// Render a scalar as mongosh-flavored text, guessing the JSON type.
function valueToken(field: string, raw: string): string {
  const v = raw.trim();
  if (v === "") return '""';
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  if (v === "true" || v === "false" || v === "null") return v;
  // 24-hex on _id / *Id fields → ObjectId
  if (/^[a-f0-9]{24}$/i.test(v) && (field === "_id" || /(^|\.)_?id$/i.test(field) || /Id$/.test(field))) {
    return `ObjectId("${v}")`;
  }
  // ISO-ish date → ISODate
  if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})?/.test(v)) return `ISODate("${v}")`;
  return JSON.stringify(v);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clause(row: Row): string | null {
  const field = row.field.trim();
  if (!field) return null;
  const key = JSON.stringify(field);
  const val = () => valueToken(field, row.value);
  switch (row.op) {
    case "eq":
      return `${key}: ${val()}`;
    case "ne":
      return `${key}: { $ne: ${val()} }`;
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return `${key}: { $${row.op}: ${val()} }`;
    case "between":
      return `${key}: { $gte: ${valueToken(field, row.value)}, $lte: ${valueToken(field, row.value2)} }`;
    case "contains":
      return `${key}: { $regex: ${JSON.stringify(escapeRegex(row.value))}, $options: "i" }`;
    case "startsWith":
      return `${key}: { $regex: ${JSON.stringify("^" + escapeRegex(row.value))}, $options: "i" }`;
    case "endsWith":
      return `${key}: { $regex: ${JSON.stringify(escapeRegex(row.value) + "$")}, $options: "i" }`;
    case "regex":
      return `${key}: { $regex: ${JSON.stringify(row.value)}, $options: "i" }`;
    case "in":
    case "nin": {
      const items = row.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => valueToken(field, s));
      return `${key}: { $${row.op}: [${items.join(", ")}] }`;
    }
    case "type":
      return `${key}: { $type: ${JSON.stringify(row.value || "string")} }`;
    case "exists":
      return `${key}: { $exists: true }`;
    case "notexists":
      return `${key}: { $exists: false }`;
  }
}

export function buildFilter(rows: Row[], combinator: "and" | "or"): string {
  const clauses = rows.map(clause).filter((c): c is string => c !== null);
  if (clauses.length === 0) return "{}";
  if (combinator === "or") {
    return `{ $or: [${clauses.map((c) => `{ ${c} }`).join(", ")}] }`;
  }
  // AND: merge into one object, unless a field repeats — then use $and.
  const fields = rows.filter((r) => r.field.trim()).map((r) => r.field.trim());
  const hasDup = new Set(fields).size !== fields.length;
  if (hasDup) return `{ $and: [${clauses.map((c) => `{ ${c} }`).join(", ")}] }`;
  return `{ ${clauses.join(", ")} }`;
}

export function QueryBuilder({
  database,
  collection,
  onApply,
}: {
  database: string;
  collection: string;
  onApply: (filter: string) => void;
}) {
  const [rows, setRows] = useState<Row[]>([newRow()]);
  const [combinator, setCombinator] = useState<"and" | "or">("and");
  const [fields, setFields] = useState<string[]>([]);
  const listId = useId();

  useEffect(() => {
    let alive = true;
    api
      .collectionFields(database, collection, 1000)
      .then((f) => alive && setFields(f))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [database, collection]);

  const update = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const preview = useMemo(() => buildFilter(rows, combinator), [rows, combinator]);

  return (
    <div className="w-[480px] space-y-2.5">
      <datalist id={listId}>
        {fields.map((f) => (
          <option key={f} value={f} />
        ))}
      </datalist>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-sm font-medium">
          <ListFilter className="h-3.5 w-3.5 text-primary" />
          Query builder
        </div>
        <div className="flex items-center rounded-md border bg-muted/60 p-0.5 text-[11px]">
          {(["and", "or"] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCombinator(c)}
              className={cn(
                "rounded-[5px] px-2 py-0.5 font-medium transition-colors",
                combinator === c
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {c === "and" ? "Match ALL" : "Match ANY"}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        {rows.map((row, i) => (
          <div key={row.id} className="space-y-1">
            {i > 0 && (
              <p className="pl-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {combinator}
              </p>
            )}
            <div className="flex items-center gap-1.5">
              <Input
                value={row.field}
                onChange={(e) => update(row.id, { field: e.target.value })}
                placeholder="field"
                list={listId}
                autoComplete="off"
                className="h-8 flex-1 font-mono text-xs"
                spellCheck={false}
              />
              <Select value={row.op} onValueChange={(v) => update(row.id, { op: v as Op })}>
                <SelectTrigger className="h-8 w-[140px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OPS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-xs">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                disabled={rows.length === 1}
                onClick={() => setRows((rs) => rs.filter((r) => r.id !== row.id))}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            {/* value row */}
            {!VALUELESS.includes(row.op) &&
              (row.op === "type" ? (
                <Select value={row.value || "string"} onValueChange={(v) => update(row.id, { value: v })}>
                  <SelectTrigger className="h-8 w-full text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {BSON_TYPES.map((t) => (
                      <SelectItem key={t} value={t} className="text-xs">
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : row.op === "between" ? (
                <div className="flex items-center gap-1.5">
                  <Input
                    value={row.value}
                    onChange={(e) => update(row.id, { value: e.target.value })}
                    placeholder="min"
                    className="h-8 flex-1 font-mono text-xs"
                    spellCheck={false}
                  />
                  <span className="text-xs text-muted-foreground">and</span>
                  <Input
                    value={row.value2}
                    onChange={(e) => update(row.id, { value2: e.target.value })}
                    placeholder="max"
                    className="h-8 flex-1 font-mono text-xs"
                    spellCheck={false}
                  />
                </div>
              ) : (
                <Input
                  value={row.value}
                  onChange={(e) => update(row.id, { value: e.target.value })}
                  placeholder={
                    row.op === "in" || row.op === "nin" ? "comma, separated, values" : "value"
                  }
                  className="h-8 w-full font-mono text-xs"
                  spellCheck={false}
                />
              ))}
          </div>
        ))}
      </div>

      <Button
        variant="ghost"
        size="sm"
        className="h-7 text-xs text-muted-foreground"
        onClick={() => setRows((rs) => [...rs, newRow()])}
      >
        <Plus className="h-3.5 w-3.5" />
        Add condition
      </Button>

      <div className="rounded-md border border-dashed bg-muted/40 px-2.5 py-1.5">
        <code className="block break-all font-mono text-[11px] text-muted-foreground">
          {preview}
        </code>
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">
          {fields.length > 0 ? `${fields.length} fields from latest 1000 docs` : "loading fields…"}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setRows([newRow()])}>
            Clear
          </Button>
          <Button size="sm" onClick={() => onApply(preview)}>
            Apply filter
          </Button>
        </div>
      </div>
    </div>
  );
}
