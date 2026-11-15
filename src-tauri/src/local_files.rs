use std::{fs, io::{ErrorKind, Write}, path::PathBuf};
use tauri::{Manager, State};

pub struct LocalFiles(pub PathBuf);
impl LocalFiles {
    fn path(&self, relative: &str) -> Result<PathBuf, String> {
        if relative.is_empty() || relative.split('/').any(|part| part.is_empty() || part == "." || part == ".." ||
            !part.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_.".contains(&c))) { return Err("fileError".into()); }
        let mut path = self.0.clone();
        for part in relative.split('/') {
            path.push(part);
            if fs::symlink_metadata(&path).map(|m| m.file_type().is_symlink()).unwrap_or(false) { return Err("fileError".into()); }
        }
        Ok(path)
    }
    fn read(&self, relative: &str) -> Result<Option<Vec<u8>>, String> {
        match fs::read(self.path(relative)?) { Ok(bytes) => Ok(Some(bytes)), Err(e) if e.kind() == ErrorKind::NotFound => Ok(None), Err(_) => Err("fileError".into()) }
    }
    fn write(&self, relative: &str, bytes: &[u8]) -> Result<(), String> {
        let path = self.path(relative)?;
        let parent = path.parent().ok_or("fileError")?;
        fs::create_dir_all(parent).map_err(|_| "fileError")?;
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "fileError")?.as_nanos();
        let temp = parent.join(format!(".write-{}-{nonce}",std::process::id()));
        let result = (|| -> std::io::Result<()> {
            let mut file = fs::OpenOptions::new().create_new(true).write(true).open(&temp)?;
            file.write_all(bytes)?; file.sync_all()?; drop(file);
            fs::rename(&temp, &path)?;
            #[cfg(unix)] fs::File::open(parent)?.sync_all()?;
            Ok(())
        })();
        if result.is_err() { let _ = fs::remove_file(temp); }
        result.map_err(|_| "fileError".into())
    }
    fn remove(&self, relative: &str) -> Result<(), String> {
        let path = self.path(relative)?;
        match fs::remove_file(&path) { Ok(()) => Ok(()), Err(e) if e.kind() == ErrorKind::NotFound => Ok(()), Err(_) => Err("fileError".into()) }
    }
}
#[tauri::command]
pub async fn local_read(app: tauri::AppHandle, path: String) -> Result<Option<Vec<u8>>, String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<LocalFiles>().read(&path)).await.map_err(|_| "fileError")?
}
#[tauri::command]
pub async fn local_write(app: tauri::AppHandle, path: String, bytes: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || app.state::<LocalFiles>().write(&path,&bytes)).await.map_err(|_| "fileError")?
}
#[tauri::command]
pub fn local_remove(files: State<'_, LocalFiles>, path: String) -> Result<(), String> { files.remove(&path) }

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn replaces_durable_bytes_and_refuses_escape() {
        let root = std::env::temp_dir().join(format!("tessera-files-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let files = LocalFiles(root.clone());
        assert_eq!(files.read("drafts/a/b.json").unwrap(),None);
        files.write("drafts/a/b.json",b"first").unwrap(); files.write("drafts/a/b.json",b"next").unwrap();
        assert_eq!(files.read("drafts/a/b.json").unwrap().unwrap(),b"next");
        for path in ["../databases/app.sqlite","/absolute","drafts/../outside","a\\outside","a//b"] { assert!(files.write(path,b"bad").is_err()); }
        files.remove("drafts/a/b.json").unwrap(); files.remove("drafts/a/b.json").unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}
