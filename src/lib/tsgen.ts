/**
 * TypeScript / Zod generator for a sampled collection shape.
 *
 * Input is the nested shape from `infer_schema_tree` plus the user's choices
 * (target, format, per-node overrides). Output is a list of highlighted code
 * lines - the UI renders the tokens directly, so the code is never an
 * editable buffer and every line knows which schema path it came from.
 *
 * Paths: `""` is the document, `a.b` a field, `a[]` the elements of array
 * `a`, `a{}` the values of an object treated as a map (Record).
 */

export interface ShapeNode {
  count: number;
  kinds: Record<string, number>;
  /** Object values seen here - the denominator for child `present`. */
  objects: number;
  fields: { name: string; present: number; shape: ShapeNode }[];
  capped: boolean;
  items: ShapeNode | null;
  /** Distinct string values with counts, when few enough to be an enum. */
  values: [string, number][] | null;
  examples: unknown[];
}

export interface SchemaTree {
  sampled: number;
  root: ShapeNode;
}

export type Target = "backend" | "frontend";
export type Format = "typescript" | "zod";
export type OidSource = "mongodb" | "bson" | "mongoose";

export interface GenOptions {
  format: Format;
  target: Target;
  rootName: string;
  /** TypeScript only. */
  declaration: "interface" | "type";
  exported: boolean;
  /** Fields missing from some documents become optional. */
  optional: boolean;
  /** Keep `null` in unions when it was observed. */
  nullable: boolean;
  /** Coverage / example comments above fields. */
  comments: boolean;
  /** Where backend BSON types are imported from. */
  oidSource: OidSource;
}

export interface NodeOverride {
  /** Pull this object out into its own named interface / schema. */
  extract?: boolean;
  name?: string;
  /** BSON-ish scalars (ObjectId, Date, Decimal128, ...): native class or string. */
  as?: "native" | "string";
  /** Emit the observed string values as a literal union / z.enum. */
  union?: boolean;
  /** Explicit optional flag; unset = from coverage. */
  optional?: boolean;
  /** Treat an object with dynamic keys as Record<string, T>. */
  record?: boolean;
}
export type Overrides = Record<string, NodeOverride>;

export type TokKind = "kw" | "decl" | "prop" | "type" | "ref" | "str" | "num" | "punc" | "com" | "fn" | "plain";
export interface Tok {
  k: TokKind;
  v: string;
}
export interface CodeLine {
  toks: Tok[];
  /** Schema path of the field declared on this line. */
  path?: string;
  /** Name of the declaration this line belongs to. */
  decl?: string;
}
export interface DeclInfo {
  name: string;
  path: string;
  /** First line of the declaration (0-based). */
  line: number;
  fields: number;
}
export interface GenResult {
  lines: CodeLine[];
  text: string;
  decls: DeclInfo[];
}

export const DEFAULT_OPTIONS: GenOptions = {
  format: "typescript",
  target: "backend",
  rootName: "Document",
  declaration: "interface",
  exported: true,
  optional: true,
  nullable: true,
  comments: false,
  oidSource: "mongodb",
};

// ---------------------------------------------------------------------------
// path + naming helpers (shared with the structure panel)
// ---------------------------------------------------------------------------

export const fieldPath = (parent: string, name: string) => (parent ? `${parent}.${name}` : name);
export const elemPath = (path: string) => `${path}[]`;
export const mapPath = (path: string) => `${path}{}`;

/** Scalars that have a native BSON class on the backend and a string form in JSON. */
export const BSONISH = new Set(["objectId", "date", "decimal", "binary", "timestamp", "regex"]);

export const hasKind = (n: ShapeNode | null | undefined, k: string) => !!n && (n.kinds[k] ?? 0) > 0;

/** "orders" -> "Order", "user_accounts" -> "UserAccount", "agendaJobs" -> "AgendaJob". */
export function typeName(raw: string, singular = false): string {
  let words = raw
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) words = ["Type"];
  if (singular) words[words.length - 1] = singularize(words[words.length - 1]);
  let name = words.map((w) => w[0].toUpperCase() + w.slice(1)).join("");
  if (/^[0-9]/.test(name)) name = `T${name}`;
  return name;
}

