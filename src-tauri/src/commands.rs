use futures::TryStreamExt;
use mongodb::bson::{doc, Bson, Document};
use mongodb::options::{ClientOptions, IndexOptions};
use mongodb::{Client, IndexModel};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tauri::State;

use crate::crypto::{Crypto, KeySource};
use crate::error::{AppError, AppResult};
use crate::profiles::{uri_from_input, ProfileInput, ProfileStore, ProfileSummary};
use crate::shell::{self, Statement};

pub struct AppState {
    pub conn: tokio::sync::Mutex<Option<Client>>,
    pub store: std::sync::Mutex<ProfileStore>,
    pub crypto: std::sync::Mutex<Crypto>,
    pub data_dir: std::path::PathBuf,
    /// True when the user chose the keychain but it failed and the key file
    /// is being used instead.
    pub degraded: std::sync::atomic::AtomicBool,
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
    let guard = state.conn.lock().await;
    guard.clone().ok_or(AppError::NotConnected)
}

// ---------------------------------------------------------------------------
// connection lifecycle
// ---------------------------------------------------------------------------

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
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

    let info = ConnectionInfo { profile_id, name, host_summary, server_version, topology, latency_ms };
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
    let (client, info) = establish(&uri, name, Some(profile_id.clone())).await?;
    *state.conn.lock().await = Some(client);
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
    let (client, info) = establish(&uri, name, None).await?;
    *state.conn.lock().await = Some(client);
    Ok(info)
}

