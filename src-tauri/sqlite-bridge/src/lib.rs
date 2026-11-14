//! SQLite/OS plumbing only. Schema and business rules live in TypeScript.
use rusqlite::{params_from_iter, types::{Value as SqlValue, ValueRef}, Connection};
use serde_json::{Map, Value};
use std::{path::Path, time::Duration};

pub struct Database { connection: Connection }
pub type Result<T> = std::result::Result<T, String>;

fn parameters(values: &[Value]) -> Result<Vec<SqlValue>> {
    values.iter().map(|v| match v {
        Value::Null => Ok(SqlValue::Null),
        Value::String(v) => Ok(SqlValue::Text(v.clone())),
        Value::Number(v) => {
            if let Some(n) = v.as_i64() { Ok(SqlValue::Integer(n)) }
            else { v.as_f64().map(SqlValue::Real).ok_or_else(|| "Invalid SQL number".into()) }
        },
        _ => Err("SQL bindings must be string, number or null".into()),
    }).collect()
}

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
        let connection = Connection::open(path).map_err(|e| e.to_string())?;
        connection.busy_timeout(Duration::from_secs(5)).map_err(|e| e.to_string())?;
        connection.execute_batch("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;")
            .map_err(|e| e.to_string())?;
        Ok(Self { connection })
    }
    pub fn execute(&self, sql: &str, values: &[Value]) -> Result<()> {
        self.connection.execute(sql, params_from_iter(parameters(values)?)).map(|_| ()).map_err(|e| e.to_string())
    }
    pub fn query(&self, sql: &str, values: &[Value]) -> Result<Vec<Value>> {
        let mut statement = self.connection.prepare(sql).map_err(|e| e.to_string())?;
        if !statement.readonly() && !["PRAGMA wal_checkpoint(TRUNCATE)", "PRAGMA journal_mode"].iter().any(|p| sql.trim().eq_ignore_ascii_case(p)) {
            return Err("query requires a read-only statement".into());
        }
        let names: Vec<String> = statement.column_names().map(|s| s.to_string()).collect();
        let mut cursor = statement.query(params_from_iter(parameters(values)?)).map_err(|e| e.to_string())?;
        let mut rows = Vec::new();
        while let Some(row) = cursor.next().map_err(|e| e.to_string())? {
            let mut object = Map::new();
            for (i, name) in names.iter().enumerate() {
                let value = match row.get_ref(i).map_err(|e| e.to_string())? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) if n.unsigned_abs() <= 9_007_199_254_740_991 => Value::from(n),
                    ValueRef::Integer(_) => return Err("Integer exceeds JavaScript safe range".into()),
                    ValueRef::Real(n) => Value::from(n),
                    ValueRef::Text(s) => Value::from(std::str::from_utf8(s).map_err(|e| e.to_string())?),
                    ValueRef::Blob(_) => return Err("BLOB values are not supported; attachments are files".into()),
                };
                object.insert(name.clone(), value);
            }
            rows.push(Value::Object(object));
        }
        Ok(rows)
    }
    pub fn begin(&self) -> Result<()> { self.execute("BEGIN IMMEDIATE", &[]) }
    pub fn commit(&self) -> Result<()> { self.execute("COMMIT", &[]) }
    pub fn rollback(&self) -> Result<()> { self.execute("ROLLBACK", &[]) }
    pub fn backup(&self, destination: &Path) -> Result<()> {
        if !self.connection.is_autocommit() { return Err("Backup inside transaction".into()); }
        // Refuse overwrite: an earlier recovery copy must survive.
        if destination.exists() { return Err("Backup already exists".into()); }
        self.execute("VACUUM INTO ?", &[Value::from(destination.to_string_lossy().as_ref())])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persistence_rollback_json_fts_and_backup() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("app.sqlite");
        let db = Database::open(&path).unwrap();
        db.execute("CREATE TABLE probe(id TEXT PRIMARY KEY, data TEXT CHECK(json_valid(data)))", &[]).unwrap();
        db.begin().unwrap();
        db.execute("INSERT INTO probe VALUES(?,?)", &[Value::from("a'"), Value::from("{\"name\":\"Запись\"}")]).unwrap();
        db.rollback().unwrap();
        assert_eq!(db.query("SELECT count(*) AS n FROM probe", &[]).unwrap()[0]["n"], 0);
        db.execute("CREATE INDEX expr_probe ON probe(json_extract(data,'$.name'))", &[]).unwrap();
        db.execute("CREATE VIRTUAL TABLE text_probe USING fts5(body, tokenize='unicode61')", &[]).unwrap();
        db.execute("INSERT INTO text_probe VALUES(?)", &[Value::from("ЗАПИСНАЯ книжка")]).unwrap();
        assert_eq!(db.query("SELECT count(*) AS n FROM text_probe WHERE text_probe MATCH ?", &[Value::from("запис*")]).unwrap()[0]["n"], 1);
        db.execute("INSERT INTO probe VALUES(?,?)", &[Value::from("a'"), Value::from("{\"name\":\"Запись\"}")]).unwrap();
        let backup = dir.path().join("backup.sqlite");
        db.backup(&backup).unwrap();
        assert!(db.backup(&backup).is_err());
        drop(db);
        for file in [&path, &backup] {
            let db = Database::open(file).unwrap();
            assert_eq!(db.query("SELECT json_extract(data,'$.name') AS name FROM probe", &[]).unwrap()[0]["name"], "Запись");
            assert_eq!(db.query("PRAGMA integrity_check", &[]).unwrap()[0]["integrity_check"], "ok");
        }
    }
    #[test]
    fn rejects_non_scalar_bindings_and_unsafe_integers() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::open(&dir.path().join("app.sqlite")).unwrap();
        assert!(db.query("SELECT ?", &[serde_json::json!({"x": 1})]).is_err());
        assert!(db.query("SELECT 9007199254740992", &[]).is_err());
        assert!(db.query("CREATE TABLE nope(id TEXT)", &[]).is_err());
    }
}