export function singularize(w: string): string {
  if (/ies$/i.test(w) && w.length > 4) return w.slice(0, -3) + "y";
  if (/(ss|us|is)$/i.test(w)) return w;
  if (/(ches|shes|xes|zes|sses)$/i.test(w)) return w.slice(0, -2);
  if (/s$/i.test(w) && w.length > 2) return w.slice(0, -1);
  return w;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const propKey = (name: string) => (IDENT.test(name) ? name : JSON.stringify(name));

/** Merge two shapes (used to build the value type of a Record). */
export function mergeShapes(a: ShapeNode, b: ShapeNode): ShapeNode {
  const kinds = { ...a.kinds };
  for (const [k, n] of Object.entries(b.kinds)) kinds[k] = (kinds[k] ?? 0) + n;
  const fields = a.fields.map((f) => ({ ...f }));
  for (const f of b.fields) {
    const i = fields.findIndex((x) => x.name === f.name);
    if (i < 0) fields.push({ ...f });
    else fields[i] = { name: f.name, present: fields[i].present + f.present, shape: mergeShapes(fields[i].shape, f.shape) };
  }
  let values: [string, number][] | null = null;
  if (a.values && b.values) {
    const m = new Map(a.values);
    for (const [v, n] of b.values) m.set(v, (m.get(v) ?? 0) + n);
    values = m.size <= 24 ? [...m.entries()].sort((x, y) => y[1] - x[1]) : null;
  }
  return {
    count: a.count + b.count,
    kinds,
    objects: a.objects + b.objects,
    fields,
    capped: a.capped || b.capped,
    items: a.items && b.items ? mergeShapes(a.items, b.items) : a.items ?? b.items,
    values: hasKind(a, "string") && hasKind(b, "string") ? values : a.values ?? b.values,
    examples: [...a.examples, ...b.examples].slice(0, 2),
  };
}

/** Value shape of an object used as a map: all its children merged. */
export function mapValueShape(n: ShapeNode): ShapeNode | null {
  if (n.fields.length === 0) return null;
  return n.fields.map((f) => f.shape).reduce(mergeShapes);
}

/** Should this object read as a map rather than a record type? Keys that look
 *  like ids, dates or numbers, or many sparse keys, give it away. */
export function looksLikeMap(n: ShapeNode): boolean {
  if (!hasKind(n, "object") || n.fields.length < 3) return false;
  const idish = /^([0-9a-f]{24}|[0-9a-f-]{36}|\d+|\d{4}-\d{2}(-\d{2})?)$/i;
  if (n.fields.every((f) => idish.test(f.name))) return true;
  if (n.capped) return true;
  if (n.fields.length < 25) return false;
  const avg = n.fields.reduce((a, f) => a + f.present, 0) / n.fields.length / Math.max(1, n.objects);
  return avg < 0.2;
}

/** A string field with few repeated values - a good literal union. */
export function suggestsUnion(n: ShapeNode): boolean {
  const v = n.values;
  if (!v || v.length < 2 || v.length > 12) return false;
  const strings = n.kinds.string ?? 0;
  return strings >= v.length * 3 && v.every(([s]) => s.length <= 32);
}

/** Is this node (or its array elements) an object that can be extracted? */
export function objectPathOf(n: ShapeNode, path: string): string | null {
  if (hasKind(n, "object")) return path;
  if (n.items && hasKind(n.items, "object")) return elemPath(path);
  return null;
}

// ---------------------------------------------------------------------------
// generator
// ---------------------------------------------------------------------------

interface Ctx {
  opts: GenOptions;
  ov: Overrides;
  names: Map<string, string>; // extracted path -> declaration name
  order: { path: string; node: ShapeNode }[]; // extracted nodes, pre-order
  natives: Set<string>; // BSON classes referenced
}

const NUMERIC = ["int", "long", "double"];

function isMap(ctx: Ctx, n: ShapeNode, path: string): boolean {
  const o = ctx.ov[path]?.record;
  return o ?? looksLikeMap(n);
}

/** Walk every object node in document order, naming the extracted ones. */
function collect(ctx: Ctx, n: ShapeNode, path: string, used: Set<string>) {
  const visitObject = (node: ShapeNode, p: string) => {
    if (p !== "" && ctx.ov[p]?.extract && hasKind(node, "object") && !isMap(ctx, node, p)) {
      const last = p.replace(/(\[\]|\{\})+$/, "").split(".").pop() ?? "Item";
      const isElem = /\[\]$/.test(p);
      let base = ctx.ov[p]?.name?.trim() || typeName(last, isElem);
      base = typeName(base);
      let name = base;
      for (let i = 2; used.has(name); i++) name = `${base}${i}`;
      used.add(name);
      ctx.names.set(p, name);
      ctx.order.push({ path: p, node });
    }
  };
  visitObject(n, path);
  if (hasKind(n, "object")) {
    if (path !== "" && isMap(ctx, n, path)) {
      const v = mapValueShape(n);
      if (v) collect(ctx, v, mapPath(path), used);
    } else {
      for (const f of n.fields) collect(ctx, f.shape, fieldPath(path, f.name), used);
    }
  }
  if (n.items) collect(ctx, n.items, elemPath(path), used);
}

class Writer {
  lines: CodeLine[] = [];
  cur: Tok[] = [];
  curPath: string | undefined;
  decl: string | undefined;
  t(k: TokKind, v: string) {
    this.cur.push({ k, v });
  }
  ind(level: number) {
    if (level > 0) this.cur.push({ k: "plain", v: "  ".repeat(level) });
  }
  mark(path: string) {
    if (this.curPath === undefined) this.curPath = path;
  }
  nl() {
    this.lines.push({ toks: this.cur, path: this.curPath, decl: this.decl });
    this.cur = [];
    this.curPath = undefined;
  }
}

type Emit = () => void;

/** Native class name for a BSON-ish kind, honouring the import source. */
function nativeName(ctx: Ctx, kind: string): string {
  const mongoose = ctx.opts.target === "backend" && ctx.opts.oidSource === "mongoose";
  const base: Record<string, string> = {
    objectId: "ObjectId",
    decimal: "Decimal128",
    binary: "Binary",
    timestamp: "Timestamp",
    regex: "BSONRegExp",
  };
  if (kind === "date") return "Date";
  const cls = base[kind];
  if (!cls) return "unknown";
  if (mongoose) {
    if (kind === "objectId" || kind === "decimal") {
      ctx.natives.add("Types");
      return `Types.${cls}`;
    }
    if (kind === "binary") return "Buffer";
    ctx.natives.add("mongo");
    return `mongo.${cls}`;
  }
  ctx.natives.add(cls);
  return cls;
}

function scalarAs(ctx: Ctx, path: string): "native" | "string" {
  return ctx.ov[path]?.as ?? (ctx.opts.target === "backend" ? "native" : "string");
}

function orderedKinds(ctx: Ctx, n: ShapeNode): string[] {
  const kinds = Object.entries(n.kinds)
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => k);
  const nonNull = kinds.filter((k) => k !== "null");
  const out: string[] = [];
  // Numeric kinds collapse into one member: "int" only when no doubles were seen.
  const numeric = nonNull.includes("double") ? "double" : "int";
  for (const k of nonNull) {
    if (!NUMERIC.includes(k)) out.push(k);
    else if (!out.includes(numeric)) out.push(numeric);
  }
  if (kinds.includes("null") && (ctx.opts.nullable || out.length === 0)) out.push("null");
  if (out.length === 0) out.push("unknown");
  return out;
}

