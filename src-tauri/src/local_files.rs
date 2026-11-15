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
    fn temporary_root() -> PathBuf {
        std::env::temp_dir().join(format!("tessera-files-{}-{}",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()))
    }
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
    #[test] fn failed_rename_preserves_destination_and_removes_temporary_bytes() {
        let root = temporary_root();
        let files = LocalFiles(root.clone());
        let destination = root.join("draft.json");
        fs::create_dir_all(&destination).unwrap();
        fs::write(destination.join("keep"), b"original").unwrap();
        assert!(files.write("draft.json", b"replacement").is_err());
        assert_eq!(fs::read(destination.join("keep")).unwrap(), b"original");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[cfg(windows)]
    #[test] fn locked_windows_destination_preserves_old_draft_on_replace_failure() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = temporary_root(); let files = LocalFiles(root.clone());
        files.write("draft.json", b"old draft").unwrap();
        let lock = fs::OpenOptions::new().read(true).share_mode(0).open(root.join("draft.json")).unwrap();
        assert!(files.write("draft.json", b"new draft").is_err());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        drop(lock);
        assert_eq!(files.read("draft.json").unwrap().unwrap(), b"old draft");
        files.write("draft.json", b"retry").unwrap();
        assert_eq!(files.read("draft.json").unwrap().unwrap(), b"retry");
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn process_kill_preserves_complete_file() {
        const CHILD_ROOT: &str = "TESSERA_FILE_CRASH_ROOT";
        if let Some(root) = std::env::var_os(CHILD_ROOT) {
            let files = LocalFiles(PathBuf::from(root));
            loop { files.write("draft.json", &vec![b'N'; 512 * 1024]).unwrap(); }
        }
        let root = temporary_root(); let files = LocalFiles(root.clone());
        let old = vec![b'O'; 512 * 1024]; files.write("draft.json", &old).unwrap();
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "local_files::tests::process_kill_preserves_complete_file"])
            .env(CHILD_ROOT, &root).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let mut saw_write = false;
        while std::time::Instant::now() < deadline {
            if fs::read_dir(&root).unwrap().any(|entry| entry.unwrap().file_name().to_string_lossy().starts_with(".write-")) { saw_write = true; break; }
            if child.try_wait().unwrap().is_some() { break; }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        let _ = child.kill(); child.wait().unwrap();
        assert!(saw_write, "child never started an atomic file write");
        let recovered = files.read("draft.json").unwrap().unwrap();
        assert!(recovered == old || recovered == vec![b'N'; 512 * 1024]);
        files.write("draft.json", b"after restart").unwrap();
        assert_eq!(files.read("draft.json").unwrap().unwrap(), b"after restart");
        fs::remove_dir_all(root).unwrap();
    }
}
