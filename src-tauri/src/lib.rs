use mongodb::{Client, options::ClientOptions, bson::Document};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use tauri::{Manager, State};
use std::sync::Arc;
use regex::Regex;
use chrono::Utc;

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

// Convert MongoDB shell syntax to extended JSON
fn convert_shell_to_json(input: &str) -> String {
    let mut result = input.to_string();
    
    // Convert ObjectId("...") to {"$oid": "..."} - with double quotes
    let oid_regex_double = Regex::new(r#"ObjectId\s*\(\s*"([a-fA-F0-9]{24})"\s*\)"#).unwrap();
    result = oid_regex_double.replace_all(&result, r#"{"$$oid":"$1"}"#).to_string();
    
    // Convert ObjectId('...') to {"$oid": "..."} - with single quotes
    let oid_regex_single = Regex::new(r#"ObjectId\s*\(\s*'([a-fA-F0-9]{24})'\s*\)"#).unwrap();
    result = oid_regex_single.replace_all(&result, r#"{"$$oid":"$1"}"#).to_string();
    
    // Convert ObjectId(...) to {"$oid": "..."} - without quotes (less common but supported)
    let oid_regex_none = Regex::new(r#"ObjectId\s*\(\s*([a-fA-F0-9]{24})\s*\)"#).unwrap();
    result = oid_regex_none.replace_all(&result, r#"{"$$oid":"$1"}"#).to_string();
    
    // Convert ISODate("...") to {"$date": "..."}
    let date_regex = Regex::new(r#"ISODate\s*\(\s*["']([^"']+)["']\s*\)"#).unwrap();
    result = date_regex.replace_all(&result, r#"{"$$date":"$1"}"#).to_string();
    
    // Convert ISODate() (no args) to current date
    let date_now_regex = Regex::new(r#"ISODate\s*\(\s*\)"#).unwrap();
    let now = Utc::now().to_rfc3339();
    result = date_now_regex.replace_all(&result, &format!(r#"{{"$$date":"{}"}}"#, now)).to_string();
    
    result
}

// Convert extended JSON to MongoDB shell format for display
fn convert_json_to_shell(json_str: &str) -> String {
    let mut result = json_str.to_string();
    
    // Convert {"$oid": "..."} to ObjectId("...")
    let oid_regex = Regex::new(r#"\{\s*"\$oid"\s*:\s*"([a-fA-F0-9]{24})"\s*\}"#).unwrap();
    result = oid_regex.replace_all(&result, r#"ObjectId("$1")"#).to_string();
    
    // Convert date with $numberLong to ISODate
    let date_long_regex = Regex::new(
        r#"\{\s*"\$date"\s*:\s*\{\s*"\$numberLong"\s*:\s*"(\d+)"\s*\}\s*\}"#
    ).unwrap();
    
    for cap in date_long_regex.captures_iter(&json_str) {
        if let Some(millis_str) = cap.get(1) {
            if let Ok(millis) = millis_str.as_str().parse::<i64>() {
                // Convert milliseconds to chrono DateTime
                use chrono::{DateTime as ChronoDateTime, TimeZone};
                if let Some(dt) = chrono::Utc.timestamp_millis_opt(millis).single() {
                    let iso_str = dt.to_rfc3339();
                    let old_str = cap.get(0).unwrap().as_str();
                    result = result.replace(old_str, &format!(r#"ISODate("{}")"#, iso_str));
                }
            }
        }
    }
    
    // Convert simple {"$date": "..."} to ISODate("...")
    let date_simple_regex = Regex::new(r#"\{\s*"\$date"\s*:\s*"([^"]+)"\s*\}"#).unwrap();
    result = date_simple_regex.replace_all(&result, r#"ISODate("$1")"#).to_string();
    
    result
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
    
    // Convert MongoDB shell syntax to extended JSON
    let converted_query = convert_shell_to_json(&query_json);
    
    // Log the conversion for debugging
    println!("Original query: {}", query_json);
    println!("Converted query: {}", converted_query);
    
    // Parse the query JSON
    let query_doc: serde_json::Value = match serde_json::from_str(&converted_query) {
        Ok(doc) => doc,
        Err(e) => {
            return Ok(QueryResult {
                success: false,
                data: None,
                error: Some(format!("Invalid JSON after conversion: {}. Converted query was: {}", e, converted_query)),
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
                            // Convert to MongoDB shell format
                            results.push(convert_json_to_shell(&json_str));
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
                            data: Some(vec![convert_json_to_shell(&json_str)]),
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
                            // Convert to MongoDB shell format
                            results.push(convert_json_to_shell(&json_str));
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