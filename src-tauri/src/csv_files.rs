use std::{fs::{File, OpenOptions}, io::Write, path::PathBuf, sync::Mutex};
use tauri::State;
struct Destination { file: Option<File>, temporary: PathBuf, final_path: PathBuf }
impl Destination {
    fn open(final_path: PathBuf) -> Result<Self, String> {
        let directory = final_path.parent().ok_or("fileError")?;
        let time = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "fileError")?.as_nanos();
        let temporary = directory.join(format!(".tessera-{}-{time}.tmp", std::process::id()));
        let file = OpenOptions::new().create_new(true).write(true).open(&temporary).map_err(|_| "fileError")?;
        Ok(Self { file: Some(file), temporary, final_path })
    }
    fn write(&mut self, text: &str) -> Result<(), String> {
        if text.len() > 128000 { return Err("fileError".into()); }
        self.file.as_mut().ok_or("fileError")?.write_all(text.as_bytes()).map_err(|_| "fileError".into())
    }
    fn write_bytes(&mut self, bytes: &[u8]) -> Result<(), String> {
        if bytes.len() > 256 * 1024 { return Err("fileError".into()); }
        self.file.as_mut().ok_or("fileError")?.write_all(bytes).map_err(|_| "fileError".into())
    }
    fn finish(mut self) -> Result<(), String> {
        self.file.as_mut().ok_or("fileError")?.sync_all().map_err(|_| "fileError")?;
        self.file.take();
        std::fs::rename(&self.temporary, &self.final_path).map_err(|_| "fileError".into())
    }
}
impl Drop for Destination { fn drop(&mut self) { self.file.take(); let _ = std::fs::remove_file(&self.temporary); } }
#[derive(Default)]
pub struct CsvFiles(Mutex<Option<Destination>>);
#[tauri::command]
pub fn csv_open(state: State<'_, CsvFiles>, path: String) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|_| "fileError")?;
    if guard.is_some() { return Err("fileBusy".into()); }
    *guard = Some(Destination::open(PathBuf::from(path))?); Ok(())
}
#[tauri::command]
pub fn csv_write(state: State<'_, CsvFiles>, text: String) -> Result<(), String> {
    state.0.lock().map_err(|_| "fileError")?.as_mut().ok_or("fileError")?.write(&text)
}
#[tauri::command]
pub fn csv_write_bytes(state: State<'_, CsvFiles>, bytes: Vec<u8>) -> Result<(), String> {
    state.0.lock().map_err(|_| "fileError")?.as_mut().ok_or("fileError")?.write_bytes(&bytes)
}
#[tauri::command]
pub fn csv_finish(state: State<'_, CsvFiles>) -> Result<(), String> {
    state.0.lock().map_err(|_| "fileError")?.take().ok_or("fileError")?.finish()
}
#[tauri::command]
pub fn csv_abort(state: State<'_, CsvFiles>) -> Result<(), String> {
    state.0.lock().map_err(|_| "fileError")?.take(); Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn atomic_export_and_abort_preserve_destination_and_unicode() {
        let root = std::env::temp_dir().join(format!("tessera-csv-{}-{}", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&root).unwrap(); let path = root.join("экспорт.csv");
        std::fs::write(&path, "original").unwrap();
        { let mut writer = Destination::open(path.clone()).unwrap(); writer.write("partial").unwrap(); }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        let mut writer = Destination::open(path.clone()).unwrap(); writer.write("\u{feff}Название;Число\r\nЁж 🦔;0\r\n").unwrap(); writer.finish().unwrap();
        assert!(std::fs::read_to_string(&path).unwrap().contains("Ёж 🦔;0"));
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
        std::fs::remove_dir_all(root).unwrap();
    }
}
