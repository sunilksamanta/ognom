/**
 * Browser-only Tauri shim for `npm run dev` outside the desktop shell. Lets
 * the whole UI be exercised (and screenshotted) against an in-memory MongoDB
 * stand-in. Never bundled into the app: main.tsx imports it only when
 * `import.meta.env.DEV` and no real `__TAURI_INTERNALS__` exists.
 */
type Doc = Record<string, unknown>;

const oid = (n: number) => ({ $oid: (0x6712a4f0c9e1b3d84a02f000 + n).toString(16).padStart(24, "0") });
const date = (daysAgo: number, h = 9) => ({
  $date: new Date(Date.UTC(2026, 7, 14 - daysAgo, h, 12, 4)).toISOString(),
});
const names = ["Amara Okafor", "Tobias Lind", "Priya Raman", "Jonas Weber", "Mei Tanaka", "Leo Marchetti", "Sofia Ruiz", "Ade Balogun", "Hanna Nyberg", "Youssef Haddad", "Clara Fontaine", "Ravi Kapoor"];
const tiers = ["gold", "free", "gold", "silver", "gold", "free", "silver", "gold", "free", "gold", "silver", "free"];
const statuses = ["paid", "refunded", "paid", "paid", "paid", "pending", "paid", "paid", "refunded", "paid", "paid", "pending"];

const orders: Doc[] = Array.from({ length: 60 }, (_, i) => ({
  _id: oid(0x118 + i),
  customer: { name: names[i % 12], tier: tiers[i % 12] },
  status: statuses[i % 12],
  total: Math.round((28.75 + (i * 137.3) % 2200) * 100) / 100,
  currency: "USD",
  refunded: statuses[i % 12] === "refunded",
  items: [
    { sku: "KB-91-BLK", qty: 1 },
    { sku: "MS-04-WHT", qty: 2 },
  ].slice(0, 1 + (i % 2)),
  createdAt: date(i % 9, 9 + (i % 12)),
  updatedAt: date(i % 9, 10),
}));
const users: Doc[] = names.map((n, i) => ({
  _id: oid(0x300 + i),
  name: n,
  email: `${n.toLowerCase().replace(" ", ".")}@example.com`,
  tier: tiers[i],
  active: i % 3 !== 0,
  signupAt: date(30 + i),
}));

const risks = ["RED", "AMBER", "GREEN"];
const patientProfiles: Doc[] = Array.from({ length: 40 }, (_, i) => ({
  _id: oid(0x500 + i),
  userId: oid(0x300 + (i % 12)),
  email: `user${i}@example.com`,
  gender: i % 2 ? "M" : "F",
  dateOfBirth: date(9000 + i * 40),
  riskLevel: risks[i % 3],
  trend: ["STABLE", "IMPROVING", "DECLINING"][i % 3],
  totalScore: (i * 7) % 30,
  ...(i % 4 ? { assessmentDates: { phase1: date(i), phase2: i % 3 ? null : date(i + 1) } } : {}),
  engagementScore: i % 5 === 0 ? 0.5 : i % 10,
  lastAppointment: i % 6 ? oid(0x900 + i) : null,
  isActive: i % 7 !== 0,
  trendSummary: {
    who5: { score: i % 25, trend: "STABLE" },
    gad2: { score: i % 6, trend: risks[i % 3] === "RED" ? "UP" : "STABLE" },
  },
  sessions: Array.from({ length: i % 3 }, (_, j) => ({ at: date(j), durationMin: 30 + j * 15, therapistId: oid(0x700 + j), notes: j ? "follow-up" : null })),
  tags: i % 2 ? ["priority"] : [],
  createdAt: date(i % 20),
  updatedAt: date(i % 5),
}));

