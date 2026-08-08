use futures::TryStreamExt;
use mongodb::bson::{doc, Bson, Document};
use mongodb::options::{ClientOptions, IndexOptions};
use mongodb::{Client, IndexModel};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

use crate::crypto::{Crypto, KeySource};
use crate::error::{AppError, AppResult};
use crate::profiles::{uri_from_input, ProfileInput, ProfileStore, ProfileSummary};
use crate::shell::{self, Statement};

/// One live connection: the pooled driver client plus the metadata the UI
/// shows for it. Keyed in [`Sessions::pool`] by workspace id (the profile id
/// for saved connections, a generated `adhoc-N` for unsaved ones).
pub struct PooledConn {
    pub client: Client,
    pub info: ConnectionInfo,
}

/// All connections the user has open at once. Switching workspaces just
/// re-points `active` — the clients stay alive, so the pool stays warm and the
/// switch is instant (no reconnect).
#[derive(Default)]
pub struct Sessions {
    pub pool: std::collections::HashMap<String, PooledConn>,
    pub active: Option<String>,
}

pub struct AppState {
    pub sessions: tokio::sync::Mutex<Sessions>,
    pub store: std::sync::Mutex<ProfileStore>,
    pub crypto: std::sync::Mutex<Crypto>,
    pub data_dir: std::path::PathBuf,
    /// True when the user chose the keychain but it failed and the key file
    /// is being used instead.
    pub degraded: std::sync::atomic::AtomicBool,
    /// Monotonic id source for unsaved ("ad-hoc") connections.
    pub adhoc_seq: std::sync::atomic::AtomicU64,
    /// Cancellation flags for in-flight long-running jobs (copies, diffs),
    /// keyed by caller-chosen job id.
    pub jobs: std::sync::Mutex<std::collections::HashMap<String, Arc<AtomicBool>>>,
}

impl AppState {
    fn crypto(&self) -> Crypto {
        self.crypto.lock().unwrap().clone()
    }
}

const DEFAULT_FIND_LIMIT: i64 = 100;
const AGG_SAFETY_LIMIT: i64 = 500;
const COUNT_TIMEOUT: Duration = Duration::from_secs(4);

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

fn to_bson(v: &Value) -> AppResult<Bson> {
    Bson::try_from(v.clone()).map_err(|e| AppError::Parse(format!("invalid value: {e}")))
}

fn to_doc(v: &Value) -> AppResult<Document> {
    match to_bson(v)? {
        Bson::Document(d) => Ok(d),
        _ => Err(AppError::Parse("expected a document like { field: value }".into())),
    }
}

fn to_pipeline(v: &Value) -> AppResult<Vec<Document>> {
    let arr = v
        .as_array()
        .ok_or_else(|| AppError::Parse("pipeline must be an array of stages".into()))?;
    arr.iter().map(to_doc).collect()
}

fn doc_to_value(d: Document) -> Value {
    Bson::Document(d).into_relaxed_extjson()
}

fn parse_doc_text(text: &str) -> AppResult<Document> {
    to_doc(&shell::parse_doc_or_empty(text)?)
}

async fn current_client(state: &State<'_, AppState>) -> AppResult<Client> {
    let s = state.sessions.lock().await;
    let id = s.active.as_ref().ok_or(AppError::NotConnected)?;
    s.pool
        .get(id)
        .map(|c| c.client.clone())
        .ok_or(AppError::NotConnected)
}

/// Client of a specific open workspace, or the active one when `workspace`
/// is `None`. Lets commands address any connection in the pool.
async fn client_for(state: &State<'_, AppState>, workspace: Option<&str>) -> AppResult<Client> {
    match workspace {
        None => current_client(state).await,
        Some(id) => {
            let s = state.sessions.lock().await;
            s.pool
                .get(id)
                .map(|c| c.client.clone())
                .ok_or(AppError::NotConnected)
        }
    }
}

// ---------------------------------------------------------------------------
// connection lifecycle
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    /// Workspace id — the pool key. Profile id for saved connections, a
    /// generated `adhoc-N` for unsaved ones.
    pub id: String,
    pub profile_id: Option<String>,
    pub name: String,
    pub host_summary: String,
    pub server_version: String,
    pub topology: String,
    pub latency_ms: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub ok: bool,
    pub server_version: Option<String>,
    pub topology: Option<String>,
    pub latency_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecurityInfo {
    pub secret_backend: KeySource,
    pub degraded: bool,
}

async fn establish(uri: &str, name: String, profile_id: Option<String>) -> AppResult<(Client, ConnectionInfo)> {
    let mut options = match ClientOptions::parse(uri).await {
        Ok(opts) => opts,
        Err(first) => {
            // Common cause: an unescaped '@' or ':' in a pasted password.
            // Retry once with the userinfo percent-encoded.
            match crate::profiles::repair_userinfo(uri) {
                Some(fixed) => ClientOptions::parse(&fixed).await.map_err(|_| {
                    AppError::Mongo(format!("invalid connection string: {}", *first.kind))
                })?,
                None => {
                    return Err(AppError::Mongo(format!(
                        "invalid connection string: {}",
                        *first.kind
                    )))
                }
            }
        }
    };
    options.app_name.get_or_insert_with(|| format!("Ognom {}", env!("CARGO_PKG_VERSION")));
    options.connect_timeout.get_or_insert(Duration::from_secs(10));
    options.server_selection_timeout.get_or_insert(Duration::from_secs(8));

    let host_summary = options
        .hosts
        .iter()
        .map(|h| h.to_string())
        .collect::<Vec<_>>()
        .join(",");

    let client = Client::with_options(options)?;

    let started = Instant::now();
    client.database("admin").run_command(doc! {"ping": 1}).await?;
    let latency_ms = started.elapsed().as_millis() as u64;

    let hello = client
        .database("admin")
        .run_command(doc! {"hello": 1})
        .await
        .unwrap_or_default();
    let topology = if hello.get_str("msg").map(|m| m == "isdbgrid").unwrap_or(false) {
        "Sharded cluster".to_string()
    } else if let Ok(set) = hello.get_str("setName") {
        format!("Replica set · {set}")
    } else {
        "Standalone".to_string()
    };

    let server_version = client
        .database("admin")
        .run_command(doc! {"buildInfo": 1})
        .await
        .ok()
        .and_then(|d| d.get_str("version").map(str::to_string).ok())
        .unwrap_or_else(|| "unknown".to_string());

    // `id` is assigned by the caller once the pool key is known.
    let info = ConnectionInfo {
        id: String::new(),
        profile_id,
        name,
        host_summary,
        server_version,
        topology,
        latency_ms,
    };
    Ok((client, info))
}

#[tauri::command]
pub fn security_info(state: State<'_, AppState>) -> SecurityInfo {
    SecurityInfo {
        secret_backend: state.crypto.lock().unwrap().source,
        degraded: state.degraded.load(std::sync::atomic::Ordering::Relaxed),
    }
}

/// Move the master key between the OS keychain and the local key file.
/// The key bytes are unchanged, so saved connections keep decrypting.
#[tauri::command]
pub fn set_secret_backend(backend: String, state: State<'_, AppState>) -> AppResult<SecurityInfo> {
    let target = match backend.as_str() {
        "keychain" => KeySource::Keychain,
        "file" => KeySource::File,
        other => return Err(AppError::Other(format!("unknown backend '{other}'"))),
    };
    let mut crypto = state.crypto.lock().unwrap();
    crypto.migrate(&state.data_dir, target)?;
    state.degraded.store(false, std::sync::atomic::Ordering::Relaxed);
    Ok(SecurityInfo { secret_backend: crypto.source, degraded: false })
}

#[tauri::command]
pub fn list_connections(state: State<'_, AppState>) -> AppResult<Vec<ProfileSummary>> {
    Ok(state.store.lock().unwrap().summaries())
}

#[tauri::command]
pub fn save_connection(
    input: ProfileInput,
    state: State<'_, AppState>,
) -> AppResult<ProfileSummary> {
    let crypto = state.crypto();
    state.store.lock().unwrap().upsert(input, &crypto)
}

#[tauri::command]
pub fn delete_connection(id: String, state: State<'_, AppState>) -> AppResult<()> {
    state.store.lock().unwrap().delete(&id)
}

#[tauri::command]
pub async fn test_connection(
    input: Option<ProfileInput>,
    profile_id: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<TestResult> {
    let crypto = state.crypto();
    let uri = match (&input, &profile_id) {
        (Some(input), _) => {
            // When editing a saved profile without retyping the password,
            // borrow the stored secret for the test.
            let has_inline_secret = input.password.as_deref().map(|p| !p.is_empty()).unwrap_or(false)
                || input.uri.as_deref().map(|u| !u.trim().is_empty()).unwrap_or(false);
            match (&input.id, has_inline_secret) {
                (Some(id), false) => {
                    let store = state.store.lock().unwrap();
                    store
                        .uri_for(id, &crypto)
                        .or_else(|_| uri_from_input(input))?
                }
                _ => uri_from_input(input)?,
            }
        }
        (None, Some(id)) => state.store.lock().unwrap().uri_for(id, &crypto)?,
        (None, None) => return Err(AppError::Other("nothing to test".into())),
    };

    match establish(&uri, "test".into(), None).await {
        Ok((client, info)) => {
            drop(client);
            Ok(TestResult {
                ok: true,
                server_version: Some(info.server_version),
                topology: Some(info.topology),
                latency_ms: Some(info.latency_ms),
                error: None,
            })
        }
        Err(e) => Ok(TestResult {
            ok: false,
            server_version: None,
            topology: None,
            latency_ms: None,
            error: Some(e.to_string()),
        }),
    }
}

#[tauri::command]
pub async fn connect(profile_id: String, state: State<'_, AppState>) -> AppResult<ConnectionInfo> {
    let (uri, name) = {
        let crypto = state.crypto();
        let store = state.store.lock().unwrap();
        let profile = store.get(&profile_id)?;
        (store.uri_for(&profile_id, &crypto)?, profile.name.clone())
    };
    let (client, mut info) = establish(&uri, name, Some(profile_id.clone())).await?;
    info.id = profile_id.clone();
    {
        let mut s = state.sessions.lock().await;
        s.pool
            .insert(profile_id.clone(), PooledConn { client, info: info.clone() });
        s.active = Some(profile_id.clone());
    }
    state.store.lock().unwrap().touch(&profile_id)?;
    Ok(info)
}

#[tauri::command]
pub async fn connect_input(
    input: ProfileInput,
    state: State<'_, AppState>,
) -> AppResult<ConnectionInfo> {
    let uri = uri_from_input(&input)?;
    let name = if input.name.trim().is_empty() { "Unsaved connection".into() } else { input.name.clone() };
    let id = format!(
        "adhoc-{}",
        state.adhoc_seq.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    );
    let (client, mut info) = establish(&uri, name, None).await?;
    info.id = id.clone();
    {
        let mut s = state.sessions.lock().await;
        s.pool.insert(id.clone(), PooledConn { client, info: info.clone() });
        s.active = Some(id);
    }
    Ok(info)
}

/// Make an already-open workspace the active one. Instant — the client is
/// already alive in the pool, so this only re-points `active`.
#[tauri::command]
pub async fn switch_workspace(id: String, state: State<'_, AppState>) -> AppResult<ConnectionInfo> {
    let mut s = state.sessions.lock().await;
    let info = s
        .pool
        .get(&id)
        .map(|c| c.info.clone())
        .ok_or(AppError::NotConnected)?;
    s.active = Some(id);
    Ok(info)
}

/// Close one workspace. Dropping its `Client` clone tears down just that pool;
/// the others stay connected. If it was active, `active` is cleared and the
/// frontend picks the next workspace to switch to.
#[tauri::command]
pub async fn disconnect_workspace(id: String, state: State<'_, AppState>) -> AppResult<()> {
    let mut s = state.sessions.lock().await;
    s.pool.remove(&id);
    if s.active.as_deref() == Some(id.as_str()) {
        s.active = None;
    }
    Ok(())
}

/// Close every workspace (full teardown).
#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>) -> AppResult<()> {
    *state.sessions.lock().await = Sessions::default();
    Ok(())
}

/// The connection URI for a saved profile — with or without the password.
#[tauri::command]
pub fn connection_uri(
    profile_id: String,
    include_password: bool,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let crypto = state.crypto();
    let store = state.store.lock().unwrap();
    if include_password {
        store.uri_for(&profile_id, &crypto)
    } else {
        store.redacted_uri(&profile_id)
    }
}

/// Write an export of saved connections to `path`. `include_secrets` requires a
/// non-empty `passphrase`; the bundle is then passphrase-encrypted.
#[tauri::command]
pub fn export_connections(
    ids: Option<Vec<String>>,
    include_secrets: bool,
    passphrase: Option<String>,
    path: String,
    state: State<'_, AppState>,
) -> AppResult<u32> {
    let crypto = state.crypto();
    let conns = {
        let store = state.store.lock().unwrap();
        store.export(ids.as_deref(), &crypto, include_secrets)?
    };
    let count = conns.len() as u32;
    let exported_at = chrono::Utc::now().to_rfc3339();
    let content =
        crate::portable::build_export(conns, include_secrets, passphrase.as_deref(), exported_at)?;
    std::fs::write(&path, content)?;
    Ok(count)
}

