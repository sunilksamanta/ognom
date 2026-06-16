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

export interface IndexInfo {
  name: string;
  keys: Doc;
  unique: boolean;
  sparse: boolean;
  hidden: boolean;
  ttlSeconds?: number | null;
  partialFilter?: Doc | null;
}

export interface ExplainSummary {
  indexName: string | null;
  stages: string[];
  isCollectionScan: boolean;
  nReturned: number | null;
  totalDocsExamined: number | null;
  totalKeysExamined: number | null;
  executionTimeMillis: number | null;
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

  // metadata
  listDatabases: () => invoke<DbInfo[]>("list_databases"),
  listCollections: (database: string) => invoke<CollInfo[]>("list_collections", { database }),

  // documents
  findDocuments: (req: FindRequest) => invoke<DocsPage>("find_documents", { req }),
  countDocuments: (database: string, collection: string, filter: string) =>
    invoke<CountResult>("count_documents", { database, collection, filter }),
  aggregate: (database: string, collection: string, stages: StageInput[], allowDiskUse: boolean) =>
    invoke<DocsPage>("aggregate_collection", { database, collection, stages, allowDiskUse }),
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
    format: "json" | "csv";
    path: string;
  }) => invoke<number>("export_collection", args),
  importDocuments: (database: string, collection: string, path: string) =>
    invoke<number>("import_documents", { database, collection, path }),

  // Ognom Studio
  saveFile: (path: string, contentsBase64: string) =>
    invoke<void>("save_file", { path, contentsBase64 }),
  aiChat: (args: {
    apiKey: string;
    model: string;
    system: string;
    user: string;
    jsonMode: boolean;
    reasoning: boolean;
  }) => invoke<AiChatResult>("ai_chat", args),

  // shell
  runShell: (database: string, text: string) => invoke<ShellOutcome>("run_shell", { database, text }),
};

/** Normalize a thrown invoke error (string or Error) to a message. */
export function errMsg(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}