/** Nested shape inference mirroring src-tauri/src/typetree.rs, over relaxed extJSON. */
type Shape = { count: number; kinds: Record<string, number>; objects: number; fields: { name: string; present: number; shape: Shape }[]; capped: boolean; items: Shape | null; values: [string, number][] | null; examples: unknown[]; _vals?: Map<string, number> | null };
const newShape = (): Shape => ({ count: 0, kinds: {}, objects: 0, fields: [], capped: false, items: null, values: null, examples: [], _vals: new Map() });
function kindOfJson(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "double";
  const o = v as Doc;
  if ("$oid" in o) return "objectId";
  if ("$date" in o) return "date";
  if ("$numberDecimal" in o) return "decimal";
  if ("$numberLong" in o) return "long";
  return "object";
}
function addValue(s: Shape, v: unknown) {
  s.count++;
  const k = kindOfJson(v);
  s.kinds[k] = (s.kinds[k] ?? 0) + 1;
  if (k === "object") addFields(s, v as Doc);
  else if (k === "array") {
    s.items ??= newShape();
    for (const e of v as unknown[]) addValue(s.items, e);
  } else if (k === "string" && s._vals) {
    s._vals.set(v as string, (s._vals.get(v as string) ?? 0) + 1);
    if (s._vals.size > 24 || (v as string).length > 64) s._vals = null;
  }
  if (s.examples.length < 2 && k !== "object" && k !== "array" && !s.examples.includes(v)) s.examples.push(v);
}
function addFields(s: Shape, d: Doc) {
  s.objects++;
  for (const [k, v] of Object.entries(d)) {
    let f = s.fields.find((x) => x.name === k);
    if (!f) s.fields.push((f = { name: k, present: 0, shape: newShape() }));
    f.present++;
    addValue(f.shape, v);
  }
}
function finish(s: Shape): Shape {
  const onlyStrings = Object.keys(s.kinds).every((k) => k === "string" || k === "null");
  const values = s._vals && s.kinds.string && onlyStrings ? [...s._vals.entries()].sort((a, b) => b[1] - a[1]) : null;
  return { ...s, values, _vals: undefined, items: s.items && finish(s.items), fields: s.fields.map((f) => ({ ...f, shape: finish(f.shape) })) };
}

const store: Record<string, Record<string, Doc[]>> = {
  api: { orders, users, profiles: patientProfiles, payments: orders.slice(0, 20), products: users.slice(0, 5), sessions: [], webhooks: [], audit_log: [] },
  shop: { customers: users, carts: [] },
  admin: {},
};

const profiles = [
  { id: "p1", name: "TEST", color: "#00ED64", access: "readwrite", kind: "fields", hostSummary: "localhost:27017", srv: false, tls: false, hasSecret: false, ssh: { enabled: false, host: "", port: 22, username: "", auth: "key", keyPath: null }, hasSshSecret: false, fields: { scheme: "mongodb", host: "localhost", port: 27017, extraHosts: [], directConnection: false, tlsEnabled: false, tlsInsecure: false }, lastUsedAt: new Date().toISOString() },
  { id: "p2", name: "staging", color: "#7FE1FF", access: "readonly", kind: "uri", hostSummary: "mongodb+srv://ops@staging.mongodb.net/app", srv: true, tls: true, hasSecret: true, ssh: { enabled: false, host: "", port: 22, username: "", auth: "key", keyPath: null }, hasSshSecret: false, fields: { scheme: "mongodb+srv", host: "staging.mongodb.net", username: "ops", defaultDatabase: "app", extraHosts: [], directConnection: false, tlsEnabled: false, tlsInsecure: false }, lastUsedAt: null },
  { id: "p3", name: "prod", color: "#F0705F", access: "production", kind: "uri", hostSummary: "mongodb://app@10.0.3.12:27017", srv: false, tls: false, hasSecret: true, ssh: { enabled: true, host: "bastion.example.com", port: 22, username: "ubuntu", auth: "key", keyPath: "~/.ssh/id_ed25519" }, hasSshSecret: false, fields: { scheme: "mongodb", host: "10.0.3.12", port: 27017, username: "app", extraHosts: [], directConnection: false, tlsEnabled: false, tlsInsecure: false }, lastUsedAt: null },
];

const info = (p: (typeof profiles)[number]) => ({
  id: p.id,
  profileId: p.id,
  name: p.name,
  hostSummary: p.hostSummary,
  serverVersion: "7.0.11",
  topology: "Replica set · rs0",
  latencyMs: 12,
  color: p.color,
  access: p.access,
  ssh: p.ssh.enabled ? `${p.ssh.username}@${p.ssh.host}` : null,
});

