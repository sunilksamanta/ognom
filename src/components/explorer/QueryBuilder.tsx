import { useState } from "react";
import { Plus, X, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Op = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "contains" | "in" | "exists" | "notexists";

const OPS: { value: Op; label: string }[] = [
  { value: "eq", label: "=" },
  { value: "ne", label: "≠" },
  { value: "gt", label: ">" },
  { value: "gte", label: "≥" },
  { value: "lt", label: "<" },
  { value: "lte", label: "≤" },
  { value: "contains", label: "contains" },
  { value: "in", label: "in (a, b)" },
  { value: "exists", label: "exists" },
  { value: "notexists", label: "not exists" },
];

const VALUELESS: Op[] = ["exists", "notexists"];

let rid = 0;
interface Row {
  id: number;
  field: string;
  op: Op;
  value: string;
}
const newRow = (): Row => ({ id: rid++, field: "", op: "eq", value: "" });

// Render one scalar value as mongosh-flavored text.
function valueToken(field: string, raw: string): string {
  const v = raw.trim();
  if (v === "") return '""';
  if (/^-?\d+(\.\d+)?$/.test(v)) return v;
  if (v === "true" || v === "false" || v === "null") return v;
  // Treat 24-hex on _id / *Id fields as an ObjectId.
  if (/^[a-f0-9]{24}$/i.test(v) && (field === "_id" || /Id$/.test(field))) {
    return `ObjectId("${v}")`;
  }
  return JSON.stringify(v);
}

function clause(row: Row): string | null {
  const field = row.field.trim();
  if (!field) return null;
  const key = JSON.stringify(field);
  switch (row.op) {
    case "eq":
      return `${key}: ${valueToken(field, row.value)}`;
    case "ne":
      return `${key}: { $ne: ${valueToken(field, row.value)} }`;
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return `${key}: { $${row.op}: ${valueToken(field, row.value)} }`;
    case "contains":
      return `${key}: { $regex: ${JSON.stringify(row.value)}, $options: "i" }`;
    case "in": {
      const items = row.value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => valueToken(field, s));
      return `${key}: { $in: [${items.join(", ")}] }`;
    }
    case "exists":
      return `${key}: { $exists: true }`;
    case "notexists":
      return `${key}: { $exists: false }`;
  }
}

export function buildFilter(rows: Row[]): string {
  const clauses = rows.map(clause).filter((c): c is string => c !== null);
  if (clauses.length === 0) return "{}";
  // Use $and when a field repeats so we never emit duplicate keys.
  const fields = rows.filter((r) => r.field.trim()).map((r) => r.field.trim());
  const hasDup = new Set(fields).size !== fields.length;
  if (hasDup) return `{ $and: [${clauses.map((c) => `{ ${c} }`).join(", ")}] }`;
  return `{ ${clauses.join(", ")} }`;
}

export function QueryBuilder({ onApply }: { onApply: (filter: string) => void }) {
  const [rows, setRows] = useState<Row[]>([newRow()]);

  const update = (id: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const preview = buildFilter(rows);

  return (
    <div className="w-[440px] space-y-2.5">
      <div className="flex items-center gap-1.5 text-sm font-medium">
        <Wand2 className="h-3.5 w-3.5 text-primary" />
        Query builder
      </div>

      <div className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.id} className="flex items-center gap-1.5">
            <Input
              value={row.field}
              onChange={(e) => update(row.id, { field: e.target.value })}
              placeholder="field"
              className="h-8 flex-1 font-mono text-xs"
              spellCheck={false}
            />
            <Select value={row.op} onValueChange={(v) => update(row.id, { op: v as Op })}>
              <SelectTrigger className="h-8 w-[112px] text-xs">
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
            <Input
              value={row.value}
              onChange={(e) => update(row.id, { value: e.target.value })}
              placeholder={VALUELESS.includes(row.op) ? "—" : "value"}
              disabled={VALUELESS.includes(row.op)}
              className="h-8 flex-1 font-mono text-xs disabled:opacity-40"
              spellCheck={false}
            />
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

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setRows([newRow()])}>
          Clear
        </Button>
        <Button size="sm" onClick={() => onApply(preview)}>
          Apply filter
        </Button>
      </div>
    </div>
  );
}
