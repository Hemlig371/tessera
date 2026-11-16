use crate::binary_store::BinaryStore;
use serde_json::{json, Value};
use tauri::Manager;
fn facts(value: Option<(u64, String)>) -> Value { value.map(|(size, sha256)| json!({"size":size,"sha256":sha256})).unwrap_or(Value::Null) }
#[tauri::command]
pub async fn binary_begin(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<BinaryStore>().begin(&id)).await.map_err(|_| "fileError")?
}
#[tauri::command]
pub async fn binary_write(app: tauri::AppHandle, id: String, offset: u64, bytes: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<BinaryStore>().write(&id, offset, &bytes)).await.map_err(|_| "fileError")?
}
#[tauri::command]
pub async fn binary_finish(app: tauri::AppHandle, id: String, size: u64, sha256: Option<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<BinaryStore>().finish(&id, size, sha256.as_deref()).map(|result| facts(Some(result)))).await.map_err(|_| "fileError")?
}
#[tauri::command]
pub async fn binary_inspect(app: tauri::AppHandle, id: String) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<BinaryStore>().inspect(&id).map(facts)).await.map_err(|_| "fileError")?
}
#[tauri::command]
pub async fn binary_read(app: tauri::AppHandle, id: String, offset: u64, length: usize) -> Result<Vec<u8>, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<BinaryStore>().read(&id, offset, length)).await.map_err(|_| "fileError")?
}
#[tauri::command]
pub async fn binary_remove(app: tauri::AppHandle, id: String, staged: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<BinaryStore>().remove(&id, staged)).await.map_err(|_| "fileError")?
}
#[tauri::command]
pub async fn binary_export(app: tauri::AppHandle, id: String, path: String, size: u64, sha256: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<BinaryStore>().export(&id, path.into(), size, &sha256)).await.map_err(|_| "fileError")?
}

#[tauri::command]
pub async fn binary_stat(app: tauri::AppHandle, id: String) -> Result<Option<u64>, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<BinaryStore>().stat(&id)).await.map_err(|_| "fileError")?
}
