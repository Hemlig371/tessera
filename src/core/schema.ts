const stamp = `id TEXT PRIMARY KEY NOT NULL, hlc TEXT NOT NULL, device_id TEXT NOT NULL,
  deleted_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL`;
const jsonObject = (column: string) => `CHECK(json_valid(${column}) AND json_type(${column})='object')`;

// Only implemented entities are introduced now; later entities use additive migrations.
export const migrations = [
  {
    version: 1,
    statements: [
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
    ],
  },
  {
    version: 2,
    statements: [
      'ALTER TABLE libraries ADD COLUMN position INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE collections ADD COLUMN position INTEGER NOT NULL DEFAULT 0',
      'ALTER TABLE fields ADD COLUMN position INTEGER NOT NULL DEFAULT 0',
      `ALTER TABLE records ADD COLUMN sort_data TEXT NOT NULL DEFAULT '{}' ${jsonObject('sort_data')}`,
      `ALTER TABLE records ADD COLUMN search_data TEXT NOT NULL DEFAULT '{}' ${jsonObject('search_data')}`,
      'ALTER TABLE records ADD COLUMN sort_version INTEGER NOT NULL DEFAULT 0',
      'CREATE INDEX libraries_order ON libraries(deleted_at, position, id)',
      'CREATE INDEX collections_order ON collections(library_id, deleted_at, position, id)',
      'CREATE INDEX fields_order ON fields(collection_id, deleted_at, position, id)',
      `CREATE TABLE ui_configs(${stamp}, collection_id TEXT NOT NULL REFERENCES collections(id),
    kind TEXT NOT NULL CHECK(kind IN ('form','card','list')), config TEXT NOT NULL ${jsonObject('config')}, UNIQUE(collection_id,kind))`,
      'CREATE INDEX records_rebuild ON records(sort_version,id)',
      'CREATE TABLE search_documents(id INTEGER PRIMARY KEY AUTOINCREMENT, record_id TEXT NOT NULL REFERENCES records(id), field_id TEXT NOT NULL REFERENCES fields(id), UNIQUE(record_id,field_id))',
      'DROP TABLE records_fts',
      `CREATE VIRTUAL TABLE records_fts USING fts5(record_id UNINDEXED, field_id UNINDEXED, body, tokenize='unicode61')`,
    ],
  },
  {
    version: 3,
    statements: [
      'ALTER TABLE records ADD COLUMN relation_version INTEGER NOT NULL DEFAULT 0',
      'CREATE INDEX records_relations_rebuild ON records(relation_version,id)',
      `CREATE TABLE relation_index(source_record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
        field_id TEXT NOT NULL REFERENCES fields(id) ON DELETE CASCADE, target_record_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK(ordinal>=0), PRIMARY KEY(source_record_id,field_id,target_record_id)) WITHOUT ROWID`,
      'CREATE INDEX relations_forward ON relation_index(source_record_id,field_id,ordinal,target_record_id)',
      'CREATE INDEX relations_reverse ON relation_index(target_record_id,field_id,source_record_id)',
      'CREATE INDEX relations_field ON relation_index(field_id,target_record_id,source_record_id)',
    ],
  },
  {
    version: 4,
    statements: [
      "ALTER TABLE libraries ADD COLUMN system_kind TEXT CHECK(system_kind IS NULL OR system_kind='inbox')",
      'CREATE UNIQUE INDEX libraries_system ON libraries(system_kind) WHERE system_kind IS NOT NULL',
      "ALTER TABLE collections ADD COLUMN system_kind TEXT CHECK(system_kind IS NULL OR system_kind='inbox')",
      'CREATE UNIQUE INDEX collections_system ON collections(system_kind) WHERE system_kind IS NOT NULL',
    ],
  },
  {
    version: 5,
    statements: [
      `CREATE TABLE quick_forms(${stamp}, collection_id TEXT NOT NULL UNIQUE REFERENCES collections(id),
        kind TEXT NOT NULL DEFAULT 'quick' CHECK(kind='quick'), config TEXT NOT NULL ${jsonObject('config')})`,
    ],
  },
  {
    version: 6,
    statements: [
      `CREATE TABLE display_profiles(${stamp}, collection_id TEXT NOT NULL REFERENCES collections(id),
        name TEXT NOT NULL CHECK(length(trim(name))>0), position INTEGER NOT NULL DEFAULT 0,
        config TEXT NOT NULL ${jsonObject('config')})`,
      'CREATE INDEX profiles_collection ON display_profiles(collection_id,deleted_at,position,id)',
      'ALTER TABLE collections ADD COLUMN default_profile_id TEXT REFERENCES display_profiles(id) DEFERRABLE INITIALLY DEFERRED',
      `INSERT INTO display_profiles(id,hlc,device_id,deleted_at,created_at,updated_at,collection_id,name,position,config)
        SELECT id,hlc,device_id,NULL,created_at,updated_at,collection_id,'Список',0,config
        FROM ui_configs WHERE kind='list' AND deleted_at IS NULL`,
      `INSERT INTO display_profiles(id,hlc,device_id,deleted_at,created_at,updated_at,collection_id,name,position,config)
        SELECT lower(hex(randomblob(4)))||'-'||lower(hex(randomblob(2)))||'-4'||substr(lower(hex(randomblob(2))),2)||'-'||
          substr('89ab',(random() & 3)+1,1)||substr(lower(hex(randomblob(2))),2)||'-'||lower(hex(randomblob(6))),
          c.hlc,c.device_id,NULL,c.created_at,c.updated_at,c.id,'Список',0,'{"fields":[],"list":{"mode":"rows"}}'
        FROM collections c WHERE NOT EXISTS(SELECT 1 FROM display_profiles p WHERE p.collection_id=c.id)`,
      'UPDATE collections SET default_profile_id=(SELECT id FROM display_profiles p WHERE p.collection_id=collections.id)',
    ],
  },
] as const;