// ---------------------------------------------------------------------------
// TypeScript
// ---------------------------------------------------------------------------

function tsMembers(ctx: Ctx, w: Writer, n: ShapeNode, path: string, level: number): Emit[] {
  const out: Emit[] = [];
  for (const k of orderedKinds(ctx, n)) {
    if (k === "string") {
      if (ctx.ov[path]?.union && n.values) {
        for (const [v] of n.values) out.push(() => w.t("str", JSON.stringify(v)));
      } else out.push(() => w.t("type", "string"));
    } else if (k === "int" || k === "double") out.push(() => w.t("type", "number"));
    else if (k === "bool") out.push(() => w.t("type", "boolean"));
    else if (k === "null") out.push(() => w.t("type", "null"));
    else if (k === "unknown") out.push(() => w.t("type", "unknown"));
    else if (BSONISH.has(k)) {
      out.push(() =>
        scalarAs(ctx, path) === "string" ? w.t("type", "string") : w.t(k === "date" ? "type" : "ref", nativeName(ctx, k))
      );
    } else if (k === "object") {
      out.push(() => tsObject(ctx, w, n, path, level));
    } else if (k === "array") {
      out.push(() => {
        const items = n.items;
        if (!items || items.count === 0) {
          w.t("type", "unknown");
          w.t("punc", "[]");
          return;
        }
        const inner = tsMembers(ctx, w, items, elemPath(path), level);
        if (inner.length > 1) w.t("punc", "(");
        inner.forEach((e, i) => {
          if (i) w.t("punc", " | ");
          e();
        });
        if (inner.length > 1) w.t("punc", ")");
        w.t("punc", "[]");
      });
    }
  }
  return out;
}

