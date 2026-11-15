import {
  relationIds,
  validateRelationDefinition,
  validateRelationTargets,
  refreshRelationRecords,
  relationSources,
  relationPage,
  relationContext,
  resolveRelationValues,
} from './relations';
import { entryRules, FieldError, prepareEntryData, RowError } from './entry-data';
import { activeCollection, activeRecords, decodeEntry, type StoredEntry } from './entry-storage';
import { queryEntries } from './queries';
import { AppError } from './errors';
import { nextHlc } from './hlc';
import { canonical, localTimestamp } from './model';
import type {
  Appearance,
  Collection,
  Entry,
  EntryListItem,
  EntryQuery,
  Field,
  FieldConfig,
  JsonValue,
  Library,
  Page,
  RecordData,
  RelationCursor,
  RelationPage,
  RelationSource,
  RelationItem,
  Stamp,
  UiConfiguration,
  UiDefinition,
  UiKind,
} from './model';
import type { DatabaseAdapter, SqlSession, SqlValue } from './ports';
import {
  appearanceValue,
  fieldConfig,
  nameValue,
  positionValue,
  requireId,
  validateData,
  validateFieldConfig,
} from './validation';
import { fieldExpression, fieldIndexName, sortData } from './search-keys';
import { validateUiDefinition } from './ui-definition';

