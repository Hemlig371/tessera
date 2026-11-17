use crate::{binary_store::BinaryStore, replacement_store::ReplacementStore};
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Mutex};
use tauri::Manager;
use tessera_sqlite::Database;

pub struct ImportFiles { replacement: ReplacementStore, db: Mutex<Option<Database>>, files: BinaryStore }
impl ImportFiles {
    pub fn new(root: PathBuf) -> Self {
        let replacement = ReplacementStore::new(root.clone(), root.join("databases/app.sqlite"));
        let files = BinaryStore::new(replacement.stage());
        Self { replacement, db: Mutex::new(None), files }
    }
    pub fn recover(&self) -> Result<(), String> {
        self.db.lock().map_err(|_| "fileError")?.take();
        self.replacement.recover()?; self.replacement.discard()
    }
    fn invoke(&self, op: &str, args: &Value, active_closed: bool) -> Result<Value, String> {
        let mut guard = self.db.lock().map_err(|_| "fileError")?;
        let string = |key: &str| args[key].as_str().ok_or_else(|| "fileError".to_string());
        let number = |key: &str| args[key].as_u64().ok_or_else(|| "fileError".to_string());
        match op {
            "prepare" => {
                if guard.is_some() { return Err("fileBusy".into()); }
                self.replacement.prepare(number("required")?)?;
                *guard = Some(Database::open(&self.replacement.stage().join("database.sqlite"))?);
            },
            "abort" => { guard.take(); self.replacement.discard()?; },
            "close" => { guard.take(); },
            "activate" => {
                if guard.is_some() || !active_closed { return Err("fileBusy".into()); }
                if let Err(error) = self.replacement.activate(|_| {}) { self.replacement.recover()?; return Err(error); }
            },
            "query" | "execute" | "begin" | "commit" | "rollback" => {
                let db = guard.as_ref().ok_or("databaseUnavailable")?;
                let params = args["params"].as_array().cloned().unwrap_or_default();
                match op {
                    "query" => return db.query(string("sql")?, &params).map(Value::Array),
                    "execute" => db.execute(string("sql")?, &params)?,
                    "begin" => db.begin()?, "commit" => db.commit()?, _ => db.rollback()?,
                }
            },
            "file_begin" => { self.files.begin(string("id")?)?; },
            "file_write" => {
                let values = args["bytes"].as_array().ok_or("invalidFileChunk")?;
                if values.len() > crate::binary_store::CHUNK_SIZE { return Err("invalidFileChunk".into()); }
                let bytes: Result<Vec<u8>, _> = values.iter().map(|v| v.as_u64().and_then(|n| u8::try_from(n).ok()).ok_or("invalidFileChunk")).collect();
                self.files.write(string("id")?, number("offset")?, &bytes?)?;
            },
            "file_finish" => { let (size, sha256) = self.files.finish(string("id")?, number("size")?, Some(string("sha256")?))?; return Ok(json!({"size":size,"sha256":sha256})); },
            _ => return Err("fileError".into()),
        }
        Ok(Value::Null)
    }
}
#[tauri::command]
pub async fn import_stage(app: tauri::AppHandle, op: String, args: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let active_closed = app.state::<crate::Storage>().db.lock().map_err(|_| "databaseUnavailable")?.is_none();
        app.state::<ImportFiles>().invoke(&op, &args, active_closed)
    }).await.map_err(|_| "fileError")?
}