/// Peek at an export file to learn whether it's encrypted (so the UI knows
/// whether to ask for a passphrase) and how many connections it holds.
#[tauri::command]
pub fn inspect_connection_import(path: String) -> AppResult<crate::portable::ImportPreview> {
    let content = std::fs::read_to_string(&path)?;
    crate::portable::inspect(&content)
}

/// Import connections from an export file, decrypting with `passphrase` when needed.
#[tauri::command]
pub fn import_connections(
    path: String,
    passphrase: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<crate::portable::ImportOutcome> {
    let content = std::fs::read_to_string(&path)?;
    let conns = crate::portable::parse_export(&content, passphrase.as_deref())?;
    let crypto = state.crypto();
    let (imported, needs_password) = {
        let mut store = state.store.lock().unwrap();
        store.import(conns, &crypto)?
    };
    Ok(crate::portable::ImportOutcome { imported, needs_password })
}

/// Detailed server diagnostics for the status-bar info dialog. Each admin
/// command degrades independently — Atlas and other locked-down deployments
/// forbid some of these (hostInfo, serverStatus), so those sections come back
/// `null` and the UI simply hides them.
#[tauri::command]
pub async fn server_info(state: State<'_, AppState>) -> AppResult<Value> {
    let client = current_client(&state).await?;
    let admin = client.database("admin");

    async fn cmd(db: &mongodb::Database, command: Document) -> Option<Value> {
        db.run_command(command).await.ok().map(doc_to_value)
    }

    Ok(json!({
        "buildInfo": cmd(&admin, doc! {"buildInfo": 1}).await,
        "hello": cmd(&admin, doc! {"hello": 1}).await,
        "serverStatus": cmd(&admin, doc! {"serverStatus": 1}).await,
        "hostInfo": cmd(&admin, doc! {"hostInfo": 1}).await,
        "connectionStatus": cmd(&admin, doc! {"connectionStatus": 1, "showPrivileges": false}).await,
    }))
}

// ---------------------------------------------------------------------------
// metadata
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbInfo {
    pub name: String,
    pub size_on_disk: Option<u64>,
    pub empty: Option<bool>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollInfo {
    pub name: String,
    pub kind: String,
}

#[tauri::command]
pub async fn list_databases(
    workspace: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<Vec<DbInfo>> {
    let client = client_for(&state, workspace.as_deref()).await?;
    let specs = client.list_databases().await?;
    let mut dbs: Vec<DbInfo> = specs
        .into_iter()
        .map(|s| DbInfo { name: s.name, size_on_disk: Some(s.size_on_disk), empty: Some(s.empty) })
        .collect();
    dbs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(dbs)
}

#[tauri::command]
pub async fn list_collections(
    database: String,
    workspace: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<Vec<CollInfo>> {
    let client = client_for(&state, workspace.as_deref()).await?;
    let specs: Vec<_> = client.database(&database).list_collections().await?.try_collect().await?;
    let mut colls: Vec<CollInfo> = specs
        .into_iter()
        .map(|s| CollInfo {
            name: s.name,
            kind: format!("{:?}", s.collection_type).to_lowercase(),
        })
        .collect();
    colls.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(colls)
}

// ---------------------------------------------------------------------------
// documents
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindRequest {
    pub database: String,
    pub collection: String,
    #[serde(default)]
    pub filter: String,
    #[serde(default)]
    pub sort: String,
    #[serde(default)]
    pub projection: String,
    pub limit: Option<i64>,
    pub skip: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocsPage {
    pub docs: Vec<Value>,
    pub exec_ms: u64,
    pub applied_default_limit: bool,
}

#[tauri::command]
pub async fn find_documents(req: FindRequest, state: State<'_, AppState>) -> AppResult<DocsPage> {
    let client = current_client(&state).await?;
    let coll = client.database(&req.database).collection::<Document>(&req.collection);

    let filter = parse_doc_text(&req.filter)?;
    let sort = parse_doc_text(&req.sort)?;
    let projection = parse_doc_text(&req.projection)?;
    let limit = req.limit.unwrap_or(25).clamp(1, 1000);

    let started = Instant::now();
    let mut find = coll.find(filter).limit(limit).skip(req.skip.unwrap_or(0));
    if !sort.is_empty() {
        find = find.sort(sort);
    }
    if !projection.is_empty() {
        find = find.projection(projection);
    }
    let docs: Vec<Document> = find.await?.try_collect().await?;
    Ok(DocsPage {
        docs: docs.into_iter().map(doc_to_value).collect(),
        exec_ms: started.elapsed().as_millis() as u64,
        applied_default_limit: false,
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountResult {
    pub count: Option<u64>,
    pub exact: bool,
    pub exec_ms: u64,
}

#[tauri::command]
pub async fn count_documents(
    database: String,
    collection: String,
    filter: String,
    state: State<'_, AppState>,
) -> AppResult<CountResult> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let filter = parse_doc_text(&filter)?;
    let started = Instant::now();

    if filter.is_empty() {
        let count = coll.estimated_document_count().await?;
        return Ok(CountResult {
            count: Some(count),
            exact: false,
            exec_ms: started.elapsed().as_millis() as u64,
        });
    }
    match tokio::time::timeout(COUNT_TIMEOUT, coll.count_documents(filter)).await {
        Ok(result) => Ok(CountResult {
            count: Some(result?),
            exact: true,
            exec_ms: started.elapsed().as_millis() as u64,
        }),
        // Counting a huge filtered set can be slower than it is useful.
        Err(_) => Ok(CountResult { count: None, exact: false, exec_ms: started.elapsed().as_millis() as u64 }),
    }
}

#[derive(Deserialize)]
pub struct StageInput {
    pub op: String,
    pub body: String,
}

fn pipeline_has_terminator(pipeline: &[Document]) -> bool {
    pipeline.iter().any(|stage| {
        stage
            .keys()
            .any(|k| matches!(k.as_str(), "$limit" | "$out" | "$merge" | "$count" | "$sample"))
    })
}

#[tauri::command]
pub async fn aggregate_collection(
    database: String,
    collection: String,
    stages: Vec<StageInput>,
    allow_disk_use: bool,
    read_only: Option<bool>,
    state: State<'_, AppState>,
) -> AppResult<DocsPage> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);

    // Hard gate for Studio: AI-generated pipelines must never write. Enforced
    // here, not just in the prompt — a $out/$merge that slips past the model's
    // instructions is rejected before it reaches the server.
    if read_only.unwrap_or(false) {
        for stage in &stages {
            let op = stage.op.trim().to_lowercase();
            if op == "$out" || op == "$merge" {
                return Err(AppError::Other(format!(
                    "blocked: {} writes data — Studio queries are read-only",
                    stage.op
                )));
            }
        }
    }

    let mut pipeline: Vec<Document> = Vec::with_capacity(stages.len());
    for (i, stage) in stages.iter().enumerate() {
        let body = shell::parse_value(&stage.body)
            .map_err(|e| AppError::Parse(format!("stage {} ({}): {e}", i + 1, stage.op)))?;
        let mut d = Document::new();
        d.insert(stage.op.clone(), to_bson(&body)?);
        pipeline.push(d);
    }

    let applied_default_limit = !pipeline_has_terminator(&pipeline);
    if applied_default_limit {
        pipeline.push(doc! {"$limit": AGG_SAFETY_LIMIT});
    }

    let started = Instant::now();
    let cursor = coll.aggregate(pipeline).allow_disk_use(allow_disk_use).await?;
    let docs: Vec<Document> = cursor.try_collect().await?;
    Ok(DocsPage {
        docs: docs.into_iter().map(doc_to_value).collect(),
        exec_ms: started.elapsed().as_millis() as u64,
        applied_default_limit,
    })
}

#[tauri::command]
pub async fn insert_document(
    database: String,
    collection: String,
    doc_text: String,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let doc = parse_doc_text(&doc_text)?;
    if doc.is_empty() {
        return Err(AppError::Parse("document is empty".into()));
    }
    let result = coll.insert_one(doc).await?;
    Ok(json!({ "insertedId": result.inserted_id.into_relaxed_extjson() }))
}

#[tauri::command]
pub async fn replace_document(
    database: String,
    collection: String,
    id: Value,
    doc_text: String,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let replacement = parse_doc_text(&doc_text)?;
    let result = coll.replace_one(doc! {"_id": to_bson(&id)?}, replacement).await?;
    if result.matched_count == 0 {
        return Err(AppError::Other("document not found (was it deleted?)".into()));
    }
    Ok(json!({ "matched": result.matched_count, "modified": result.modified_count }))
}

#[tauri::command]
pub async fn delete_document(
    database: String,
    collection: String,
    id: Value,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let result = coll.delete_one(doc! {"_id": to_bson(&id)?}).await?;
    Ok(json!({ "deleted": result.deleted_count }))
}

// ---------------------------------------------------------------------------
// collection operations
// ---------------------------------------------------------------------------

/// Drop a collection (or view) entirely — documents, indexes and all.
#[tauri::command]
pub async fn drop_collection(
    database: String,
    collection: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let client = current_client(&state).await?;
    client
        .database(&database)
        .collection::<Document>(&collection)
        .drop()
        .await?;
    Ok(())
}

/// Empty a collection — delete every document but keep the collection and its
/// indexes. Returns how many documents were removed.
#[tauri::command]
pub async fn clear_collection(
    database: String,
    collection: String,
    state: State<'_, AppState>,
) -> AppResult<u64> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let result = coll.delete_many(doc! {}).await?;
    Ok(result.deleted_count)
}

/// Copy a collection into a new one under the same database: all documents
/// (server-side via `$out`, so nothing round-trips through the UI) plus its
/// secondary indexes. Refuses to overwrite an existing collection.
#[tauri::command]
pub async fn duplicate_collection(
    database: String,
    source: String,
    target: String,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    let client = current_client(&state).await?;
    let db = client.database(&database);

    let target = target.trim().to_string();
    if target.is_empty() {
        return Err(AppError::Parse("new collection name is required".into()));
    }
    if target == source {
        return Err(AppError::Other("the new name must differ from the source".into()));
    }
    let existing: Vec<String> = db.list_collection_names().await?;
    if existing.iter().any(|n| *n == target) {
        return Err(AppError::Other(format!("a collection named '{target}' already exists")));
    }

    // Copy the documents. `$out` reads the whole source and writes the target
    // server-side; `try_collect` drives the cursor so the write completes.
    let src = db.collection::<Document>(&source);
    let _: Vec<Document> = src.aggregate(vec![doc! {"$out": &target}]).await?.try_collect().await?;

    // `$out` skips the target when the source is empty — make sure it exists.
    let after: Vec<String> = db.list_collection_names().await?;
    if !after.iter().any(|n| *n == target) {
        db.create_collection(&target).await?;
    }

    // `$out` copies documents but not secondary indexes — recreate them. A view
    // has no listable indexes, so fall back to none rather than failing.
    let dst = db.collection::<Document>(&target);
    let models: Vec<IndexModel> = match src.list_indexes().await {
        Ok(cursor) => cursor.try_collect().await.unwrap_or_default(),
        Err(_) => Vec::new(),
    };
    let mut indexes = 0u32;
    for model in models {
        let is_id = model
            .options
            .as_ref()
            .and_then(|o| o.name.as_deref())
            .map(|n| n == "_id_")
            .unwrap_or(false);
        if is_id {
            continue;
        }
        dst.create_index(model).await?;
        indexes += 1;
    }

    let documents = dst.estimated_document_count().await?;
    Ok(json!({ "documents": documents, "indexes": indexes }))
}

// ---------------------------------------------------------------------------
// schema relations map
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationNode {
    pub name: String,
    pub count: u64,
    pub fields: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationEdge {
    pub from: String,
    pub field: String,
    pub to: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationReport {
    pub nodes: Vec<RelationNode>,
    pub edges: Vec<RelationEdge>,
    /// True when the collection list was capped.
    pub truncated: bool,
}

/// Candidate collection names a reference field could point at:
/// "user" / "userId" / "user_id" → users, user; "category" → categories.
fn reference_targets(field: &str) -> Vec<String> {
    let base = field
        .strip_suffix("_id")
        .or_else(|| field.strip_suffix("Id"))
        .or_else(|| field.strip_suffix("_ids"))
        .or_else(|| field.strip_suffix("Ids"))
        .unwrap_or(field)
        .to_lowercase();
    if base.is_empty() || base == "_" {
        return Vec::new();
    }
    let mut out = vec![base.clone(), format!("{base}s"), format!("{base}es")];
    if let Some(stem) = base.strip_suffix('y') {
        out.push(format!("{stem}ies"));
    }
    out
}

/// Infer the database's entity graph: sample every collection, then link
/// fields that (a) look like references by name (user / userId / user_id) and
/// (b) hold ObjectId-ish values, to the collection their name points at.
#[tauri::command]
pub async fn db_relations(database: String, state: State<'_, AppState>) -> AppResult<RelationReport> {
    const MAX_COLLECTIONS: usize = 30;
    const SAMPLE: i64 = 50;

    let client = current_client(&state).await?;
    let db = client.database(&database);
    let mut names: Vec<String> = db
        .list_collection_names()
        .await?
        .into_iter()
        .filter(|n| !n.starts_with("system."))
        .collect();
    names.sort();
    let truncated = names.len() > MAX_COLLECTIONS;
    names.truncate(MAX_COLLECTIONS);

    let lower: std::collections::HashMap<String, String> =
        names.iter().map(|n| (n.to_lowercase(), n.clone())).collect();

    let mut nodes: Vec<RelationNode> = Vec::new();
    let mut edges: Vec<RelationEdge> = Vec::new();

    for name in &names {
        let coll = db.collection::<Document>(name);
        let count = coll.estimated_document_count().await.unwrap_or(0);
        let docs: Vec<Document> = match coll
            .aggregate(vec![doc! {"$sample": {"size": SAMPLE}}])
            .await
        {
            Ok(cursor) => cursor.try_collect().await.unwrap_or_default(),
            Err(_) => Vec::new(), // views can't $sample — node stays edge-less
        };

        let mut fields: Vec<String> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        let mut ref_fields: std::collections::HashMap<String, bool> =
            std::collections::HashMap::new();

        for d in &docs {
            for (k, v) in d {
                if seen.insert(k.clone()) {
                    fields.push(k.clone());
                }
                // Reference-shaped value? ObjectId, array of ObjectIds, or a
                // 24-hex string (apps that store ids as strings).
                let is_ref_value = match v {
                    Bson::ObjectId(_) => true,
                    Bson::String(s) => {
                        s.len() == 24 && s.chars().all(|c| c.is_ascii_hexdigit())
                    }
                    Bson::Array(arr) => arr.iter().any(|e| matches!(e, Bson::ObjectId(_))),
                    _ => false,
                };
                if is_ref_value && k != "_id" {
                    ref_fields.entry(k.clone()).or_insert(true);
                }
            }
        }

        for field in ref_fields.keys() {
            for target in reference_targets(field) {
                if let Some(actual) = lower.get(&target) {
                    if actual != name {
                        edges.push(RelationEdge {
                            from: name.clone(),
                            field: field.clone(),
                            to: actual.clone(),
                        });
                        break;
                    }
                }
            }
        }

        fields.truncate(40);
        nodes.push(RelationNode { name: name.clone(), count, fields });
    }

    edges.sort_by(|a, b| (a.from.clone(), a.field.clone()).cmp(&(b.from.clone(), b.field.clone())));
    edges.dedup_by(|a, b| a.from == b.from && a.field == b.field && a.to == b.to);

    Ok(RelationReport { nodes, edges, truncated })
}

// ---------------------------------------------------------------------------
// ops panel — currentOp / profiler / live server stats
// ---------------------------------------------------------------------------

/// In-flight operations via the `currentOp` admin command (idle connections
/// and system operations excluded). Returns the raw op documents in relaxed
/// extJSON; the UI picks the interesting fields.
#[tauri::command]
pub async fn current_ops(state: State<'_, AppState>) -> AppResult<Vec<Value>> {
    let client = current_client(&state).await?;
    let raw = client
        .database("admin")
        .run_command(doc! { "currentOp": 1, "active": true, "$all": false })
        .await?;
    let ops = raw
        .get_array("inprog")
        .map(|arr| {
            arr.iter()
                .filter_map(|b| match b {
                    Bson::Document(d) => Some(doc_to_value(d.clone())),
                    _ => None,
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(ops)
}

/// Kill one in-flight operation. `op_id` is numeric on standalone/replica
/// deployments and a string on sharded clusters — accept either.
#[tauri::command]
pub async fn kill_op(op_id: Value, state: State<'_, AppState>) -> AppResult<()> {
    let client = current_client(&state).await?;
    let op = to_bson(&op_id)?;
    client
        .database("admin")
        .run_command(doc! { "killOp": 1, "op": op })
        .await?;
    Ok(())
}

/// Current profiler level + slowms threshold for a database.
#[tauri::command]
pub async fn profiler_status(database: String, state: State<'_, AppState>) -> AppResult<Value> {
    let client = current_client(&state).await?;
    let raw = client
        .database(&database)
        .run_command(doc! { "profile": -1 })
        .await?;
    Ok(doc_to_value(raw))
}

/// Set the profiler level (0 off · 1 slow ops · 2 all ops) and optionally the
/// slow-op threshold in milliseconds.
#[tauri::command]
pub async fn set_profiler(
    database: String,
    level: i32,
    slow_ms: Option<i32>,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    if !(0..=2).contains(&level) {
        return Err(AppError::Parse("profiler level must be 0, 1, or 2".into()));
    }
    let client = current_client(&state).await?;
    let mut cmd = doc! { "profile": level };
    if let Some(ms) = slow_ms {
        cmd.insert("slowms", ms);
    }
    let raw = client.database(&database).run_command(cmd).await?;
    Ok(doc_to_value(raw))
}

/// Most recent entries from `system.profile`, newest first.
#[tauri::command]
pub async fn profiler_entries(
    database: String,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Vec<Value>> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>("system.profile");
    let docs: Vec<Document> = coll
        .find(doc! {})
        .sort(doc! { "ts": -1 })
        .limit(limit.unwrap_or(50).clamp(1, 500))
        .await?
        .try_collect()
        .await?;
    Ok(docs.into_iter().map(doc_to_value).collect())
}

/// Light serverStatus slice for live polling: opcounters, connections,
/// memory, network, uptime. Small on purpose — this gets called every
/// couple of seconds while the Live tab is open.
#[tauri::command]
pub async fn server_status_light(state: State<'_, AppState>) -> AppResult<Value> {
    let client = current_client(&state).await?;
    let raw = client
        .database("admin")
        .run_command(doc! { "serverStatus": 1 })
        .await?;
    let pick = |key: &str| raw.get(key).cloned().unwrap_or(Bson::Null);
    let slim = doc! {
        "uptime": pick("uptime"),
        "opcounters": pick("opcounters"),
        "connections": pick("connections"),
        "mem": pick("mem"),
        "network": pick("network"),
        "version": pick("version"),
    };
    Ok(doc_to_value(slim))
}

// ---------------------------------------------------------------------------
// bulk operations
// ---------------------------------------------------------------------------

/// Apply an operator update ({$set: …}, {$unset: …}, …) to every document
/// matching the filter. Plain replacement documents are rejected — a bulk
/// replace of N documents with the same body is almost never intended.
#[tauri::command]
pub async fn bulk_update(
    database: String,
    collection: String,
    filter: String,
    update: String,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);

    let filter = parse_doc_text(&filter)?;
    let update_doc = parse_doc_text(&update)?;
    if update_doc.is_empty() {
        return Err(AppError::Parse("update document is required, e.g. { $set: { field: 1 } }".into()));
    }
    if !update_doc.keys().all(|k| k.starts_with('$')) {
        return Err(AppError::Parse(
            "bulk update requires operator syntax ({ $set: … }, { $unset: … }, …)".into(),
        ));
    }

    let started = Instant::now();
    let result = coll.update_many(filter, update_doc).await?;
    Ok(json!({
        "matched": result.matched_count,
        "modified": result.modified_count,
        "execMs": started.elapsed().as_millis() as u64,
    }))
}

/// Delete every document matching the filter. An empty filter is refused —
/// "Clear collection" is the explicit tool for wiping everything.
#[tauri::command]
pub async fn bulk_delete(
    database: String,
    collection: String,
    filter: String,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);

    let filter = parse_doc_text(&filter)?;
    if filter.is_empty() {
        return Err(AppError::Parse(
            "bulk delete needs a filter — use Clear Collection to remove every document".into(),
        ));
    }

    let started = Instant::now();
    let result = coll.delete_many(filter).await?;
    Ok(json!({
        "deleted": result.deleted_count,
        "execMs": started.elapsed().as_millis() as u64,
    }))
}

// ---------------------------------------------------------------------------
// aggregation stage profiling
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageStat {
    pub op: String,
    /// Documents flowing OUT of this stage (pipeline prefix + $count).
    pub docs: u64,
    /// Wall time for the whole prefix ending at this stage.
    pub cumulative_ms: u64,
}

/// Profile a pipeline stage-by-stage: for each prefix run
/// `[stage1..stageN, {$count}]` and report the surviving document count and
/// cumulative time. This is how "stage 3 dropped 98% of the docs and took
/// 2 s" gets surfaced in the builder. Write stages are refused — profiling
/// must never mutate data.
#[tauri::command]
pub async fn aggregate_stage_stats(
    database: String,
    collection: String,
    stages: Vec<StageInput>,
    allow_disk_use: bool,
    state: State<'_, AppState>,
) -> AppResult<Vec<StageStat>> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);

    let mut pipeline: Vec<Document> = Vec::with_capacity(stages.len());
    for (i, stage) in stages.iter().enumerate() {
        let op = stage.op.trim();
        if op.eq_ignore_ascii_case("$out") || op.eq_ignore_ascii_case("$merge") {
            return Err(AppError::Other(
                "stage profiling skips $out/$merge — remove the write stage to analyze".into(),
            ));
        }
        let body = shell::parse_value(&stage.body)
            .map_err(|e| AppError::Parse(format!("stage {} ({}): {e}", i + 1, stage.op)))?;
        let mut d = Document::new();
        d.insert(stage.op.clone(), to_bson(&body)?);
        pipeline.push(d);
    }
    if pipeline.is_empty() {
        return Err(AppError::Parse("add at least one enabled stage".into()));
    }

    let mut out: Vec<StageStat> = Vec::with_capacity(pipeline.len());
    for i in 0..pipeline.len() {
        let mut prefix: Vec<Document> = pipeline[..=i].to_vec();
        prefix.push(doc! {"$count": "__n"});
        let started = Instant::now();
        let docs: Vec<Document> = coll
            .aggregate(prefix)
            .allow_disk_use(allow_disk_use)
            .await?
            .try_collect()
            .await?;
        let n = docs
            .first()
            .and_then(|d| d.get("__n"))
            .and_then(|v| match v {
                Bson::Int32(n) => Some(*n as u64),
                Bson::Int64(n) => Some(*n as u64),
                Bson::Double(n) => Some(*n as u64),
                _ => None,
            })
            .unwrap_or(0);
        out.push(StageStat {
            op: stages[i].op.clone(),
            docs: n,
            cumulative_ms: started.elapsed().as_millis() as u64,
        });
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// cross-connection collection copy
// ---------------------------------------------------------------------------

const COPY_BATCH: usize = 500;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyRequest {
    /// Source workspace id (pool key). `None` means the active workspace.
    pub source_workspace: Option<String>,
    pub source_database: String,
    pub source_collection: String,
    /// Target workspace id — may equal the source for same-server copies.
    pub target_workspace: String,
    pub target_database: String,
    pub target_collection: String,
    /// mongosh-flavored filter; empty copies everything.
    pub filter: String,
    pub copy_indexes: bool,
    /// Caller-chosen id used for progress events and cancellation.
    pub job_id: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CopyProgress {
    pub job_id: String,
    pub copied: u64,
    /// Best-effort total; `None` when counting was too slow or unavailable.
    pub total: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CopyOutcome {
    pub documents: u64,
    pub indexes: u32,
    pub canceled: bool,
    pub exec_ms: u64,
}

/// Copy a collection between any two open workspaces (or within one), batched
/// and streaming — documents round-trip through the app in chunks of
/// [`COPY_BATCH`], never all at once. Emits `copy-progress` events and honors
/// cancellation via [`cancel_job`]. Refuses to overwrite an existing target.
#[tauri::command]
pub async fn copy_collection(
    req: CopyRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<CopyOutcome> {
    let started = Instant::now();

    let target_collection = req.target_collection.trim().to_string();
    let target_database = req.target_database.trim().to_string();
    if target_collection.is_empty() {
        return Err(AppError::Parse("target collection name is required".into()));
    }
    if target_database.is_empty() {
        return Err(AppError::Parse("target database name is required".into()));
    }

    let src_client = client_for(&state, req.source_workspace.as_deref()).await?;
    let dst_client = client_for(&state, Some(&req.target_workspace)).await?;

    // Copying a collection onto itself would read and write the same data.
    let same_workspace = match &req.source_workspace {
        Some(id) => *id == req.target_workspace,
        // Source defaulted to the active workspace — resolve it to compare.
        None => {
            let s = state.sessions.lock().await;
            s.active.as_deref() == Some(req.target_workspace.as_str())
        }
    };
    if same_workspace
        && req.source_database == target_database
        && req.source_collection == target_collection
    {
        return Err(AppError::Other("source and target are the same collection".into()));
    }

    let filter = parse_doc_text(&req.filter)?;

    let dst_db = dst_client.database(&target_database);
    let existing: Vec<String> = dst_db.list_collection_names().await?;
    if existing.iter().any(|n| *n == target_collection) {
        return Err(AppError::Other(format!(
            "collection '{target_collection}' already exists in '{target_database}' on the target"
        )));
    }

    let src = src_client
        .database(&req.source_database)
        .collection::<Document>(&req.source_collection);
    let dst = dst_db.collection::<Document>(&target_collection);

    // Best-effort total for the progress bar: cheap estimate when unfiltered,
    // time-boxed exact count otherwise. `None` just means an indeterminate bar.
    let total: Option<u64> = if filter.is_empty() {
        src.estimated_document_count().await.ok()
    } else {
        match tokio::time::timeout(COUNT_TIMEOUT, src.count_documents(filter.clone())).await {
            Ok(Ok(n)) => Some(n),
            _ => None,
        }
    };

    // Register the cancel flag before the first read.
    let cancel = Arc::new(AtomicBool::new(false));
    state
        .jobs
        .lock()
        .unwrap()
        .insert(req.job_id.clone(), cancel.clone());

    let result = run_copy(&app, &req.job_id, &src, &dst, filter, total, &cancel).await;

    state.jobs.lock().unwrap().remove(&req.job_id);
    let (documents, canceled) = result?;

    // Recreate secondary indexes only after a complete, uncanceled copy.
    let mut indexes = 0u32;
    if req.copy_indexes && !canceled {
        let models: Vec<IndexModel> = match src.list_indexes().await {
            Ok(cursor) => cursor.try_collect().await.unwrap_or_default(),
            Err(_) => Vec::new(),
        };
        for model in models {
            let is_id = model
                .options
                .as_ref()
                .and_then(|o| o.name.as_deref())
                .map(|n| n == "_id_")
                .unwrap_or(false);
            if is_id {
                continue;
            }
            dst.create_index(model).await?;
            indexes += 1;
        }
    }

    // An empty source never triggers an insert — make sure the target exists
    // so the copy is visible in the target's collection list.
    if documents == 0 && !canceled {
        let after: Vec<String> = dst_db.list_collection_names().await?;
        if !after.iter().any(|n| *n == target_collection) {
            dst_db.create_collection(&target_collection).await?;
        }
    }

    Ok(CopyOutcome {
        documents,
        indexes,
        canceled,
        exec_ms: started.elapsed().as_millis() as u64,
    })
}

/// The streaming loop, separated so the caller can always unregister the job.
async fn run_copy(
    app: &AppHandle,
    job_id: &str,
    src: &mongodb::Collection<Document>,
    dst: &mongodb::Collection<Document>,
    filter: Document,
    total: Option<u64>,
    cancel: &AtomicBool,
) -> AppResult<(u64, bool)> {
    let mut cursor = src.find(filter).await?;
    let mut batch: Vec<Document> = Vec::with_capacity(COPY_BATCH);
    let mut copied: u64 = 0;
    let mut canceled = false;

    loop {
        if cancel.load(Ordering::Relaxed) {
            canceled = true;
            break;
        }
        match cursor.try_next().await? {
            Some(d) => {
                batch.push(d);
                if batch.len() >= COPY_BATCH {
                    dst.insert_many(std::mem::take(&mut batch)).await?;
                    copied += COPY_BATCH as u64;
                    let _ = app.emit(
                        "copy-progress",
                        CopyProgress { job_id: job_id.to_string(), copied, total },
                    );
                }
            }
            None => break,
        }
    }
    if !batch.is_empty() && !canceled {
        copied += batch.len() as u64;
        dst.insert_many(batch).await?;
        let _ = app.emit(
            "copy-progress",
            CopyProgress { job_id: job_id.to_string(), copied, total },
        );
    }
    Ok((copied, canceled))
}

/// Flag an in-flight job (copy, diff, …) for cancellation. The job stops at
/// its next batch boundary; work already applied stays.
#[tauri::command]
pub async fn cancel_job(job_id: String, state: State<'_, AppState>) -> AppResult<()> {
    if let Some(flag) = state.jobs.lock().unwrap().get(&job_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// collection diff & sync
// ---------------------------------------------------------------------------

const DIFF_BATCH: usize = 500;
/// Per-category cap on returned document details. Counts keep going past it.
const DIFF_DETAIL_CAP: usize = 200;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffRequest {
    /// Source workspace id (pool key). `None` means the active workspace.
    pub source_workspace: Option<String>,
    pub source_database: String,
    pub source_collection: String,
    pub target_workspace: String,
    pub target_database: String,
    pub target_collection: String,
    /// mongosh-flavored filter applied to both sides; empty diffs everything.
    pub filter: String,
    pub job_id: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiffProgress {
    pub job_id: String,
    /// "source" while scanning the source side, "target" for the reverse pass.
    pub phase: String,
    pub processed: u64,
    pub total: Option<u64>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffEntry {
    pub id: Value,
    pub source: Option<Value>,
    pub target: Option<Value>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffOutcome {
    pub identical: u64,
    pub changed: u64,
    pub only_in_source: u64,
    pub only_in_target: u64,
    /// Document details, each list capped at [`DIFF_DETAIL_CAP`].
    pub changed_docs: Vec<DiffEntry>,
    pub only_in_source_docs: Vec<DiffEntry>,
    pub only_in_target_docs: Vec<DiffEntry>,
    /// True when any detail list hit its cap (counts above are still complete).
    pub truncated: bool,
    pub canceled: bool,
    pub exec_ms: u64,
}

/// Key a document id for in-memory matching. Canonical extJSON keeps full
/// type fidelity, so ObjectId("x") never collides with the string "x".
fn id_key(id: &Bson) -> String {
    serde_json::to_string(&id.clone().into_canonical_extjson()).unwrap_or_default()
}

/// Compare two collections across any two open workspaces, matched by `_id`.
/// Streams both sides in [`DIFF_BATCH`]-sized chunks (`$in` lookups against
/// the other side), so memory stays flat regardless of collection size.
/// Emits `diff-progress` events; honors [`cancel_job`].
#[tauri::command]
pub async fn diff_collections(
    req: DiffRequest,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<DiffOutcome> {
    let started = Instant::now();

    let src_client = client_for(&state, req.source_workspace.as_deref()).await?;
    let dst_client = client_for(&state, Some(&req.target_workspace)).await?;
    let filter = parse_doc_text(&req.filter)?;

    let src = src_client
        .database(&req.source_database)
        .collection::<Document>(&req.source_collection);
    let dst = dst_client
        .database(&req.target_database)
        .collection::<Document>(&req.target_collection);

    let cancel = Arc::new(AtomicBool::new(false));
    state.jobs.lock().unwrap().insert(req.job_id.clone(), cancel.clone());
    let result = run_diff(&app, &req.job_id, &src, &dst, filter, &cancel).await;
    state.jobs.lock().unwrap().remove(&req.job_id);

    let mut outcome = result?;
    outcome.exec_ms = started.elapsed().as_millis() as u64;
    Ok(outcome)
}

async fn run_diff(
    app: &AppHandle,
    job_id: &str,
    src: &mongodb::Collection<Document>,
    dst: &mongodb::Collection<Document>,
    filter: Document,
    cancel: &AtomicBool,
) -> AppResult<DiffOutcome> {
    let mut out = DiffOutcome {
        identical: 0,
        changed: 0,
        only_in_source: 0,
        only_in_target: 0,
        changed_docs: Vec::new(),
        only_in_source_docs: Vec::new(),
        only_in_target_docs: Vec::new(),
        truncated: false,
        canceled: false,
        exec_ms: 0,
    };

    let src_total = src.estimated_document_count().await.ok();
    let dst_total = dst.estimated_document_count().await.ok();

    let emit = |phase: &str, processed: u64, total: Option<u64>| {
        let _ = app.emit(
            "diff-progress",
            DiffProgress {
                job_id: job_id.to_string(),
                phase: phase.to_string(),
                processed,
                total,
            },
        );
    };

    // Pass 1 — walk the source; look up each batch on the target by `_id`.
    let mut cursor = src.find(filter.clone()).await?;
    let mut batch: Vec<Document> = Vec::with_capacity(DIFF_BATCH);
    let mut processed: u64 = 0;
    loop {
        if cancel.load(Ordering::Relaxed) {
            out.canceled = true;
            return Ok(out);
        }
        let next = cursor.try_next().await?;
        let flush = match &next {
            Some(_) => batch.len() + 1 >= DIFF_BATCH,
            None => !batch.is_empty(),
        };
        if let Some(d) = next {
            batch.push(d);
        } else if batch.is_empty() {
            break;
        }
        if !flush {
            continue;
        }

        let ids: Vec<Bson> = batch
            .iter()
            .filter_map(|d| d.get("_id").cloned())
            .collect();
        let found: Vec<Document> = dst
            .find(doc! { "_id": { "$in": ids } })
            .await?
            .try_collect()
            .await?;
        let mut by_id: std::collections::HashMap<String, Document> = found
            .into_iter()
            .filter_map(|d| d.get("_id").cloned().map(|id| (id_key(&id), d)))
            .collect();

        for sdoc in std::mem::take(&mut batch) {
            let Some(id) = sdoc.get("_id").cloned() else { continue };
            match by_id.remove(&id_key(&id)) {
                None => {
                    out.only_in_source += 1;
                    if out.only_in_source_docs.len() < DIFF_DETAIL_CAP {
                        out.only_in_source_docs.push(DiffEntry {
                            id: Bson::from(id).into_relaxed_extjson(),
                            source: Some(doc_to_value(sdoc)),
                            target: None,
                        });
                    } else {
                        out.truncated = true;
                    }
                }
                Some(tdoc) => {
                    if sdoc == tdoc {
                        out.identical += 1;
                    } else {
                        out.changed += 1;
                        if out.changed_docs.len() < DIFF_DETAIL_CAP {
                            out.changed_docs.push(DiffEntry {
                                id: Bson::from(id).into_relaxed_extjson(),
                                source: Some(doc_to_value(sdoc)),
                                target: Some(doc_to_value(tdoc)),
                            });
                        } else {
                            out.truncated = true;
                        }
                    }
                }
            }
            processed += 1;
        }
        emit("source", processed, src_total);
    }

    // Pass 2 — walk the target; anything whose `_id` is absent on the source
    // side is target-only. Changed/identical were already settled in pass 1.
    let mut cursor = dst.find(filter).await?;
    let mut batch: Vec<Document> = Vec::with_capacity(DIFF_BATCH);
    let mut processed: u64 = 0;
    loop {
        if cancel.load(Ordering::Relaxed) {
            out.canceled = true;
            return Ok(out);
        }
        let next = cursor.try_next().await?;
        let flush = match &next {
            Some(_) => batch.len() + 1 >= DIFF_BATCH,
            None => !batch.is_empty(),
        };
        if let Some(d) = next {
            batch.push(d);
        } else if batch.is_empty() {
            break;
        }
        if !flush {
            continue;
        }

        let ids: Vec<Bson> = batch
            .iter()
            .filter_map(|d| d.get("_id").cloned())
            .collect();
        let found: Vec<Document> = src
            .find(doc! { "_id": { "$in": ids } })
            .projection(doc! { "_id": 1 })
            .await?
            .try_collect()
            .await?;
        let present: std::collections::HashSet<String> = found
            .into_iter()
            .filter_map(|d| d.get("_id").map(id_key))
            .collect();

        for tdoc in std::mem::take(&mut batch) {
            let Some(id) = tdoc.get("_id").cloned() else { continue };
            if !present.contains(&id_key(&id)) {
                out.only_in_target += 1;
                if out.only_in_target_docs.len() < DIFF_DETAIL_CAP {
                    out.only_in_target_docs.push(DiffEntry {
                        id: Bson::from(id).into_relaxed_extjson(),
                        source: None,
                        target: Some(doc_to_value(tdoc)),
                    });
                } else {
                    out.truncated = true;
                }
            }
            processed += 1;
        }
        emit("target", processed, dst_total);
    }

    Ok(out)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncRequest {
    pub source_workspace: Option<String>,
    pub source_database: String,
    pub source_collection: String,
    pub target_workspace: String,
    pub target_database: String,
    pub target_collection: String,
    /// "copy" upserts the source version of each id onto the target (covers
    /// both missing and changed documents); "delete" removes the ids from the
    /// target.
    pub action: String,
    /// Document `_id`s in extJSON form, as returned by [`diff_collections`].
    pub ids: Vec<Value>,
}

/// Apply a diff resolution to the target collection. Batched; returns how many
/// documents were written or removed.
#[tauri::command]
pub async fn sync_documents(req: SyncRequest, state: State<'_, AppState>) -> AppResult<u64> {
    let src_client = client_for(&state, req.source_workspace.as_deref()).await?;
    let dst_client = client_for(&state, Some(&req.target_workspace)).await?;
    let src = src_client
        .database(&req.source_database)
        .collection::<Document>(&req.source_collection);
    let dst = dst_client
        .database(&req.target_database)
        .collection::<Document>(&req.target_collection);

    let ids: Vec<Bson> = req.ids.iter().map(to_bson).collect::<AppResult<_>>()?;
    let mut applied: u64 = 0;

    match req.action.as_str() {
        "copy" => {
            for chunk in ids.chunks(DIFF_BATCH) {
                let docs: Vec<Document> = src
                    .find(doc! { "_id": { "$in": chunk.to_vec() } })
                    .await?
                    .try_collect()
                    .await?;
                for d in docs {
                    let Some(id) = d.get("_id").cloned() else { continue };
                    let r = dst
                        .replace_one(doc! { "_id": id }, d)
                        .upsert(true)
                        .await?;
                    applied += if r.modified_count > 0 || r.upserted_id.is_some() {
                        1
                    } else {
                        // Matched but unmodified — already in sync; count it.
                        r.matched_count
                    };
                }
            }
        }
        "delete" => {
            for chunk in ids.chunks(DIFF_BATCH) {
                let r = dst.delete_many(doc! { "_id": { "$in": chunk.to_vec() } }).await?;
                applied += r.deleted_count;
            }
        }
        other => return Err(AppError::Parse(format!("unknown sync action '{other}'"))),
    }

    Ok(applied)
}

// ---------------------------------------------------------------------------
// indexes & stats
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub keys: Value,
    pub unique: bool,
    pub sparse: bool,
    pub hidden: bool,
    pub ttl_seconds: Option<u64>,
    pub partial_filter: Option<Value>,
    /// Operations served since the stats epoch ($indexStats); `None` when
    /// usage stats are unavailable (views, older servers, permissions).
    pub usage_ops: Option<i64>,
    /// ISO timestamp the usage counter has been accumulating since.
    pub usage_since: Option<String>,
}

#[tauri::command]
pub async fn list_indexes(
    database: String,
    collection: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<IndexInfo>> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let models: Vec<IndexModel> = coll.list_indexes().await?.try_collect().await?;

    // Usage stats power "unused index" detection. Best-effort: $indexStats is
    // unavailable on views and restricted deployments — degrade to None.
    let mut usage: std::collections::HashMap<String, (i64, Option<String>)> =
        std::collections::HashMap::new();
    if let Ok(cursor) = coll.aggregate(vec![doc! {"$indexStats": {}}]).await {
        let stats: Vec<Document> = cursor.try_collect().await.unwrap_or_default();
        for s in stats {
            let Some(name) = s.get_str("name").ok() else { continue };
            let ops = s
                .get_document("accesses")
                .ok()
                .and_then(|a| {
                    a.get_i64("ops")
                        .ok()
                        .or_else(|| a.get_i32("ops").ok().map(i64::from))
                })
                .unwrap_or(0);
            let since = s
                .get_document("accesses")
                .ok()
                .and_then(|a| a.get_datetime("since").ok())
                .map(|d| d.try_to_rfc3339_string().unwrap_or_default());
            usage.insert(name.to_string(), (ops, since));
        }
    }

    Ok(models
        .into_iter()
        .map(|m| {
            let o = m.options.unwrap_or_default();
            let name = o.name.unwrap_or_default();
            let u = usage.get(&name);
            IndexInfo {
                keys: doc_to_value(m.keys),
                unique: o.unique.unwrap_or(false),
                sparse: o.sparse.unwrap_or(false),
                hidden: o.hidden.unwrap_or(false),
                ttl_seconds: o.expire_after.map(|d| d.as_secs()),
                partial_filter: o.partial_filter_expression.map(doc_to_value),
                usage_ops: u.map(|(ops, _)| *ops),
                usage_since: u.and_then(|(_, since)| since.clone()),
                name,
            }
        })
        .collect())
}

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn create_index(
    database: String,
    collection: String,
    keys_text: String,
    name: Option<String>,
    unique: bool,
    ttl_seconds: Option<u64>,
    sparse: Option<bool>,
    hidden: Option<bool>,
    partial_filter_text: Option<String>,
    collation_locale: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<String> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let keys = parse_doc_text(&keys_text)?;
    if keys.is_empty() {
        return Err(AppError::Parse("index keys are required, e.g. { email: 1 }".into()));
    }

    // Optional partial filter expression — only indexes documents matching it.
    let partial_filter = match partial_filter_text {
        Some(ref t) if !t.trim().is_empty() => {
            let d = parse_doc_text(t)?;
            if d.is_empty() {
                None
            } else {
                Some(d)
            }
        }
        _ => None,
    };

    // Case-insensitive (or locale-aware) collation via strength 2.
    let collation = collation_locale
        .filter(|l| !l.trim().is_empty())
        .map(|locale| {
            mongodb::options::Collation::builder()
                .locale(locale)
                .strength(mongodb::options::CollationStrength::Secondary)
                .build()
        });

    let options = IndexOptions::builder()
        .name(name.filter(|n| !n.trim().is_empty()))
        .unique(if unique { Some(true) } else { None })
        .expire_after(ttl_seconds.map(Duration::from_secs))
        .sparse(sparse.filter(|b| *b))
        .hidden(hidden.filter(|b| *b))
        .partial_filter_expression(partial_filter)
        .collation(collation)
        .build();
    let model = IndexModel::builder().keys(keys).options(options).build();
    let result = coll.create_index(model).await?;
    Ok(result.index_name)
}

#[tauri::command]
pub async fn drop_index(
    database: String,
    collection: String,
    name: String,
    state: State<'_, AppState>,
) -> AppResult<()> {
    let client = current_client(&state).await?;
    client
        .database(&database)
        .collection::<Document>(&collection)
        .drop_index(name)
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn collection_stats(
    database: String,
    collection: String,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let cursor = coll
        .aggregate(vec![doc! {"$collStats": {"storageStats": {}}}])
        .await?;
    let docs: Vec<Document> = cursor.try_collect().await?;
    let stats = docs
        .first()
        .and_then(|d| d.get_document("storageStats").ok())
        .cloned()
        .unwrap_or_default();
    Ok(json!({
        "count": stats.get_i64("count").ok().or(stats.get_i32("count").ok().map(i64::from)),
        "size": stats.get_i64("size").ok().or(stats.get_i32("size").ok().map(i64::from)),
        "avgObjSize": stats.get_i64("avgObjSize").ok().or(stats.get_i32("avgObjSize").ok().map(i64::from)),
        "storageSize": stats.get_i64("storageSize").ok().or(stats.get_i32("storageSize").ok().map(i64::from)),
        "totalIndexSize": stats.get_i64("totalIndexSize").ok().or(stats.get_i32("totalIndexSize").ok().map(i64::from)),
        "nindexes": stats.get_i32("nindexes").ok(),
    }))
}

// ---------------------------------------------------------------------------
// explain
// ---------------------------------------------------------------------------

/// Run an explain (queryPlanner verbosity) for a find or an aggregate and
/// return a compact, UI-friendly summary plus the raw plan.
#[tauri::command]
pub async fn explain_query(
    database: String,
    collection: String,
    filter: String,
    sort: String,
    projection: String,
    pipeline_stages: Option<Vec<StageInput>>,
    verbosity: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    let client = current_client(&state).await?;
    let db = client.database(&database);
    let verbosity = verbosity.unwrap_or_else(|| "executionStats".into());

    // Filter/sort shapes are kept around to derive an index suggestion when
    // the plan turns out to be a collection scan.
    let (shape_filter, shape_sort);

    let explain = if let Some(stages) = pipeline_stages {
        let mut pipeline: Vec<Document> = Vec::with_capacity(stages.len());
        for (i, stage) in stages.iter().enumerate() {
            let body = shell::parse_value(&stage.body)
                .map_err(|e| AppError::Parse(format!("stage {} ({}): {e}", i + 1, stage.op)))?;
            let mut d = Document::new();
            d.insert(stage.op.clone(), to_bson(&body)?);
            pipeline.push(d);
        }
        // Only a leading $match (and the first $sort) can be served by an
        // index, so that's the shape the suggestion is derived from.
        shape_filter = pipeline
            .first()
            .and_then(|d| d.get_document("$match").ok())
            .cloned()
            .unwrap_or_default();
        shape_sort = pipeline
            .iter()
            .find_map(|d| d.get_document("$sort").ok())
            .cloned()
            .unwrap_or_default();
        doc! {
            "explain": {
                "aggregate": &collection,
                "pipeline": pipeline,
                "cursor": {},
            },
            "verbosity": &verbosity,
        }
    } else {
        let filter_doc = parse_doc_text(&filter)?;
        let sort_doc = parse_doc_text(&sort)?;
        let projection = parse_doc_text(&projection)?;
        let mut find_cmd = doc! { "find": &collection, "filter": filter_doc.clone() };
        if !sort_doc.is_empty() {
            find_cmd.insert("sort", sort_doc.clone());
        }
        if !projection.is_empty() {
            find_cmd.insert("projection", projection);
        }
        shape_filter = filter_doc;
        shape_sort = sort_doc;
        doc! { "explain": find_cmd, "verbosity": &verbosity }
    };

    let raw = db.run_command(explain).await?;
    let mut summary = summarize_explain(&raw);
    if summary.get_bool("isCollectionScan").unwrap_or(false) {
        if let Some(idx) = suggest_index(&shape_filter, &shape_sort) {
            summary.insert("suggestedIndex", idx);
        }
    }
    Ok(doc_to_value(summary))
}

/// Derive an index key doc from a query shape using the classic
/// Equality → Sort → Range field ordering. Returns `None` when nothing
/// indexable is in the shape (e.g. only `$expr`/`$or` operators).
fn suggest_index(filter: &Document, sort: &Document) -> Option<Document> {
    let mut equality: Vec<String> = Vec::new();
    let mut range: Vec<String> = Vec::new();
    for (k, v) in filter {
        if k.starts_with('$') {
            continue; // $or / $and / $expr — too shape-dependent to suggest from
        }
        let is_range =
            matches!(v, Bson::Document(d) if d.keys().any(|op| op.starts_with('$')));
        if is_range {
            range.push(k.clone());
        } else {
            equality.push(k.clone());
        }
    }

    let mut idx = Document::new();
    for k in equality {
        idx.insert(k, 1i32);
    }
    for (k, dir) in sort {
        if !idx.contains_key(k) {
            idx.insert(k.clone(), dir.clone());
        }
    }
    for k in range {
        if !idx.contains_key(&k) {
            idx.insert(k, 1i32);
        }
    }
    if idx.is_empty() {
        None
    } else {
        Some(idx)
    }
}

/// Pull the headline numbers out of a (possibly nested / sharded) explain plan.
fn summarize_explain(raw: &Document) -> Document {
    fn winning(raw: &Document) -> Option<&Document> {
        raw.get_document("queryPlanner").ok()?.get_document("winningPlan").ok()
    }
    // Walk a plan tree collecting the stage names and any index name.
    fn walk(plan: &Document, stages: &mut Vec<String>, index: &mut Option<String>) {
        if let Ok(stage) = plan.get_str("stage") {
            stages.push(stage.to_string());
        }
        if index.is_none() {
            if let Ok(kp) = plan.get_document("keyPattern") {
                *index = plan
                    .get_str("indexName")
                    .ok()
                    .map(String::from)
                    .or_else(|| Some(Bson::Document(kp.clone()).into_relaxed_extjson().to_string()));
            }
        }
        for key in ["inputStage", "inputStages"] {
            match plan.get(key) {
                Some(Bson::Document(d)) => walk(d, stages, index),
                Some(Bson::Array(arr)) => {
                    for v in arr {
                        if let Bson::Document(d) = v {
                            walk(d, stages, index);
                        }
                    }
                }
                _ => {}
            }
        }
    }

    let exec = raw.get_document("executionStats").ok();
    let mut stages = Vec::new();
    let mut index = None;
    if let Some(plan) = winning(raw) {
        walk(plan, &mut stages, &mut index);
    }
    let collscan = stages.iter().any(|s| s == "COLLSCAN");

    doc! {
        "indexName": index,
        "stages": stages,
        "isCollectionScan": collscan,
        "nReturned": exec.and_then(|e| e.get_i64("nReturned").ok().or(e.get_i32("nReturned").ok().map(i64::from))),
        "totalDocsExamined": exec.and_then(|e| e.get_i64("totalDocsExamined").ok().or(e.get_i32("totalDocsExamined").ok().map(i64::from))),
        "totalKeysExamined": exec.and_then(|e| e.get_i64("totalKeysExamined").ok().or(e.get_i32("totalKeysExamined").ok().map(i64::from))),
        "executionTimeMillis": exec.and_then(|e| e.get_i64("executionTimeMillis").ok().or(e.get_i32("executionTimeMillis").ok().map(i64::from))),
        "raw": raw.clone(),
    }
}

/// Collect dotted field paths from the most recent `limit` documents (ordered
/// by `_id` desc), sorted by how often each path appears. Used to power
/// field autocompletion in the query builder.
#[tauri::command]
pub async fn collection_fields(
    database: String,
    collection: String,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let limit = limit.unwrap_or(1000).clamp(10, 5000);

    let docs: Vec<Document> = coll
        .find(doc! {})
        .sort(doc! {"_id": -1})
        .limit(limit)
        .await?
        .try_collect()
        .await?;

    use std::collections::HashMap;
    let mut freq: HashMap<String, i64> = HashMap::new();
    fn visit(prefix: &str, doc: &Document, freq: &mut HashMap<String, i64>) {
        for (k, v) in doc {
            let path = if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") };
            *freq.entry(path.clone()).or_insert(0) += 1;
            if let Bson::Document(sub) = v {
                visit(&path, sub, freq);
            }
        }
    }
    for d in &docs {
        visit("", d, &mut freq);
    }

    let mut paths: Vec<(String, i64)> = freq.into_iter().collect();
    paths.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    Ok(paths.into_iter().map(|(p, _)| p).collect())
}

// ---------------------------------------------------------------------------
// schema analysis
// ---------------------------------------------------------------------------

/// Sample documents and infer, per (dotted) field path, the BSON types seen,
/// how many docs contain it, and a couple of example values.
#[tauri::command]
pub async fn analyze_schema(
    database: String,
    collection: String,
    sample_size: Option<i64>,
    state: State<'_, AppState>,
) -> AppResult<Value> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let sample_size = sample_size.unwrap_or(1000).clamp(10, 10_000);

    let cursor = coll
        .aggregate(vec![doc! { "$sample": { "size": sample_size } }])
        .await?;
    let docs: Vec<Document> = cursor.try_collect().await?;
    let sampled = docs.len() as i64;

    use std::collections::BTreeMap;
    struct FieldAcc {
        present: i64,
        types: BTreeMap<String, i64>,
        examples: Vec<Value>,
    }
    let mut fields: BTreeMap<String, FieldAcc> = BTreeMap::new();

    fn type_name(b: &Bson) -> &'static str {
        match b {
            Bson::Double(_) => "double",
            Bson::String(_) => "string",
            Bson::Array(_) => "array",
            Bson::Document(_) => "object",
            Bson::Boolean(_) => "bool",
            Bson::Null => "null",
            Bson::RegularExpression(_) => "regex",
            Bson::Int32(_) => "int",
            Bson::Int64(_) => "long",
            Bson::Timestamp(_) => "timestamp",
            Bson::Binary(_) => "binary",
            Bson::ObjectId(_) => "objectId",
            Bson::DateTime(_) => "date",
            Bson::Decimal128(_) => "decimal",
            _ => "other",
        }
    }

    fn visit(prefix: &str, doc: &Document, fields: &mut BTreeMap<String, FieldAcc>) {
        for (k, v) in doc {
            let path = if prefix.is_empty() { k.clone() } else { format!("{prefix}.{k}") };
            let acc = fields.entry(path.clone()).or_insert_with(|| FieldAcc {
                present: 0,
                types: BTreeMap::new(),
                examples: Vec::new(),
            });
            acc.present += 1;
            *acc.types.entry(type_name(v).to_string()).or_insert(0) += 1;
            if acc.examples.len() < 3 && !matches!(v, Bson::Document(_) | Bson::Array(_)) {
                acc.examples.push(v.clone().into_relaxed_extjson());
            }
            if let Bson::Document(sub) = v {
                visit(&path, sub, fields);
            }
        }
    }

    for d in &docs {
        visit("", d, &mut fields);
    }

    let result: Vec<Value> = fields
        .into_iter()
        .map(|(path, acc)| {
            let mut types: Vec<Value> = acc
                .types
                .into_iter()
                .map(|(t, n)| json!({ "type": t, "count": n }))
                .collect();
            types.sort_by_key(|v| -(v.get("count").and_then(|c| c.as_i64()).unwrap_or(0)));
            json!({
                "path": path,
                "present": acc.present,
                "coverage": if sampled > 0 { acc.present as f64 / sampled as f64 } else { 0.0 },
                "types": types,
                "examples": acc.examples,
            })
        })
        .collect();

    Ok(json!({ "sampled": sampled, "fields": result }))
}

// ---------------------------------------------------------------------------
// export / import
// ---------------------------------------------------------------------------

/// Export documents matching `filter` to `path` as JSON (array) or CSV.
/// Returns the number of documents written.
#[tauri::command]
pub async fn export_collection(
    database: String,
    collection: String,
    filter: String,
    sort: String,
    format: String,
    path: String,
    job_id: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<CopyOutcome> {
    use std::io::Write;

    let started = Instant::now();
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let filter = parse_doc_text(&filter)?;
    let sort = parse_doc_text(&sort)?;

    let total: Option<u64> = if filter.is_empty() {
        coll.estimated_document_count().await.ok()
    } else {
        match tokio::time::timeout(COUNT_TIMEOUT, coll.count_documents(filter.clone())).await {
            Ok(Ok(n)) => Some(n),
            _ => None,
        }
    };

    let mut find = coll.find(filter);
    if !sort.is_empty() {
        find = find.sort(sort);
    }
    let mut cursor = find.await?;

    let file = std::fs::File::create(&path)
        .map_err(|e| AppError::Parse(format!("cannot write {path}: {e}")))?;
    let mut w = std::io::BufWriter::new(file);

    let cancel = Arc::new(AtomicBool::new(false));
    let job = job_id.unwrap_or_default();
    if !job.is_empty() {
        state.jobs.lock().unwrap().insert(job.clone(), cancel.clone());
    }
    let emit = |copied: u64| {
        if !job.is_empty() {
            let _ = app.emit(
                "copy-progress",
                CopyProgress { job_id: job.clone(), copied, total },
            );
        }
    };

    // CSV needs a column set before the first row. Buffer an initial window to
    // discover the key union, then stream the rest against those columns —
    // memory stays flat no matter how large the collection is.
    let mut count: u64 = 0;
    let mut canceled = false;
    let result: AppResult<()> = async {
        match format.as_str() {
            "csv" => {
                const SNIFF: usize = 1000;
                let mut head: Vec<Document> = Vec::with_capacity(SNIFF);
                while head.len() < SNIFF {
                    match cursor.try_next().await? {
                        Some(d) => head.push(d),
                        None => break,
                    }
                }
                let mut cols: Vec<String> = Vec::new();
                let mut seen = std::collections::HashSet::new();
                if head.iter().any(|d| d.contains_key("_id")) {
                    cols.push("_id".into());
                    seen.insert("_id".to_string());
                }
                for d in &head {
                    for k in d.keys() {
                        if seen.insert(k.clone()) {
                            cols.push(k.clone());
                        }
                    }
                }
                writeln!(w, "{}", cols.iter().map(|c| csv_escape(c)).collect::<Vec<_>>().join(","))?;
                let write_row = |d: &Document, w: &mut dyn Write| -> AppResult<()> {
                    let row: Vec<String> = cols
                        .iter()
                        .map(|c| match d.get(c) {
                            Some(b) => csv_escape(&bson_to_cell(b)),
                            None => String::new(),
                        })
                        .collect();
                    writeln!(w, "{}", row.join(","))?;
                    Ok(())
                };
                for d in &head {
                    write_row(d, &mut w)?;
                    count += 1;
                }
                emit(count);
                loop {
                    if cancel.load(Ordering::Relaxed) {
                        canceled = true;
                        break;
                    }
                    match cursor.try_next().await? {
                        Some(d) => {
                            write_row(&d, &mut w)?;
                            count += 1;
                            if count % 500 == 0 {
                                emit(count);
                            }
                        }
                        None => break,
                    }
                }
            }
            "bson" => {
                // mongodump-compatible: raw BSON documents, concatenated.
                loop {
                    if cancel.load(Ordering::Relaxed) {
                        canceled = true;
                        break;
                    }
                    match cursor.try_next().await? {
                        Some(d) => {
                            d.to_writer(&mut w)
                                .map_err(|e| AppError::Parse(format!("bson write: {e}")))?;
                            count += 1;
                            if count % 500 == 0 {
                                emit(count);
                            }
                        }
                        None => break,
                    }
                }
            }
            "ndjson" => {
                loop {
                    if cancel.load(Ordering::Relaxed) {
                        canceled = true;
                        break;
                    }
                    match cursor.try_next().await? {
                        Some(d) => {
                            writeln!(w, "{}", doc_to_value(d))?;
                            count += 1;
                            if count % 500 == 0 {
                                emit(count);
                            }
                        }
                        None => break,
                    }
                }
            }
            _ => {
                // JSON array of relaxed extended JSON, streamed one doc per line.
                w.write_all(b"[\n")?;
                loop {
                    if cancel.load(Ordering::Relaxed) {
                        canceled = true;
                        break;
                    }
                    match cursor.try_next().await? {
                        Some(d) => {
                            if count > 0 {
                                w.write_all(b",\n")?;
                            }
                            let json = serde_json::to_string_pretty(&doc_to_value(d))
                                .map_err(|e| AppError::Parse(format!("serialize failed: {e}")))?;
                            w.write_all(json.as_bytes())?;
                            count += 1;
                            if count % 500 == 0 {
                                emit(count);
                            }
                        }
                        None => break,
                    }
                }
                w.write_all(b"\n]")?;
            }
        }
        w.flush()?;
        Ok(())
    }
    .await;

    if !job.is_empty() {
        state.jobs.lock().unwrap().remove(&job);
    }
    result?;
    emit(count);
    Ok(CopyOutcome {
        documents: count,
        indexes: 0,
        canceled,
        exec_ms: started.elapsed().as_millis() as u64,
    })
}

fn csv_escape(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn bson_to_cell(b: &Bson) -> String {
    match b {
        Bson::String(s) => s.clone(),
        Bson::Document(_) | Bson::Array(_) => Bson::clone(b).into_relaxed_extjson().to_string(),
        Bson::ObjectId(o) => o.to_hex(),
        Bson::Boolean(v) => v.to_string(),
        Bson::Int32(v) => v.to_string(),
        Bson::Int64(v) => v.to_string(),
        Bson::Double(v) => v.to_string(),
        Bson::Null => String::new(),
        other => other.clone().into_relaxed_extjson().to_string(),
    }
}

/// Import documents from a JSON file (array or newline-delimited) into a
/// collection. Returns the number inserted.
#[tauri::command]
pub async fn import_documents(
    database: String,
    collection: String,
    path: String,
    job_id: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<CopyOutcome> {
    let started = Instant::now();
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);

    let cancel = Arc::new(AtomicBool::new(false));
    let job = job_id.unwrap_or_default();
    if !job.is_empty() {
        state.jobs.lock().unwrap().insert(job.clone(), cancel.clone());
    }

    let result = run_import(&app, &job, &coll, &path, &cancel).await;

    if !job.is_empty() {
        state.jobs.lock().unwrap().remove(&job);
    }
    let (count, canceled) = result?;
    Ok(CopyOutcome {
        documents: count,
        indexes: 0,
        canceled,
        exec_ms: started.elapsed().as_millis() as u64,
    })
}

const IMPORT_BATCH: usize = 1000;

async fn run_import(
    app: &AppHandle,
    job: &str,
    coll: &mongodb::Collection<Document>,
    path: &str,
    cancel: &AtomicBool,
) -> AppResult<(u64, bool)> {
    use std::io::{BufRead, Read};

    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let mut count: u64 = 0;
    let mut canceled = false;
    let mut batch: Vec<Document> = Vec::with_capacity(IMPORT_BATCH);

    let emit = |copied: u64| {
        if !job.is_empty() {
            let _ = app.emit(
                "copy-progress",
                CopyProgress { job_id: job.to_string(), copied, total: None },
            );
        }
    };

    macro_rules! flush {
        () => {
            if !batch.is_empty() {
                let n = batch.len() as u64;
                coll.insert_many(std::mem::take(&mut batch)).await?;
                count += n;
                emit(count);
            }
        };
    }

    match ext.as_str() {
        "bson" => {
            // mongodump format: length-prefixed BSON documents, concatenated.
            let file = std::fs::File::open(path)
                .map_err(|e| AppError::Parse(format!("cannot read {path}: {e}")))?;
            let mut r = std::io::BufReader::new(file);
            loop {
                if cancel.load(Ordering::Relaxed) {
                    canceled = true;
                    break;
                }
                // Peek: EOF means done; anything else must parse as a doc.
                let mut probe = [0u8; 1];
                match r.read(&mut probe) {
                    Ok(0) => break,
                    Ok(_) => {}
                    Err(e) => return Err(AppError::Parse(format!("bson read: {e}"))),
                }
                let chained = probe.as_slice().chain(&mut r);
                let d = Document::from_reader(chained)
                    .map_err(|e| AppError::Parse(format!("bson document {}: {e}", count + 1)))?;
                batch.push(d);
                if batch.len() >= IMPORT_BATCH {
                    flush!();
                }
            }
            flush!();
        }
        "csv" => {
            let text = std::fs::read_to_string(path)
                .map_err(|e| AppError::Parse(format!("cannot read {path}: {e}")))?;
            let rows = parse_csv(&text)?;
            let mut iter = rows.into_iter();
            let header = iter
                .next()
                .ok_or_else(|| AppError::Parse("CSV file is empty".into()))?;
            for row in iter {
                if cancel.load(Ordering::Relaxed) {
                    canceled = true;
                    break;
                }
                if row.iter().all(|c| c.is_empty()) {
                    continue;
                }
                let mut d = Document::new();
                for (i, cell) in row.iter().enumerate() {
                    let Some(key) = header.get(i) else { continue };
                    if key.is_empty() || cell.is_empty() {
                        continue; // empty cell → field absent, like mongoimport
                    }
                    d.insert(key.clone(), csv_cell_to_bson(key, cell));
                }
                if !d.is_empty() {
                    batch.push(d);
                }
                if batch.len() >= IMPORT_BATCH {
                    flush!();
                }
            }
            flush!();
        }
        "ndjson" | "jsonl" => {
            // Line-streamed: constant memory regardless of file size.
            let file = std::fs::File::open(path)
                .map_err(|e| AppError::Parse(format!("cannot read {path}: {e}")))?;
            let r = std::io::BufReader::new(file);
            for (i, line) in r.lines().enumerate() {
                if cancel.load(Ordering::Relaxed) {
                    canceled = true;
                    break;
                }
                let line = line.map_err(|e| AppError::Parse(format!("line {}: {e}", i + 1)))?;
                if line.trim().is_empty() {
                    continue;
                }
                let v = shell::parse_value(&line)
                    .map_err(|e| AppError::Parse(format!("line {}: {e}", i + 1)))?;
                batch.push(to_doc(&v)?);
                if batch.len() >= IMPORT_BATCH {
                    flush!();
                }
            }
            flush!();
        }
        _ => {
            // .json — array or NDJSON body, sniffed like before. The array
            // form needs a full parse; NDJSON content streams line-by-line.
            let text = std::fs::read_to_string(path)
                .map_err(|e| AppError::Parse(format!("cannot read {path}: {e}")))?;
            if text.trim_start().starts_with('[') {
                let value = shell::parse_value(&text)?;
                for v in value
                    .as_array()
                    .ok_or_else(|| AppError::Parse("expected a JSON array".into()))?
                {
                    if cancel.load(Ordering::Relaxed) {
                        canceled = true;
                        break;
                    }
                    batch.push(to_doc(v)?);
                    if batch.len() >= IMPORT_BATCH {
                        flush!();
                    }
                }
            } else {
                for (i, line) in text.lines().enumerate() {
                    if cancel.load(Ordering::Relaxed) {
                        canceled = true;
                        break;
                    }
                    if line.trim().is_empty() {
                        continue;
                    }
                    let v = shell::parse_value(line)
                        .map_err(|e| AppError::Parse(format!("line {}: {e}", i + 1)))?;
                    batch.push(to_doc(&v)?);
                    if batch.len() >= IMPORT_BATCH {
                        flush!();
                    }
                }
            }
            flush!();
        }
    }

    if count == 0 && !canceled {
        return Err(AppError::Parse("no documents found in file".into()));
    }
    Ok((count, canceled))
}

/// Minimal RFC-4180 CSV parser: quoted fields, escaped quotes, newlines
/// inside quotes. Returns rows of cells.
fn parse_csv(text: &str) -> AppResult<Vec<Vec<String>>> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut cell = String::new();
    let mut in_quotes = false;
    let mut chars = text.chars().peekable();

    while let Some(c) = chars.next() {
        if in_quotes {
            match c {
                '"' => {
                    if chars.peek() == Some(&'"') {
                        chars.next();
                        cell.push('"');
                    } else {
                        in_quotes = false;
                    }
                }
                _ => cell.push(c),
            }
        } else {
            match c {
                '"' => in_quotes = true,
                ',' => {
                    row.push(std::mem::take(&mut cell));
                }
                '\r' => {} // swallow; the \n handles the row break
                '\n' => {
                    row.push(std::mem::take(&mut cell));
                    rows.push(std::mem::take(&mut row));
                }
                _ => cell.push(c),
            }
        }
    }
    if !cell.is_empty() || !row.is_empty() {
        row.push(cell);
        rows.push(row);
    }
    Ok(rows)
}

/// Type inference for CSV cells, mongoimport-style: bool, int, double, and a
/// 24-hex `_id` becomes an ObjectId; everything else stays a string.
fn csv_cell_to_bson(key: &str, cell: &str) -> Bson {
    if key == "_id" && cell.len() == 24 && cell.chars().all(|c| c.is_ascii_hexdigit()) {
        if let Ok(oid) = mongodb::bson::oid::ObjectId::parse_str(cell) {
            return Bson::ObjectId(oid);
        }
    }
    match cell {
        "true" => return Bson::Boolean(true),
        "false" => return Bson::Boolean(false),
        "null" => return Bson::Null,
        _ => {}
    }
    if let Ok(n) = cell.parse::<i64>() {
        // Preserve leading-zero strings like "007" as strings.
        if !(cell.len() > 1 && cell.starts_with('0')) {
            return if let Ok(n32) = i32::try_from(n) {
                Bson::Int32(n32)
            } else {
                Bson::Int64(n)
            };
        }
    }
    if let Ok(f) = cell.parse::<f64>() {
        if cell.contains('.') || cell.contains('e') || cell.contains('E') {
            return Bson::Double(f);
        }
    }
    Bson::String(cell.to_string())
}

/// Write arbitrary (base64-encoded) bytes to a user-chosen path. Used by
/// Studio exports (chart PNGs, result JSON/CSV).
#[tauri::command]
pub async fn save_file(path: String, contents_base64: String) -> AppResult<()> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(contents_base64.as_bytes())
        .map_err(|e| AppError::Parse(format!("invalid file payload: {e}")))?;
    std::fs::write(&path, bytes).map_err(|e| AppError::Parse(format!("cannot write {path}: {e}")))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Ognom Studio — AI chat proxy
// ---------------------------------------------------------------------------

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatResult {
    pub content: String,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

const AI_PROVIDERS: &[&str] = &["openai", "anthropic", "ollama", "lmstudio", "custom"];

fn ai_keys_path(state: &AppState) -> std::path::PathBuf {
    state.data_dir.join("ai_keys.json")
}

/// provider → encrypted key payload. Same AES-256-GCM vault as connection
/// secrets, so an AI key is protected exactly like a database password.
fn load_ai_keys(state: &AppState) -> std::collections::HashMap<String, String> {
    std::fs::read_to_string(ai_keys_path(state))
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn stored_ai_key(state: &AppState, provider: &str) -> Option<String> {
    let keys = load_ai_keys(state);
    let payload = keys.get(provider)?;
    state.crypto().decrypt(payload).ok().filter(|k| !k.trim().is_empty())
}

/// Store (or clear, with an empty key) a provider's API key in the encrypted
/// vault. Returns the providers that currently have a key.
#[tauri::command]
pub fn set_ai_key(
    provider: String,
    key: String,
    state: State<'_, AppState>,
) -> AppResult<Vec<String>> {
    if !AI_PROVIDERS.contains(&provider.as_str()) {
        return Err(AppError::Parse(format!("unknown AI provider '{provider}'")));
    }
    let mut keys = load_ai_keys(&state);
    let key = key.trim();
    if key.is_empty() {
        keys.remove(&provider);
    } else {
        keys.insert(provider, state.crypto().encrypt(key)?);
    }
    let json = serde_json::to_string_pretty(&keys)
        .map_err(|e| AppError::Storage(format!("could not serialize AI keys: {e}")))?;
    std::fs::write(ai_keys_path(&state), json)
        .map_err(|e| AppError::Storage(format!("could not write AI keys: {e}")))?;
    let mut have: Vec<String> = keys.into_keys().collect();
    have.sort();
    Ok(have)
}

/// Which providers have a key stored. The key itself never leaves the backend.
#[tauri::command]
pub fn ai_key_status(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    let mut have: Vec<String> = load_ai_keys(&state).into_keys().collect();
    have.sort();
    Ok(have)
}

fn provider_label(provider: &str) -> &'static str {
    match provider {
        "openai" => "OpenAI",
        "anthropic" => "Anthropic",
        "ollama" => "Ollama",
        "lmstudio" => "LM Studio",
        _ => "AI provider",
    }
}

/// Proxy a chat completion to the configured AI provider from the backend
/// (no CORS, and the key never enters the webview's network layer). OpenAI,
/// Ollama, LM Studio, and custom endpoints speak the OpenAI-compatible
/// chat-completions API; Anthropic uses its native Messages API. Returns the
/// assistant message text plus token usage.
#[tauri::command]
pub async fn ai_chat(
    provider: String,
    model: String,
    system: String,
    user: String,
    json_mode: bool,
    reasoning: bool,
    base_url: Option<String>,
    state: State<'_, AppState>,
) -> AppResult<AiChatResult> {
    let label = provider_label(&provider);
    let key = stored_ai_key(&state, &provider);
    // Cloud providers need a key; local/custom endpoints usually don't.
    if key.is_none() && matches!(provider.as_str(), "openai" | "anthropic") {
        return Err(AppError::Parse(format!(
            "{label} API key is not set — add it in Settings → Prompts & AI"
        )));
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::Parse(format!("http client: {e}")))?;

    if provider == "anthropic" {
        return anthropic_chat(&client, &key.unwrap(), &model, &system, &user, reasoning).await;
    }

    // ---- OpenAI-compatible path (openai / ollama / lmstudio / custom) -----
    let base = base_url
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| match provider.as_str() {
            "ollama" => "http://localhost:11434/v1".into(),
            "lmstudio" => "http://localhost:1234/v1".into(),
            _ => "https://api.openai.com/v1".into(),
        });
    let url = format!("{}/chat/completions", base.trim_end_matches('/'));

    let mut body = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
    });
    // Local servers vary in which OpenAI extensions they accept — only send
    // OpenAI-specific fields to OpenAI itself (and response_format to custom
    // endpoints, which are usually cloud-compatible).
    if json_mode && matches!(provider.as_str(), "openai" | "custom") {
        body["response_format"] = json!({ "type": "json_object" });
    }
    if provider == "openai" {
        // Same model in both modes — Deep Think just reasons harder. "none"
        // keeps Normal fast. (gpt-5.4 supports none/low/medium/high/xhigh.)
        body["reasoning_effort"] = json!(if reasoning { "high" } else { "none" });
    }

    let mut req = client.post(&url).json(&body);
    if let Some(k) = key {
        req = req.bearer_auth(k);
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::Parse(format!("{label} request failed: {e}")))?;

    let status = resp.status();
    let payload: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Parse(format!("{label} response unreadable: {e}")))?;

    if !status.is_success() {
        let msg = payload
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .or_else(|| payload.pointer("/error").and_then(|v| v.as_str()))
            .unwrap_or("unknown error");
        return Err(AppError::Parse(format!("{label} ({status}): {msg}")));
    }

    let content = payload
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| AppError::Parse(format!("{label} returned an empty response")))?;

    let usage = |key: &str| payload.pointer(&format!("/usage/{key}")).and_then(|v| v.as_u64()).unwrap_or(0);
    Ok(AiChatResult {
        content,
        input_tokens: usage("prompt_tokens"),
        output_tokens: usage("completion_tokens"),
        total_tokens: usage("total_tokens"),
    })
}

/// Anthropic Messages API. System prompt is a top-level field; thinking is
/// adaptive by default on current models, so Deep Think maps to a higher
/// `output_config.effort` instead of a separate reasoning switch.
async fn anthropic_chat(
    client: &reqwest::Client,
    api_key: &str,
    model: &str,
    system: &str,
    user: &str,
    reasoning: bool,
) -> AppResult<AiChatResult> {
    let mut body = json!({
        "model": model,
        "max_tokens": 16000,
        "system": system,
        "messages": [ { "role": "user", "content": user } ],
    });
    // `effort` is unsupported on claude-haiku-4-5 / claude-sonnet-4-5 —
    // sending it there would 400. Those models just run at their default.
    if !model.contains("haiku") && !model.contains("sonnet-4-5") {
        body["output_config"] = json!({ "effort": if reasoning { "high" } else { "low" } });
    }

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Parse(format!("Anthropic request failed: {e}")))?;

    let status = resp.status();
    let payload: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Parse(format!("Anthropic response unreadable: {e}")))?;

    if !status.is_success() {
        let msg = payload
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(AppError::Parse(format!("Anthropic ({status}): {msg}")));
    }

    if payload.pointer("/stop_reason").and_then(|v| v.as_str()) == Some("refusal") {
        return Err(AppError::Parse(
            "Anthropic declined this request (safety classifier) — try rephrasing".into(),
        ));
    }

    // Content is an array of blocks; the answer is the first non-empty text
    // block (thinking blocks may precede it).
    let content = payload
        .pointer("/content")
        .and_then(|v| v.as_array())
        .and_then(|blocks| {
            blocks.iter().find_map(|b| {
                if b.pointer("/type").and_then(|t| t.as_str()) == Some("text") {
                    b.pointer("/text")
                        .and_then(|t| t.as_str())
                        .filter(|s| !s.trim().is_empty())
                        .map(str::to_string)
                } else {
                    None
                }
            })
        })
        .ok_or_else(|| AppError::Parse("Anthropic returned an empty response".into()))?;

    let usage = |key: &str| payload.pointer(&format!("/usage/{key}")).and_then(|v| v.as_u64()).unwrap_or(0);
    let input = usage("input_tokens");
    let output = usage("output_tokens");
    Ok(AiChatResult {
        content,
        input_tokens: input,
        output_tokens: output,
        total_tokens: input + output,
    })
}

// ---------------------------------------------------------------------------
// shell execution
// ---------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellOutcome {
    pub kind: String, // "docs" | "value" | "message" | "useDb"
    pub docs: Option<Vec<Value>>,
    pub value: Option<Value>,
    pub message: Option<String>,
    pub use_db: Option<String>,
    pub exec_ms: u64,
    pub applied_default_limit: bool,
}

impl ShellOutcome {
    fn docs(docs: Vec<Value>, exec_ms: u64, limited: bool) -> Self {
        ShellOutcome {
            kind: "docs".into(),
            docs: Some(docs),
            value: None,
            message: None,
            use_db: None,
            exec_ms,
            applied_default_limit: limited,
        }
    }
    fn value(v: Value, exec_ms: u64) -> Self {
        ShellOutcome {
            kind: "value".into(),
            docs: None,
            value: Some(v),
            message: None,
            use_db: None,
            exec_ms,
            applied_default_limit: false,
        }
    }
    fn message(m: String, exec_ms: u64) -> Self {
        ShellOutcome {
            kind: "message".into(),
            docs: None,
            value: None,
            message: Some(m),
            use_db: None,
            exec_ms,
            applied_default_limit: false,
        }
    }
}

fn arg_doc(args: &[Value], idx: usize) -> AppResult<Document> {
    match args.get(idx) {
        Some(v) => to_doc(v),
        None => Ok(Document::new()),
    }
}

fn opt_bool(args: &[Value], idx: usize, key: &str) -> bool {
    args.get(idx)
        .and_then(|v| v.get(key))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

#[tauri::command]
pub async fn run_shell(
    database: String,
    text: String,
    state: State<'_, AppState>,
) -> AppResult<ShellOutcome> {
    let statement = shell::parse_statement(&text)?;
    let client = current_client(&state).await?;
    let db = client.database(&database);
    let started = Instant::now();
    let ms = move |s: Instant| s.elapsed().as_millis() as u64;

    match statement {
        Statement::ShowDbs => {
            let specs = client.list_databases().await?;
            let docs = specs
                .into_iter()
                .map(|s| json!({"name": s.name, "sizeOnDisk": s.size_on_disk, "empty": s.empty}))
                .collect();
            Ok(ShellOutcome::docs(docs, ms(started), false))
        }
        Statement::ShowCollections => {
            let names = db.list_collection_names().await?;
            let docs = names.into_iter().map(|n| json!({"name": n})).collect();
            Ok(ShellOutcome::docs(docs, ms(started), false))
        }
        Statement::Use(name) => Ok(ShellOutcome {
            kind: "useDb".into(),
            docs: None,
            value: None,
            message: Some(format!("switched to db {name}")),
            use_db: Some(name),
            exec_ms: ms(started),
            applied_default_limit: false,
        }),
        Statement::DbStats => {
            let result = db.run_command(doc! {"dbStats": 1}).await?;
            Ok(ShellOutcome::value(doc_to_value(result), ms(started)))
        }
        Statement::RunCommand(cmd) => {
            let result = db.run_command(to_doc(&cmd)?).await?;
            Ok(ShellOutcome::value(doc_to_value(result), ms(started)))
        }
        Statement::AdminCommand(cmd) => {
            let result = client.database("admin").run_command(to_doc(&cmd)?).await?;
            Ok(ShellOutcome::value(doc_to_value(result), ms(started)))
        }
        Statement::CreateCollection(name) => {
            db.create_collection(&name).await?;
            Ok(ShellOutcome::message(format!("created collection '{name}'"), ms(started)))
        }
        Statement::DropDatabase => {
            db.drop().await?;
            Ok(ShellOutcome::message(format!("dropped database '{database}'"), ms(started)))
        }
        Statement::Collection { collection, method, args, chain } => {
            run_collection_method(db, &collection, &method, args, chain, started).await
        }
    }
}

async fn run_collection_method(
    db: mongodb::Database,
    collection: &str,
    method: &str,
    args: Vec<Value>,
    chain: Vec<(String, Vec<Value>)>,
    started: Instant,
) -> AppResult<ShellOutcome> {
    let coll = db.collection::<Document>(collection);
    let ms = move |s: Instant| s.elapsed().as_millis() as u64;

    // Chain options shared by find/aggregate.
    let mut sort: Option<Document> = None;
    let mut limit: Option<i64> = None;
    let mut skip: Option<u64> = None;
    let mut projection: Option<Document> = None;
    let mut hint: Option<Document> = None;
    let mut count_terminal = false;
    let mut allow_disk_use = false;

    for (name, cargs) in &chain {
        match name.as_str() {
            "sort" => sort = Some(arg_doc(cargs, 0)?),
            "limit" => {
                limit = Some(
                    cargs
                        .first()
                        .and_then(|v| v.as_i64())
                        .ok_or_else(|| AppError::Parse("limit(n) needs a number".into()))?,
                )
            }
            "skip" => {
                skip = Some(
                    cargs
                        .first()
                        .and_then(|v| v.as_i64())
                        .map(|n| n.max(0) as u64)
                        .ok_or_else(|| AppError::Parse("skip(n) needs a number".into()))?,
                )
            }
            "project" | "projection" => projection = Some(arg_doc(cargs, 0)?),
            "hint" => hint = Some(arg_doc(cargs, 0)?),
            "count" | "size" => count_terminal = true,
            "allowDiskUse" => {
                allow_disk_use = cargs.first().and_then(|v| v.as_bool()).unwrap_or(true)
            }
            "toArray" | "pretty" => {}
            other => {
                return Err(AppError::Parse(format!(
                    ".{other}() is not supported — supported chains: sort, limit, skip, project, hint, count, allowDiskUse, toArray, pretty"
                )))
            }
        }
    }

    match method {
        "find" | "findOne" => {
            let filter = arg_doc(&args, 0)?;
            if args.len() > 1 && projection.is_none() {
                projection = Some(to_doc(&args[1])?);
            }
            if count_terminal {
                let count = coll.count_documents(filter).await?;
                return Ok(ShellOutcome::value(json!({"count": count}), ms(started)));
            }
            let mut applied_default = false;
            let effective_limit = if method == "findOne" {
                1
            } else {
                limit.unwrap_or_else(|| {
                    applied_default = true;
                    DEFAULT_FIND_LIMIT
                })
            };
            let mut find = coll.find(filter).limit(effective_limit);
            if let Some(s) = sort {
                find = find.sort(s);
            }
            if let Some(s) = skip {
                find = find.skip(s);
            }
            if let Some(p) = projection {
                find = find.projection(p);
            }
            if let Some(h) = hint {
                find = find.hint(mongodb::options::Hint::Keys(h));
            }
            let docs: Vec<Document> = find.await?.try_collect().await?;
            let truncated = applied_default && docs.len() as i64 == DEFAULT_FIND_LIMIT;
            Ok(ShellOutcome::docs(
                docs.into_iter().map(doc_to_value).collect(),
                ms(started),
                truncated,
            ))
        }
        "aggregate" => {
            let mut pipeline = match args.first() {
                Some(v) => to_pipeline(v)?,
                None => Vec::new(),
            };
            if !allow_disk_use {
                allow_disk_use = opt_bool(&args, 1, "allowDiskUse");
            }
            let applied_default = !pipeline_has_terminator(&pipeline);
            if applied_default {
                pipeline.push(doc! {"$limit": AGG_SAFETY_LIMIT});
            }
            let cursor = coll.aggregate(pipeline).allow_disk_use(allow_disk_use).await?;
            let docs: Vec<Document> = cursor.try_collect().await?;
            let truncated = applied_default && docs.len() as i64 == AGG_SAFETY_LIMIT;
            Ok(ShellOutcome::docs(
                docs.into_iter().map(doc_to_value).collect(),
                ms(started),
                truncated,
            ))
        }
        "countDocuments" | "count" => {
            let count = coll.count_documents(arg_doc(&args, 0)?).await?;
            Ok(ShellOutcome::value(json!({"count": count}), ms(started)))
        }
        "estimatedDocumentCount" => {
            let count = coll.estimated_document_count().await?;
            Ok(ShellOutcome::value(json!({"count": count}), ms(started)))
        }
        "distinct" => {
            let field = args
                .first()
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::Parse("distinct('field', filter?) needs a field name".into()))?;
            let filter = arg_doc(&args, 1)?;
            let values = coll.distinct(field, filter).await?;
            let values: Vec<Value> = values.into_iter().map(|b| b.into_relaxed_extjson()).collect();
            Ok(ShellOutcome::value(json!({"values": values}), ms(started)))
        }
        "insertOne" => {
            let doc = args
                .first()
                .map(to_doc)
                .transpose()?
                .ok_or_else(|| AppError::Parse("insertOne(doc) needs a document".into()))?;
            let result = coll.insert_one(doc).await?;
            Ok(ShellOutcome::value(
                json!({"acknowledged": true, "insertedId": result.inserted_id.into_relaxed_extjson()}),
                ms(started),
            ))
        }
        "insertMany" => {
            let arr = args
                .first()
                .and_then(|v| v.as_array())
                .ok_or_else(|| AppError::Parse("insertMany([docs]) needs an array".into()))?;
            let docs: Vec<Document> = arr.iter().map(to_doc).collect::<AppResult<_>>()?;
            let result = coll.insert_many(docs).await?;
            let ids: Vec<Value> =
                result.inserted_ids.values().map(|b| b.clone().into_relaxed_extjson()).collect();
            Ok(ShellOutcome::value(
                json!({"acknowledged": true, "insertedCount": ids.len(), "insertedIds": ids}),
                ms(started),
            ))
        }
        "updateOne" | "updateMany" => {
            let filter = arg_doc(&args, 0)?;
            let update = args
                .get(1)
                .map(to_doc)
                .transpose()?
                .ok_or_else(|| AppError::Parse(format!("{method}(filter, update) needs an update document")))?;
            if !update.keys().any(|k| k.starts_with('$')) {
                return Err(AppError::Parse(
                    "update must use operators like {$set: {...}} — use replaceOne for full replacement".into(),
                ));
            }
            let upsert = opt_bool(&args, 2, "upsert");
            let result = if method == "updateOne" {
                coll.update_one(filter, update).upsert(upsert).await?
            } else {
                coll.update_many(filter, update).upsert(upsert).await?
            };
            Ok(ShellOutcome::value(
                json!({
                    "matchedCount": result.matched_count,
                    "modifiedCount": result.modified_count,
                    "upsertedId": result.upserted_id.map(|b| b.into_relaxed_extjson()),
                }),
                ms(started),
            ))
        }
        "replaceOne" => {
            let filter = arg_doc(&args, 0)?;
            let replacement = args
                .get(1)
                .map(to_doc)
                .transpose()?
                .ok_or_else(|| AppError::Parse("replaceOne(filter, doc) needs a replacement".into()))?;
            let upsert = opt_bool(&args, 2, "upsert");
            let result = coll.replace_one(filter, replacement).upsert(upsert).await?;
            Ok(ShellOutcome::value(
                json!({
                    "matchedCount": result.matched_count,
                    "modifiedCount": result.modified_count,
                    "upsertedId": result.upserted_id.map(|b| b.into_relaxed_extjson()),
                }),
                ms(started),
            ))
        }
        "deleteOne" | "deleteMany" => {
            let filter = arg_doc(&args, 0)?;
            if method == "deleteMany" && filter.is_empty() && args.is_empty() {
                return Err(AppError::Parse(
                    "deleteMany() with no filter would delete everything — pass {} explicitly if you mean it".into(),
                ));
            }
            let result = if method == "deleteOne" {
                coll.delete_one(filter).await?
            } else {
                coll.delete_many(filter).await?
            };
            Ok(ShellOutcome::value(json!({"deletedCount": result.deleted_count}), ms(started)))
        }
        "drop" => {
            coll.drop().await?;
            Ok(ShellOutcome::message(format!("dropped collection '{collection}'"), ms(started)))
        }
        "getIndexes" | "getIndices" => {
            let models: Vec<IndexModel> = coll.list_indexes().await?.try_collect().await?;
            let docs = models
                .into_iter()
                .map(|m| {
                    let o = m.options.unwrap_or_default();
                    json!({
                        "name": o.name.unwrap_or_default(),
                        "key": doc_to_value(m.keys),
                        "unique": o.unique.unwrap_or(false),
                    })
                })
                .collect();
            Ok(ShellOutcome::docs(docs, ms(started), false))
        }
        "createIndex" => {
            let keys = args
                .first()
                .map(to_doc)
                .transpose()?
                .ok_or_else(|| AppError::Parse("createIndex(keys, options?) needs keys".into()))?;
            let opts = args.get(1);
            // Full option parity with the GUI index builder: partial filter,
            // collation, and hidden used to be silently dropped here.
            let partial = opts
                .and_then(|o| o.get("partialFilterExpression"))
                .map(to_doc)
                .transpose()?;
            let collation = opts
                .and_then(|o| o.get("collation"))
                .map(to_doc)
                .transpose()?
                .map(|d| {
                    mongodb::bson::from_document::<mongodb::options::Collation>(d)
                        .map_err(|e| AppError::Parse(format!("collation: {e}")))
                })
                .transpose()?;
            let options = IndexOptions::builder()
                .name(opts.and_then(|o| o.get("name")).and_then(|v| v.as_str()).map(str::to_string))
                .unique(opts.and_then(|o| o.get("unique")).and_then(|v| v.as_bool()).filter(|b| *b))
                .expire_after(
                    opts.and_then(|o| o.get("expireAfterSeconds"))
                        .and_then(|v| v.as_u64())
                        .map(Duration::from_secs),
                )
                .sparse(opts.and_then(|o| o.get("sparse")).and_then(|v| v.as_bool()).filter(|b| *b))
                .hidden(opts.and_then(|o| o.get("hidden")).and_then(|v| v.as_bool()).filter(|b| *b))
                .partial_filter_expression(partial)
                .collation(collation)
                .build();
            let model = IndexModel::builder().keys(keys).options(options).build();
            let result = coll.create_index(model).await?;
            Ok(ShellOutcome::message(format!("created index '{}'", result.index_name), ms(started)))
        }
        "dropIndex" => {
            let name = args
                .first()
                .and_then(|v| v.as_str())
                .ok_or_else(|| AppError::Parse("dropIndex('name') needs an index name".into()))?;
            coll.drop_index(name).await?;
            Ok(ShellOutcome::message(format!("dropped index '{name}'"), ms(started)))
        }
        "stats" => {
            let cursor = coll.aggregate(vec![doc! {"$collStats": {"storageStats": {}}}]).await?;
            let docs: Vec<Document> = cursor.try_collect().await?;
            let v = docs.into_iter().next().map(doc_to_value).unwrap_or(Value::Null);
            Ok(ShellOutcome::value(v, ms(started)))
        }
        other => Err(AppError::Parse(format!(
            "{other}() is not supported — supported: find, findOne, aggregate, countDocuments, \
             estimatedDocumentCount, distinct, insertOne, insertMany, updateOne, updateMany, \
             replaceOne, deleteOne, deleteMany, drop, getIndexes, createIndex, dropIndex, stats"
        ))),
    }
}
