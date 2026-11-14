const stamp = `id TEXT PRIMARY KEY NOT NULL, hlc TEXT NOT NULL, device_id TEXT NOT NULL,
  deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL`;
const jsonObject = (column: string) => `CHECK(json_valid(${column}) AND json_type(${column})='object')`;

// Only implemented entities are introduced now; later entities use additive migrations.
export const migrations = [{ version: 1, statements: [
  'CREATE TABLE app_meta(key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)',
  'CREATE TABLE local_settings(key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)',
  `CREATE TABLE libraries(${stamp}, name TEXT NOT NULL CHECK(length(trim(name))>0), config TEXT NOT NULL DEFAULT '{}' ${jsonObject('config')})`,
  `CREATE TABLE collections(${stamp}, library_id TEXT NOT NULL REFERENCES libraries(id), name TEXT NOT NULL CHECK(length(trim(name))>0),
    primary_field_id TEXT NOT NULL, incoming_field_id TEXT NOT NULL, config TEXT NOT NULL DEFAULT '{}' ${jsonObject('config')},
    FOREIGN KEY(primary_field_id) REFERENCES fields(id) DEFERRABLE INITIALLY DEFERRED,
    FOREIGN KEY(incoming_field_id) REFERENCES fields(id) DEFERRABLE INITIALLY DEFERRED)`,
  `CREATE TABLE fields(${stamp}, collection_id TEXT NOT NULL REFERENCES collections(id), name TEXT NOT NULL, type TEXT NOT NULL,
    config TEXT NOT NULL DEFAULT '{}' ${jsonObject('config')})`,
  `CREATE TABLE records(${stamp}, collection_id TEXT NOT NULL REFERENCES collections(id), data TEXT NOT NULL ${jsonObject('data')},
    created_local TEXT NOT NULL, updated_local TEXT NOT NULL, purged INTEGER NOT NULL DEFAULT 0 CHECK(purged IN (0,1)))`,
  `CREATE TABLE record_versions(id TEXT PRIMARY KEY NOT NULL, record_id TEXT NOT NULL REFERENCES records(id),
    hlc TEXT NOT NULL, device_id TEXT NOT NULL, saved_at TEXT NOT NULL, snapshot TEXT NOT NULL ${jsonObject('snapshot')})`,
  `CREATE TRIGGER record_versions_immutable BEFORE UPDATE ON record_versions BEGIN SELECT RAISE(ABORT, 'immutable version'); END`,
  `CREATE TABLE change_log(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL, hlc TEXT NOT NULL, device_id TEXT NOT NULL, payload TEXT NOT NULL ${jsonObject('payload')})`,
  'CREATE INDEX collections_library ON collections(library_id, deleted_at, id)',
  'CREATE INDEX fields_collection ON fields(collection_id, deleted_at, id)',
  'CREATE INDEX records_page ON records(collection_id, deleted_at, updated_at DESC, id DESC)',
  'CREATE INDEX records_hlc ON records(hlc, id)',
  'CREATE INDEX versions_top ON record_versions(record_id, hlc DESC, id DESC)',
  'CREATE INDEX changes_entity ON change_log(entity_type, entity_id, hlc)',
  `CREATE VIRTUAL TABLE records_fts USING fts5(record_id UNINDEXED, body, tokenize='unicode61')`,
] }] as const;