#[tauri::command]
pub async fn disconnect(state: State<'_, AppState>) -> AppResult<()> {
    // Dropping the last Client clone tears the pool down.
    *state.conn.lock().await = None;
    Ok(())
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
pub async fn list_databases(state: State<'_, AppState>) -> AppResult<Vec<DbInfo>> {
    let client = current_client(&state).await?;
    let specs = client.list_databases().await?;
    let mut dbs: Vec<DbInfo> = specs
        .into_iter()
        .map(|s| DbInfo { name: s.name, size_on_disk: Some(s.size_on_disk), empty: Some(s.empty) })
        .collect();
    dbs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(dbs)
}

#[tauri::command]
pub async fn list_collections(database: String, state: State<'_, AppState>) -> AppResult<Vec<CollInfo>> {
    let client = current_client(&state).await?;
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
    state: State<'_, AppState>,
) -> AppResult<DocsPage> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);

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
    Ok(models
        .into_iter()
        .map(|m| {
            let o = m.options.unwrap_or_default();
            IndexInfo {
                name: o.name.unwrap_or_default(),
                keys: doc_to_value(m.keys),
                unique: o.unique.unwrap_or(false),
                sparse: o.sparse.unwrap_or(false),
                hidden: o.hidden.unwrap_or(false),
                ttl_seconds: o.expire_after.map(|d| d.as_secs()),
                partial_filter: o.partial_filter_expression.map(doc_to_value),
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

    let explain = if let Some(stages) = pipeline_stages {
        let mut pipeline: Vec<Document> = Vec::with_capacity(stages.len());
        for (i, stage) in stages.iter().enumerate() {
            let body = shell::parse_value(&stage.body)
                .map_err(|e| AppError::Parse(format!("stage {} ({}): {e}", i + 1, stage.op)))?;
            let mut d = Document::new();
            d.insert(stage.op.clone(), to_bson(&body)?);
            pipeline.push(d);
        }
        doc! {
            "explain": {
                "aggregate": &collection,
                "pipeline": pipeline,
                "cursor": {},
            },
            "verbosity": &verbosity,
        }
    } else {
        let mut find_cmd = doc! { "find": &collection, "filter": parse_doc_text(&filter)? };
        let sort = parse_doc_text(&sort)?;
        let projection = parse_doc_text(&projection)?;
        if !sort.is_empty() {
            find_cmd.insert("sort", sort);
        }
        if !projection.is_empty() {
            find_cmd.insert("projection", projection);
        }
        doc! { "explain": find_cmd, "verbosity": &verbosity }
    };

    let raw = db.run_command(explain).await?;
    Ok(doc_to_value(summarize_explain(&raw)))
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
    state: State<'_, AppState>,
) -> AppResult<u64> {
    use std::io::Write;

    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let filter = parse_doc_text(&filter)?;
    let sort = parse_doc_text(&sort)?;

    let mut find = coll.find(filter);
    if !sort.is_empty() {
        find = find.sort(sort);
    }
    let docs: Vec<Document> = find.await?.try_collect().await?;

    let file = std::fs::File::create(&path)
        .map_err(|e| AppError::Parse(format!("cannot write {path}: {e}")))?;
    let mut w = std::io::BufWriter::new(file);
    let count = docs.len() as u64;

    if format == "csv" {
        // Union of top-level keys across all docs, _id first.
        let mut cols: Vec<String> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        if docs.iter().any(|d| d.contains_key("_id")) {
            cols.push("_id".into());
            seen.insert("_id".to_string());
        }
        for d in &docs {
            for k in d.keys() {
                if seen.insert(k.clone()) {
                    cols.push(k.clone());
                }
            }
        }
        writeln!(w, "{}", cols.iter().map(|c| csv_escape(c)).collect::<Vec<_>>().join(","))?;
        for d in &docs {
            let row: Vec<String> = cols
                .iter()
                .map(|c| match d.get(c) {
                    Some(b) => csv_escape(&bson_to_cell(b)),
                    None => String::new(),
                })
                .collect();
            writeln!(w, "{}", row.join(","))?;
        }
    } else {
        // Pretty JSON array of relaxed extended JSON.
        let arr: Vec<Value> = docs.into_iter().map(doc_to_value).collect();
        let json = serde_json::to_string_pretty(&arr)
            .map_err(|e| AppError::Parse(format!("serialize failed: {e}")))?;
        w.write_all(json.as_bytes())?;
    }
    w.flush()?;
    Ok(count)
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
    state: State<'_, AppState>,
) -> AppResult<u64> {
    let client = current_client(&state).await?;
    let coll = client.database(&database).collection::<Document>(&collection);
    let text = std::fs::read_to_string(&path)
        .map_err(|e| AppError::Parse(format!("cannot read {path}: {e}")))?;

    // Accept either a JSON array or newline-delimited JSON (NDJSON).
    let trimmed = text.trim_start();
    let mut docs: Vec<Document> = Vec::new();
    if trimmed.starts_with('[') {
        let value = shell::parse_value(&text)?;
        for v in value.as_array().ok_or_else(|| AppError::Parse("expected a JSON array".into()))? {
            docs.push(to_doc(v)?);
        }
    } else {
        for (i, line) in text.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            let v = shell::parse_value(line)
                .map_err(|e| AppError::Parse(format!("line {}: {e}", i + 1)))?;
            docs.push(to_doc(&v)?);
        }
    }

    if docs.is_empty() {
        return Err(AppError::Parse("no documents found in file".into()));
    }
    let n = docs.len() as u64;
    coll.insert_many(docs).await?;
    Ok(n)
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

/// Proxy a chat completion to OpenAI from the backend (no CORS, key stays
/// out of the webview's network layer). Returns the assistant message text
/// plus token usage so the UI can surface how much was spent.
#[tauri::command]
pub async fn ai_chat(
    api_key: String,
    model: String,
    system: String,
    user: String,
    json_mode: bool,
    reasoning: bool,
) -> AppResult<AiChatResult> {
    if api_key.trim().is_empty() {
        return Err(AppError::Parse("OpenAI API key is not set — add it in Studio settings".into()));
    }

    let mut body = json!({
        "model": model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user },
        ],
    });
    if json_mode {
        body["response_format"] = json!({ "type": "json_object" });
    }
    // Same model in both modes — Deep Think just reasons harder. "none" keeps
    // Normal fast; "high" turns on reasoning. (gpt-5.4 supports
    // none/low/medium/high/xhigh — not "minimal".)
    body["reasoning_effort"] = json!(if reasoning { "high" } else { "none" });

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|e| AppError::Parse(format!("http client: {e}")))?;

    let resp = client
        .post("https://api.openai.com/v1/chat/completions")
        .bearer_auth(api_key.trim())
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Parse(format!("OpenAI request failed: {e}")))?;

    let status = resp.status();
    let payload: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Parse(format!("OpenAI response unreadable: {e}")))?;

    if !status.is_success() {
        let msg = payload
            .pointer("/error/message")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(AppError::Parse(format!("OpenAI ({status}): {msg}")));
    }

    let content = payload
        .pointer("/choices/0/message/content")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.trim().is_empty())
        .ok_or_else(|| AppError::Parse("OpenAI returned an empty response".into()))?;

    let usage = |key: &str| payload.pointer(&format!("/usage/{key}")).and_then(|v| v.as_u64()).unwrap_or(0);
    Ok(AiChatResult {
        content,
        input_tokens: usage("prompt_tokens"),
        output_tokens: usage("completion_tokens"),
        total_tokens: usage("total_tokens"),
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
            let options = IndexOptions::builder()
                .name(opts.and_then(|o| o.get("name")).and_then(|v| v.as_str()).map(str::to_string))
                .unique(opts.and_then(|o| o.get("unique")).and_then(|v| v.as_bool()).filter(|b| *b))
                .expire_after(
                    opts.and_then(|o| o.get("expireAfterSeconds"))
                        .and_then(|v| v.as_u64())
                        .map(Duration::from_secs),
                )
                .sparse(opts.and_then(|o| o.get("sparse")).and_then(|v| v.as_bool()).filter(|b| *b))
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
