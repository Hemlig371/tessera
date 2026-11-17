//! Recoverable filesystem activation only. Archive/schema/data rules remain in TypeScript.
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs::{self, File}, io::Write, path::{Path, PathBuf}};
type Result<T> = std::result::Result<T, String>;

pub struct ReplacementStore { root: PathBuf, database: PathBuf }
impl ReplacementStore {
    pub fn new(root: PathBuf, database: PathBuf) -> Self { Self { root, database } }
    pub fn stage(&self) -> PathBuf { self.root.join("operational/db-import/new") }
    fn journal(&self) -> PathBuf { self.root.join("operational/db-import-state.json") }
    fn plans(&self) -> Vec<(PathBuf, PathBuf, PathBuf)> {
        let work = self.root.join("operational/db-import");
        let mut paths = vec![(self.database.clone(), "database.sqlite".to_string()),
            ({ let mut p = self.database.as_os_str().to_os_string(); p.push("-wal"); PathBuf::from(p) }, "database.sqlite-wal".into()),
            ({ let mut p = self.database.as_os_str().to_os_string(); p.push("-shm"); PathBuf::from(p) }, "database.sqlite-shm".into())];
        for (active, name) in [("attachments", "attachments"), ("operational/drafts", "drafts"),
            ("operational/inbox", "inbox"), ("operational/outbox", "outbox"), ("cache/thumbnails", "thumbnails"), ("operational/file-staging", "file-staging")] {
            paths.push((self.root.join(active), name.into()));
        }
        paths.into_iter().map(|(active, name)| (active, work.join("new").join(&name), work.join("old").join(name))).collect()
    }
    pub fn prepare(&self, required: u64) -> Result<()> {
        self.recover()?;
        fs::create_dir_all(self.root.join("operational")).map_err(|_| "fileError")?;
        remove(&self.root.join("operational/db-import"))?;
        if free_space(&self.root)? < required { return Err("notEnoughSpace".into()); }
        for name in ["attachments", "drafts", "inbox", "outbox", "thumbnails", "file-staging", "operational/file-staging"] {
            fs::create_dir_all(self.stage().join(name)).map_err(|_| "fileError")?;
        }
        Ok(())
    }
    pub fn discard(&self) -> Result<()> {
        if self.journal().exists() { return Err("fileBusy".into()); }
        remove(&self.root.join("operational/db-import"))
    }
    fn write_journal(&self, value: &Value) -> Result<()> {
        let temporary = self.journal().with_extension("new");
        let mut file = File::create(&temporary).map_err(|_| "fileError")?;
        let payload = value.to_string();
        let envelope = json!({"payload":payload,"sha256":format!("{:x}", Sha256::digest(payload.as_bytes()))});
        file.write_all(envelope.to_string().as_bytes()).and_then(|_| file.sync_all()).map_err(|_| "fileError")?;
        drop(file); fs::rename(temporary, self.journal()).map_err(|_| "fileError")?;
        sync_dir(self.journal().parent().ok_or("fileError")?)
    }
    pub fn activate(&self, hook: impl Fn(&str)) -> Result<()> {
        if self.journal().exists() || !self.stage().join("database.sqlite").is_file() { return Err("fileBusy".into()); }
        // SQLite connections must have been closed first. Preserve old sidecars too, so even
        // an interrupted prior checkpoint cannot be confused with the new database.
        let plans = self.plans(); let existed: Vec<bool> = plans.iter().map(|(p, _, _)| p.exists()).collect();
        fs::create_dir_all(self.root.join("operational/db-import/old")).map_err(|_| "fileError")?;
        for (_, staged, _) in &plans { if staged.is_file() { sync_file(staged)?; } }
        sync_dir(&self.stage())?;
        self.write_journal(&json!({"committed":false,"existed":existed}))?; hook("prepared");
        for (index, (active, staged, old)) in plans.iter().enumerate() {
            if active.exists() { fs::rename(active, old).map_err(|_| "fileError")?; }
            sync_dir(active.parent().ok_or("fileError")?)?; sync_dir(old.parent().ok_or("fileError")?)?;
            hook(&format!("old-{index}"));
            if staged.exists() {
                fs::create_dir_all(active.parent().ok_or("fileError")?).map_err(|_| "fileError")?;
                fs::rename(staged, active).map_err(|_| "fileError")?;
            }
            sync_dir(active.parent().ok_or("fileError")?)?; sync_dir(&self.stage())?;
            hook(&format!("new-{index}"));
        }
        self.write_journal(&json!({"committed":true,"existed":existed}))?; hook("committed");
        self.recover()
    }
    pub fn recover(&self) -> Result<()> {
        let bytes = match fs::read(self.journal()) { Ok(v) => v, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()), Err(_) => return Err("fileError".into()) };
        if bytes.len() > 8192 { return Err("importRecoveryFailed".into()); }
        let envelope: Value = serde_json::from_slice(&bytes).map_err(|_| "importRecoveryFailed")?;
        let payload = envelope["payload"].as_str().ok_or("importRecoveryFailed")?;
        if envelope["sha256"].as_str() != Some(format!("{:x}", Sha256::digest(payload.as_bytes())).as_str()) { return Err("importRecoveryFailed".into()); }
        let value: Value = serde_json::from_str(payload).map_err(|_| "importRecoveryFailed")?;
        let committed = value["committed"].as_bool().ok_or("importRecoveryFailed")?;
        let existed = value["existed"].as_array().ok_or("importRecoveryFailed")?;
        let plans = self.plans();
        if existed.len() != plans.len() || existed.iter().any(|v| !v.is_boolean()) { return Err("importRecoveryFailed".into()); }
        if !committed {
            for ((active, _, old), existed) in plans.iter().zip(existed) {
                if old.exists() { remove(active)?; fs::rename(old, active).map_err(|_| "importRecoveryFailed")?; }
                else if existed == false { remove(active)?; }
                sync_dir(active.parent().ok_or("fileError")?)?;
            }
        }
        // Keep the committed journal until cleanup succeeds. Recovery itself is restartable.
        remove(&self.root.join("operational/db-import"))?;
        fs::remove_file(self.journal()).map_err(|_| "importRecoveryFailed")?;
        sync_dir(self.journal().parent().ok_or("fileError")?)
    }
}
fn remove(path: &Path) -> Result<()> {
    match fs::symlink_metadata(path) {
        Ok(m) if m.is_dir() && !m.file_type().is_symlink() => fs::remove_dir_all(path),
        Ok(_) => fs::remove_file(path), Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(()), Err(e) => Err(e),
    }.map_err(|_| "fileError".into())
}
fn sync_dir(path: &Path) -> Result<()> {
    #[cfg(unix)] { if path.exists() { File::open(path).and_then(|f| f.sync_all()).map_err(|_| "fileError")?; } }
    #[cfg(not(unix))] { let _ = path; }
    Ok(())
}
fn sync_file(path: &Path) -> Result<()> {
    // Windows FlushFileBuffers requires write access. Opening an existing staged
    // database must neither truncate it nor create a missing file.
    #[cfg(windows)] let file = fs::OpenOptions::new().read(true).write(true).open(path);
    #[cfg(not(windows))] let file = File::open(path);
    file.and_then(|f| f.sync_all()).map_err(|_| "fileError".into())
}
fn free_space(path: &Path) -> Result<u64> {
    #[cfg(unix)] {
        // POSIX df is provided by all supported desktop systems. No shell interpolation.
        let output = std::process::Command::new("df").args(["-Pk"]).arg(path).output().map_err(|_| "fileError")?;
        if !output.status.success() { return Err("fileError".into()); }
        String::from_utf8_lossy(&output.stdout).lines().last().and_then(|s| s.split_whitespace().nth(3))
            .and_then(|s| s.parse::<u64>().ok()).and_then(|n| n.checked_mul(1024)).ok_or("fileError".into())
    }
    #[cfg(windows)] {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")] extern "system" { fn GetDiskFreeSpaceExW(path: *const u16, available: *mut u64, total: *mut u64, free: *mut u64) -> i32; }
        let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect(); let mut available = 0;
        let result = unsafe { GetDiskFreeSpaceExW(path.as_ptr(), &mut available, std::ptr::null_mut(), std::ptr::null_mut()) };
        if result == 0 { Err("fileError".into()) } else { Ok(available) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tessera_sqlite::Database;
    fn store(root: &Path) -> ReplacementStore { ReplacementStore::new(root.into(), root.join("databases/app.sqlite")) }
    fn database(path: &Path, marker: &str) {
        let db = Database::open(path).unwrap(); db.execute("CREATE TABLE marker(value TEXT)", &[]).unwrap();
        db.execute("INSERT INTO marker VALUES(?)", &[json!(marker)]).unwrap();
    }
    #[test]
    fn killed_child() {
        let Some(root) = std::env::var_os("TESSERA_REPLACE_CHILD_ROOT") else { return; };
        let phase = std::env::var("TESSERA_REPLACE_CHILD_PHASE").unwrap();
        store(Path::new(&root)).activate(|at| { if at == phase { std::process::exit(77); } }).unwrap();
        panic!("kill phase was not reached");
    }
    #[test]
    fn corrupt_journal_preserves_both_copies_and_refuses_to_guess() {
        let dir = tempfile::tempdir().unwrap(); let root = dir.path(); let store = store(root);
        database(&root.join("databases/app.sqlite"), "old"); store.prepare(1).unwrap(); database(&store.stage().join("database.sqlite"), "new");
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| store.activate(|at| { if at == "new-0" { panic!("injected interruption"); } })));
        assert!(result.is_err(), "activation returned before the interruption: {result:?}");
        let mut envelope: Value = serde_json::from_slice(&fs::read(store.journal()).unwrap()).unwrap();
        envelope["payload"] = json!(envelope["payload"].as_str().unwrap().replace("false", "true"));
        fs::write(store.journal(), envelope.to_string()).unwrap();
        assert_eq!(store.recover().unwrap_err(), "importRecoveryFailed");
        assert!(root.join("databases/app.sqlite").is_file());
        assert!(root.join("operational/db-import/old/database.sqlite").is_file());
    }
    #[test]
    fn abrupt_death_at_every_rename_restores_one_complete_dataset() {
        let mut phases = vec!["prepared".to_string(), "committed".into()];
        for i in 0..9 { phases.push(format!("old-{i}")); phases.push(format!("new-{i}")); }
        for phase in phases {
            let dir = tempfile::tempdir().unwrap(); let root = dir.path(); let store = store(root);
            database(&root.join("databases/app.sqlite"), "old");
            fs::create_dir_all(root.join("attachments")).unwrap(); fs::write(root.join("attachments/original"), "old bytes").unwrap();
            fs::create_dir_all(root.join("operational/drafts")).unwrap(); fs::write(root.join("operational/drafts/draft"), "old draft").unwrap();
            store.prepare(1).unwrap(); database(&store.stage().join("database.sqlite"), "new");
            fs::write(store.stage().join("attachments/imported"), "new bytes").unwrap();
            let result = std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact", &format!("{}::killed_child", module_path!().split_once("::").unwrap().1)])
                .env("TESSERA_REPLACE_CHILD_ROOT", root).env("TESSERA_REPLACE_CHILD_PHASE", &phase)
                .output().unwrap();
            // The same source also compiles in the Tauri binary with a different module name.
            if result.status.code() != Some(77) { panic!("child did not reach phase {phase}: {}\nstdout: {}\nstderr: {}", result.status, String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr)); }
            store.recover().unwrap(); store.recover().unwrap();
            let db = Database::open(&root.join("databases/app.sqlite")).unwrap();
            let expected = if phase == "committed" { "new" } else { "old" };
            assert_eq!(db.query("SELECT * FROM marker", &[]).unwrap(), vec![json!({"value":expected})], "{phase}");
            assert_eq!(root.join("attachments/imported").exists(), expected == "new", "{phase}");
            assert_eq!(root.join("attachments/original").exists(), expected == "old", "{phase}");
            assert_eq!(root.join("operational/drafts/draft").exists(), expected == "old", "{phase}");
        }
    }
}
