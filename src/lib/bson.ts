/**
 * Helpers for MongoDB relaxed Extended JSON values as returned by the backend:
 * type detection, human display, and a mongosh-flavored pretty printer whose
 * output round-trips through the backend shell parser.
 */

export type BsonKind =
  | "objectId"
  | "date"
  | "decimal"
  | "long"
  | "double"
  | "binary"
  | "uuid"
  | "regex"
  | "timestamp"
  | "minKey"
  | "maxKey"
  | "code"
  | "string"
  | "number"
  | "boolean"
  | "null"
  | "array"
  | "object";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function kindOf(v: unknown): BsonKind {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return "string";
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (Array.isArray(v)) return "array";
  const o = v as Obj;
  if (typeof o.$oid === "string") return "objectId";
  if ("$date" in o) return "date";
  if (typeof o.$numberDecimal === "string") return "decimal";
  if (typeof o.$numberLong === "string") return "long";
  if (typeof o.$numberDouble === "string") return "double";
  if (isObj(o.$binary)) {
    return (o.$binary as Obj).subType === "04" ? "uuid" : "binary";
  }
  if (typeof o.$uuid === "string") return "uuid";
  if (isObj(o.$regularExpression)) return "regex";
  if (isObj(o.$timestamp)) return "timestamp";
  if ("$minKey" in o) return "minKey";
  if ("$maxKey" in o) return "maxKey";
  if ("$code" in o) return "code";
  return "object";
}

