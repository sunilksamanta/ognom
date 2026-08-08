import { invoke } from "@tauri-apps/api/core";

/** A document in MongoDB relaxed Extended JSON form. */
export type Doc = Record<string, unknown>;

export interface ConnFields {
  scheme: "mongodb" | "mongodb+srv";
  host: string;
  port?: number | null;
  extraHosts: string[];
  username?: string | null;
  authSource?: string | null;
  authMechanism?: string | null;
  defaultDatabase?: string | null;
  replicaSet?: string | null;
  directConnection: boolean;
  readPreference?: string | null;
  tlsEnabled: boolean;
  tlsInsecure: boolean;
  tlsCaFile?: string | null;
  tlsCertKeyFile?: string | null;
  connectTimeoutMs?: number | null;
  serverSelectionTimeoutMs?: number | null;
  maxPoolSize?: number | null;
  extraOptions?: string | null;
}

export const emptyFields = (): ConnFields => ({
  scheme: "mongodb",
  host: "localhost",
  port: 27017,
  extraHosts: [],
  directConnection: false,
  tlsEnabled: false,
  tlsInsecure: false,
});

export type ProfileKind = "fields" | "uri";

export interface ProfileInput {
  id?: string | null;
  name: string;
  color?: string | null;
  kind: ProfileKind;
  fields: ConnFields;
  uri?: string | null;
  password?: string | null;
}

export interface ProfileSummary {
  id: string;
  name: string;
  color?: string | null;
  kind: ProfileKind;
  hostSummary: string;
  srv: boolean;
  tls: boolean;
  hasSecret: boolean;
  fields: ConnFields;
  lastUsedAt?: string | null;
}

export interface ConnectionInfo {
  /** Workspace id — pool key. Profile id for saved connections, `adhoc-N` otherwise. */
  id: string;
  profileId?: string | null;
  name: string;
  hostSummary: string;
  serverVersion: string;
  topology: string;
  latencyMs: number;
}

export interface TestResult {
  ok: boolean;
  serverVersion?: string | null;
  topology?: string | null;
  latencyMs?: number | null;
  error?: string | null;
}

/**
 * Raw admin-command output for the server-details dialog. Each section is the
 * relaxed-extJSON result of one command, or `null` when the deployment forbids
 * it (Atlas restricts hostInfo / serverStatus on some tiers).
 */
export interface ServerInfoRaw {
  buildInfo: Doc | null;
  hello: Doc | null;
  serverStatus: Doc | null;
  hostInfo: Doc | null;
  connectionStatus: Doc | null;
}

/** Peek at a connections export file before importing. */
export interface ImportPreview {
  encrypted: boolean;
  count: number;
  exportedAt?: string | null;
}

export interface ImportOutcome {
  imported: number;
  /** How many imported connections still need a password / connection string. */
  needsPassword: number;
}

export interface SecurityInfo {
  secretBackend: "keychain" | "file";
  /** Keychain was requested but unavailable; key file is in use. */
  degraded: boolean;
}

export interface DbInfo {
  name: string;
  sizeOnDisk?: number | null;
  empty?: boolean | null;
}

export interface CollInfo {
  name: string;
  kind: string; // "collection" | "view" | "timeseries"
}

export interface DocsPage {
  docs: Doc[];
  execMs: number;
  appliedDefaultLimit: boolean;
}

export interface CountResult {
  count?: number | null;
  exact: boolean;
  execMs: number;
}

export interface FindRequest {
  database: string;
  collection: string;
  filter: string;
  sort: string;
  projection: string;
  limit: number;
  skip: number;
}

export interface StageInput {
  op: string;
  body: string;
}

export interface CopyRequest {
  /** Source workspace id; omit for the active workspace. */
  sourceWorkspace?: string | null;
  sourceDatabase: string;
  sourceCollection: string;
  targetWorkspace: string;
  targetDatabase: string;
  targetCollection: string;
  /** mongosh-flavored filter; empty copies everything. */
  filter: string;
  copyIndexes: boolean;
  /** Caller-chosen id used for `copy-progress` events and cancellation. */
  jobId: string;
}