function tsObject(ctx: Ctx, w: Writer, n: ShapeNode, path: string, level: number) {
  const name = ctx.names.get(path);
  if (name) return w.t("ref", name);
  if (path !== "" && isMap(ctx, n, path)) {
    const v = mapValueShape(n);
    w.t("type", "Record");
    w.t("punc", "<");
    w.t("type", "string");
    w.t("punc", ", ");
    if (!v) w.t("type", "unknown");
    else {
      const members = tsMembers(ctx, w, v, mapPath(path), level);
      members.forEach((e, i) => {
        if (i) w.t("punc", " | ");
        e();
      });
    }
    w.t("punc", ">");
    return;
  }
  if (n.fields.length === 0) {
    w.t("type", "Record");
    w.t("punc", "<");
    w.t("type", "string");
    w.t("punc", ", ");
    w.t("type", "unknown");
    w.t("punc", ">");
    return;
  }
  w.t("punc", "{");
  w.nl();
  tsFields(ctx, w, n, path, level + 1);
  w.ind(level);
  w.t("punc", "}");
}

function comment(ctx: Ctx, n: ShapeNode, coverage: number): string | null {
  if (!ctx.opts.comments) return null;
  const parts: string[] = [];
  if (coverage < 1) parts.push(`in ${Math.round(coverage * 100)}% of documents`);
  const ex = n.examples.find((e) => e !== null && typeof e !== "object");
  if (ex !== undefined) parts.push(`e.g. ${JSON.stringify(ex).slice(0, 48)}`);
  return parts.length ? parts.join(" · ") : null;
}

export function isOptional(ctx: { opts: GenOptions; ov: Overrides }, path: string, present: number, objects: number) {
  return ctx.ov[path]?.optional ?? (ctx.opts.optional && present < objects);
}

function tsFields(ctx: Ctx, w: Writer, n: ShapeNode, path: string, level: number) {
  for (const f of n.fields) {
    const p = fieldPath(path, f.name);
    const cov = n.objects ? f.present / n.objects : 1;
    const c = comment(ctx, f.shape, cov);
    if (c) {
      w.ind(level);
      w.t("com", `/** ${c} */`);
      w.mark(p);
      w.nl();
    }
    w.ind(level);
    w.mark(p);
    w.t("prop", propKey(f.name));
    if (isOptional(ctx, p, f.present, n.objects)) w.t("punc", "?");
    w.t("punc", ": ");
    const members = tsMembers(ctx, w, f.shape, p, level);
    members.forEach((e, i) => {
      if (i) w.t("punc", " | ");
      e();
    });
    w.t("punc", ";");
    w.nl();
  }
}

function tsDecl(ctx: Ctx, w: Writer, name: string, n: ShapeNode, path: string) {
  w.decl = name;
  if (ctx.opts.exported) w.t("kw", "export ");
  if (ctx.opts.declaration === "interface") {
    w.t("kw", "interface ");
    w.t("decl", name);
    w.t("punc", " {");
  } else {
    w.t("kw", "type ");
    w.t("decl", name);
    w.t("punc", " = {");
  }
  w.nl();
  tsFields(ctx, w, n, path, 1);
  w.t("punc", ctx.opts.declaration === "interface" ? "}" : "};");
  w.nl();
}

// ---------------------------------------------------------------------------
// Zod
// ---------------------------------------------------------------------------

