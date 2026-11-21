import { AppError } from './errors';
import { assertHlc } from './hlc';
import { UUID_RE, type Entry } from './model';
import { mergeHistory, applyHistoryClear, type RecordVersion } from './history';
import type { SqlSession, SqlValue } from './ports';
import type { SyncEvent, SyncEntity } from './sync-protocol';

const entities = {
  library: ['libraries', 'id,hlc,device_id,deleted_at,created_at,updated_at,name,config,position,system_kind'],
  collection: ['collections', 'id,hlc,device_id,deleted_at,created_at,updated_at,library_id,name,primary_field_id,incoming_field_id,config,position,system_kind,default_profile_id'],
  field: ['fields', 'id,hlc,device_id,deleted_at,created_at,updated_at,collection_id,name,type,config,position'],
  ui_config: ['ui_configs', 'id,hlc,device_id,deleted_at,created_at,updated_at,collection_id,kind,config'],
  quick_form: ['quick_forms', 'id,hlc,device_id,deleted_at,created_at,updated_at,collection_id,kind,config'],
  display_profile: ['display_profiles', 'id,hlc,device_id,deleted_at,created_at,updated_at,collection_id,name,position,config'],
  creation_preset: ['creation_presets', 'id,hlc,device_id,deleted_at,created_at,updated_at,collection_id,name,position,config'],
  attachment: ['attachments', 'id,hlc,device_id,deleted_at,created_at,updated_at,record_id,name,mime,size,sha256,purged'],
  attachment_location: ['attachment_locations', 'id,hlc,device_id,attachment_id,present'],
} as const satisfies Partial<Record<SyncEntity, readonly [string, string]>>;
const invalid = () => new AppError('invalidSyncPacket');
async function mergeScalar(s: SqlSession, event: SyncEvent): Promise<boolean> {
  const def = entities[event.entity_type as keyof typeof entities];
  if (!def) throw invalid();
  const [table, csv] = def, columns: string[] = csv.split(',');
  if (Object.keys(event.payload).some(key => !columns.includes(key))) throw invalid();
  const values: SqlValue[] = columns.map(column => {
    const value = event.payload[column];
    if (value === undefined) {
      if (['system_kind','default_profile_id','deleted_at'].includes(column)) return null;
      if (column === 'kind' && event.entity_type === 'quick_form') return 'quick';
      throw invalid();
    }
    if (value !== null && typeof value !== 'number' && typeof value !== 'string') throw invalid();
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw invalid();
    return value;
  });
  const [old] = await s.query<{ hlc: string; purged?: number }>('SELECT hlc' +
    (table === 'attachments' ? ',purged' : '') + ' FROM ' + table + ' WHERE id=?', [event.entity_id]);
  if (old?.purged || (old && old.hlc >= event.hlc)) return false;
  if (table === 'attachments' && ![0,1].includes(event.payload.purged as number)) throw invalid();
  if (table === 'attachment_locations' && ![0,1].includes(event.payload.present as number)) throw invalid();
  if (old) {
    const updates = columns.filter(column => column !== 'id');
    await s.execute('UPDATE ' + table + ' SET ' + updates.map(column => column + '=?').join(',') + ' WHERE id=?',
      [...updates.map(column => values[columns.indexOf(column)]!), event.entity_id]);
  } else {
    await s.execute('INSERT INTO ' + table + '(' + csv + ') VALUES(' + columns.map(() => '?').join(',') + ')', values);
  }
  return true;
}
async function mergeMarker(s: SqlSession, event: SyncEvent): Promise<boolean> {
  const key = event.entity_id, value = event.payload.value;
  if (typeof value !== 'string') throw invalid();
  if (event.entity_type === 'history_marker') {
    if (key.startsWith('history:clear:')) {
      const recordId = key.slice('history:clear:'.length);
      if (recordId !== 'all' && !UUID_RE.test(recordId)) throw invalid();
      if (value !== event.hlc) throw invalid();
      const [old] = await s.query<{ value: string }>('SELECT value FROM app_meta WHERE key=?', [key]);
      if (old && old.value >= value) return false;
      await applyHistoryClear(s, { record_id: recordId === 'all' ? null : recordId, hlc: value });
      return true;
    }
    if (key.startsWith('history:trim:')) {
      const recordId = key.slice('history:trim:'.length);
      if (!UUID_RE.test(recordId)) throw invalid();
      let order: { hlc: string; id: string };
      try { order = JSON.parse(value) as { hlc: string; id: string }; assertHlc(order.hlc); }
      catch { throw invalid(); }
      if (!UUID_RE.test(order.id)) throw invalid();
      const [old] = await s.query<{ value: string }>('SELECT value FROM app_meta WHERE key=?', [key]);
      if (old) {
        const prior = JSON.parse(old.value) as { hlc: string; id: string };
        if (prior.hlc > order.hlc || (prior.hlc === order.hlc && prior.id >= order.id)) return false;
      }
      await mergeHistory(s, { record_id: recordId, versions: [], trimmed_through: order, cleared_through: null });
      return true;
    }
    throw invalid();
  }
  if (key !== 'attachment:limit' && key !== 'trash:retention') throw invalid();
  let incoming: { hlc: string };
  try { incoming = JSON.parse(value) as { hlc: string }; assertHlc(incoming.hlc); }
  catch { throw invalid(); }
  if (incoming.hlc !== event.hlc) throw invalid();
  const [old] = await s.query<{ value: string }>('SELECT value FROM app_meta WHERE key=?', [key]);
  if (old) {
    let previous: { hlc: string };
    try { previous = JSON.parse(old.value) as { hlc: string }; assertHlc(previous.hlc); }
    catch { throw new AppError('invalidSyncState'); }
    if (previous.hlc >= event.hlc) return false;
  }
  await s.execute('INSERT INTO app_meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key,value]);
  return true;
}
export async function applySyncEvent(s: SqlSession, event: SyncEvent,
  mergeRecord: (entry: Entry) => Promise<boolean>, relay: (event: SyncEvent) => Promise<void>): Promise<void> {
  let changed: boolean;
  if (event.entity_type === 'record') changed = await mergeRecord(event.payload as unknown as Entry);
  else if (event.entity_type === 'history_clear') {
    const recordId = event.payload.record_id;
    if (!(recordId === null || (typeof recordId === 'string' && UUID_RE.test(recordId) &&
          recordId === event.entity_id)) || event.payload.hlc !== event.hlc) throw invalid();
    const key = 'history:clear:' + (recordId ?? 'all');
    const [previous] = await s.query<{ value: string }>('SELECT value FROM app_meta WHERE key=?', [key]);
    if (!previous || previous.value < event.hlc) {
      await applyHistoryClear(s, { record_id: recordId, hlc: event.hlc });
      changed = true;
    }
  } else if (event.entity_type === 'record_version') {
    const version = event.payload as unknown as RecordVersion;
    if (version.id !== event.entity_id || !UUID_RE.test(version.record_id) ||
        !version.snapshot || version.snapshot.id !== version.record_id) throw invalid();
    const [old] = await s.query<{ id: string }>('SELECT id FROM record_versions WHERE id=?', [version.id]);
    await mergeHistory(s, { record_id: version.record_id, versions: [version], trimmed_through: null, cleared_through: null });
    const [now] = await s.query<{ id: string }>('SELECT id FROM record_versions WHERE id=?', [version.id]);
    changed = !old && !!now;
  } else if (event.entity_type === 'history_marker' || event.entity_type === 'app_setting') changed = await mergeMarker(s,event);
  else changed = await mergeScalar(s,event);
  await s.execute("INSERT INTO local_settings(key,value) VALUES('hlc',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<excluded.value", [event.hlc]);
  if (changed && event.entity_type !== 'record') await relay(event);
}