type Table = 'libraries' | 'collections' | 'fields' | 'records' | 'ui_configs';
export class Repository {
  private constructor(
    readonly db: DatabaseAdapter,
    readonly deviceId: string,
    readonly datasetId: string
  ) {}
  static async open(db: DatabaseAdapter): Promise<Repository> {
    const ids = await db.transaction(async (s) => {
      const [format] = await s.query<{ value: string }>(
        "SELECT value FROM app_meta WHERE key='format_version'"
      );
      if (format?.value !== '1') throw new AppError('unsupportedSchema');
      const [dataset] = await s.query<{ value: string }>("SELECT value FROM app_meta WHERE key='dataset_id'");
      const [device] = await s.query<{ value: string }>(
        "SELECT value FROM local_settings WHERE key='device_id'"
      );
      const datasetId = dataset?.value ?? crypto.randomUUID(),
        deviceId = device?.value ?? crypto.randomUUID();
      requireId(datasetId);
      requireId(deviceId);
      await s.execute("INSERT OR IGNORE INTO app_meta VALUES('dataset_id',?)", [datasetId]);
      await s.execute("INSERT OR IGNORE INTO local_settings VALUES('device_id',?)", [deviceId]);
      return { datasetId, deviceId };
    });
    const repository = new Repository(db, ids.deviceId, ids.datasetId);
    await repository.rebuildDerived();
    await repository.rebuildRelationIndex(false);
    return repository;
  }
  private async stamp(s: SqlSession, id: string = crypto.randomUUID()): Promise<Stamp> {
    const [last] = await s.query<{ value: string }>("SELECT value FROM local_settings WHERE key='hlc'");
    const now = new Date(),
      hlc = nextHlc(this.deviceId, now.getTime(), last?.value);
    await s.execute(
      "INSERT INTO local_settings VALUES('hlc',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [hlc]
    );
    return {
      id,
      hlc,
      device_id: this.deviceId,
      deleted_at: null,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };
  }
  private async insert(s: SqlSession, table: Table, row: object): Promise<void> {
    const values = Object.values(row) as SqlValue[];
    await s.execute(
      `INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${values.map(() => '?').join(',')})`,
      values
    );
  }
  private async log(s: SqlSession, entity: string, row: Stamp, payload: object): Promise<void> {
    await s.execute(
      'INSERT INTO change_log(id,entity_type,entity_id,hlc,device_id,payload) VALUES(?,?,?,?,?,?)',
      [
        crypto.randomUUID(),
        entity,
        row.id,
        row.hlc,
        row.device_id,
        canonical(payload as Record<string, JsonValue>),
      ]
    );
  }
  private async update<T extends Stamp>(
    s: SqlSession,
    table: Table,
    entity: string,
    old: T,
    patch: Partial<T>
  ): Promise<T> {
    const candidate = { ...old, ...patch };
    if (canonical(candidate as unknown as JsonValue) === canonical({ ...old } as unknown as JsonValue))
      return old;
    const next = {
      ...candidate,
      ...(await this.stamp(s, old.id)),
      created_at: old.created_at,
      deleted_at: candidate.deleted_at,
    };
    const columns = Object.keys(next).filter((k) => k !== 'id');
    await s.execute(`UPDATE ${table} SET ${columns.map((k) => k + '=?').join(',')} WHERE id=?`, [
      ...(columns.map((k) => next[k as keyof T]) as SqlValue[]),
      old.id,
    ]);
    await this.log(s, entity, next, next);
    return next;
  }
  async createLibrary(value: string, appearance: Appearance = {}): Promise<Library> {
    const name = nameValue(value),
      config = canonical(appearanceValue(appearance) as Record<string, JsonValue>);
    return this.db.transaction(async (s) => {
      const [order] = await s.query<{ n: number }>('SELECT coalesce(max(position),-1)+1 AS n FROM libraries');
      const row: Library = { ...(await this.stamp(s)), name, config, position: order!.n };
      await this.insert(s, 'libraries', row);
      await this.log(s, 'library', row, row);
      return row;
    });
  }
  async updateLibrary(
    id: string,
    patch: { name?: string; position?: number; appearance?: Appearance }
  ): Promise<Library> {
    requireId(id);
    return this.db.transaction(async (s) => {
      const [old] = await s.query<Library>('SELECT * FROM libraries WHERE id=? AND deleted_at IS NULL', [id]);
      if (!old) throw new AppError('notFound');
      return this.update(s, 'libraries', 'library', old, {
        ...(patch.name != null ? { name: nameValue(patch.name) } : {}),
        ...(patch.position != null ? { position: positionValue(patch.position) } : {}),
        ...(patch.appearance != null
          ? { config: canonical({ ...JSON.parse(old.config), ...appearanceValue(patch.appearance) }) }
          : {}),
      });
    });
  }
  listLibraries(): Promise<Library[]> {
    return this.db.read((s) =>
      s.query<Library>('SELECT * FROM libraries WHERE deleted_at IS NULL ORDER BY position,created_at,id')
    );
  }
  async createCollection(libraryId: string, value: string, primaryLabel: string): Promise<Collection> {
    requireId(libraryId);
    const name = nameValue(value),
      label = nameValue(primaryLabel);
    return this.db.transaction(async (s) => {
      if (!(await s.query('SELECT id FROM libraries WHERE id=? AND deleted_at IS NULL', [libraryId]))[0])
        throw new AppError('notFound');
      const [order] = await s.query<{ n: number }>(
        'SELECT coalesce(max(position),-1)+1 AS n FROM collections WHERE library_id=?',
        [libraryId]
      );
      const fieldId = crypto.randomUUID();
      const row: Collection = {
        ...(await this.stamp(s)),
        library_id: libraryId,
        name,
        primary_field_id: fieldId,
        incoming_field_id: fieldId,
        config: '{}',
        position: order!.n,
      };
      const field: Field = {
        ...(await this.stamp(s, fieldId)),
        collection_id: row.id,
        name: label,
        type: 'text',
        config: '{"required":true,"fts":true}',
        position: 0,
      };
      await this.insert(s, 'collections', row);
      await this.insert(s, 'fields', field);
      await this.log(s, 'collection', row, row);
      await this.log(s, 'field', field, field);
      return row;
    });
  }
  async updateCollection(
    id: string,
    patch: {
      name?: string;
      position?: number;
      appearance?: Appearance;
      primary_field_id?: string;
      incoming_field_id?: string;
    }
  ): Promise<Collection> {
    requireId(id);
    return this.db.transaction(async (s) => {
      const old = await activeCollection(s, id);
      for (const fieldId of [patch.primary_field_id, patch.incoming_field_id]) {
        if (fieldId) {
          requireId(fieldId);
          if (
            !(
              await s.query(
                "SELECT id FROM fields WHERE id=? AND collection_id=? AND type='text' AND deleted_at IS NULL",
                [fieldId, id]
              )
            )[0]
          )
            throw new AppError('invalidPrimaryField');
        }
      }
      return this.update(s, 'collections', 'collection', old, {
        ...(patch.name != null ? { name: nameValue(patch.name) } : {}),
        ...(patch.position != null ? { position: positionValue(patch.position) } : {}),
        ...(patch.appearance != null
          ? { config: canonical({ ...JSON.parse(old.config), ...appearanceValue(patch.appearance) }) }
          : {}),
        ...(patch.primary_field_id ? { primary_field_id: patch.primary_field_id } : {}),
        ...(patch.incoming_field_id ? { incoming_field_id: patch.incoming_field_id } : {}),
      });
    });
  }
  async listCollections(libraryId: string): Promise<Collection[]> {
    requireId(libraryId);
    return this.db.read((s) =>
      s.query<Collection>(
        `SELECT c.* FROM collections c JOIN libraries l ON l.id=c.library_id
      WHERE c.library_id=? AND c.deleted_at IS NULL AND l.deleted_at IS NULL ORDER BY c.position,c.created_at,c.id`,
        [libraryId]
      )
    );
  }
  getCollection(id: string): Promise<Collection> {
    requireId(id);
    return this.db.read((s) => activeCollection(s, id));
  }
  async listFields(collectionId: string): Promise<Field[]> {
    requireId(collectionId);
    return this.db.read(async (s) => {
      await activeCollection(s, collectionId);
      return s.query<Field>(
        'SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL ORDER BY position,created_at,id',
        [collectionId]
      );
    });
  }
  async createField(
    collectionId: string,
    name: string,
    type: string,
    config: FieldConfig = {}
  ): Promise<Field> {
    requireId(collectionId);
    const label = nameValue(name),
      checked = validateFieldConfig(type, config);
    const row = await this.db.transaction(async (s) => {
      const parent = await activeCollection(s, collectionId);
      await validateRelationDefinition(s, parent, type, checked);
      const [order] = await s.query<{ n: number }>(
        'SELECT coalesce(max(position),-1)+1 AS n FROM fields WHERE collection_id=?',
        [collectionId]
      );
      const field: Field = {
        ...(await this.stamp(s)),
        collection_id: collectionId,
        name: label,
        type,
        config: canonical(checked as Record<string, JsonValue>),
        position: order!.n,
      };
      await this.insert(s, 'fields', field);
      await this.log(s, 'field', field, field);
      await this.indexesInSession(s, collectionId);
      return field;
    });
    return row;
  }
  async updateField(
    id: string,
    patch: { name?: string; position?: number; type?: string; config?: FieldConfig }
  ): Promise<Field> {
    requireId(id);
    const row = await this.db.transaction(async (s) => {
      const [old] = await s.query<Field>('SELECT * FROM fields WHERE id=? AND deleted_at IS NULL', [id]);
      if (!old) throw new AppError('notFound');
      const parent = await activeCollection(s, old.collection_id);
      if (patch.type && patch.type !== old.type) throw new AppError('fieldTypeChange');
      const checked = patch.config ? validateFieldConfig(old.type, patch.config) : fieldConfig(old);
      await validateRelationDefinition(s, parent, old.type, checked, old);
      const updated = await this.update(s, 'fields', 'field', old, {
        ...(patch.name != null ? { name: nameValue(patch.name) } : {}),
        ...(patch.position != null ? { position: positionValue(patch.position) } : {}),
        ...(patch.config ? { config: canonical(checked as Record<string, JsonValue>) } : {}),
      });
      if (fieldConfig(old).fts !== checked.fts)
        await s.execute('UPDATE records SET sort_version=0 WHERE collection_id=?', [old.collection_id]);
      await this.indexesInSession(s, old.collection_id);
      return updated;
    });
    await this.rebuildDerived();
    return row;
  }
  async setDeleted(
    kind: 'library' | 'collection' | 'field' | 'record',
    id: string,
    deleted: boolean
  ): Promise<void> {
    requireId(id);
    const table = { library: 'libraries', collection: 'collections', field: 'fields', record: 'records' }[
      kind
    ] as Exclude<Table, 'ui_configs'>;
    const collectionId = await this.db.transaction(async (s) => {
      const [stored] = await s.query<Library | Collection | Field | StoredEntry>(
        `SELECT * FROM ${table} WHERE id=?`,
        [id]
      );
      if (!stored) throw new AppError('notFound');
      if (kind !== 'library') {
        if (kind === 'collection') {
          if (
            !(
              await s.query('SELECT id FROM libraries WHERE id=? AND deleted_at IS NULL', [
                (stored as Collection).library_id,
              ])
            )[0]
          )
            throw new AppError('notFound');
        } else await activeCollection(s, (stored as Field | Entry).collection_id);
      }
      if (!!stored.deleted_at === deleted) return null;
      if (kind === 'field' && deleted) {
        const parent = await activeCollection(s, (stored as Field).collection_id);
        if (parent.primary_field_id === id || parent.incoming_field_id === id)
          throw new AppError('protectedField');
      }
      if (kind === 'record') {
        const old = decodeEntry(stored as StoredEntry);
        if (old.purged) throw new AppError('purgedRecord');
        if (!!old.deleted_at === deleted) return old.collection_id;
        const stamp = await this.stamp(s, id),
          row: Entry = {
            ...old,
            hlc: stamp.hlc,
            device_id: stamp.device_id,
            updated_at: stamp.updated_at,
            updated_local: localTimestamp(new Date(stamp.updated_at)),
            deleted_at: deleted ? stamp.updated_at : null,
          };
        await s.execute(
          'UPDATE records SET deleted_at=?,updated_at=?,updated_local=?,hlc=?,device_id=?,sort_version=0 WHERE id=?',
          [row.deleted_at, row.updated_at, row.updated_local, row.hlc, row.device_id, id]
        );
        await this.log(s, kind, row, row);
        return row.collection_id;
      }
      await this.update(s, table, kind, stored as Library | Collection | Field, {
        deleted_at: deleted ? new Date().toISOString() : null,
      });
      if (kind === 'field' || kind === 'collection')
        await s.execute('UPDATE records SET sort_version=0,relation_version=0 WHERE collection_id=?', [
          kind === 'field' ? (stored as Field).collection_id : id,
        ]);
      if (kind === 'library')
        await s.execute(
          'UPDATE records SET sort_version=0 WHERE collection_id IN(SELECT id FROM collections WHERE library_id=?)',
          [id]
        );
      return kind === 'field' ? (stored as Field).collection_id : null;
    });
    await this.rebuildDerived();
    await this.rebuildRelationIndex(false);
    if (collectionId) await this.reconcileIndexes(collectionId);
  }
  async saveEntry(collectionId: string, data: RecordData, id?: string): Promise<Entry> {
    requireId(collectionId);
    if (id) requireId(id);
    validateData(data);
    return this.db.transaction((s) => this.saveEntryInSession(s, collectionId, data, id));
  }
  async saveEntryInSession(
    s: SqlSession,
    collectionId: string,
    data: RecordData,
    id?: string
  ): Promise<Entry> {
    requireId(collectionId);
    if (id) requireId(id);
    validateData(data);
    const collection = await activeCollection(s, collectionId);
    const [stored] = id
      ? await s.query<StoredEntry>(
          'SELECT * FROM records WHERE id=? AND collection_id=? AND deleted_at IS NULL AND purged=0',
          [id, collectionId]
        )
      : [];
    if (id && !stored) throw new AppError('notFound');
    const previous = stored ? decodeEntry(stored) : undefined;
    const fields = await s.query<Field>(
      'SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL ORDER BY position,id',
      [collectionId]
    );
    const [form] = await s.query<UiConfiguration>(
      "SELECT * FROM ui_configs WHERE collection_id=? AND kind='form' AND deleted_at IS NULL",
      [collectionId]
    );
    const rules = entryRules(
      collection,
      fields,
      form ? (JSON.parse(form.config) as UiDefinition) : { fields: [] }
    );
    const merged = prepareEntryData(data, rules, previous?.data);
    await validateRelationTargets(s, collection, fields, merged, previous?.data);
    const encoded = canonical(merged);
    if (previous && encoded === canonical(previous.data)) return previous;
    const stamp = await this.stamp(s, id),
      local = localTimestamp(new Date(stamp.updated_at));
    const row: Entry = {
      ...stamp,
      collection_id: collectionId,
      data: merged,
      purged: 0,
      created_at: previous?.created_at ?? stamp.created_at,
      created_local: previous?.created_local ?? local,
      updated_local: local,
    };
    if (previous)
      await s.execute(
        'UPDATE records SET data=?,updated_at=?,updated_local=?,hlc=?,device_id=?,sort_version=0 WHERE id=?',
        [encoded, row.updated_at, local, row.hlc, this.deviceId, row.id]
      );
    else
      await this.insert(s, 'records', {
        ...row,
        data: encoded,
        sort_data: '{}',
        sort_version: 0,
        search_data: '{}',
      });
    const version = {
      id: crypto.randomUUID(),
      record_id: row.id,
      hlc: row.hlc,
      device_id: this.deviceId,
      saved_at: row.updated_at,
      snapshot: { ...row },
    };
    await s.execute('INSERT INTO record_versions VALUES(?,?,?,?,?,?)', [
      version.id,
      row.id,
      row.hlc,
      this.deviceId,
      row.updated_at,
      canonical(version.snapshot),
    ]);
    await this.log(s, 'record', row, row);
    await this.log(s, 'record_version', { ...stamp, id: version.id }, version);
    await this.refreshRecords(
      s,
      [{ ...row, data: encoded, sort_data: '{}', sort_version: 0, search_data: '{}' }],
      fields
    );
    return row;
  }
  queryEntries(query: EntryQuery): Promise<Page<EntryListItem>> {
    return this.db.read((s) => queryEntries(s, query));
  }
  async previewImport(
    collectionId: string,
    source: Iterable<RecordData>
  ): Promise<{ count: number; preview: RecordData[] }> {
    requireId(collectionId);
    return this.db.read(async (s) => {
      const collection = await activeCollection(s, collectionId);
      const fields = await s.query<Field>(
        'SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL',
        [collectionId]
      );
      const [form] = await s.query<{ config: string }>(
        "SELECT config FROM ui_configs WHERE collection_id=? AND kind='form' AND deleted_at IS NULL",
        [collectionId]
      );
      const rules = entryRules(
        collection,
        fields,
        form ? (JSON.parse(form.config) as UiDefinition) : { fields: [] }
      );
      let count = 0;
      const preview: RecordData[] = [];
      for (const input of source) {
        try {
          const data = prepareEntryData(input, rules);
          await validateRelationTargets(s, collection, fields, data);
          if (preview.length < 10) preview.push(data);
        } catch (e) {
          if (e instanceof FieldError) throw new RowError(count + 2, e.field, e.code);
          throw e;
        }
        count++;
        if (count % 500 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return { count, preview };
    });
  }
  /** One atomic import, bounded bridge batches; identical field/form rules to explicit save. */
  async importEntries(
    collectionId: string,
    source: Iterable<RecordData>,
    progress?: (count: number) => void
  ): Promise<number> {
    requireId(collectionId);
    return this.db.transaction(async (s) => {
      const collection = await activeCollection(s, collectionId);
      const fields = await s.query<Field>(
        'SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL',
        [collectionId]
      );
      const [form] = await s.query<{ config: string }>(
        "SELECT config FROM ui_configs WHERE collection_id=? AND kind='form' AND deleted_at IS NULL",
        [collectionId]
      );
      const rules = entryRules(
        collection,
        fields,
        form ? (JSON.parse(form.config) as UiDefinition) : { fields: [] }
      );
      const [last] = await s.query<{ value: string }>("SELECT value FROM local_settings WHERE key='hlc'");
      let clock = last?.value,
        count = 0;
      let batch: StoredEntry[] = [];
      const flush = async () => {
        if (!batch.length) return;
        const versions = batch.map((row) => {
          const entry = decodeEntry(row);
          return {
            id: crypto.randomUUID(),
            record_id: row.id,
            hlc: row.hlc,
            device_id: row.device_id,
            saved_at: row.updated_at,
            snapshot: entry,
          };
        });
        const columns = Object.keys(batch[0]!);
        await s.execute(
          `INSERT INTO records(${columns.join(',')}) VALUES ${batch.map(() => '(' + columns.map(() => '?').join(',') + ')').join(',')}`,
          batch.flatMap((row) => columns.map((k) => row[k as keyof StoredEntry] as SqlValue))
        );
        await s.execute(
          `INSERT INTO record_versions VALUES ${versions.map(() => '(?,?,?,?,?,?)').join(',')}`,
          versions.flatMap((v) => [
            v.id,
            v.record_id,
            v.hlc,
            v.device_id,
            v.saved_at,
            canonical({ ...v.snapshot }),
          ])
        );
        const logs = batch.flatMap((row, i) => {
          const v = versions[i]!;
          return [
            [
              crypto.randomUUID(),
              'record',
              row.id,
              row.hlc,
              row.device_id,
              canonical({ ...decodeEntry(row) }),
            ],
            [
              crypto.randomUUID(),
              'record_version',
              v.id,
              v.hlc,
              v.device_id,
              canonical(v as unknown as JsonValue),
            ],
          ];
        });
        await s.execute(
          `INSERT INTO change_log(id,entity_type,entity_id,hlc,device_id,payload) VALUES ${logs.map(() => '(?,?,?,?,?,?)').join(',')}`,
          logs.flat()
        );
        await this.refreshRecords(s, batch, fields);
        count += batch.length;
        batch = [];
        progress?.(count);
      };
      for (const input of source) {
        let data: RecordData;
        try {
          data = prepareEntryData(input, rules);
          await validateRelationTargets(s, collection, fields, data);
        } catch (e) {
          if (e instanceof FieldError) throw new RowError(count + batch.length + 2, e.field, e.code);
          throw e;
        }
        const now = new Date(),
          time = now.toISOString();
        clock = nextHlc(this.deviceId, now.getTime(), clock);
        batch.push({
          id: crypto.randomUUID(),
          hlc: clock,
          device_id: this.deviceId,
          deleted_at: null,
          created_at: time,
          updated_at: time,
          collection_id: collectionId,
          data: canonical(data),
          created_local: localTimestamp(now),
          updated_local: localTimestamp(now),
          purged: 0,
          sort_data: '{}',
          sort_version: 0,
          search_data: '{}',
        });
        if (batch.length === 60) await flush();
      }
      await flush();
      if (count)
        await s.execute(
          "INSERT INTO local_settings VALUES('hlc',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          [clock!]
        );
      return count;
    });
  }
  async getEntry(id: string): Promise<Entry | null> {
    requireId(id);
    return this.db.read(async (s) => {
      const [row] = await s.query<StoredEntry>('SELECT r.* ' + activeRecords + ' AND r.id=?', [id]);
      return row ? decodeEntry(row) : null;
    });
  }
  async listEntries(collectionId: string, cursor?: Page<Entry>['next'], limit = 100): Promise<Page<Entry>> {
    requireId(collectionId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new AppError('invalidLimit');
    return this.db.read(async (s) => {
      const params: SqlValue[] = [collectionId];
      const clause = cursor ? 'AND (r.updated_at < ? OR (r.updated_at = ? AND r.id < ?))' : '';
      if (cursor) params.push(cursor.updated_at, cursor.updated_at, cursor.id);
      params.push(limit + 1);
      const rows = await s.query<StoredEntry>(
        `SELECT r.* ${activeRecords} AND r.collection_id=? ${clause} ORDER BY r.updated_at DESC,r.id DESC LIMIT ?`,
        params
      );
      const items = rows.slice(0, limit).map(decodeEntry),
        last = items.at(-1);
      return {
        items,
        next: rows.length > limit && last ? { updated_at: last.updated_at, id: last.id } : null,
      };
    });
  }
  async getUiConfig(collectionId: string, kind: UiKind): Promise<UiDefinition> {
    requireId(collectionId);
    return this.db.read(async (s) => {
      await activeCollection(s, collectionId);
      const [row] = await s.query<UiConfiguration>(
        'SELECT * FROM ui_configs WHERE collection_id=? AND kind=? AND deleted_at IS NULL',
        [collectionId, kind]
      );
      const definition = row ? (JSON.parse(row.config) as UiDefinition) : { fields: [] };
      const fields = await s.query<{ id: string }>(
        'SELECT id FROM fields WHERE collection_id=? AND deleted_at IS NULL',
        [collectionId]
      );
      const ids = new Set(fields.map((f) => f.id));
      definition.fields = definition.fields.filter((item) => ids.has(item.field_id));
      if (definition.list) {
        if (
          definition.list.sort_field &&
          definition.list.sort_field !== 'updated_at' &&
          !ids.has(definition.list.sort_field)
        )
          delete definition.list.sort_field;
        if (definition.list.group_field && !ids.has(definition.list.group_field))
          delete definition.list.group_field;
        if (definition.list.filters)
          definition.list.filters = definition.list.filters.filter((f) => ids.has(f.field_id));
      }
      return definition;
    });
  }
  async saveUiConfig(collectionId: string, kind: UiKind, definition: UiDefinition): Promise<void> {
    requireId(collectionId);
    if (!['form', 'card', 'list'].includes(kind)) throw new AppError('invalidData');
    await this.db.transaction(async (s) => {
      const collection = await activeCollection(s, collectionId);
      const fields = await s.query<Field>(
        'SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL',
        [collectionId]
      );
      validateUiDefinition(definition, kind, fields, collection.primary_field_id);
      const [old] = await s.query<UiConfiguration>(
        'SELECT * FROM ui_configs WHERE collection_id=? AND kind=?',
        [collectionId, kind]
      );
      const config = canonical(definition as unknown as JsonValue);
      if (old) await this.update(s, 'ui_configs', 'ui_config', old, { config, deleted_at: null });
      else {
        const row: UiConfiguration = { ...(await this.stamp(s)), collection_id: collectionId, kind, config };
        await this.insert(s, 'ui_configs', row);
        await this.log(s, 'ui_config', row, row);
      }
      await this.indexesInSession(s, collectionId);
    });
  }
  /** Resumable local cache rebuild; each transaction handles at most 200 records. */
  async rebuildDerived(): Promise<void> {
    for (;;) {
      const count = await this.db.transaction(async (s) => {
        const rows = await s.query<StoredEntry>(
          'SELECT * FROM records WHERE sort_version=0 ORDER BY id LIMIT 200'
        );
        if (!rows.length) return 0;
        await this.refreshRecords(s, rows);
        return rows.length;
      });
      if (!count) break;
    }
  }
  private async refreshRecords(
    s: SqlSession,
    rows: readonly StoredEntry[],
    knownFields?: Field[]
  ): Promise<void> {
    if (!rows.length) return;
    const fieldsByCollection = new Map<string, Field[]>();
    if (knownFields && rows[0]) fieldsByCollection.set(rows[0].collection_id, knownFields);
    const params: SqlValue[] = [],
      searchParams: SqlValue[] = [],
      ids = rows.map((row) => row.id),
      marks = ids.map(() => '?').join(',');
    for (const row of rows) {
      let fields = fieldsByCollection.get(row.collection_id);
      if (!fields) {
        fields = await s.query<Field>('SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL', [
          row.collection_id,
        ]);
        fieldsByCollection.set(row.collection_id, fields);
      }
      const data = JSON.parse(row.data) as RecordData;
      params.push(row.id, canonical(sortData(data, fields)));
      searchParams.push(
        row.id,
        canonical(
          Object.fromEntries(
            fields
              .filter((f) => typeof data[f.id] === 'string')
              .map((f) => [f.id, String(data[f.id]).normalize('NFKC').toLocaleLowerCase('ru-RU')])
          )
        )
      );
    }
    await s.execute(
      `UPDATE records SET sort_data=CASE id ${ids.map(() => 'WHEN ? THEN ?').join(' ')} END,sort_version=1 WHERE id IN(${marks})`,
      [...params, ...ids]
    );
    await s.execute(
      `UPDATE records SET search_data=CASE id ${ids.map(() => 'WHEN ? THEN ?').join(' ')} END WHERE id IN(${marks})`,
      [...searchParams, ...ids]
    );
    await s.execute(
      `DELETE FROM records_fts WHERE rowid IN(SELECT id FROM search_documents WHERE record_id IN(${marks}))`,
      ids
    );
    await s.execute(`DELETE FROM search_documents WHERE record_id IN(${marks})`, ids);
    await s.execute(
      `INSERT INTO search_documents(record_id,field_id) SELECT r.id,f.id FROM records r
      JOIN fields f ON f.collection_id=r.collection_id JOIN collections c ON c.id=r.collection_id JOIN libraries l ON l.id=c.library_id
      WHERE r.id IN(${marks}) AND r.deleted_at IS NULL AND r.purged=0 AND f.deleted_at IS NULL AND c.deleted_at IS NULL AND l.deleted_at IS NULL
      AND f.type IN('text','multiline') AND json_extract(f.config,'$.fts') IS NOT 0 AND json_type(r.data,'$."'||f.id||'"')='text'`,
      ids
    );
    await s.execute(
      `INSERT INTO records_fts(rowid,record_id,field_id,body) SELECT d.id,d.record_id,d.field_id,json_extract(r.search_data,'$."'||d.field_id||'"')
      FROM search_documents d JOIN records r ON r.id=d.record_id WHERE d.record_id IN(${marks})`,
      ids
    );
    await refreshRelationRecords(s, ids);
  }
  listRelationSources(collectionId: string): Promise<RelationSource[]> {
    requireId(collectionId);
    return this.db.read((s) => relationSources(s, collectionId));
  }
  getRelationPage(
    recordId: string,
    fieldId: string,
    cursor?: RelationCursor | null,
    limit = 50
  ): Promise<RelationPage> {
    return this.db.read((s) => relationPage(s, recordId, fieldId, cursor, limit));
  }
  resolveRelationValues(fieldId: string, ids: readonly string[]): Promise<RelationItem[]> {
    return this.db.read((s) => resolveRelationValues(s, fieldId, ids));
  }
  async queryRelationTargets(
    fieldId: string,
    query: Pick<EntryQuery, 'search' | 'cursor' | 'limit'> = {}
  ): Promise<Page<EntryListItem>> {
    return this.db.read(async (s) => {
      const { field, forward } = await relationContext(s, fieldId);
      if (field.type !== 'relation' || !forward) throw new AppError('invalidRelation');
      const target = fieldConfig(field).target_collection_id!;
      await activeCollection(s, target);
      return queryEntries(s, {
        ...query,
        collection_id: target,
        filters: [],
        sort_field: 'updated_at',
        group_field: '',
        direction: 'desc',
        limit: query.limit ?? 50,
      });
    });
  }
  async getLinkedCollection(recordId: string, fieldId: string): Promise<Collection> {
    return this.db.read(async (s) => {
      const { field, collection, forward } = await relationContext(s, fieldId);
      if (!forward) throw new AppError('relationUnavailable');
      if (
        !(
          await s.query('SELECT r.id ' + activeRecords + ' AND r.id=? AND r.collection_id=?', [
            recordId,
            collection.id,
          ])
        )[0]
      )
        throw new AppError('notFound');
      return activeCollection(
        s,
        field.type === 'relation' ? fieldConfig(field).target_collection_id! : forward.collection_id
      );
    });
  }
  async createLinkedEntry(recordId: string, fieldId: string, data: RecordData): Promise<Entry> {
    requireId(recordId);
    validateData(data);
    return this.db.transaction(async (s) => {
      const { field, collection, forward } = await relationContext(s, fieldId);
      if (!forward) throw new AppError('relationUnavailable');
      const [stored] = await s.query<StoredEntry>(
        'SELECT r.* ' + activeRecords + ' AND r.id=? AND r.collection_id=?',
        [recordId, collection.id]
      );
      if (!stored) throw new AppError('notFound');
      const parent = decodeEntry(stored);
      if (field.type === 'backlink') {
        const config = fieldConfig(forward);
        return this.saveEntryInSession(s, forward.collection_id, {
          ...data,
          [forward.id]: config.multiple
            ? [...new Set([...relationIds(data[forward.id]), recordId])]
            : recordId,
        });
      }
      const config = fieldConfig(field);
      const created = await this.saveEntryInSession(s, config.target_collection_id!, data);
      await this.saveEntryInSession(
        s,
        collection.id,
        { [field.id]: config.multiple ? [...relationIds(parent.data[field.id]), created.id] : created.id },
        parent.id
      );
      return created;
    });
  }
  /** Restartable local cache rebuild. No user versions, HLC or change_log events. */
  async rebuildRelationIndex(force = true): Promise<void> {
    if (force) await this.db.transaction((s) => s.execute('UPDATE records SET relation_version=0'));
    for (;;) {
      const count = await this.db.transaction(async (s) => {
        const rows = await s.query<{ id: string }>(
          'SELECT id FROM records WHERE relation_version=0 ORDER BY id LIMIT 200'
        );
        await refreshRelationRecords(
          s,
          rows.map((row) => row.id)
        );
        return rows.length;
      });
      if (!count) break;
    }
  }
  async reconcileIndexes(collectionId: string): Promise<void> {
    return this.db.transaction((s) => this.indexesInSession(s, collectionId));
  }
  private async indexesInSession(s: SqlSession, collectionId: string): Promise<void> {
    const fields = await s.query<Field>('SELECT * FROM fields WHERE collection_id=?', [collectionId]);
    const [layout] = await s.query<UiConfiguration>(
      "SELECT * FROM ui_configs WHERE collection_id=? AND kind='list' AND deleted_at IS NULL",
      [collectionId]
    );
    const list = layout ? (JSON.parse(layout.config) as UiDefinition).list : undefined;
    const automatic = new Set([
      list?.sort_field,
      list?.group_field,
      ...(list?.filters?.map((f) => f.field_id) ?? []),
    ]);
    for (const field of fields) {
      if (
        !field.deleted_at &&
        !['relation', 'backlink'].includes(field.type) &&
        (fieldConfig(field).indexed || automatic.has(field.id))
      ) {
        await s.execute(
          `CREATE INDEX IF NOT EXISTS ${fieldIndexName(field.id)} ON records(collection_id,deleted_at,${fieldExpression(field)},id)`
        );
      } else await s.execute(`DROP INDEX IF EXISTS ${fieldIndexName(field.id)}`);
    }
  }
}