export function dateOf(v: unknown): Date | null {
  if (!isObj(v) || !("$date" in v)) return null;
  const d = (v as Obj).$date;
  if (typeof d === "string") {
    const parsed = new Date(d);
    return isNaN(parsed.getTime()) ? null : parsed;
  }
  if (isObj(d) && typeof d.$numberLong === "string") {
    return new Date(Number(d.$numberLong));
  }
  return null;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDate(d: Date): string {
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}Z`
  );
}

function isoOf(v: unknown): string {
  const d = dateOf(v);
  return d ? d.toISOString() : String((v as Obj)?.$date ?? "");
}

/** Compact, human display for a leaf value (table cells, tree leaves). */
export function leafText(v: unknown): string {
  switch (kindOf(v)) {
    case "null":
      return "null";
    case "string":
      return v as string;
    case "number":
      return String(v);
    case "boolean":
      return String(v);
    case "objectId":
      return (v as Obj).$oid as string;
    case "date": {
      const d = dateOf(v);
      return d ? formatDate(d) : isoOf(v);
    }
    case "decimal":
      return (v as Obj).$numberDecimal as string;
    case "long":
      return (v as Obj).$numberLong as string;
    case "double":
      return (v as Obj).$numberDouble as string;
    case "uuid": {
      const o = v as Obj;
      if (typeof o.$uuid === "string") return o.$uuid;
      return `UUID(${((o.$binary as Obj)?.base64 as string) ?? ""})`;
    }
    case "binary": {
      const b = (v as Obj).$binary as Obj;
      const bytes = Math.floor((((b?.base64 as string) ?? "").length * 3) / 4);
      return `BinData(${parseInt((b?.subType as string) ?? "0", 16)}, ${bytes} B)`;
    }
    case "regex": {
      const r = (v as Obj).$regularExpression as Obj;
      return `/${r?.pattern ?? ""}/${r?.options ?? ""}`;
    }
    case "timestamp": {
      const t = (v as Obj).$timestamp as Obj;
      return `Timestamp(${t?.t ?? 0}, ${t?.i ?? 0})`;
    }
    case "minKey":
      return "MinKey";
    case "maxKey":
      return "MaxKey";
    case "code":
      return "Code(…)";
    case "array":
      return `[ ${(v as unknown[]).length} ]`;
    case "object":
      return `{ ${Object.keys(v as Obj).length} }`;
  }
}

export const isExpandable = (v: unknown): boolean => {
  const k = kindOf(v);
  return k === "array" || k === "object" || k === "code";
};

// ---------------------------------------------------------------------------
// mongosh-style printer (round-trips through the backend parser)
// ---------------------------------------------------------------------------

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function shellKey(k: string): string {
  return IDENT_RE.test(k) ? k : JSON.stringify(k);
}

function shellLeaf(v: unknown): string | null {
  switch (kindOf(v)) {
    case "null":
      return "null";
    case "string":
      return JSON.stringify(v);
    case "number":
      return String(v);
    case "boolean":
      return String(v);
    case "objectId":
      return `ObjectId("${(v as Obj).$oid}")`;
    case "date":
      return `ISODate("${isoOf(v)}")`;
    case "decimal":
      return `NumberDecimal("${(v as Obj).$numberDecimal}")`;
    case "long":
      return `NumberLong("${(v as Obj).$numberLong}")`;
    case "double": {
      const s = (v as Obj).$numberDouble as string;
      // NaN / Infinity have no shell literal that survives JSON5; keep extJSON.
      return /^-?\d/.test(s) ? s : `{"$numberDouble": ${JSON.stringify(s)}}`;
    }
    case "uuid": {
      const o = v as Obj;
      if (typeof o.$uuid === "string") return `UUID("${o.$uuid}")`;
      return null; // $binary subtype 04 → print generically
    }
    case "binary": {
      const b = (v as Obj).$binary as Obj;
      return `BinData(${parseInt((b?.subType as string) ?? "0", 16)}, "${b?.base64 ?? ""}")`;
    }
    case "timestamp": {
      const t = (v as Obj).$timestamp as Obj;
      return `Timestamp(${t?.t ?? 0}, ${t?.i ?? 0})`;
    }
    case "minKey":
      return "MinKey";
    case "maxKey":
      return "MaxKey";
    default:
      return null;
  }
}

export function toShellText(v: unknown, indent = 0): string {
  const leaf = shellLeaf(v);
  if (leaf !== null) return leaf;

  const pad = "  ".repeat(indent);
  const padIn = "  ".repeat(indent + 1);

  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    const items = v.map((item) => toShellText(item, indent + 1));
    const inline = `[${items.join(", ")}]`;
    if (inline.length <= 72 && !inline.includes("\n")) return inline;
    return `[\n${items.map((s) => padIn + s).join(",\n")}\n${pad}]`;
  }

  const o = v as Obj;
  const keys = Object.keys(o);
  if (keys.length === 0) return "{}";
  const entries = keys.map((k) => `${shellKey(k)}: ${toShellText(o[k], indent + 1)}`);
  const inline = `{ ${entries.join(", ")} }`;
  if (inline.length <= 72 && !inline.includes("\n")) return inline;
  return `{\n${entries.map((s) => padIn + s).join(",\n")}\n${pad}}`;
}

// ---------------------------------------------------------------------------
// plain JSON (every BSON wrapper collapsed — no $oid / $date / $numberLong / …)
// ---------------------------------------------------------------------------

/** Collapse a relaxed-extJSON value into a pure JS value with no `$`-wrappers. */
export function toPlainValue(v: unknown): unknown {
  switch (kindOf(v)) {
    case "null":
      return null;
    case "string":
    case "number":
    case "boolean":
      return v;
    case "array":
      return (v as unknown[]).map(toPlainValue);
    case "objectId":
      return (v as Obj).$oid as string;
    case "date": {
      const d = dateOf(v);
      return d ? d.toISOString() : isoOf(v);
    }
    case "long": {
      // longs can exceed 2^53 (snowflake ids); keep as string when unsafe.
      const s = (v as Obj).$numberLong as string;
      const n = Number(s);
      return Number.isSafeInteger(n) ? n : s;
    }
    case "double": {
      const n = Number((v as Obj).$numberDouble as string);
      return Number.isFinite(n) ? n : null; // NaN / ±Infinity → null (JSON has no literal)
    }
    case "decimal": {
      const s = (v as Obj).$numberDecimal as string;
      const n = Number(s);
      return Number.isFinite(n) ? n : s;
    }
    case "uuid": {
      const o = v as Obj;
      return typeof o.$uuid === "string"
        ? o.$uuid
        : ((o.$binary as Obj)?.base64 as string) ?? null;
    }
    case "binary":
      return (((v as Obj).$binary as Obj)?.base64 as string) ?? null;
    case "regex": {
      const r = (v as Obj).$regularExpression as Obj;
      return `/${r?.pattern ?? ""}/${r?.options ?? ""}`;
    }
    case "timestamp": {
      const t = (v as Obj).$timestamp as Obj;
      return { t: Number(t?.t ?? 0), i: Number(t?.i ?? 0) };
    }
    case "code":
      return (v as Obj).$code as string;
    case "minKey":
      return "MinKey";
    case "maxKey":
      return "MaxKey";
    case "object": {
      const o = v as Obj;
      const out: Obj = {};
      for (const k of Object.keys(o)) out[k] = toPlainValue(o[k]);
      return out;
    }
  }
}

/** A value as pure JSON text — every BSON wrapper collapsed to a plain value. */
export function toPlainJson(v: unknown): string {
  return JSON.stringify(toPlainValue(v), null, 2);
}

/** The raw extJSON _id of a document (pass straight back to the backend). */
export function docId(doc: Obj): unknown {
  return doc._id;
}

/** Short _id label for card headers and confirmations. */
export function idLabel(doc: Obj): string {
  if (!("_id" in doc)) return "(no _id)";
  const id = doc._id;
  const k = kindOf(id);
  if (k === "objectId") return (id as Obj).$oid as string;
  const text = leafText(id);
  return text.length > 40 ? text.slice(0, 37) + "…" : text;
}

// ---------------------------------------------------------------------------
// misc formatting
// ---------------------------------------------------------------------------

export function formatBytes(n?: number | null): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = n / 1024;
  let u = 0;
  while (value >= 1024 && u < units.length - 1) {
    value /= 1024;
    u++;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[u]}`;
}

export function formatCount(n?: number | null): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-US");
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return "never used";
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "";
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}
