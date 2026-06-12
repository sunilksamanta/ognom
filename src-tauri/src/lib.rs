mod commands;
mod crypto;
mod error;
mod profiles;
mod shell;

use commands::AppState;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            let data_dir = app.path().app_data_dir()?;
            let (crypto, degraded) = crypto::Crypto::init(&data_dir)
                .map_err(|e| format!("could not initialize secret storage: {e}"))?;
            let store = profiles::ProfileStore::load(&data_dir)
                .map_err(|e| format!("could not load connections: {e}"))?;
            app.manage(AppState {
                conn: tokio::sync::Mutex::new(None),
                store: std::sync::Mutex::new(store),
                crypto: std::sync::Mutex::new(crypto),
                data_dir,
                degraded: std::sync::atomic::AtomicBool::new(degraded),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::security_info,
            commands::set_secret_backend,
            commands::list_connections,
            commands::save_connection,
            commands::delete_connection,
            commands::test_connection,
            commands::connect,
            commands::connect_input,
            commands::disconnect,
            commands::list_databases,
            commands::list_collections,
            commands::find_documents,
            commands::count_documents,
            commands::aggregate_collection,
            commands::insert_document,
            commands::replace_document,
            commands::delete_document,
            commands::list_indexes,
            commands::create_index,
            commands::drop_index,
            commands::collection_stats,
            commands::run_shell,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
