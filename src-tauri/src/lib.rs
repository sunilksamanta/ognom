use mongodb::{Client, options::ClientOptions, bson::Document};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tauri::{Manager, State};
use std::sync::Arc;

// State to hold our MongoDB client
struct MongoState {
    client: Arc<Mutex<Option<Client>>>,
}

#[derive(Serialize, Deserialize)]
struct ConnectionResult {
    success: bool,
    message: String,
}

#[derive(Serialize, Deserialize)]
struct QueryResult {
    success: bool,
    data: Option<Vec<String>>,
    error: Option<String>,
}

// Connect to MongoDB
#[tauri::command]
async fn connect_to_mongodb(
    connection_string: String,
    state: State<'_, MongoState>,
) -> Result<ConnectionResult, String> {
    let client_options = ClientOptions::parse(&connection_string)
        .await
        .map_err(|e| format!("Failed to parse connection string: {}", e))?;
    
    let client = Client::with_options(client_options)
        .map_err(|e| format!("Failed to create client: {}", e))?;
    
    client
        .database("admin")
        .run_command(mongodb::bson::doc! {"ping": 1})
        .await
        .map_err(|e| format!("Failed to connect: {}", e))?;
    
    let mut client_guard = state.client.lock().await;
    *client_guard = Some(client);
    
    Ok(ConnectionResult {
        success: true,
        message: "Connected successfully!".to_string(),
    })
}

// List all databases
#[tauri::command]
async fn list_databases(state: State<'_, MongoState>) -> Result<Vec<String>, String> {
    let client_guard = state.client.lock().await;
    let client = client_guard
        .as_ref()
        .ok_or("Not connected to MongoDB")?;
    
    let db_names = client
        .list_database_names()
        .await
        .map_err(|e| format!("Failed to list databases: {}", e))?;
    
    Ok(db_names)
}

// List collections in a database
#[tauri::command]
async fn list_collections(
    database_name: String,
    state: State<'_, MongoState>,
) -> Result<Vec<String>, String> {
    let client_guard = state.client.lock().await;
    let client = client_guard
        .as_ref()
        .ok_or("Not connected to MongoDB")?;
    
    let db = client.database(&database_name);
    let collection_names = db
        .list_collection_names()
        .await
        .map_err(|e| format!("Failed to list collections: {}", e))?;
    
    Ok(collection_names)
}

// Execute a find query
#[tauri::command]
async fn execute_query(
    database_name: String,
    collection_name: String,
    query_json: String,
    state: State<'_, MongoState>,
) -> Result<QueryResult, String> {
    let client_guard = state.client.lock().await;
    let client = client_guard
        .as_ref()
        .ok_or("Not connected to MongoDB")?;
    
    // Parse the query JSON
    let filter: Document = match serde_json::from_str(&query_json) {
        Ok(doc) => doc,
        Err(e) => {
            return Ok(QueryResult {
                success: false,
                data: None,
                error: Some(format!("Invalid JSON query: {}", e)),
            });
        }
    };
    
    let db = client.database(&database_name);
    let collection = db.collection::<Document>(&collection_name);
    
    // Execute the query
    match collection.find(filter).await {
        Ok(mut cursor) => {
            let mut results = Vec::new();
            
            use futures::stream::TryStreamExt;
            while let Some(doc) = cursor.try_next().await.map_err(|e| format!("Cursor error: {}", e))? {
                match serde_json::to_string_pretty(&doc) {
                    Ok(json_str) => results.push(json_str),
                    Err(e) => {
                        return Ok(QueryResult {
                            success: false,
                            data: None,
                            error: Some(format!("Failed to serialize document: {}", e)),
                        });
                    }
                }
            }
            
            Ok(QueryResult {
                success: true,
                data: Some(results),
                error: None,
            })
        }
        Err(e) => Ok(QueryResult {
            success: false,
            data: None,
            error: Some(format!("Query execution failed: {}", e)),
        }),
    }
}

// Disconnect from MongoDB
#[tauri::command]
async fn disconnect_mongodb(state: State<'_, MongoState>) -> Result<String, String> {
    let mut client_guard = state.client.lock().await;
    *client_guard = None;
    Ok("Disconnected successfully".to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            app.manage(MongoState {
                client: Arc::new(Mutex::new(None)),
            });
            Ok(())
        })
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            connect_to_mongodb,
            list_databases,
            list_collections,
            execute_query,
            disconnect_mongodb
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}