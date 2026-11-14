// Explicit dev-only feature; never included by the Tauri app dependency.
use serde_json::{json, Value};
use std::{io::{self, BufRead, Write}, path::PathBuf};
use tessera_sqlite::Database;
fn main() {
    let path = PathBuf::from(std::env::args().nth(1).expect("database path"));
    let db = Database::open(&path).unwrap();
    for line in io::stdin().lock().lines() {
        let request: Value = serde_json::from_str(&line.unwrap()).unwrap();
        let sql = request["sql"].as_str().unwrap_or("");
        let params = request["params"].as_array().cloned().unwrap_or_default();
        let result = match request["op"].as_str().unwrap() {
            "query" => db.query(sql, &params).map(Value::from),
            "execute" => db.execute(sql, &params).map(|_| Value::Null),
            "begin" => db.begin().map(|_| Value::Null),
            "commit" => db.commit().map(|_| Value::Null),
            "rollback" => db.rollback().map(|_| Value::Null),
            "backup" => db.backup(&PathBuf::from(request["path"].as_str().unwrap())).map(|_| Value::Null),
            _ => Err("unknown operation".into()),
        };
        println!("{}", match result { Ok(value) => json!({"value": value}), Err(error) => json!({"error": error}) });
        io::stdout().flush().unwrap();
    }
}
