//! Bounded private file I/O. Attachment ownership, retention and synchronization stay in TypeScript.
use sha2::{Digest, Sha256};
use std::{fs::{self, File, OpenOptions}, io::{Read, Seek, SeekFrom, Write}, path::PathBuf, sync::Mutex};

pub const CHUNK_SIZE: usize = 256 * 1024;
pub struct BinaryStore { root: PathBuf, gate: Mutex<()> }
type Result<T> = std::result::Result<T, String>;
impl BinaryStore {
    pub fn new(root: PathBuf) -> Self { Self { root, gate: Mutex::new(()) } }
    fn path(&self, id: &str, staged: bool) -> Result<PathBuf> {
        if id.len() != 36 || !id.bytes().enumerate().all(|(i, c)| if [8,13,18,23].contains(&i) { c == b'-' } else { c.is_ascii_digit() || (b'a'..=b'f').contains(&c) }) { return Err("invalidId".into()); }
        let relative = if staged { format!("operational/file-staging/{id}.part") } else { format!("attachments/{}/{id}", &id[..2]) };
        let mut path = self.root.clone();
        if fs::symlink_metadata(&path).map(|m| m.file_type().is_symlink()).unwrap_or(false) { return Err("fileError".into()); }
        for component in relative.split('/') {
            path.push(component);
            if fs::symlink_metadata(&path).map(|m| m.file_type().is_symlink()).unwrap_or(false) { return Err("fileError".into()); }
        }
        Ok(path)
    }
    fn facts(path: &std::path::Path) -> Result<Option<(u64, String)>> {
        let mut file = match File::open(path) { Ok(file) => file, Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None), Err(_) => return Err("fileError".into()) };
        let mut hash = Sha256::new(); let mut size = 0u64; let mut buffer = [0u8; CHUNK_SIZE];
        loop { let n = file.read(&mut buffer).map_err(|_| "fileError")?; if n == 0 { break; } size += n as u64; hash.update(&buffer[..n]); }
        Ok(Some((size, format!("{:x}", hash.finalize()))))
    }
    pub fn begin(&self, id: &str) -> Result<()> {
        let _guard = self.gate.lock().map_err(|_| "fileError")?;
        let path = self.path(id, true)?;
        if self.path(id, false)?.exists() { return Err("fileExists".into()); }
        fs::create_dir_all(path.parent().ok_or("fileError")?).map_err(|_| "fileError")?;
        OpenOptions::new().write(true).create_new(true).open(path).map_err(|_| "fileError")?;
        Ok(())
    }
    pub fn write(&self, id: &str, offset: u64, bytes: &[u8]) -> Result<()> {
        let _guard = self.gate.lock().map_err(|_| "fileError")?;
        if bytes.is_empty() || bytes.len() > CHUNK_SIZE { return Err("invalidFileChunk".into()); }
        let mut file = OpenOptions::new().append(true).open(self.path(id, true)?).map_err(|_| "fileError")?;
        if file.metadata().map_err(|_| "fileError")?.len() != offset { return Err("invalidFileOffset".into()); }
        file.write_all(bytes).map_err(|_| "fileError".into())
    }
    pub fn finish(&self, id: &str, expected_size: u64, expected_hash: Option<&str>) -> Result<(u64, String)> {
        let _guard = self.gate.lock().map_err(|_| "fileError")?;
        let staged = self.path(id, true)?; let target = self.path(id, false)?;
        let facts = Self::facts(&staged)?.ok_or("fileMissing")?;
        if facts.0 != expected_size || expected_hash.map(|hash| hash != facts.1).unwrap_or(false) { return Err("fileCorrupt".into()); }
        if target.exists() { return Err("fileExists".into()); }
        File::open(&staged).and_then(|f| f.sync_all()).map_err(|_| "fileError")?;
        fs::create_dir_all(target.parent().ok_or("fileError")?).map_err(|_| "fileError")?;
        fs::rename(&staged, &target).map_err(|_| "fileError")?;
        #[cfg(unix)] { File::open(target.parent().ok_or("fileError")?).and_then(|f| f.sync_all()).map_err(|_| "fileError")?; }
        Ok(facts)
    }
    pub fn inspect(&self, id: &str) -> Result<Option<(u64, String)>> {
        let _guard = self.gate.lock().map_err(|_| "fileError")?;
        Self::facts(&self.path(id, false)?)
    }
    pub fn read(&self, id: &str, offset: u64, length: usize) -> Result<Vec<u8>> {
        let _guard = self.gate.lock().map_err(|_| "fileError")?;
        if length == 0 || length > CHUNK_SIZE { return Err("invalidFileChunk".into()); }
        let mut file = File::open(self.path(id, false)?).map_err(|e| if e.kind() == std::io::ErrorKind::NotFound { "fileMissing" } else { "fileError" })?;
        if offset > file.metadata().map_err(|_| "fileError")?.len() { return Err("invalidFileOffset".into()); }
        file.seek(SeekFrom::Start(offset)).map_err(|_| "fileError")?;
        let mut bytes = vec![0; length]; let mut count = 0;
        while count < length { let n = file.read(&mut bytes[count..]).map_err(|_| "fileError")?; if n == 0 { break; } count += n; }
        bytes.truncate(count); Ok(bytes)
    }
    pub fn remove(&self, id: &str, staged: bool) -> Result<()> {
        let _guard = self.gate.lock().map_err(|_| "fileError")?;
        match fs::remove_file(self.path(id, staged)?) { Ok(()) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(_) => Err("fileError".into()) }
    }
    pub fn export(&self, id: &str, destination: PathBuf, expected_size: u64, expected_hash: &str) -> Result<()> {
        let _guard = self.gate.lock().map_err(|_| "fileError")?;
        let source = self.path(id, false)?;
        let parent = destination.parent().ok_or("fileError")?;
        let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "fileError")?.as_nanos();
        let temporary = parent.join(format!(".tessera-file-{}-{nonce}.tmp", std::process::id()));
        let result = (|| -> Result<()> {
            let mut input = File::open(source).map_err(|_| "fileMissing")?;
            let mut output = OpenOptions::new().create_new(true).write(true).open(&temporary).map_err(|_| "fileError")?;
            let mut hash = Sha256::new(); let mut size = 0u64; let mut buffer = [0u8; CHUNK_SIZE];
            loop { let n = input.read(&mut buffer).map_err(|_| "fileError")?; if n == 0 { break; } hash.update(&buffer[..n]); size += n as u64; output.write_all(&buffer[..n]).map_err(|_| "fileError")?; }
            if size != expected_size || format!("{:x}", hash.finalize()) != expected_hash { return Err("fileCorrupt".into()); }
            output.sync_all().map_err(|_| "fileError")?; drop(output);
            fs::rename(&temporary, &destination).map_err(|_| "fileError")?;
            #[cfg(unix)] { File::open(parent).and_then(|f| f.sync_all()).map_err(|_| "fileError")?; }
            Ok(())
        })();
        if result.is_err() { let _ = fs::remove_file(temporary); }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "01234567-0123-4123-8123-0123456789ab";
    const EMPTY: &str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    #[test] fn streams_hashes_reopens_reads_ranges_and_never_overwrites_an_existing_id() {
        let root = tempfile::tempdir().unwrap(); let store = BinaryStore::new(root.path().into());
        store.begin(ID).unwrap();
        let chunk = vec![73u8; CHUNK_SIZE];
        for offset in 0..45 { store.write(ID, offset * CHUNK_SIZE as u64, &chunk).unwrap(); }
        let facts = store.finish(ID, 45 * CHUNK_SIZE as u64, None).unwrap();
        let mut expected = Sha256::new(); for _ in 0..45 { expected.update(&chunk); }
        assert_eq!(facts.1, format!("{:x}", expected.finalize()));
        let again = BinaryStore::new(root.path().into());
        assert_eq!(again.inspect(ID).unwrap(), Some(facts));
        assert_eq!(again.read(ID, 44 * CHUNK_SIZE as u64, CHUNK_SIZE).unwrap(), chunk);
        assert!(again.read(ID, 46 * CHUNK_SIZE as u64, 1).is_err());
        assert!(again.begin(ID).is_err());
        again.remove(ID, true).unwrap(); assert!(again.inspect(ID).unwrap().is_some());
        again.remove(ID, false).unwrap(); assert_eq!(again.inspect(ID).unwrap(), None);
    }
    #[test] fn refuses_gaps_traversal_oversize_chunks_and_bad_hashes_without_publishing_partial_bytes() {
        let root = tempfile::tempdir().unwrap(); let store = BinaryStore::new(root.path().into());
        for bad in ["../app.sqlite", "/absolute", "01234567-0123-4123-8123-0123456789a/", "01234567-0123-4123-8123-0123456789AB"] { assert!(store.begin(bad).is_err()); }
        store.begin(ID).unwrap();
        assert!(store.write(ID, 1, b"a").is_err()); assert!(store.write(ID, 0, &vec![0; CHUNK_SIZE+1]).is_err());
        store.write(ID, 0, b"abc").unwrap();
        assert!(store.finish(ID, 4, None).is_err()); assert!(store.finish(ID, 3, Some(EMPTY)).is_err());
        assert_eq!(store.inspect(ID).unwrap(), None);
        store.remove(ID, true).unwrap(); store.begin(ID).unwrap();
        assert_eq!(store.finish(ID, 0, Some(EMPTY)).unwrap(), (0, EMPTY.into()));
    }
    #[test] fn failed_export_preserves_the_previous_destination_and_reports_corruption() {
        let root = tempfile::tempdir().unwrap(); let store = BinaryStore::new(root.path().into());
        store.begin(ID).unwrap(); store.write(ID, 0, b"export bytes").unwrap(); let facts = store.finish(ID, 12, None).unwrap();
        let output = root.path().join("копия.bin"); fs::write(&output, b"old").unwrap();
        assert!(store.export(ID, output.clone(), 12, EMPTY).is_err()); assert_eq!(fs::read(&output).unwrap(), b"old");
        store.export(ID, output.clone(), 12, &facts.1).unwrap(); assert_eq!(fs::read(&output).unwrap(), b"export bytes");
        fs::write(store.path(ID, false).unwrap(), b"corrupt").unwrap();
        assert!(store.export(ID, output.clone(), 12, &facts.1).is_err()); assert_eq!(fs::read(output).unwrap(), b"export bytes");
    }
    #[test] fn process_death_during_copy_never_publishes_partial_bytes() {
        const ENV: &str = "TESSERA_BINARY_CRASH_ROOT";
        if let Some(root) = std::env::var_os(ENV) {
            let store = BinaryStore::new(root.into()); store.begin(ID).unwrap();
            let chunk = vec![73u8; CHUNK_SIZE];
            for n in 0..100 { store.write(ID, n * CHUNK_SIZE as u64, &chunk).unwrap(); }
            store.finish(ID, 100 * CHUNK_SIZE as u64, None).unwrap(); return;
        }
        let root = tempfile::tempdir().unwrap(); let store = BinaryStore::new(root.path().into());
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "binary_store::tests::process_death_during_copy_never_publishes_partial_bytes"])
            .env(ENV, root.path()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).spawn().unwrap();
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        let mut copying = false;
        while std::time::Instant::now() < deadline {
            if fs::metadata(store.path(ID, true).unwrap()).map(|m| m.len() > 0).unwrap_or(false) { copying = true; break; }
            if child.try_wait().unwrap().is_some() { break; }
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
        let _ = child.kill(); child.wait().unwrap(); assert!(copying);
        // Even a kill during finish can leave only the whole verified file or no final file.
        if let Some(facts) = store.inspect(ID).unwrap() { assert_eq!(facts.0, 100 * CHUNK_SIZE as u64); }
        else { store.remove(ID, true).unwrap(); store.begin(ID).unwrap(); assert_eq!(store.finish(ID, 0, Some(EMPTY)).unwrap().1, EMPTY); }
    }
    #[cfg(unix)]
    #[test] fn refuses_symlinked_roots_and_prefixes() {
        let root = tempfile::tempdir().unwrap(); let elsewhere = tempfile::tempdir().unwrap();
        let linked = root.path().join("linked"); std::os::unix::fs::symlink(elsewhere.path(), &linked).unwrap();
        assert!(BinaryStore::new(linked).begin(ID).is_err());
        fs::create_dir(root.path().join("attachments")).unwrap();
        std::os::unix::fs::symlink(elsewhere.path(), root.path().join("attachments/01")).unwrap();
        assert!(BinaryStore::new(root.path().into()).begin(ID).is_err());
    }
}
