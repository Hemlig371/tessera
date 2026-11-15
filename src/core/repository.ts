import { checkCancelled, yieldOperation, type OperationProgress } from './operations';
import { defaultAppearance, validateAppearance, type DeviceAppearance } from './device-appearance';
import { inboxMoveDefaults, validateInboxMapping, type InboxMapping } from './inbox-mapping';
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
  CreationChoice,
  CreationPreset,
  PresetDefinition,
  DisplayProfile,
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
  validateValue,
} from './validation';
import { fieldExpression, fieldIndexName, sortData } from './search-keys';
import { collectionCreationChoice, validateCreationChoice, validatePresetDefinition } from './creation-presets';
import { formConfig, validateUiDefinition } from './ui-definition';
import { readQuickForm, validateQuickForm } from './quick-forms';

type Table = 'libraries' | 'collections' | 'fields' | 'records' | 'ui_configs' | 'quick_forms' | 'display_profiles' | 'creation_presets';
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
  getDeviceAppearance(): Promise<DeviceAppearance> {
    return this.db.read(async s => {
      const [row] = await s.query<{ value: string }>("SELECT value FROM local_settings WHERE key='device_appearance'");
      return row ? validateAppearance(JSON.parse(row.value)) : { ...defaultAppearance };
    });
  }
  async saveDeviceAppearance(value: DeviceAppearance): Promise<DeviceAppearance> {
    const valid = validateAppearance(value);
    await this.db.transaction(s => s.execute("INSERT INTO local_settings VALUES('device_appearance',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [canonical({ ...valid })]));
    return valid;
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
      if (old.system_kind) throw new AppError('systemContainer');
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
      s.query<Library>('SELECT * FROM libraries WHERE deleted_at IS NULL AND system_kind IS NULL ORDER BY position,created_at,id')
    );
  }
  /** A hidden structural library keeps the single records table and its foreign keys intact. */
  async getInbox(): Promise<Collection> {
    return this.db.transaction(async (s) => {
      const [existing] = await s.query<Collection>("SELECT * FROM collections WHERE system_kind='inbox'");
      if (existing) {
        await activeCollection(s, existing.id);
        return existing;
      }
      const systemId = async (role: string) => {
        const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`tessera:${this.datasetId}:inbox:${role}`))).slice(0, 16);
        bytes[6] = (bytes[6]! & 15) | 128;
        bytes[8] = (bytes[8]! & 63) | 128;
        const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
        return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
      };
      const library: Library = { ...(await this.stamp(s, await systemId('library'))), name: 'inbox', config: '{}', position: 0, system_kind: 'inbox' };
      const fieldId = await systemId('content');
      const collection: Collection = { ...(await this.stamp(s, await systemId('collection'))), library_id: library.id, name: 'inbox',
        primary_field_id: fieldId, incoming_field_id: fieldId, config: '{}', position: 0, system_kind: 'inbox' };
      const field: Field = { ...(await this.stamp(s, fieldId)), collection_id: collection.id,
        name: 'content', type: 'multiline', config: '{"required":true,"fts":true}', position: 0 };
      await this.insert(s, 'libraries', library);
      await this.insert(s, 'collections', collection);
      await this.insert(s, 'fields', field);
      await this.log(s, 'library', library, library);
      await this.log(s, 'collection', collection, collection);
      await this.log(s, 'field', field, field);
      return collection;
    });
  }
  async previewInboxMove(id: string, collectionId: string, expectedHlc: string) {
    requireId(id); requireId(collectionId);
    return this.db.read(async s => {
      const [row] = await s.query<StoredEntry>('SELECT r.* ' + activeRecords + ' AND r.id=?', [id]);
      if (!row) throw new AppError('notFound');
      if (row.hlc !== expectedHlc) throw new AppError('staleRecord');
      const source = await activeCollection(s, row.collection_id), target = await activeCollection(s, collectionId);
      if (source.system_kind !== 'inbox' || target.system_kind) throw new AppError('invalidInboxMove');
      const fields = await s.query<Field>('SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL', [collectionId]);
      return inboxMoveDefaults(source, target, fields, decodeEntry(row).data);
    });
  }
  async inboxOriginal(entry: Entry): Promise<string | null> {
    return this.db.read(async s => {
      const [source] = await s.query<Collection>("SELECT * FROM collections WHERE system_kind='inbox'");
      const value = source && source.id !== entry.collection_id ? entry.data[source.incoming_field_id] : undefined;
      return typeof value === 'string' ? value : null;
    });
  }
  async moveInboxEntry(id: string, collectionId: string, input: RecordData, expectedHlc: string): Promise<Entry> {
    requireId(id);
    requireId(collectionId);
    validateData(input);
    return this.db.transaction(async (s) => {
      const [stored] = await s.query<StoredEntry>('SELECT r.* ' + activeRecords + ' AND r.id=?', [id]);
      if (!stored) throw new AppError('notFound');
      const previous = decodeEntry(stored);
      if (previous.hlc !== expectedHlc) throw new AppError('staleRecord');
      const source = await activeCollection(s, previous.collection_id);
      const target = await activeCollection(s, collectionId);
      if (source.system_kind !== 'inbox' || target.system_kind) throw new AppError('invalidInboxMove');
      const fields = await s.query<Field>('SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL ORDER BY position,id', [collectionId]);
      const [form] = await s.query<UiConfiguration>("SELECT * FROM ui_configs WHERE collection_id=? AND kind='form' AND deleted_at IS NULL", [collectionId]);
      const preview = inboxMoveDefaults(source, target, fields, previous.data);
      const data = prepareEntryData({ ...previous.data, ...preview.data, ...input, [source.incoming_field_id]: preview.original },
        entryRules(target, fields, form ? JSON.parse(form.config) as UiDefinition : { fields: [] }));
      await validateRelationTargets(s, target, fields, data);
      const stamp = await this.stamp(s, id);
      // Moving is not delete+create. Preserve all original dates and unknown values; HLC records the operation.
      const row: Entry = { ...previous, collection_id: collectionId, data, hlc: stamp.hlc, device_id: stamp.device_id };
      await this.persistEntry(s, row, true, fields, stamp.updated_at);
      return row;
    });
  }
  async createCollection(libraryId: string, value: string, primaryLabel: string): Promise<Collection> {
    requireId(libraryId);
    const name = nameValue(value),
      label = nameValue(primaryLabel);
    return this.db.transaction(async (s) => {
      if (!(await s.query('SELECT id FROM libraries WHERE id=? AND deleted_at IS NULL AND system_kind IS NULL', [libraryId]))[0])
        throw new AppError('notFound');
      const [order] = await s.query<{ n: number }>(
        'SELECT coalesce(max(position),-1)+1 AS n FROM collections WHERE library_id=?',
        [libraryId]
      );
      const fieldId = crypto.randomUUID(), profileId = crypto.randomUUID();
      const row: Collection = {
        ...(await this.stamp(s)),
        library_id: libraryId,
        name,
        primary_field_id: fieldId,
        incoming_field_id: fieldId,
        default_profile_id: profileId,
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
      const profile: DisplayProfile = { ...(await this.stamp(s, profileId)), collection_id: row.id,
        name: 'Список', position: 0, config: '{"fields":[],"list":{"mode":"rows"}}' };
      await this.insert(s, 'display_profiles', profile);
      await this.log(s, 'collection', row, row);
      await this.log(s, 'field', field, field);
      await this.log(s, 'display_profile', profile, profile);
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
      inbox_mapping?: InboxMapping | null;
    }
  ): Promise<Collection> {
    requireId(id);
    return this.db.transaction(async (s) => {
      const old = await activeCollection(s, id);
      if (old.system_kind) throw new AppError('systemContainer');
      for (const fieldId of [patch.primary_field_id, patch.incoming_field_id]) {
        if (fieldId) {
          requireId(fieldId);
          if (
            !(
              await s.query(
                "SELECT id FROM fields WHERE id=? AND collection_id=? AND type IN('text','multiline','markdown') AND deleted_at IS NULL",
                [fieldId, id]
              )
            )[0]
          )
            throw new AppError('invalidPrimaryField');
        }
      }
      if (patch.inbox_mapping) validateInboxMapping(patch.inbox_mapping, await s.query<Field>('SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL', [id]));
      return this.update(s, 'collections', 'collection', old, {
        ...(patch.name != null ? { name: nameValue(patch.name) } : {}),
        ...(patch.position != null ? { position: positionValue(patch.position) } : {}),
        ...(patch.appearance != null || Object.hasOwn(patch, 'inbox_mapping')
          ? { config: canonical({ ...JSON.parse(old.config), ...(patch.appearance ? appearanceValue(patch.appearance) : {}),
            ...(Object.hasOwn(patch, 'inbox_mapping') ? { inbox_mapping: patch.inbox_mapping ?? null } : {}) }) }
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
      if (parent.system_kind) throw new AppError('systemContainer');
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
      if (parent.system_kind) throw new AppError('systemContainer');
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
    ] as Exclude<Table, 'ui_configs' | 'quick_forms'>;
    const collectionId = await this.db.transaction(async (s) => {
      const [stored] = await s.query<Library | Collection | Field | StoredEntry>(
        `SELECT * FROM ${table} WHERE id=?`,
        [id]
      );
      if (!stored) throw new AppError('notFound');
      if (kind === 'library' || kind === 'collection') {
        if ((stored as Library | Collection).system_kind) throw new AppError('systemContainer');
      }
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
  async saveEntry(collectionId: string, data: RecordData): Promise<Entry>;
  async saveEntry(collectionId: string, data: RecordData, id: string, expectedHlc: string): Promise<Entry>;
  async saveEntry(collectionId: string, data: RecordData, id?: string, expectedHlc?: string): Promise<Entry> {
    requireId(collectionId);
    if (id) requireId(id);
    if (id && !expectedHlc) throw new AppError('staleRecord');
    validateData(data);
    return this.db.transaction((s) => this.saveEntryInSession(s, collectionId, data, id, undefined, expectedHlc));
  }
  /** A draft may reserve a UUID without inserting anything. Retrying a completed create never duplicates it. */
  async saveNewEntry(collectionId: string, data: RecordData, createId: string): Promise<Entry> {
    requireId(collectionId); requireId(createId); validateData(data);
    return this.db.transaction(s => this.newEntryInSession(s, collectionId, data, createId));
  }
  private async newEntryInSession(s: SqlSession, collectionId: string, data: RecordData, createId?: string): Promise<Entry> {
    await activeCollection(s, collectionId);
    if (createId) {
      requireId(createId);
      const [old] = await s.query<StoredEntry>('SELECT * FROM records WHERE id=?', [createId]);
      if (old) {
        if (old.collection_id !== collectionId || old.deleted_at || old.purged) throw new AppError('staleRecord');
        return decodeEntry(old);
      }
    }
    return this.saveEntryInSession(s, collectionId, data, undefined, createId);
  }
  async saveEntryInSession(
    s: SqlSession,
    collectionId: string,
    data: RecordData,
    id?: string,
    createId?: string,
    expectedHlc?: string
  ): Promise<Entry> {
    requireId(collectionId);
    if (id) requireId(id);
    if (createId) requireId(createId);
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
    if (previous && expectedHlc !== undefined && previous.hlc !== expectedHlc) throw new AppError('staleRecord');
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
    const stamp = await this.stamp(s, id ?? createId),
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
    await this.persistEntry(s, row, !!previous, fields);
    return row;
  }
  private async persistEntry(s: SqlSession, row: Entry, exists: boolean, fields: Field[], savedAt = row.updated_at): Promise<void> {
    const encoded = canonical(row.data);
    if (exists)
      await s.execute(
        'UPDATE records SET collection_id=?,data=?,updated_at=?,updated_local=?,hlc=?,device_id=?,sort_version=0 WHERE id=?',
        [row.collection_id, encoded, row.updated_at, row.updated_local, row.hlc, this.deviceId, row.id]
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
      saved_at: savedAt,
      snapshot: { ...row },
    };
    await s.execute('INSERT INTO record_versions VALUES(?,?,?,?,?,?)', [
      version.id,
      row.id,
      row.hlc,
      this.deviceId,
      savedAt,
      canonical(version.snapshot),
    ]);
    await this.log(s, 'record', row, row);
    await this.log(s, 'record_version', { ...row, id: version.id }, version);
    await this.refreshRecords(
      s,
      [{ ...row, data: encoded, sort_data: '{}', sort_version: 0, search_data: '{}' }],
      fields
    );
  }
  queryEntries(query: EntryQuery): Promise<Page<EntryListItem>> {
    return this.db.read((s) => queryEntries(s, query));
  }
  async previewImport(
    collectionId: string,
    source: Iterable<RecordData>,
    progress?: OperationProgress,
    signal?: AbortSignal
  ): Promise<{ count: number; preview: RecordData[] }> {
    requireId(collectionId); checkCancelled(signal);
    return this.db.read(async (s) => {
      checkCancelled(signal);
      const collection = await activeCollection(s, collectionId);
      if (collection.system_kind) throw new AppError('systemContainer');
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
        checkCancelled(signal);
        try {
          const data = prepareEntryData(input, rules);
          await validateRelationTargets(s, collection, fields, data);
          if (preview.length < 10) preview.push(data);
        } catch (e) {
          if (e instanceof FieldError) throw new RowError(count + 2, e.field, e.code);
          throw e;
        }
        count++;
        if (count % 500 === 0) { progress?.(count, 'processing'); await yieldOperation(); }
      }
      checkCancelled(signal); progress?.(count, 'processing'); return { count, preview };
    });
  }
  /** One atomic import, bounded bridge batches; identical field/form rules to explicit save. */
  async importEntries(
    collectionId: string,
    source: Iterable<RecordData>,
    progress?: OperationProgress,
    signal?: AbortSignal
  ): Promise<number> {
    requireId(collectionId); checkCancelled(signal);
    return this.db.transaction(async (s) => {
      checkCancelled(signal);
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
        checkCancelled(signal); if (!batch.length) return;
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
        progress?.(count, 'processing');
        if (progress || signal) await yieldOperation();
        checkCancelled(signal);
      };
      for (const input of source) {
        checkCancelled(signal);
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
      checkCancelled(signal); progress?.(count, 'committing'); checkCancelled(signal);
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
  async getDraftTarget(id: string): Promise<Entry | null> {
    requireId(id);
    return this.db.read(async s => {
      const [row] = await s.query<StoredEntry>('SELECT * FROM records WHERE id=?', [id]);
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
  async listCreationPresets(collectionId: string): Promise<CreationPreset[]> {
    requireId(collectionId);
    return this.db.read(async s => {
      await activeCollection(s, collectionId);
      return s.query<CreationPreset>('SELECT * FROM creation_presets WHERE collection_id=? AND deleted_at IS NULL ORDER BY position,created_at,id', [collectionId]);
    });
  }
  async setCreationChoice(collectionId: string, choice: CreationChoice): Promise<void> {
    requireId(collectionId); validateCreationChoice(choice);
    await this.db.transaction(async s => {
      const parent = await activeCollection(s, collectionId);
      if (parent.system_kind) throw new AppError('systemContainer');
      if (choice.kind === 'preset' && !(await s.query('SELECT id FROM creation_presets WHERE id=? AND collection_id=? AND deleted_at IS NULL', [choice.preset_id, collectionId])).length) throw new AppError('invalidPreset');
      await this.update(s, 'collections', 'collection', parent, { config: canonical({ ...JSON.parse(parent.config), creation: choice }) });
    });
  }
  async createCreationPreset(collectionId: string, value: string, definition: PresetDefinition, makeDefault = false, position?: number): Promise<CreationPreset> {
    requireId(collectionId); const name = nameValue(value);
    return this.db.transaction(async s => {
      const { collection, fields, form } = await this.quickContext(s, collectionId);
      validatePresetDefinition(definition, fields, form, collection.primary_field_id);
      const [order] = await s.query<{ n: number }>('SELECT coalesce(max(position),-1)+1 AS n FROM creation_presets WHERE collection_id=?', [collectionId]);
      const row: CreationPreset = { ...(await this.stamp(s)), collection_id: collectionId, name, position: position == null ? order!.n : positionValue(position), config: canonical(definition as unknown as JsonValue) };
      await this.insert(s, 'creation_presets', row); await this.log(s, 'creation_preset', row, row);
      if (makeDefault) await this.update(s, 'collections', 'collection', collection, { config: canonical({ ...JSON.parse(collection.config), creation: { kind: 'preset', preset_id: row.id } }) });
      return row;
    });
  }
  async updateCreationPreset(id: string, patch: { name?: string; position?: number; definition?: PresetDefinition; make_default?: boolean }): Promise<CreationPreset> {
    requireId(id);
    return this.db.transaction(async s => {
      const [old] = await s.query<CreationPreset>('SELECT * FROM creation_presets WHERE id=? AND deleted_at IS NULL', [id]);
      if (!old) throw new AppError('notFound');
      const { collection, fields, form } = await this.quickContext(s, old.collection_id);
      if (patch.definition) validatePresetDefinition(patch.definition, fields, form, collection.primary_field_id);
      const row = await this.update(s, 'creation_presets', 'creation_preset', old, {
        ...(patch.name != null ? { name: nameValue(patch.name) } : {}),
        ...(patch.position != null ? { position: positionValue(patch.position) } : {}),
        ...(patch.definition ? { config: canonical(patch.definition as unknown as JsonValue) } : {}),
      });
      if (patch.make_default) await this.update(s, 'collections', 'collection', collection, { config: canonical({ ...JSON.parse(collection.config), creation: { kind: 'preset', preset_id: id } }) });
      return row;
    });
  }
  async deleteCreationPreset(id: string): Promise<void> {
    requireId(id);
    await this.db.transaction(async s => {
      const [old] = await s.query<CreationPreset>('SELECT * FROM creation_presets WHERE id=? AND deleted_at IS NULL', [id]);
      if (!old) throw new AppError('notFound');
      const parent = await activeCollection(s, old.collection_id);
      if (parent.system_kind) throw new AppError('systemContainer');
      const choice = collectionCreationChoice(parent.config);
      if (choice.kind === 'preset' && choice.preset_id === id) await this.update(s, 'collections', 'collection', parent, { config: canonical({ ...JSON.parse(parent.config), creation: { kind: 'standard' } }) });
      await this.update(s, 'creation_presets', 'creation_preset', old, { deleted_at: new Date().toISOString() });
    });
  }
  async resolveCreation(collectionId: string, input?: CreationChoice, now = new Date()): Promise<{ form: 'standard' | 'quick'; data: RecordData }> {
    requireId(collectionId);
    return this.db.read(async s => {
      const { collection, fields, form } = await this.quickContext(s, collectionId);
      const choice = input ?? collectionCreationChoice(collection.config); validateCreationChoice(choice);
      if (choice.kind !== 'preset') return { form: choice.kind, data: {} };
      const [row] = await s.query<CreationPreset>('SELECT * FROM creation_presets WHERE id=? AND collection_id=? AND deleted_at IS NULL', [choice.preset_id, collectionId]);
      if (!row) throw new AppError('invalidPreset');
      const definition = JSON.parse(row.config) as PresetDefinition;
      validatePresetDefinition(definition, fields, form, collection.primary_field_id);
      const data: RecordData = { ...definition.data };
      for (const id of definition.today_fields) data[id] = localTimestamp(now).slice(0, 10);
      for (const id of Object.keys(data)) {
        const field = fields.find(field => field.id === id)!;
        validateValue(field.type, data[id], formConfig(field, form.fields.find(item => item.field_id === id)), field.id === collection.primary_field_id);
      }
      return { form: definition.form, data };
    });
  }
  async listDisplayProfiles(collectionId: string): Promise<DisplayProfile[]> {
    requireId(collectionId);
    return this.db.read(async s => {
      await activeCollection(s, collectionId);
      return s.query<DisplayProfile>('SELECT * FROM display_profiles WHERE collection_id=? AND deleted_at IS NULL ORDER BY position,created_at,id', [collectionId]);
    });
  }
  async createDisplayProfile(collectionId: string, value: string, definition: UiDefinition = { fields: [], list: { mode: 'rows' } }): Promise<DisplayProfile> {
    requireId(collectionId); const name = nameValue(value);
    return this.db.transaction(async s => {
      const parent = await activeCollection(s, collectionId);
      if (parent.system_kind) throw new AppError('systemContainer');
      const fields = await s.query<Field>('SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL', [collectionId]);
      validateUiDefinition(definition, 'list', fields, parent.primary_field_id);
      const [order] = await s.query<{ n: number }>('SELECT coalesce(max(position),-1)+1 AS n FROM display_profiles WHERE collection_id=?', [collectionId]);
      const row: DisplayProfile = { ...(await this.stamp(s)), collection_id: collectionId, name, position: order!.n, config: canonical(definition as unknown as JsonValue) };
      await this.insert(s, 'display_profiles', row); await this.log(s, 'display_profile', row, row);
      await this.indexesInSession(s, collectionId); return row;
    });
  }
  async updateDisplayProfile(id: string, patch: { name?: string; position?: number; definition?: UiDefinition; make_default?: boolean }): Promise<DisplayProfile> {
    requireId(id);
    return this.db.transaction(async s => {
      const [old] = await s.query<DisplayProfile>('SELECT * FROM display_profiles WHERE id=? AND deleted_at IS NULL', [id]);
      if (!old) throw new AppError('notFound');
      const parent = await activeCollection(s, old.collection_id);
      if (parent.system_kind) throw new AppError('systemContainer');
      if (patch.definition) {
        const fields = await s.query<Field>('SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL', [parent.id]);
        validateUiDefinition(patch.definition, 'list', fields, parent.primary_field_id);
      }
      const row = await this.update(s, 'display_profiles', 'display_profile', old, {
        ...(patch.name != null ? { name: nameValue(patch.name) } : {}),
        ...(patch.position != null ? { position: positionValue(patch.position) } : {}),
        ...(patch.definition ? { config: canonical(patch.definition as unknown as JsonValue) } : {}),
      });
      if (patch.make_default) await this.update(s, 'collections', 'collection', parent, { default_profile_id: id });
      await this.indexesInSession(s, parent.id); return row;
    });
  }
  async deleteDisplayProfile(id: string): Promise<void> {
    requireId(id);
    await this.db.transaction(async s => {
      const [old] = await s.query<DisplayProfile>('SELECT * FROM display_profiles WHERE id=? AND deleted_at IS NULL', [id]);
      if (!old) throw new AppError('notFound');
      const parent = await activeCollection(s, old.collection_id);
      if (parent.system_kind) throw new AppError('systemContainer');
      const [next] = await s.query<DisplayProfile>('SELECT * FROM display_profiles WHERE collection_id=? AND id<>? AND deleted_at IS NULL ORDER BY position,created_at,id LIMIT 1', [parent.id, id]);
      if (!next) throw new AppError('lastProfile');
      if (parent.default_profile_id === id) await this.update(s, 'collections', 'collection', parent, { default_profile_id: next.id });
      await this.update(s, 'display_profiles', 'display_profile', old, { deleted_at: new Date().toISOString() });
      await this.indexesInSession(s, parent.id);
    });
  }
  async getUiConfig(collectionId: string, kind: UiKind, profileId?: string): Promise<UiDefinition> {
    requireId(collectionId);
    return this.db.read(async (s) => {
      await activeCollection(s, collectionId);
      if (profileId) requireId(profileId);
      const [row] = kind === 'list'
        ? await s.query<DisplayProfile>(`SELECT p.* FROM display_profiles p JOIN collections c ON c.id=p.collection_id
          WHERE p.collection_id=? AND p.deleted_at IS NULL AND p.id=coalesce(?,c.default_profile_id)`, [collectionId, profileId ?? null])
        : await s.query<UiConfiguration>('SELECT * FROM ui_configs WHERE collection_id=? AND kind=? AND deleted_at IS NULL', [collectionId, kind]);
      if (profileId && !row) throw new AppError('notFound');
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
    if (kind === 'list') {
      const parent = await this.getCollection(collectionId);
      if (!parent.default_profile_id) throw new AppError('notFound');
      await this.updateDisplayProfile(parent.default_profile_id, { definition }); return;
    }
    await this.db.transaction(async (s) => {
      const collection = await activeCollection(s, collectionId);
      if (collection.system_kind) throw new AppError('systemContainer');
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
  private async quickContext(s: SqlSession, collectionId: string, allowSystem = false) {
    const collection = await activeCollection(s, collectionId);
    if (collection.system_kind && !allowSystem) throw new AppError('systemContainer');
    const fields = await s.query<Field>('SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL ORDER BY position,id', [collectionId]);
    const [stored] = await s.query<{ config: string }>("SELECT config FROM ui_configs WHERE collection_id=? AND kind='form' AND deleted_at IS NULL", [collectionId]);
    const form: UiDefinition = stored ? JSON.parse(stored.config) as UiDefinition : { fields: [] };
    return { collection, fields, form };
  }
  async getQuickForm(collectionId: string): Promise<UiDefinition> {
    requireId(collectionId);
    return this.db.read(async s => {
      const { collection, fields, form } = await this.quickContext(s, collectionId, true);
      if (collection.system_kind) return { fields: [] };
      return readQuickForm(s, collection, fields, form);
    });
  }
  async saveQuickForm(collectionId: string, definition: UiDefinition): Promise<void> {
    requireId(collectionId);
    await this.db.transaction(async s => {
      const { collection, fields, form } = await this.quickContext(s, collectionId);
      validateQuickForm(definition, collection, fields, form);
      const config = canonical(definition as unknown as JsonValue);
      const [old] = await s.query<Stamp & { collection_id: string; kind: 'quick'; config: string }>('SELECT * FROM quick_forms WHERE collection_id=?', [collectionId]);
      if (old) await this.update(s, 'quick_forms', 'ui_config', old, { config, deleted_at: null });
      else {
        const row = { ...(await this.stamp(s)), collection_id: collectionId, kind: 'quick', config };
        await this.insert(s, 'quick_forms', row);
        await this.log(s, 'ui_config', row, row);
      }
    });
  }
  async saveQuickEntry(collectionId: string, data: RecordData, createId?: string): Promise<Entry> {
    requireId(collectionId);
    validateData(data);
    return this.db.transaction(async s => {
      const { collection, fields, form } = await this.quickContext(s, collectionId);
      validateQuickForm(await readQuickForm(s, collection, fields, form), collection, fields, form);
      return this.newEntryInSession(s, collectionId, data, createId);
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
      AND f.type IN('text','multiline','markdown') AND json_extract(f.config,'$.fts') IS NOT 0 AND json_type(r.data,'$."'||f.id||'"')='text'`,
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
  async createLinkedEntry(recordId: string, fieldId: string, data: RecordData, createId?: string): Promise<Entry> {
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
        return this.newEntryInSession(s, forward.collection_id, {
          ...data,
          [forward.id]: config.multiple
            ? [...new Set([...relationIds(data[forward.id]), recordId])]
            : recordId,
        }, createId);
      }
      const config = fieldConfig(field);
      await activeCollection(s, config.target_collection_id!);
      if (createId) {
        requireId(createId);
        const [old] = await s.query<StoredEntry>('SELECT * FROM records WHERE id=?', [createId]);
        if (old) {
          if (old.collection_id !== config.target_collection_id || old.deleted_at || old.purged) throw new AppError('staleRecord');
          return decodeEntry(old);
        }
      }
      const created = await this.newEntryInSession(s, config.target_collection_id!, data, createId);
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
    const profiles = await s.query<DisplayProfile>('SELECT * FROM display_profiles WHERE collection_id=? AND deleted_at IS NULL', [collectionId]);
    const automatic = new Set(profiles.flatMap(profile => {
      const list = (JSON.parse(profile.config) as UiDefinition).list;
      return [list?.sort_field, list?.group_field, ...(list?.filters?.map(filter => filter.field_id) ?? [])];
    }));
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
