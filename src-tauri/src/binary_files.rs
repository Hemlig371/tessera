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


/** One user-selected folder; no arbitrary relative paths and no silent overwrites. */
#[tauri::command]
pub async fn binary_export_batch(app: tauri::AppHandle, folder: String, files: Vec<Value>) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        use std::{fs, path::PathBuf};
        if files.is_empty() || files.len() > 100 { return Err("invalidAttachment".into()); }
        let root = PathBuf::from(folder).canonicalize().map_err(|_| "fileError")?;
        if !root.is_dir() { return Err("fileError".into()); }
        let safe = |name: &str| -> bool {
            !name.is_empty() && name.len() <= 240 && name != "." && name != ".." &&
                !name.chars().any(|c| c.is_control() || matches!(c, '/' | '\\' | '<' | '>' | ':' | '"' | '|' | '?' | '*'))
        };
        let mut created = Vec::<PathBuf>::new();
        let result = (|| -> Result<usize, String> {
            for item in &files {
                let id = item.get("id").and_then(Value::as_str).ok_or("invalidAttachment")?;
                let name = item.get("name").and_then(Value::as_str).ok_or("invalidAttachment")?;
                let hash = item.get("sha256").and_then(Value::as_str).ok_or("invalidAttachment")?;
                let size = item.get("size").and_then(Value::as_u64).ok_or("invalidAttachment")?;
                let folders = item.get("folders").and_then(Value::as_array).ok_or("invalidAttachment")?;
                if !safe(name) || folders.is_empty() || folders.len() > 4 ||
                    hash.len() != 64 || !hash.bytes().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase()) {
                    return Err("invalidAttachment".into());
                }
                let mut parent = root.clone();
                for folder in folders {
                    let segment = folder.as_str().ok_or("invalidAttachment")?;
                    if !safe(segment) { return Err("invalidAttachment".into()); }
                    parent.push(segment);
                    if !parent.exists() { fs::create_dir(&parent).map_err(|_| "fileError")?; }
                    if !parent.is_dir() || fs::symlink_metadata(&parent).map_err(|_| "fileError")?.file_type().is_symlink() {
                        return Err("fileError".into());
                    }
                }
                let path = parent.join(name);
                if path.exists() { return Err("fileExists".into()); }
                app.state::<BinaryStore>().export(id, path.clone(), size, hash)?;
                created.push(path);
            }
            Ok(created.len())
        })();
        if result.is_err() {
            for path in created.into_iter().rev() { let _ = fs::remove_file(path); }
        }
        result
    }).await.map_err(|_| "fileError".to_owned())?
}
