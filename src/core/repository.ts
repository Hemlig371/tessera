import { attachmentLimit, attachmentRow, bindAttachments, mediaReferences, encodeAttachmentSetting, exportFileName, fileChunkSize, fileIds, isFile, purgeAttachments, validateFileFacts, validateFileSource, type Attachment, type AttachmentView, type ByteSource, type StagedAttachment } from './attachments';
import { checkCancelled, yieldOperation, type OperationProgress } from './operations';
import { libraryNavigation, navigationLibrary, resolveLibraryStart, validLibraryLocation, validateLibraryNavigation, type LibraryLocation, type LibraryNavigation } from './library-navigation';
import { applyHistoryClear, readHistory, trimHistory, type HistoryClear, type HistoryState } from './history';
import { acknowledgeChanges, activateJournal, compactChanges, detachJournal, journalCheckpoint, journalEnabled, pauseJournal, readChanges, syncMode, type JournalCheckpoint } from './change-journal';
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
import { assertHlc, nextHlc } from './hlc';
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
import type { BinaryFileAdapter, DatabaseAdapter, SqlSession, SqlValue } from './ports';
import {
  appearanceValue,
  isText,
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
import { isUtcTimestamp, readRetention, validateRetention, type TrashRetention, type TrashCursor, type TrashPage } from './trash';

type Table = 'libraries' | 'collections' | 'fields' | 'records' | 'ui_configs' | 'quick_forms' | 'display_profiles' | 'creation_presets';
export class Repository {
  private attachmentCleanup: Promise<{ removed: number; pending: number }> | null = null;
  private constructor(
    readonly db: DatabaseAdapter,
    readonly deviceId: string,
    private currentDatasetId: string,
    private readonly files: BinaryFileAdapter | null
  ) {}
  get datasetId(): string { return this.currentDatasetId; }
  static async open(db: DatabaseAdapter, files: BinaryFileAdapter | null = null): Promise<Repository> {
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
    const repository = new Repository(db, ids.deviceId, ids.datasetId, files);
    await repository.recoverAttachmentStages();
    await repository.repairUiChangeTypes();
    await repository.prepareSearchKeys();
    await repository.compactHistory();
    await repository.cleanTrash();
    await repository.rebuildDerived();
    await repository.rebuildRelationIndex(false);
    return repository;
  }
  private filePort(): BinaryFileAdapter {
    if (!this.files) throw new AppError('nativeRequired');
    return this.files;
  }
  private async attachmentOwner(s: SqlSession, ownerId: string): Promise<void> {
    const [owner] = await s.query<{ purged: number; deleted_at: string | null }>('SELECT purged,deleted_at FROM records WHERE id=?', [ownerId]);
    if (owner && (owner.purged || owner.deleted_at)) throw new AppError('staleRecord');
  }
  async stageAttachment(collectionId: string, ownerId: string, source: ByteSource, progress?: OperationProgress, signal?: AbortSignal): Promise<StagedAttachment> {
    requireId(collectionId); requireId(ownerId); validateFileSource(source); checkCancelled(signal);
    const files = this.filePort(), id = crypto.randomUUID();
    const staged: StagedAttachment = { id, collection_id: collectionId, owner_id: ownerId, name: source.name,
      mime: source.mime.toLowerCase() || 'application/octet-stream', size: source.size, sha256: '', state: 'copying', created_at: new Date().toISOString() };
    await this.db.transaction(async s => {
      await activeCollection(s, collectionId); await this.attachmentOwner(s, ownerId);
      const columns = Object.keys(staged);
      await s.execute(`INSERT INTO attachment_staging(${columns.join(',')}) VALUES(${columns.map(() => '?').join(',')})`, Object.values(staged));
    });
    let complete = false;
    try {
      await files.begin(id);
      for (let offset = 0; offset < source.size;) {
        checkCancelled(signal);
        const count = Math.min(fileChunkSize, source.size - offset), bytes = await source.read(offset, count);
        if (!(bytes instanceof Uint8Array) || bytes.length !== count) throw new AppError('fileCorrupt');
        checkCancelled(signal); await files.write(id, offset, bytes); offset += count;
        progress?.(offset, 'processing'); await yieldOperation();
      }
      checkCancelled(signal); progress?.(source.size, 'committing');
      const facts = await files.finish(id, source.size); validateFileFacts(facts); checkCancelled(signal);
      if (facts.size !== source.size) throw new AppError('fileCorrupt');
      await this.db.transaction(async s => {
        await activeCollection(s, collectionId); await this.attachmentOwner(s, ownerId);
        if ((await s.query('SELECT id FROM attachment_gc WHERE id=?', [id])).length || !(await s.query('SELECT id FROM attachment_staging WHERE id=?', [id])).length) throw new AppError('operationCancelled');
        await s.execute("UPDATE attachment_staging SET state='ready',sha256=? WHERE id=?", [facts.sha256, id]);
      });
      complete = true; return { ...staged, ...facts, state: 'ready' };
    } finally {
      if (!complete) {
        await this.db.transaction(s => s.execute('INSERT INTO attachment_gc(id,staged) VALUES(?,1) ON CONFLICT(id) DO NOTHING', [id]));
        await this.collectAttachmentFiles();
      }
    }
  }
  /** Recover a fully published file if the process died before its local metadata commit. Never expose a partial file. */
  private async recoverAttachmentStages(): Promise<void> {
    if (!this.files) return;
    let after = '';
    for (;;) {
      const rows = await this.db.read(s => s.query<StagedAttachment>("SELECT * FROM attachment_staging WHERE state='copying' AND id>? ORDER BY id LIMIT 50", [after]));
      if (!rows.length) break;
      for (const row of rows) {
        if ((await this.db.read(s => s.query('SELECT id FROM attachment_gc WHERE id=?', [row.id]))).length) continue;
        const facts = await this.files.inspect(row.id);
        if (facts && facts.size === row.size) {
          validateFileFacts(facts);
          await this.db.transaction(s => s.execute("UPDATE attachment_staging SET state='ready',sha256=? WHERE id=? AND state='copying' AND NOT EXISTS(SELECT 1 FROM attachment_gc WHERE id=?)", [facts.sha256, row.id, row.id]));
        }
      }
      after = rows.at(-1)!.id;
    }
    after = '';
    for (;;) {
      const rows = await this.db.read(s => s.query<Attachment>("SELECT a.* FROM attachments a JOIN attachment_local l ON l.id=a.id WHERE l.state='copying' AND a.id>? ORDER BY a.id LIMIT 50", [after]));
      if (!rows.length) break;
      for (const row of rows) {
        if (row.purged) {
          await this.db.transaction(async s => {
            await s.execute('INSERT INTO attachment_gc VALUES(?,1) ON CONFLICT(id) DO UPDATE SET staged=1', [row.id]);
            await s.execute("UPDATE attachment_local SET state='deleting' WHERE id=?", [row.id]);
          });
          continue;
        }
        const facts = await this.files.inspect(row.id);
        const state = !facts ? 'missing' : facts.size === row.size && facts.sha256 === row.sha256 ? 'present' : 'corrupt';
        await this.db.transaction(async s => {
          if ((await s.query("SELECT id FROM attachment_local WHERE id=? AND state='copying' AND NOT EXISTS(SELECT 1 FROM attachment_gc WHERE id=?)", [row.id, row.id])).length) {
            await this.attachmentPresence(s, row.id, state === 'present', state);
          }
        });
      }
      after = rows.at(-1)!.id;
    }
  }
  async discardAttachmentStages(ownerId: string, keep: readonly string[] = []): Promise<void> {
    requireId(ownerId); keep.forEach(requireId); const retained = new Set(keep);
    if (!(await this.db.read(s => s.query('SELECT id FROM attachment_staging WHERE owner_id=? LIMIT 1', [ownerId]))).length) return;
    await this.db.transaction(async s => {
      const rows = await s.query<{ id: string }>('SELECT id FROM attachment_staging WHERE owner_id=?', [ownerId]);
      for (const row of rows) if (!retained.has(row.id)) await s.execute('INSERT INTO attachment_gc(id,staged) VALUES(?,1) ON CONFLICT(id) DO NOTHING', [row.id]);
    });
    await this.collectAttachmentFiles();
  }
  private async attachmentPresence(s: SqlSession, id: string, present: boolean, state: 'present' | 'missing' | 'corrupt' | 'deleting' | 'copying'): Promise<void> {
    const [meta] = await s.query<Attachment>('SELECT * FROM attachments WHERE id=?', [id]);
    if (!meta || (meta.purged && present)) return;
    const key = `${id}:${this.deviceId}`;
    const [old] = await s.query<{ present: number }>('SELECT present FROM attachment_locations WHERE id=?', [key]);
    if (!old || !!old.present !== present) {
      const stamp = await this.stamp(s, undefined, meta.hlc);
      const location = { id: key, attachment_id: id, device_id: this.deviceId, hlc: stamp.hlc, present: Number(present) };
      await s.execute('INSERT INTO attachment_locations(id,attachment_id,device_id,hlc,present) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET hlc=excluded.hlc,present=excluded.present', Object.values(location));
      await this.log(s, 'attachment_location', location, location);
    }
    await s.execute(`INSERT INTO attachment_local(id,state,verified_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET
      state=CASE WHEN attachment_local.state='copying' AND ?=1 THEN 'copying' ELSE excluded.state END,verified_at=excluded.verified_at`, [id, state, new Date().toISOString(), meta.purged]);
  }
  /** Persisted file-removal jobs bridge the SQLite/filesystem boundary and are safe to retry after a crash. */
  collectAttachmentFiles(): Promise<{ removed: number; pending: number }> {
    return this.attachmentCleanup ??= this.drainAttachmentFiles().finally(() => { this.attachmentCleanup = null; });
  }
  private async drainAttachmentFiles(): Promise<{ removed: number; pending: number }> {
    let removed = 0, after = '';
    if (this.files) for (;;) {
      const rows = await this.db.read(s => s.query<{ id: string; staged: number }>('SELECT * FROM attachment_gc WHERE id>? ORDER BY id LIMIT 50', [after]));
      for (const row of rows) {
        try {
          const attached = row.staged && (await this.db.read(s => s.query('SELECT id FROM attachments WHERE id=? AND purged=0', [row.id]))).length;
          if (!attached) {
            await this.files.remove(row.id, false);
            if (row.staged) await this.files.remove(row.id, true);
          }
          await this.db.transaction(async s => {
            if (row.staged) await s.execute('DELETE FROM attachment_staging WHERE id=?', [row.id]);
            if (!attached) await this.attachmentPresence(s, row.id, false, 'missing');
            await s.execute('DELETE FROM attachment_gc WHERE id=?', [row.id]);
          });
          removed++;
        } catch { /* Keep the durable job. A later foreground opportunity retries it; no successful byte removal is invented. */ }
      }
      if (rows.length < 50) break;
      after = rows.at(-1)!.id;
      await yieldOperation();
    }
    const [count] = await this.db.read(s => s.query<{ n: number }>('SELECT count(*) AS n FROM attachment_gc'));
    return { removed, pending: count!.n };
  }
  getAttachmentLimit(): Promise<number> { return this.db.read(attachmentLimit); }
  /** References retained after an Inbox move or field removal remain usable outside the current field layout. */
  unmappedAttachments(entry: Entry): Promise<string[]> {
    requireId(entry.id); requireId(entry.collection_id);
    return this.db.read(async s => {
      const fields = new Set((await s.query<{ id: string }>('SELECT id FROM fields WHERE collection_id=? AND deleted_at IS NULL', [entry.collection_id])).map(field => field.id));
      const unknown = await mediaReferences(s, Object.fromEntries(Object.entries(entry.data).filter(([id]) => !fields.has(id))));
      const rows = await s.query<{ id: string }>('SELECT id FROM attachments WHERE record_id=? AND purged=0 ORDER BY created_at,id', [entry.id]);
      return rows.filter(file => unknown.has(file.id)).map(file => file.id);
    });
  }
  saveAttachmentLimit(bytes: number): Promise<void> {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new AppError('invalidAttachmentLimit');
    return this.db.transaction(async s => {
      if (await attachmentLimit(s) === bytes) return;
      const stamp = await this.stamp(s), value = encodeAttachmentSetting(bytes, stamp);
      await s.execute("INSERT INTO app_meta VALUES('attachment:limit',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [value]);
      await this.log(s, 'app_setting', { ...stamp, id: 'attachment:limit' }, { key: 'attachment:limit', value });
    });
  }
  async getAttachmentView(id: string, ownerId: string, verify = false): Promise<AttachmentView> {
    const files = this.filePort();
    const context = await this.db.read(async s => {
      const rows = await attachmentRow(s, id, ownerId);
      const [owner] = await s.query<{ purged: number }>('SELECT purged FROM records WHERE id=?', [ownerId]);
      if (owner?.purged) throw new AppError('purgedRecord');
      const [local] = await s.query<{ state: AttachmentView['status'] }>('SELECT state FROM attachment_local WHERE id=?', [id]);
      const [others] = await s.query<{ n: number }>('SELECT count(*) AS n FROM attachment_locations WHERE attachment_id=? AND device_id<>? AND present=1', [id, this.deviceId]);
      const removing = (await s.query('SELECT id FROM attachment_gc WHERE id=?', [id])).length > 0;
      return { ...rows, local, others: others!.n, removing, limit: await attachmentLimit(s) };
    });
    const meta = context.attachment ?? context.staged!;
    let status: AttachmentView['status'];
    if (context.removing || context.local?.state === 'deleting') status = 'deleting';
    else if (context.staged?.state === 'copying' || context.local?.state === 'copying') status = 'copying';
    else {
      const size = await files.stat(id);
      status = size === null ? 'missing' : size !== meta.size ? 'corrupt' : 'present';
      if (verify && status === 'present') {
        const facts = await files.inspect(id);
        status = !facts ? 'missing' : facts.size !== meta.size || facts.sha256 !== meta.sha256 ? 'corrupt' : 'present';
      } else if (!verify && context.local?.state === 'corrupt' && status === 'present') status = 'corrupt';
      if (verify && context.attachment) await this.db.transaction(s => this.attachmentPresence(s, id, status === 'present', status as 'present' | 'missing' | 'corrupt'));
    }
    return { id, name: meta.name, mime: meta.mime, size: meta.size, sha256: meta.sha256, status, large: meta.size > context.limit, staged: !!context.staged, other_copies: context.others };
  }
  async exportAttachment(id: string, ownerId: string): Promise<boolean> {
    const view = await this.getAttachmentView(id, ownerId, true);
    if (view.status !== 'present') throw new AppError(view.status === 'corrupt' ? 'fileCorrupt' : 'fileMissing');
    return this.filePort().export(id, exportFileName(view.name), view.mime, view);
  }
  async readAttachmentPreview(id: string, ownerId: string): Promise<{ mime: string; bytes: Uint8Array }> {
    const view = await this.getAttachmentView(id, ownerId, true);
    if (view.status !== 'present') throw new AppError(view.status === 'corrupt' ? 'fileCorrupt' : 'fileMissing');
    if (!['image/png','image/jpeg','image/webp','image/gif','image/avif','image/bmp'].includes(view.mime) || view.size > 10 * 1024 * 1024) throw new AppError('previewUnavailable');
    const bytes = new Uint8Array(view.size), files = this.filePort();
    for (let offset = 0; offset < view.size;) {
      const length = Math.min(fileChunkSize, view.size - offset), chunk = await files.read(id, offset, length);
      if (chunk.length !== length) throw new AppError('fileCorrupt');
      bytes.set(chunk, offset); offset += length;
    }
    return { mime: view.mime, bytes };
  }
  async removeAttachmentCopy(id: string, ownerId: string, confirmLastCopy = false): Promise<void> {
    requireId(id); requireId(ownerId); this.filePort();
    await this.db.transaction(async s => {
      const { attachment } = await attachmentRow(s, id, ownerId);
      if (!attachment) throw new AppError('invalidAttachment');
      const [others] = await s.query<{ n: number }>('SELECT count(*) AS n FROM attachment_locations WHERE attachment_id=? AND device_id<>? AND present=1', [id, this.deviceId]);
      if (!others!.n && !confirmLastCopy) throw new AppError('lastAttachmentCopy');
      await this.attachmentPresence(s, id, false, 'deleting');
      await s.execute('INSERT INTO attachment_gc(id,staged) VALUES(?,0) ON CONFLICT(id) DO NOTHING', [id]);
    });
    const result = await this.collectAttachmentFiles();
    if (result.pending) throw new AppError('attachmentCleanup');
  }
  async restoreAttachmentCopy(id: string, ownerId: string, source: ByteSource, progress?: OperationProgress, signal?: AbortSignal): Promise<void> {
    validateFileSource(source); const files = this.filePort();
    const { attachment } = await this.db.read(s => attachmentRow(s, id, ownerId));
    if (!attachment || source.size !== attachment.size) throw new AppError('fileCorrupt');
    if (await files.stat(id) !== null) throw new AppError('fileExists');
    await this.db.transaction(async s => {
      await this.attachmentOwner(s, ownerId);
      if ((await s.query('SELECT id FROM attachment_gc WHERE id=?', [id])).length) throw new AppError('attachmentCleanup');
      await s.execute("INSERT INTO attachment_local(id,state) VALUES(?,'copying') ON CONFLICT(id) DO UPDATE SET state='copying'", [id]);
    });
    let published = false;
    try {
      await files.remove(id, true); await files.begin(id);
      for (let offset = 0; offset < source.size;) {
        checkCancelled(signal); const length = Math.min(fileChunkSize, source.size - offset), bytes = await source.read(offset, length);
        if (!(bytes instanceof Uint8Array) || bytes.length !== length) throw new AppError('fileCorrupt');
        checkCancelled(signal); await files.write(id, offset, bytes); offset += length; progress?.(offset, 'processing');
      }
      checkCancelled(signal); progress?.(source.size, 'committing');
      await files.finish(id, attachment.size, attachment.sha256);
      published = true;
      await this.db.transaction(async s => { await this.attachmentOwner(s, ownerId); await this.attachmentPresence(s, id, true, 'present'); });
    } finally {
      await files.remove(id, true);
      const missing = !published && await files.stat(id) === null;
      const purged = await this.db.transaction(async s => {
        const [meta] = await s.query<{ purged: number }>('SELECT purged FROM attachments WHERE id=?', [id]);
        if (meta?.purged) {
          // Purge may have drained its earlier job before this copy published its final file.
          await s.execute('INSERT INTO attachment_gc VALUES(?,0) ON CONFLICT(id) DO NOTHING', [id]);
          await s.execute("UPDATE attachment_local SET state='deleting' WHERE id=?", [id]);
          return true;
        }
        if (missing) await s.execute("UPDATE attachment_local SET state='missing' WHERE id=? AND state='copying'", [id]);
        return false;
      });
      if (purged) await this.collectAttachmentFiles();
    }
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
  private async stamp(s: SqlSession, id: string = crypto.randomUUID(), remote?: string): Promise<Stamp> {
    const [last] = await s.query<{ value: string }>("SELECT value FROM local_settings WHERE key='hlc'");
    const now = new Date(),
      hlc = nextHlc(this.deviceId, now.getTime(), last?.value, remote);
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
  private async log(s: SqlSession, entity: string, row: Pick<Stamp, 'id' | 'hlc' | 'device_id'>, payload: object): Promise<void> {
    if (!await journalEnabled(s)) return;
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
  getSyncMode() { return this.db.read(s => syncMode(s)); }
  /** Repair the old ambiguous transport label without losing events or changing their cursors/payloads. */
  private repairUiChangeTypes(): Promise<void> {
    return this.db.transaction(s => s.execute("UPDATE change_log SET entity_type='quick_form' WHERE entity_type='ui_config' AND json_extract(payload,'$.kind')='quick'"));
  }
  /** Foundation for local protocol tests. Enabling transport is a separate feature. */
  startLocalSync(): Promise<JournalCheckpoint> {
    return this.db.transaction(async s => {
      if (await syncMode(s) === 'active') return journalCheckpoint(s);
      await activateJournal(s);
      const tables = [
        ['libraries', 'library'], ['collections', 'collection'], ['fields', 'field'],
        ['ui_configs', 'ui_config'], ['quick_forms', 'quick_form'],
        ['display_profiles', 'display_profile'], ['creation_presets', 'creation_preset'],
        ['records', 'record'], ['record_versions', 'record_version'],
        ['attachments', 'attachment'], ['attachment_locations', 'attachment_location'],
      ] as const;
      for (const [table, entity] of tables) {
        let after = '';
        while (true) {
          const rows = await s.query<Stamp & { snapshot?: string }>(`SELECT * FROM ${table} WHERE id>? ORDER BY id LIMIT 100`, [after]);
          if (!rows.length) break;
          for (const row of rows) {
            const payload = table === 'records' ? decodeEntry(row as StoredEntry) :
              table === 'record_versions' ? { ...row, snapshot: JSON.parse(row.snapshot!) } : { ...row };
            await this.log(s, entity, row, payload);
          }
          after = rows.at(-1)!.id;
        }
      }
      const markers = await s.query<{ key: string; value: string }>("SELECT key,value FROM app_meta WHERE key LIKE 'history:%' OR key IN('trash:retention','attachment:limit') ORDER BY key");
      for (const marker of markers) {
        const hlc = marker.key.startsWith('history:clear:') ? marker.value : (JSON.parse(marker.value) as { hlc: string }).hlc;
        await this.log(s, ['trash:retention', 'attachment:limit'].includes(marker.key) ? 'app_setting' : 'history_marker', { id: marker.key, hlc, device_id: this.deviceId }, { ...marker });
      }
      return journalCheckpoint(s);
    });
  }
  pauseLocalSync(paused: boolean): Promise<void> { return this.db.transaction(s => pauseJournal(s, paused)); }
  async detachLocalSync(): Promise<void> {
    this.currentDatasetId = await this.db.transaction(s => detachJournal(s));
  }
  readLocalChanges(after: JournalCheckpoint, limit = 200) { return this.db.read(s => readChanges(s, after, limit)); }
  acknowledgeLocalChanges(peerId: string, checkpoint: JournalCheckpoint): Promise<void> {
    return this.db.transaction(s => acknowledgeChanges(s, peerId, checkpoint));
  }
  compactLocalChanges(): Promise<void> { return this.db.transaction(s => compactChanges(s)); }
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
  getLibraryNavigation(id: string): Promise<LibraryNavigation> {
    return this.db.read(async s => libraryNavigation(await navigationLibrary(s, id)));
  }
  saveLibraryNavigation(id: string, value: LibraryNavigation): Promise<void> {
    requireId(id); const navigation = validateLibraryNavigation(value);
    return this.db.transaction(async s => {
      const library = await navigationLibrary(s, id);
      if (navigation.start.kind !== 'last' && !await validLibraryLocation(s, id, navigation.start)) throw new AppError('invalidLibraryNavigation');
      await this.update(s, 'libraries', 'library', library, { config: canonical({ ...JSON.parse(library.config), navigation }) });
    });
  }
  resolveLibraryStart(id: string): Promise<LibraryLocation> {
    requireId(id); return this.db.read(s => resolveLibraryStart(s, id));
  }
  rememberLibraryLocation(id: string, value: LibraryLocation): Promise<void> {
    requireId(id);
    const location = validateLibraryNavigation({ start: value, collections_layout: 'cards' }).start;
    if (location.kind === 'last') throw new AppError('invalidLibraryNavigation');
    // One local hint write commits atomically by itself. Renderer death must not
    // strand BEGIN/COMMIT while only recording a navigation preference.
    return this.db.read(async s => {
      await navigationLibrary(s, id);
      if (!await validLibraryLocation(s, id, location)) throw new AppError('invalidLibraryNavigation');
      await s.execute('INSERT INTO local_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<>excluded.value', [`library_last:${id}`, canonical(location)]);
    });
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
      const files: Field = { ...(await this.stamp(s, await systemId('attachments'))), collection_id: collection.id, name: 'attachments', type: 'file', config: '{"multiple":true,"fts":false}', position: 1 };
      await this.insert(s, 'fields', files);
      await this.log(s, 'field', files, files);
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
      if (['file','image'].includes(old.type) && !!fieldConfig(old).multiple !== !!checked.multiple) throw new AppError('attachmentMultiplicity');
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
    deleted: boolean,
    expectedHlc?: string
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
      if (kind === 'record') {
        if ((stored as StoredEntry).purged) throw new AppError('purgedRecord');
        if (expectedHlc && stored.hlc !== expectedHlc) throw new AppError('staleRecord');
      }
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
        await this.refreshRecords(s, [{ ...stored as StoredEntry, ...row, data: canonical(row.data) }]);
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
    if (kind === 'record') return;
    await this.rebuildDerived();
    await this.rebuildRelationIndex(false);
    if (collectionId) await this.reconcileIndexes(collectionId);
  }
  getTrashRetention(): Promise<TrashRetention> { return this.db.read(readRetention); }
  saveTrashRetention(days: TrashRetention): Promise<void> {
    validateRetention(days);
    return this.db.transaction(async s => {
      if (await readRetention(s) === days) return;
      const stamp = await this.stamp(s);
      const value = canonical({ days, hlc: stamp.hlc, device_id: stamp.device_id });
      await s.execute("INSERT INTO app_meta VALUES('trash:retention',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [value]);
      await this.log(s, 'app_setting', { ...stamp, id: 'trash:retention' }, { key: 'trash:retention', value });
    });
  }
  listTrashLibraries(): Promise<{ id: string; name: string }[]> {
    return this.db.read(s => s.query(`SELECT l.id,l.name FROM libraries l WHERE EXISTS(
      SELECT 1 FROM records r JOIN collections c ON c.id=r.collection_id
      WHERE c.library_id=l.id AND r.deleted_at IS NOT NULL AND r.purged=0) ORDER BY l.name,l.id`));
  }
  queryTrash(libraryId: string | null = null, cursor: TrashCursor | null = null, limit = 50): Promise<TrashPage> {
    if (libraryId !== null) requireId(libraryId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new AppError('invalidQuery');
    if (cursor) { requireId(cursor.id); if (!isUtcTimestamp(cursor.deleted_at)) throw new AppError('invalidQuery'); }
    return this.db.read(async s => {
      const rows = await s.query<StoredEntry & { title: string; library_id: string; library_name: string; collection_name: string; restorable: number }>(
        `SELECT r.*,coalesce(CAST(json_extract(r.data,'$."'||c.primary_field_id||'"') AS TEXT),'') AS title,
        l.id AS library_id,l.name AS library_name,c.name AS collection_name,
        (c.deleted_at IS NULL AND l.deleted_at IS NULL) AS restorable
        FROM records r JOIN collections c ON c.id=r.collection_id JOIN libraries l ON l.id=c.library_id
        WHERE r.deleted_at IS NOT NULL AND r.purged=0 ${libraryId ? 'AND l.id=?' : ''}
        ${cursor ? 'AND (r.deleted_at<? OR (r.deleted_at=? AND r.id<?))' : ''}
        ORDER BY r.deleted_at DESC,r.id DESC LIMIT ?`,
        [...(libraryId ? [libraryId] : []), ...(cursor ? [cursor.deleted_at, cursor.deleted_at, cursor.id] : []), limit + 1]);
      const page = rows.slice(0, limit), last = page.at(-1);
      return { items: page.map(row => ({ ...decodeEntry(row), title: row.title, library_id: row.library_id,
        library_name: row.library_name, collection_name: row.collection_name, restorable: !!row.restorable })),
        next: rows.length > limit && last ? { deleted_at: last.deleted_at!, id: last.id } : null };
    });
  }
  /** Terminal tombstone keeps identity/HLC indefinitely; referenced target UUIDs in other records survive. */
  private async purgeInSession(s: SqlSession, stored: StoredEntry): Promise<void> {
    if (stored.purged) return;
    if (!stored.deleted_at) throw new AppError('recordNotDeleted');
    const stamp = await this.stamp(s, stored.id, stored.hlc);
    const row: Entry = { ...decodeEntry(stored), data: {}, purged: 1, hlc: stamp.hlc, device_id: stamp.device_id,
      updated_at: stamp.updated_at, updated_local: localTimestamp(new Date(stamp.updated_at)) };
    await s.execute("UPDATE records SET data='{}',purged=1,hlc=?,device_id=?,updated_at=?,updated_local=?,sort_version=0,relation_version=0 WHERE id=?",
      [row.hlc, row.device_id, row.updated_at, row.updated_local, row.id]);
    await purgeAttachments(s, row, (entity, meta, payload) => this.log(s, entity, meta, payload));
    // Existing active/paused events retain their delivery lifecycle; never delete the journal here.
    await s.execute('DELETE FROM record_versions WHERE record_id=?', [row.id]);
    await applyHistoryClear(s, { record_id: row.id, hlc: row.hlc });
    await this.refreshRecords(s, [{ ...stored, ...row, data: '{}' }]);
    await this.log(s, 'record', row, row);
  }
  async purgeEntry(id: string, expectedHlc: string): Promise<void> {
    requireId(id);
    if (!expectedHlc) throw new AppError('staleRecord');
    await this.db.transaction(async s => {
      const [stored] = await s.query<StoredEntry>('SELECT * FROM records WHERE id=?', [id]);
      if (!stored) throw new AppError('notFound');
      if (stored.purged) return;
      if (stored.hlc !== expectedHlc) throw new AppError('staleRecord');
      await this.purgeInSession(s, stored);
    });
    await this.collectAttachmentFiles();
  }
  /** Bounded transactions; a crash resumes remaining rows on next startup/foreground opportunity. */
  async cleanTrash(): Promise<number> {
    let total = 0;
    for (;;) {
      const count = await this.db.transaction(async s => {
        const days = await readRetention(s);
        if (days === null) return 0;
        const cutoff = new Date(Date.now() - days * 86400000).toISOString();
        const rows = await s.query<StoredEntry>('SELECT * FROM records WHERE purged=0 AND deleted_at IS NOT NULL AND deleted_at<=? ORDER BY deleted_at,id LIMIT 50', [cutoff]);
        for (const row of rows) await this.purgeInSession(s, row);
        return rows.length;
      });
      total += count;
      if (!count) { await this.collectAttachmentFiles(); return total; }
      await yieldOperation();
    }
  }
  /** Local replication primitive. Packet validation/cursors and transport are separate work. */
  mergeEntryState(incoming: Entry): Promise<boolean> {
    requireId(incoming.id); requireId(incoming.collection_id); requireId(incoming.device_id);
    assertHlc(incoming.hlc); validateData(incoming.data);
    if (!incoming.hlc.endsWith(`-${incoming.device_id}`) || ![0, 1].includes(incoming.purged) ||
        (incoming.purged && !incoming.deleted_at) ||
        [incoming.created_at, incoming.updated_at].some(value => !isUtcTimestamp(value)) ||
        (incoming.deleted_at !== null && !isUtcTimestamp(incoming.deleted_at)) ||
        typeof incoming.created_local !== 'string' || typeof incoming.updated_local !== 'string') throw new AppError('invalidRecordState');
    return this.db.transaction(async s => {
      const [old] = await s.query<StoredEntry>('SELECT * FROM records WHERE id=?', [incoming.id]);
      // Observe accepted remote clocks without generating a local edit/version.
      await s.execute("INSERT INTO local_settings VALUES('hlc',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<excluded.value", [incoming.hlc]);
      if (old?.purged && (!incoming.purged || old.hlc >= incoming.hlc)) return false;
      if (old && !incoming.purged && old.hlc >= incoming.hlc) return false;
      if (!(await s.query('SELECT id FROM collections WHERE id=?', [incoming.collection_id])).length) throw new AppError('notFound');
      const row: Entry = { id: incoming.id, collection_id: incoming.collection_id,
        hlc: incoming.hlc, device_id: incoming.device_id, deleted_at: incoming.deleted_at,
        created_at: incoming.created_at, updated_at: incoming.updated_at,
        created_local: incoming.created_local, updated_local: incoming.updated_local,
        purged: incoming.purged, data: incoming.purged ? {} : incoming.data };
      // Purge is terminal, including when a disconnected replica had a later live edit.
      if (old && old.hlc > row.hlc) { row.hlc = old.hlc; row.device_id = old.device_id; }
      const stored = { ...row, data: canonical(row.data), sort_data: '{}', search_data: '{}', sort_version: 0, relation_version: 0 };
      if (old) {
        const columns = Object.keys(stored).filter(key => key !== 'id');
        await s.execute(`UPDATE records SET ${columns.map(key => key + '=?').join(',')} WHERE id=?`,
          [...columns.map(key => stored[key as keyof typeof stored]) as SqlValue[], row.id]);
      } else await this.insert(s, 'records', stored);
      if (row.purged) {
        await purgeAttachments(s, row, (entity, meta, payload) => this.log(s, entity, meta, payload));
        await s.execute('DELETE FROM record_versions WHERE record_id=?', [row.id]);
        await applyHistoryClear(s, { record_id: row.id, hlc: row.hlc });
      }
      await this.refreshRecords(s, [stored]);
      await this.log(s, 'record', row, row);
      return true;
    });
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
    await bindAttachments(s, row, fields, (entity, meta, payload) => this.log(s, entity, meta, payload));
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
    await trimHistory(s, row.id);
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
  getHistory(recordId: string): Promise<HistoryState> {
    requireId(recordId);
    return this.db.read(s => readHistory(s, recordId));
  }
  /** An explicit restore is a new save of the retained snapshot, never a rewrite of a version. */
  restoreEntryVersion(recordId: string, versionId: string, expectedHlc: string): Promise<Entry> {
    requireId(recordId); requireId(versionId);
    if (!expectedHlc) throw new AppError('staleRecord');
    return this.db.transaction(async s => {
      const [stored] = await s.query<StoredEntry>('SELECT r.* ' + activeRecords + ' AND r.id=?', [recordId]);
      if (!stored) throw new AppError('notFound');
      const previous = decodeEntry(stored);
      if (previous.hlc !== expectedHlc) throw new AppError('staleRecord');
      const version = (await readHistory(s, recordId)).versions.find(value => value.id === versionId);
      if (!version) throw new AppError('notFound');
      const target = await activeCollection(s, version.snapshot.collection_id);
      const fields = await s.query<Field>('SELECT * FROM fields WHERE collection_id=? AND deleted_at IS NULL ORDER BY position,id', [target.id]);
      const [form] = await s.query<UiConfiguration>("SELECT * FROM ui_configs WHERE collection_id=? AND kind='form' AND deleted_at IS NULL", [target.id]);
      // Validate against the current schema without filling new defaults or retaining later values.
      const data = prepareEntryData(version.snapshot.data,
        entryRules(target, fields, form ? JSON.parse(form.config) as UiDefinition : { fields: [] }), version.snapshot.data);
      await validateRelationTargets(s, target, fields, data, previous.collection_id === target.id ? previous.data : undefined);
      if (previous.collection_id === target.id && canonical(data) === canonical(previous.data)) return previous;
      const stamp = await this.stamp(s, recordId, version.hlc);
      const row: Entry = { ...previous, collection_id: target.id, data, hlc: stamp.hlc, device_id: stamp.device_id,
        updated_at: stamp.updated_at, updated_local: localTimestamp(new Date(stamp.updated_at)) };
      await this.persistEntry(s, row, true, fields);
      return row;
    });
  }
  private async compactHistory(): Promise<void> {
    while (await this.db.transaction(async s => {
      const records = await s.query<{ record_id: string }>(
        'SELECT record_id FROM record_versions GROUP BY record_id HAVING count(*)>20 LIMIT 100');
      for (const record of records) await trimHistory(s, record.record_id);
      return records.length;
    })) { /* Restartable batches; the cutoff and deletion commit together. */ }
  }
  /** Explicit user operation; records and current values remain intact. */
  clearHistory(recordId: string | null = null): Promise<HistoryClear> {
    if (recordId !== null) requireId(recordId);
    return this.db.transaction(async s => {
      const [observed] = await s.query<{ hlc: string | null }>(`SELECT max(hlc) AS hlc FROM (
        SELECT hlc FROM record_versions UNION ALL
        SELECT value FROM app_meta WHERE key LIKE 'history:clear:%' UNION ALL
        SELECT json_extract(value,'$.hlc') FROM app_meta WHERE key LIKE 'history:trim:%')`);
      const stamp = await this.stamp(s, recordId ?? undefined, observed?.hlc ?? undefined);
      const marker = { record_id: recordId, hlc: stamp.hlc };
      await applyHistoryClear(s, marker);
      await this.log(s, 'history_clear', stamp, marker);
      return marker;
    });
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
      const keepJournal = await journalEnabled(s);
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
        if (keepJournal) {
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
        }
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
          for (const field of fields) if (isFile(field.type) && fileIds(data[field.id]).length) throw new FieldError('csvAttachment', field.name);
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
      if (old) await this.update(s, 'quick_forms', 'quick_form', old, { config, deleted_at: null });
      else {
        const row = { ...(await this.stamp(s)), collection_id: collectionId, kind: 'quick', config };
        await this.insert(s, 'quick_forms', row);
        await this.log(s, 'quick_form', row, row);
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
  /** Invalidate disposable caches once; per-record flags retain progress after interruption. */
  private prepareSearchKeys(): Promise<void> {
    return this.db.transaction(async s => {
      const [policy] = await s.query<{ value: string }>("SELECT value FROM local_settings WHERE key='derived_search_policy'");
      if (policy?.value === 'text-only-1') return;
      await s.execute('UPDATE records SET sort_version=0');
      const secrets = await s.query<{ id: string }>("SELECT id FROM fields WHERE type='secret'");
      for (const field of secrets) await s.execute(`DROP INDEX IF EXISTS ${fieldIndexName(field.id)}`);
      await s.execute("INSERT INTO local_settings VALUES('derived_search_policy','text-only-1') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
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
              .filter((f) => isText(f.type) && typeof data[f.id] === 'string')
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
        !['secret', 'relation', 'backlink', 'file', 'image'].includes(field.type) &&
        (fieldConfig(field).indexed || automatic.has(field.id))
      ) {
        await s.execute(
          `CREATE INDEX IF NOT EXISTS ${fieldIndexName(field.id)} ON records(collection_id,deleted_at,${fieldExpression(field)},id)`
        );
      } else await s.execute(`DROP INDEX IF EXISTS ${fieldIndexName(field.id)}`);
    }
  }
}
