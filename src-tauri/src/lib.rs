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

// Execute a raw MongoDB query/command
#[tauri::command]
async fn execute_query(
    database_name: String,
    collection_name: String,
    query_type: String,
    query_json: String,
    state: State<'_, MongoState>,
) -> Result<QueryResult, String> {
    let client_guard = state.client.lock().await;
    let client = client_guard
        .as_ref()
        .ok_or("Not connected to MongoDB")?;
    
    let db = client.database(&database_name);
    let collection = db.collection::<Document>(&collection_name);
    
    // Parse the query JSON
    let query_doc: serde_json::Value = match serde_json::from_str(&query_json) {
        Ok(doc) => doc,
        Err(e) => {
            return Ok(QueryResult {
                success: false,
                data: None,
                error: Some(format!("Invalid JSON: {}", e)),
            });
        }
    };
    
    // Execute based on query type
    match query_type.as_str() {
        "find" => {
            let filter: Document = serde_json::from_value(query_doc)
                .map_err(|e| format!("Invalid filter: {}", e))?;
            
            match collection.find(filter).await {
                Ok(mut cursor) => {
                    let mut results = Vec::new();
                    use futures::stream::TryStreamExt;
                    while let Some(doc) = cursor.try_next().await
                        .map_err(|e| format!("Cursor error: {}", e))? {
                        if let Ok(json_str) = serde_json::to_string_pretty(&doc) {
                            results.push(json_str);
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
                    error: Some(format!("Find failed: {}", e)),
                }),
            }
        }
        "findOne" => {
            let filter: Document = serde_json::from_value(query_doc)
                .map_err(|e| format!("Invalid filter: {}", e))?;
            
            match collection.find_one(filter).await {
                Ok(Some(doc)) => {
                    if let Ok(json_str) = serde_json::to_string_pretty(&doc) {
                        Ok(QueryResult {
                            success: true,
                            data: Some(vec![json_str]),
                            error: None,
                        })
                    } else {
                        Ok(QueryResult {
                            success: false,
                            data: None,
                            error: Some("Failed to serialize result".to_string()),
                        })
                    }
                }
                Ok(None) => Ok(QueryResult {
                    success: true,
                    data: Some(vec![]),
                    error: None,
                }),
                Err(e) => Ok(QueryResult {
                    success: false,
                    data: None,
                    error: Some(format!("FindOne failed: {}", e)),
                }),
            }
        }
        "aggregate" => {
            let pipeline: Vec<Document> = serde_json::from_value(query_doc)
                .map_err(|e| format!("Invalid pipeline: {}", e))?;
            
            match collection.aggregate(pipeline).await {
                Ok(mut cursor) => {
                    let mut results = Vec::new();
                    use futures::stream::TryStreamExt;
                    while let Some(doc) = cursor.try_next().await
                        .map_err(|e| format!("Cursor error: {}", e))? {
                        if let Ok(json_str) = serde_json::to_string_pretty(&doc) {
                            results.push(json_str);
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
                    error: Some(format!("Aggregate failed: {}", e)),
                }),
            }
        }
        "insertOne" => {
            let document: Document = serde_json::from_value(query_doc)
                .map_err(|e| format!("Invalid document: {}", e))?;
            
            match collection.insert_one(document).await {
                Ok(result) => {
                    let result_json = serde_json::json!({
                        "insertedId": result.inserted_id.to_string(),
                        "acknowledged": true
                    });
                    if let Ok(json_str) = serde_json::to_string_pretty(&result_json) {
                        Ok(QueryResult {
                            success: true,
                            data: Some(vec![json_str]),
                            error: None,
                        })
                    } else {
                        Ok(QueryResult {
                            success: false,
                            data: None,
                            error: Some("Failed to serialize result".to_string()),
                        })
                    }
                }
                Err(e) => Ok(QueryResult {
                    success: false,
                    data: None,
                    error: Some(format!("InsertOne failed: {}", e)),
                }),
            }
        }
        "insertMany" => {
            let documents: Vec<Document> = serde_json::from_value(query_doc)
                .map_err(|e| format!("Invalid documents array: {}", e))?;
            
            match collection.insert_many(documents).await {
                Ok(result) => {
                    let ids: Vec<String> = result.inserted_ids.values()
                        .map(|id| id.to_string())
                        .collect();
                    let result_json = serde_json::json!({
                        "insertedIds": ids,
                        "insertedCount": ids.len(),
                        "acknowledged": true
                    });
                    if let Ok(json_str) = serde_json::to_string_pretty(&result_json) {
                        Ok(QueryResult {
                            success: true,
                            data: Some(vec![json_str]),
                            error: None,
                        })
                    } else {
                        Ok(QueryResult {
                            success: false,
                            data: None,
                            error: Some("Failed to serialize result".to_string()),
                        })
                    }
                }
                Err(e) => Ok(QueryResult {
                    success: false,
                    data: None,
                    error: Some(format!("InsertMany failed: {}", e)),
                }),
            }
        }
        "updateOne" | "updateMany" => {
            let obj = query_doc.as_object()
                .ok_or("Query must be an object with 'filter' and 'update' fields")?;
            
            let filter: Document = serde_json::from_value(
                obj.get("filter").cloned().unwrap_or(serde_json::json!({}))
            ).map_err(|e| format!("Invalid filter: {}", e))?;
            
            let update: Document = serde_json::from_value(
                obj.get("update").cloned()
                    .ok_or("Missing 'update' field")?
            ).map_err(|e| format!("Invalid update: {}", e))?;
            
            let result = if query_type == "updateOne" {
                collection.update_one(filter, update).await
            } else {
                collection.update_many(filter, update).await
            };
            
            match result {
                Ok(update_result) => {
                    let result_json = serde_json::json!({
                        "matchedCount": update_result.matched_count,
                        "modifiedCount": update_result.modified_count,
                        "upsertedId": update_result.upserted_id.map(|id| id.to_string()),
                        "acknowledged": true
                    });
                    if let Ok(json_str) = serde_json::to_string_pretty(&result_json) {
                        Ok(QueryResult {
                            success: true,
                            data: Some(vec![json_str]),
                            error: None,
                        })
                    } else {
                        Ok(QueryResult {
                            success: false,
                            data: None,
                            error: Some("Failed to serialize result".to_string()),
                        })
                    }
                }
                Err(e) => Ok(QueryResult {
                    success: false,
                    data: None,
                    error: Some(format!("{} failed: {}", query_type, e)),
                }),
            }
        }
        "deleteOne" => {
            let filter: Document = serde_json::from_value(query_doc)
                .map_err(|e| format!("Invalid filter: {}", e))?;
            
            match collection.delete_one(filter).await {
                Ok(result) => {
                    let result_json = serde_json::json!({
                        "deletedCount": result.deleted_count,
                        "acknowledged": true
                    });
                    if let Ok(json_str) = serde_json::to_string_pretty(&result_json) {
                        Ok(QueryResult {
                            success: true,
                            data: Some(vec![json_str]),
                            error: None,
                        })
                    } else {
                        Ok(QueryResult {
                            success: false,
                            data: None,
                            error: Some("Failed to serialize result".to_string()),
                        })
                    }
                }
                Err(e) => Ok(QueryResult {
                    success: false,
                    data: None,
                    error: Some(format!("DeleteOne failed: {}", e)),
                }),
            }
        }
        "deleteMany" => {
            let filter: Document = serde_json::from_value(query_doc)
                .map_err(|e| format!("Invalid filter: {}", e))?;
            
            match collection.delete_many(filter).await {
                Ok(result) => {
                    let result_json = serde_json::json!({
                        "deletedCount": result.deleted_count,
                        "acknowledged": true
                    });
                    if let Ok(json_str) = serde_json::to_string_pretty(&result_json) {
                        Ok(QueryResult {
                            success: true,
                            data: Some(vec![json_str]),
                            error: None,
                        })
                    } else {
                        Ok(QueryResult {
                            success: false,
                            data: None,
                            error: Some("Failed to serialize result".to_string()),
                        })
                    }
                }
                Err(e) => Ok(QueryResult {
                    success: false,
                    data: None,
                    error: Some(format!("DeleteMany failed: {}", e)),
                }),
            }
        }
        "countDocuments" => {
            let filter: Document = serde_json::from_value(query_doc)
                .map_err(|e| format!("Invalid filter: {}", e))?;
            
            match collection.count_documents(filter).await {
                Ok(count) => {
                    let result_json = serde_json::json!({
                        "count": count
                    });
                    if let Ok(json_str) = serde_json::to_string_pretty(&result_json) {
                        Ok(QueryResult {
                            success: true,
                            data: Some(vec![json_str]),
                            error: None,
                        })
                    } else {
                        Ok(QueryResult {
                            success: false,
                            data: None,
                            error: Some("Failed to serialize result".to_string()),
                        })
                    }
                }
                Err(e) => Ok(QueryResult {
                    success: false,
                    data: None,
                    error: Some(format!("CountDocuments failed: {}", e)),
                }),
            }
        }
        _ => Ok(QueryResult {
            success: false,
            data: None,
            error: Some(format!("Unknown query type: {}", query_type)),
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