const zfn = (w: Writer, name: string) => {
  w.t("plain", "z.");
  w.t("fn", name);
  w.t("punc", "(");
};

function zodScalar(ctx: Ctx, w: Writer, k: string, n: ShapeNode, path: string, level: number) {
  if (k === "string") {
    if (ctx.ov[path]?.union && n.values) {
      zfn(w, "enum");
      w.t("punc", "[");
      n.values.forEach(([v], i) => {
        if (i) w.t("punc", ", ");
        w.t("str", JSON.stringify(v));
      });
      w.t("punc", "])");
    } else {
      zfn(w, "string");
      w.t("punc", ")");
    }
  } else if (k === "int" || k === "double") {
    zfn(w, "number");
    w.t("punc", ")");
    if (k === "int") {
      w.t("plain", ".");
      w.t("fn", "int");
      w.t("punc", "()");
    }
  } else if (k === "bool") {
    zfn(w, "boolean");
    w.t("punc", ")");
  } else if (k === "null") {
    zfn(w, "null");
    w.t("punc", ")");
  } else if (k === "unknown") {
    zfn(w, "unknown");
    w.t("punc", ")");
  } else if (BSONISH.has(k)) {
    const native = scalarAs(ctx, path) === "native";
    if (native && k === "date") {
      zfn(w, "date");
      w.t("punc", ")");
    } else if (native) {
      zfn(w, "instanceof");
      w.t("ref", nativeName(ctx, k));
      w.t("punc", ")");
    } else if (k === "objectId") {
      zfn(w, "string");
      w.t("punc", ")");
      w.t("plain", ".");
      w.t("fn", "regex");
      w.t("punc", "(");
      w.t("str", "/^[0-9a-f]{24}$/i");
      w.t("punc", ")");
    } else if (k === "date") {
      zfn(w, "string");
      w.t("punc", ")");
      w.t("plain", ".");
      w.t("fn", "datetime");
      w.t("punc", "()");
    } else {
      zfn(w, "string");
      w.t("punc", ")");
    }
  } else if (k === "object") {
    zodObject(ctx, w, n, path, level);
  } else if (k === "array") {
    zfn(w, "array");
    const items = n.items;
    if (!items || items.count === 0) {
      zfn(w, "unknown");
      w.t("punc", ")");
    } else zodValue(ctx, w, items, elemPath(path), level);
    w.t("punc", ")");
  }
}

/** Write a Zod expression for a node; an observed null folds into `.nullable()`. */
function zodValue(ctx: Ctx, w: Writer, n: ShapeNode, path: string, level: number) {
  const kinds = orderedKinds(ctx, n);
  const nonNull = kinds.filter((k) => k !== "null");
  const hasNull = kinds.includes("null") && nonNull.length > 0;
  if (nonNull.length === 1) {
    zodScalar(ctx, w, nonNull[0], n, path, level);
  } else if (nonNull.length === 0) {
    zfn(w, "null");
    w.t("punc", ")");
  } else {
    zfn(w, "union");
    w.t("punc", "[");
    nonNull.forEach((k, i) => {
      if (i) w.t("punc", ", ");
      zodScalar(ctx, w, k, n, path, level);
    });
    w.t("punc", "])");
  }
  if (hasNull) {
    w.t("plain", ".");
    w.t("fn", "nullable");
    w.t("punc", "()");
  }
}

function zodObject(ctx: Ctx, w: Writer, n: ShapeNode, path: string, level: number) {
  const name = ctx.names.get(path);
  if (name) return w.t("ref", `${name}Schema`);
  if ((path !== "" && isMap(ctx, n, path)) || n.fields.length === 0) {
    const v = path !== "" ? mapValueShape(n) : null;
    zfn(w, "record");
    zfn(w, "string");
    w.t("punc", "), ");
    if (v) zodValue(ctx, w, v, mapPath(path), level);
    else {
      zfn(w, "unknown");
      w.t("punc", ")");
    }
    w.t("punc", ")");
    return;
  }
  zfn(w, "object");
  w.t("punc", "{");
  w.nl();
  zodFields(ctx, w, n, path, level + 1);
  w.ind(level);
  w.t("punc", "})");
}