/** Payload of the `copy-progress` Tauri event. */
export interface CopyProgress {
  jobId: string;
  copied: number;
  /** Best-effort total; null means indeterminate. */
  total?: number | null;
}

export interface CopyOutcome {
  documents: number;
  indexes: number;
  canceled: boolean;
  execMs: number;
}

export interface DiffRequest {
  /** Source workspace id; omit for the active workspace. */
  sourceWorkspace?: string | null;
  sourceDatabase: string;
  sourceCollection: string;
  targetWorkspace: string;
  targetDatabase: string;
  targetCollection: string;
  /** mongosh-flavored filter applied to both sides; empty diffs everything. */
  filter: string;
  /** Caller-chosen id used for `diff-progress` events and cancellation. */
  jobId: string;
}

/** Payload of the `diff-progress` Tauri event. */
export interface DiffProgress {
  jobId: string;
  /** "source" while scanning the source side, "target" for the reverse pass. */
  phase: string;
  processed: number;
  total?: number | null;
}

export interface DiffEntry {
  /** Document `_id` in extJSON form — pass back verbatim to syncDocuments. */
  id: unknown;
  source?: Doc | null;
  target?: Doc | null;
}

export interface DiffOutcome {
  identical: number;
  changed: number;
  onlyInSource: number;
  onlyInTarget: number;
  changedDocs: DiffEntry[];
  onlyInSourceDocs: DiffEntry[];
  onlyInTargetDocs: DiffEntry[];
  /** A detail list hit its cap; the counts are still complete. */
  truncated: boolean;
  canceled: boolean;
  execMs: number;
}

export interface SyncRequest {
  sourceWorkspace?: string | null;
  sourceDatabase: string;
  sourceCollection: string;
  targetWorkspace: string;
  targetDatabase: string;
  targetCollection: string;
  /** "copy" upserts the source version onto the target; "delete" removes from the target. */
  action: "copy" | "delete";
  ids: unknown[];
}

export interface IndexInfo {
  name: string;
  keys: Doc;
  unique: boolean;
  sparse: boolean;
  hidden: boolean;
  ttlSeconds?: number | null;
  partialFilter?: Doc | null;
  /** Operations served since the stats epoch; null when $indexStats is unavailable. */
  usageOps?: number | null;
  /** ISO timestamp the usage counter has been accumulating since. */
  usageSince?: string | null;
}

/** One stage's profile from aggregate_stage_stats. */
export interface StageStat {
  op: string;
  /** Documents flowing out of this stage. */
  docs: number;
  /** Wall time for the whole pipeline prefix ending at this stage. */
  cumulativeMs: number;
}

export interface ExplainSummary {
  indexName: string | null;
  stages: string[];
  isCollectionScan: boolean;
  nReturned: number | null;
  totalDocsExamined: number | null;
  totalKeysExamined: number | null;
  executionTimeMillis: number | null;
  /** ESR-ordered index keys suggested when the plan is a collection scan. */
  suggestedIndex?: Doc | null;
  raw: Doc;
}

export interface SchemaFieldType {
  type: string;
  count: number;
}

export interface SchemaField {
  path: string;
  present: number;
  coverage: number; // 0..1
  types: SchemaFieldType[];
  examples: unknown[];
}

export interface SchemaReport {
  sampled: number;
  fields: SchemaField[];
}

export interface CollectionStats {
  count?: number | null;
  size?: number | null;
  avgObjSize?: number | null;
  storageSize?: number | null;
  totalIndexSize?: number | null;
  nindexes?: number | null;
}

export interface ShellOutcome {
  kind: "docs" | "value" | "message" | "useDb";
  docs?: Doc[] | null;
  value?: unknown;
  message?: string | null;
  useDb?: string | null;
  execMs: number;
  appliedDefaultLimit: boolean;
}

