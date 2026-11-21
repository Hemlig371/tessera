#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod binary_store;
mod replacement_store;
mod import_files;
mod binary_files;
mod csv_files;
mod local_files;
mod external_actions;
mod sync_secrets;
mod sync_mail;
use csv_files::CsvFiles;
use serde_json::Value;
use std::{path::PathBuf, sync::Mutex};
use tauri::{Manager, State};
use tessera_sqlite::Database;

struct Storage { db: Mutex<Option<Database>>, backups: PathBuf, error: Option<String> }
fn with_db<T>(state: State<'_, Storage>, work: impl FnOnce(&Database) -> Result<T, String>) -> Result<T, String> {
    let guard = state.db.lock().map_err(|_| "databaseUnavailable".to_string())?;
    work(guard.as_ref().ok_or_else(|| state.error.clone().unwrap_or("databaseUnavailable".into()))?)
}
#[tauri::command]
async fn db_open(app: tauri::AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<Storage>();
        let mut guard = state.db.lock().map_err(|_| "databaseUnavailable")?;
        // Renderer reloads keep Tauri alive: abandon its old stage and reopen after import.
        guard.take();
        app.state::<import_files::ImportFiles>().recover()?;
        let root = app.path().app_data_dir().map_err(|_| "databaseUnavailable")?;
        *guard = Some(Database::open(&root.join("databases/app.sqlite"))?);
        Ok(())
    }).await.map_err(|_| "databaseUnavailable")?
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
            let replacement = replacement_store::ReplacementStore::new(root.clone(), root.join("databases/app.sqlite"));
            let recovery = replacement.recover().and_then(|_| replacement.discard());
            app.manage(import_files::ImportFiles::new(root.clone()));
            let opened = recovery.and_then(|_| Database::open(&root.join("databases/app.sqlite")));
            let (db, error) = match opened { Ok(db) => (Some(db), None), Err(error) => (None, Some(error)) };
            app.manage(local_files::LocalFiles(root.join("operational")));
            app.manage(binary_store::BinaryStore::new(root.clone()));
            app.manage(Storage { db: Mutex::new(db), backups: root.join("operational/backups"), error });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![db_open, db_query, db_execute, db_begin, db_commit, db_rollback, db_backup, db_close, import_files::import_stage, csv_files::csv_open, csv_files::csv_write, csv_files::csv_write_bytes, csv_files::csv_finish, csv_files::csv_abort, local_files::local_read, local_files::local_write, local_files::local_remove, external_actions::external_open_url, external_actions::external_open_calendar_file, external_actions::external_open_folder, binary_files::binary_begin, binary_files::binary_write, binary_files::binary_finish, binary_files::binary_inspect, binary_files::binary_stat, binary_files::binary_read, binary_files::binary_remove, binary_files::binary_export, binary_files::binary_export_batch, sync_secrets::sync_secret_store, sync_secrets::sync_secret_load, sync_secrets::sync_secret_remove, sync_mail::sync_mail_send, sync_mail::sync_mail_fetch])
        .run(tauri::generate_context!()).expect("Tessera startup failed");
}
