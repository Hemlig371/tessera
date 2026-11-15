#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod csv_files;
mod local_files;
use csv_files::CsvFiles;
use serde_json::Value;
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, State};
use tessera_sqlite::Database;

struct Storage { db: Mutex<Option<Database>>, backups: PathBuf }
fn with_db<T>(state: State<'_, Storage>, work: impl FnOnce(&Database) -> Result<T, String>) -> Result<T, String> {
    let guard = state.db.lock().map_err(|_| "databaseUnavailable".to_string())?;
    work(guard.as_ref().ok_or("databaseUnavailable")?)
}
#[tauri::command]
async fn db_query(app: tauri::AppHandle, sql: String, params: Vec<Value>) -> Result<Vec<Value>, String> {
    tauri::async_runtime::spawn_blocking(move || with_db(app.state(), |db| db.query(&sql, &params))).await.map_err(|_| "databaseUnavailable")?
}
#[tauri::command]
async fn db_execute(app: tauri::AppHandle, sql: String, params: Vec<Value>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || with_db(app.state(), |db| db.execute(&sql, &params))).await.map_err(|_| "databaseUnavailable")?
}
#[tauri::command]
fn db_begin(state: State<'_, Storage>) -> Result<(), String> { with_db(state, |db| db.begin()) }
#[tauri::command]
fn db_commit(state: State<'_, Storage>) -> Result<(), String> { with_db(state, |db| db.commit()) }
#[tauri::command]
fn db_rollback(state: State<'_, Storage>) -> Result<(), String> { with_db(state, |db| db.rollback()) }
#[tauri::command]
fn db_backup(state: State<'_, Storage>) -> Result<(), String> {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "clock")?.as_nanos();
    let file = state.backups.join(format!("migration-{now}.sqlite"));
    with_db(state, |db| db.backup(&file))
}
#[tauri::command]
fn db_close(state: State<'_, Storage>) -> Result<(), String> {
    state.db.lock().map_err(|_| "databaseUnavailable")?.take(); Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(CsvFiles::default())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
        }))
        .setup(|app| {
            let root = app.path().app_data_dir()?;
            for sub in ["databases", "attachments", "cache/thumbnails", "operational/outbox", "operational/inbox", "operational/drafts", "operational/logs", "operational/backups"] {
                std::fs::create_dir_all(root.join(sub))?;
            }
            let db = Database::open(&root.join("databases/app.sqlite"))?;
            app.manage(local_files::LocalFiles(root.join("operational")));
            app.manage(Storage { db: Mutex::new(Some(db)), backups: root.join("operational/backups") });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![db_query, db_execute, db_begin, db_commit, db_rollback, db_backup, db_close, csv_files::csv_open, csv_files::csv_write, csv_files::csv_finish, csv_files::csv_abort, local_files::local_read, local_files::local_write, local_files::local_remove])
        .run(tauri::generate_context!()).expect("Tessera startup failed");
}
