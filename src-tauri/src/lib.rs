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
            {
                app.handle().plugin(tauri_plugin_dialog::init())?;
            }

            // macOS: add "About Ognom" and "Check for Updates…" to the
            // system Help menu; both forward to the webview via menu-action.
            #[cfg(target_os = "macos")]
            {
                use tauri::menu::{Menu, MenuItem, MenuItemKind, Submenu};
                let handle = app.handle();
                let menu = Menu::default(handle)?;
                let about =
                    MenuItem::with_id(handle, "about-ognom", "About Ognom", true, None::<&str>)?;
                let updates = MenuItem::with_id(
                    handle,
                    "check-updates",
                    "Check for Updates…",
                    true,
                    None::<&str>,
                )?;
                let help = menu.items()?.into_iter().find_map(|item| match item {
                    MenuItemKind::Submenu(s)
                        if s.text().map(|t| t == "Help").unwrap_or(false) =>
                    {
                        Some(s)
                    }
                    _ => None,
                });
                match help {
                    Some(submenu) => submenu.prepend_items(&[&about, &updates])?,
                    None => {
                        let submenu =
                            Submenu::with_items(handle, "Help", true, &[&about, &updates])?;
                        menu.append(&submenu)?;
                    }
                }
                app.set_menu(menu)?;
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
        .on_menu_event(|app, event| {
            use tauri::Emitter;
            let id = event.id().0.as_str();
            if id == "about-ognom" || id == "check-updates" {
                let _ = app.emit("menu-action", id.to_string());
            }
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
            commands::explain_query,
            commands::collection_fields,
            commands::analyze_schema,
            commands::export_collection,
            commands::import_documents,
            commands::run_shell,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