let seq = 0;
const listeners = new Map<number, (e: unknown) => void>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Very small subset of the shell filter syntax: `{}` or `{ field: value }`. */
function matches(doc: Doc, filter: string): boolean {
  const f = filter.trim();
  if (!f || f === "{}") return true;
  const m = f.match(/^\{\s*([\w.]+)\s*:\s*("([^"]*)"|'([^']*)'|(-?[\d.]+)|(true|false))\s*\}$/);
  if (!m) return true;
  const key = m[1];
  const val = m[3] ?? m[4] ?? (m[5] !== undefined ? Number(m[5]) : m[6] === "true");
  const got = key.split(".").reduce<unknown>((o, k) => (o as Doc | undefined)?.[k], doc);
  return got === val;
}

async function invoke(cmd: string, args: Record<string, unknown> = {}): Promise<unknown> {
  await sleep(cmd.startsWith("plugin:") ? 0 : 60);
  switch (cmd) {
    case "plugin:app|version":
      return "2.0.0";
    case "plugin:event|listen":
      return ++seq;
    case "plugin:event|unlisten":
      return null;
    case "plugin:window|start_dragging":
    case "plugin:window|toggle_maximize":
      return null;
    case "app_env":
      return "macOS · arm64";
    case "security_info":
      return { secretBackend: "keychain", degraded: false };
    case "list_connections":
      return profiles;
    case "save_connection": {
      const input = args.input as Doc;
      const p = { ...(profiles[0] as Doc), id: `p${Date.now()}`, ...input, hostSummary: (input.fields as Doc)?.host ?? "mongodb+srv://new", hasSecret: !!input.password };
      profiles.push(p as never);
      return p;
    }
    case "test_connection":
      return { ok: true, serverVersion: "7.0.11", topology: "Replica set · rs0", latencyMs: 24 };
    case "connect":
      return info(profiles.find((p) => p.id === args.profileId)!);
    case "connect_input":
      return { ...info(profiles[0]), id: `adhoc-${++seq}`, profileId: null, name: (args.input as Doc).name || "Unsaved" };
    case "switch_workspace":
      return info(profiles.find((p) => p.id === args.id) ?? profiles[0]);
    case "disconnect_workspace":
    case "disconnect":
      return null;
    case "list_databases":
      return Object.keys(store).map((name) => ({ name, sizeOnDisk: name === "api" ? 44_700_000 : 1_200_000, empty: false }));
    case "list_collections":
      return Object.keys(store[args.database as string] ?? {}).map((name) => ({ name, kind: "collection" }));
    case "collection_counts":
      return Object.fromEntries(Object.entries(store[args.database as string] ?? {}).map(([n, d]) => [n, d.length]));
    case "collection_stats": {
      const docs = store[args.database as string]?.[args.collection as string] ?? [];
      return { count: docs.length, size: docs.length * 4400, avgObjSize: 4400, storageSize: docs.length * 5100, totalIndexSize: 49_152, nindexes: 2 };
    }
    case "count_documents": {
      const docs = store[args.database as string]?.[args.collection as string] ?? [];
      return { count: docs.filter((d) => matches(d, args.filter as string)).length, exact: true, execMs: 3 };
    }
    case "find_documents": {
      const req = args.req as { database: string; collection: string; filter: string; limit: number; skip: number };
      const docs = (store[req.database]?.[req.collection] ?? []).filter((d) => matches(d, req.filter));
      return { docs: docs.slice(req.skip, req.skip + req.limit), execMs: 12, appliedDefaultLimit: false };
    }
    case "explain_query":
      return { indexName: "status_1_total_-1", stages: ["IXSCAN", "FETCH"], isCollectionScan: false, nReturned: 12, totalDocsExamined: 12, totalKeysExamined: 12, executionTimeMillis: 1, raw: {} };
    case "list_indexes":
      return [
        { name: "_id_", keys: { _id: 1 }, unique: true, sparse: false, hidden: false, usageOps: 1240 },
        { name: "status_1_total_-1", keys: { status: 1, total: -1 }, unique: false, sparse: false, hidden: false, usageOps: 88 },
      ];
    case "analyze_schema":
      return { sampled: 60, fields: [
        { path: "_id", present: 60, coverage: 1, types: [{ type: "objectId", count: 60 }], examples: [] },
        { path: "customer", present: 60, coverage: 1, types: [{ type: "object", count: 60 }], examples: [] },
        { path: "customer.name", present: 60, coverage: 1, types: [{ type: "string", count: 60 }], examples: ["Amara Okafor"] },
        { path: "status", present: 60, coverage: 1, types: [{ type: "string", count: 60 }], examples: ["paid", "refunded"] },
        { path: "total", present: 60, coverage: 1, types: [{ type: "double", count: 60 }], examples: [248.9] },
        { path: "items", present: 60, coverage: 1, types: [{ type: "array", count: 60 }], examples: [] },
        { path: "createdAt", present: 58, coverage: 0.97, types: [{ type: "date", count: 58 }], examples: [] },
      ] };
    case "infer_schema_tree": {
      const docs = store[args.database as string]?.[args.collection as string] ?? [];
      const root = newShape();
      root.count = docs.length;
      root.kinds = docs.length ? { object: docs.length } : {};
      for (const d of docs) addFields(root, d);
      return { sampled: docs.length, root: finish(root) };
    }
    case "collection_fields":
      return ["_id", "customer.name", "customer.tier", "status", "total", "items", "createdAt"];
    case "aggregate_collection":
      return { docs: orders.slice(0, 5), execMs: 8, appliedDefaultLimit: false };
    case "aggregate_stage_stats":
      return (args.stages as unknown[]).map((_, i) => ({ op: "$match", docs: 60 - i * 20, cumulativeMs: 2 + i }));
    case "insert_document":
    case "replace_document":
      return { insertedId: oid(999), matched: 1, modified: 1 };
    case "delete_document":
      return { deleted: 1 };
    case "bulk_delete":
      return { deleted: 3, execMs: 4 };
    case "bulk_update":
      return { matched: 3, modified: 3, execMs: 4 };
    case "drop_collection":
    case "clear_collection":
      return 0;
    case "run_shell":
      return { kind: "docs", docs: orders.slice(0, 8), execMs: 5, appliedDefaultLimit: false };
    case "server_info":
      return { buildInfo: { version: "7.0.11" }, hello: { setName: "rs0" }, serverStatus: null, hostInfo: null, connectionStatus: null };
    case "server_status_light":
      return { connections: { current: 3 }, opcounters: { query: 10 } };
    case "current_ops":
      return [];
    case "profiler_status":
      return { was: 0, slowms: 100 };
    case "profiler_entries":
      return [];
    case "ping_workspace":
      return 8 + Math.round(Math.random() * 30);
    case "save_text_file":
      return null;
    case "db_overview": {
      const colls = store[args.database as string] ?? {};
      return {
        database: args.database,
        refsSkipped: 0,
        collections: Object.entries(colls).map(([name, docs], i) => ({
          name,
          kind: "collection",
          count: name === "audit_log" ? 184_220 : docs.length,
          size: docs.length * 4400,
          avgObjSize: docs.length ? 4400 : null,
          storageSize: docs.length * 5100,
          totalIndexSize: name === "payments" ? 400_000 : 36_864 * (i + 1),
          nindexes: name === "audit_log" ? 1 : 2,
          capped: name === "sessions",
          validated: name === "users",
          refs: name === "orders" ? [{ field: "userId", to: "users" }] : name === "payments" ? [{ field: "orderId", to: "orders" }] : [],
        })),
      };
    }
    default:
      console.warn("[mockTauri] unhandled", cmd, args);
      return null;
  }
}

(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke,
  transformCallback: (cb: (e: unknown) => void) => {
    const id = ++seq;
    listeners.set(id, cb);
    return id;
  },
  unregisterCallback: (id: number) => listeners.delete(id),
  convertFileSrc: (p: string) => p,
  metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
};

export {};