function zodFields(ctx: Ctx, w: Writer, n: ShapeNode, path: string, level: number) {
  for (const f of n.fields) {
    const p = fieldPath(path, f.name);
    const cov = n.objects ? f.present / n.objects : 1;
    const c = comment(ctx, f.shape, cov);
    if (c) {
      w.ind(level);
      w.t("com", `// ${c}`);
      w.mark(p);
      w.nl();
    }
    w.ind(level);
    w.mark(p);
    w.t("prop", propKey(f.name));
    w.t("punc", ": ");
    zodValue(ctx, w, f.shape, p, level);
    if (isOptional(ctx, p, f.present, n.objects)) {
      w.t("plain", ".");
      w.t("fn", "optional");
      w.t("punc", "()");
    }
    w.t("punc", ",");
    w.nl();
  }
}

function zodDecl(ctx: Ctx, w: Writer, name: string, n: ShapeNode, path: string) {
  w.decl = name;
  if (ctx.opts.exported) w.t("kw", "export ");
  w.t("kw", "const ");
  w.t("decl", `${name}Schema`);
  w.t("punc", " = ");
  zfn(w, "object");
  w.t("punc", "{");
  w.nl();
  zodFields(ctx, w, n, path, 1);
  w.t("punc", "});");
  w.nl();
  if (ctx.opts.exported) w.t("kw", "export ");
  w.t("kw", "type ");
  w.t("decl", name);
  w.t("punc", " = ");
  w.t("plain", "z.");
  w.t("type", "infer");
  w.t("punc", "<");
  w.t("kw", "typeof ");
  w.t("ref", `${name}Schema`);
  w.t("punc", ">;");
  w.nl();
}

// ---------------------------------------------------------------------------

function importSource(opts: GenOptions): string {
  if (opts.target === "frontend") return "bson";
  return opts.oidSource;
}

export function generate(tree: SchemaTree, opts: GenOptions, ov: Overrides): GenResult {
  const rootName = typeName(opts.rootName || "Document");
  const ctx: Ctx = { opts, ov, names: new Map(), order: [], natives: new Set() };
  const used = new Set([rootName]);
  collect(ctx, tree.root, "", used);

  const body = new Writer();
  const decls: DeclInfo[] = [];
  const all = [{ path: "", node: tree.root, name: rootName }, ...ctx.order.map((o) => ({ ...o, name: ctx.names.get(o.path)! }))];
  // Zod consts must be declared before use: children first, root last.
  const sequence = opts.format === "zod" ? [...all].reverse() : all;
  sequence.forEach((d, i) => {
    if (i) {
      body.decl = undefined;
      body.nl();
    }
    decls.push({ name: d.name, path: d.path, line: body.lines.length, fields: d.node.fields.length });
    if (opts.format === "zod") zodDecl(ctx, body, d.name, d.node, d.path);
    else tsDecl(ctx, body, d.name, d.node, d.path);
  });

  // Header: imports, now that we know which classes were used.
  const head = new Writer();
  if (opts.format === "zod") {
    head.t("kw", "import ");
    head.t("punc", "{ ");
    head.t("plain", "z");
    head.t("punc", " } ");
    head.t("kw", "from ");
    head.t("str", '"zod"');
    head.t("punc", ";");
    head.nl();
  }
  if (ctx.natives.size > 0) {
    const names = [...ctx.natives].sort();
    head.t("kw", opts.format === "zod" ? "import " : "import type ");
    head.t("punc", "{ ");
    names.forEach((n, i) => {
      if (i) head.t("punc", ", ");
      head.t("ref", n);
    });
    head.t("punc", " } ");
    head.t("kw", "from ");
    head.t("str", JSON.stringify(importSource(opts)));
    head.t("punc", ";");
    head.nl();
  }
  if (head.lines.length) head.nl();

  const offset = head.lines.length;
  const lines = [...head.lines, ...body.lines];
  for (const d of decls) d.line += offset;
  // Show declarations in document order in the UI, whatever the emit order.
  decls.sort((a, b) => (a.path === "" ? -1 : b.path === "" ? 1 : all.findIndex((x) => x.path === a.path) - all.findIndex((x) => x.path === b.path)));
  const text = lines.map((l) => l.toks.map((t) => t.v).join("")).join("\n") + "\n";
  return { lines, text, decls };
}