export interface AiChatResult {
  content: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export const api = {
  // connections
  securityInfo: () => invoke<SecurityInfo>("security_info"),
  setSecretBackend: (backend: "keychain" | "file") =>
    invoke<SecurityInfo>("set_secret_backend", { backend }),
  listConnections: () => invoke<ProfileSummary[]>("list_connections"),
  saveConnection: (input: ProfileInput) => invoke<ProfileSummary>("save_connection", { input }),
  deleteConnection: (id: string) => invoke<void>("delete_connection", { id }),
  testConnection: (args: { input?: ProfileInput; profileId?: string }) =>
    invoke<TestResult>("test_connection", args),
  connect: (profileId: string) => invoke<ConnectionInfo>("connect", { profileId }),
  connectInput: (input: ProfileInput) => invoke<ConnectionInfo>("connect_input", { input }),
  switchWorkspace: (id: string) => invoke<ConnectionInfo>("switch_workspace", { id }),
  disconnectWorkspace: (id: string) => invoke<void>("disconnect_workspace", { id }),
  disconnect: () => invoke<void>("disconnect"),
  connectionUri: (profileId: string, includePassword: boolean) =>
    invoke<string>("connection_uri", { profileId, includePassword }),
  exportConnections: (args: {
    ids?: string[];
    includeSecrets: boolean;
    passphrase?: string;
    path: string;
  }) => invoke<number>("export_connections", args),
  inspectConnectionImport: (path: string) =>
    invoke<ImportPreview>("inspect_connection_import", { path }),
  importConnections: (path: string, passphrase?: string) =>
    invoke<ImportOutcome>("import_connections", { path, passphrase }),
  serverInfo: () => invoke<ServerInfoRaw>("server_info"),

  // metadata — pass a workspace id to read a non-active open connection
  listDatabases: (workspace?: string) => invoke<DbInfo[]>("list_databases", { workspace }),
  listCollections: (database: string, workspace?: string) =>
    invoke<CollInfo[]>("list_collections", { database, workspace }),

  // documents
  findDocuments: (req: FindRequest) => invoke<DocsPage>("find_documents", { req }),
  countDocuments: (database: string, collection: string, filter: string) =>
    invoke<CountResult>("count_documents", { database, collection, filter }),
  aggregate: (
    database: string,
    collection: string,
    stages: StageInput[],
    allowDiskUse: boolean,
    readOnly?: boolean
  ) =>
    invoke<DocsPage>("aggregate_collection", {
      database,
      collection,
      stages,
      allowDiskUse,
      readOnly,
    }),
  aggregateStageStats: (
    database: string,
    collection: string,
    stages: StageInput[],
    allowDiskUse: boolean
  ) =>
    invoke<StageStat[]>("aggregate_stage_stats", { database, collection, stages, allowDiskUse }),
  insertDocument: (database: string, collection: string, docText: string) =>
    invoke<{ insertedId: unknown }>("insert_document", { database, collection, docText }),
  replaceDocument: (database: string, collection: string, id: unknown, docText: string) =>
    invoke<{ matched: number; modified: number }>("replace_document", {
      database,
      collection,
      id,
      docText,
    }),
  deleteDocument: (database: string, collection: string, id: unknown) =>
    invoke<{ deleted: number }>("delete_document", { database, collection, id }),

  bulkUpdate: (database: string, collection: string, filter: string, update: string) =>
    invoke<{ matched: number; modified: number; execMs: number }>("bulk_update", {
      database,
      collection,
      filter,
      update,
    }),
  bulkDelete: (database: string, collection: string, filter: string) =>
    invoke<{ deleted: number; execMs: number }>("bulk_delete", { database, collection, filter }),

  // collection operations
  dropCollection: (database: string, collection: string) =>
    invoke<void>("drop_collection", { database, collection }),
  clearCollection: (database: string, collection: string) =>
    invoke<number>("clear_collection", { database, collection }),
  duplicateCollection: (database: string, source: string, target: string) =>
    invoke<{ documents: number; indexes: number }>("duplicate_collection", {
      database,
      source,
      target,
    }),
  copyCollection: (req: CopyRequest) => invoke<CopyOutcome>("copy_collection", { req }),
  diffCollections: (req: DiffRequest) => invoke<DiffOutcome>("diff_collections", { req }),
  syncDocuments: (req: SyncRequest) => invoke<number>("sync_documents", { req }),
  cancelJob: (jobId: string) => invoke<void>("cancel_job", { jobId }),

  // indexes & stats
  listIndexes: (database: string, collection: string) =>
    invoke<IndexInfo[]>("list_indexes", { database, collection }),
  createIndex: (args: {
    database: string;
    collection: string;
    keysText: string;
    name?: string;
    unique: boolean;
    ttlSeconds?: number;
    sparse?: boolean;
    hidden?: boolean;
    partialFilterText?: string;
    collationLocale?: string;
  }) => invoke<string>("create_index", args),
  dropIndex: (database: string, collection: string, name: string) =>
    invoke<void>("drop_index", { database, collection, name }),
  collectionStats: (database: string, collection: string) =>
    invoke<CollectionStats>("collection_stats", { database, collection }),

  // explain / schema / export / import
  explainQuery: (args: {
    database: string;
    collection: string;
    filter: string;
    sort: string;
    projection: string;
    pipelineStages?: StageInput[];
    verbosity?: string;
  }) => invoke<ExplainSummary>("explain_query", args),
  analyzeSchema: (database: string, collection: string, sampleSize?: number) =>
    invoke<SchemaReport>("analyze_schema", { database, collection, sampleSize }),
  collectionFields: (database: string, collection: string, limit?: number) =>
    invoke<string[]>("collection_fields", { database, collection, limit }),
  exportCollection: (args: {
    database: string;
    collection: string;
    filter: string;
    sort: string;
    format: "json" | "csv" | "ndjson" | "bson";
    path: string;
    /** Enables `copy-progress` events and cancellation via cancelJob. */
    jobId?: string;
  }) => invoke<CopyOutcome>("export_collection", args),
  importDocuments: (database: string, collection: string, path: string, jobId?: string) =>
    invoke<CopyOutcome>("import_documents", { database, collection, path, jobId }),

  // Ognom Studio
  saveFile: (path: string, contentsBase64: string) =>
    invoke<void>("save_file", { path, contentsBase64 }),
  aiChat: (args: {
    provider: string;
    model: string;
    system: string;
    user: string;
    jsonMode: boolean;
    reasoning: boolean;
    baseUrl?: string | null;
  }) => invoke<AiChatResult>("ai_chat", args),
  /** Store (or clear, with "") a provider's key in the encrypted vault.
   *  Returns the providers that currently have a key. */
  setAiKey: (provider: string, key: string) =>
    invoke<string[]>("set_ai_key", { provider, key }),
  aiKeyStatus: () => invoke<string[]>("ai_key_status"),

  // schema relations
  dbRelations: (database: string) =>
    invoke<{
      nodes: { name: string; count: number; fields: string[] }[];
      edges: { from: string; field: string; to: string }[];
      truncated: boolean;
    }>("db_relations", { database }),

  // ops panel
  currentOps: () => invoke<Doc[]>("current_ops"),
  killOp: (opId: unknown) => invoke<void>("kill_op", { opId }),
  profilerStatus: (database: string) => invoke<Doc>("profiler_status", { database }),
  setProfiler: (database: string, level: number, slowMs?: number) =>
    invoke<Doc>("set_profiler", { database, level, slowMs }),
  profilerEntries: (database: string, limit?: number) =>
    invoke<Doc[]>("profiler_entries", { database, limit }),
  serverStatusLight: () => invoke<Doc>("server_status_light"),

  // shell
  runShell: (database: string, text: string) => invoke<ShellOutcome>("run_shell", { database, text }),
};

/** Normalize a thrown invoke error (string or Error) to a message. */
export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
