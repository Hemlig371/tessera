import { AppError } from './errors';
import { assertHlc } from './hlc';
import { canonical, type Entry, type JsonValue } from './model';
import type { SqlSession } from './ports';
import { requireId } from './validation';

export interface RecordVersion {
  id: string;
  record_id: string;
  hlc: string;
  device_id: string;
  saved_at: string;
  snapshot: Entry;
}
export interface VersionOrder { hlc: string; id: string }
export interface HistoryState {
  record_id: string;
  versions: RecordVersion[];
  trimmed_through: VersionOrder | null;
  cleared_through: string | null;
}
export interface HistoryClear { record_id: string | null; hlc: string }
type StoredVersion = Omit<RecordVersion, 'snapshot'> & { snapshot: string };
const cutoffKey = (id: string) => `history:trim:${id}`;
const clearKey = (id: string | null) => `history:clear:${id ?? 'all'}`;
const encode = (value: RecordVersion) => canonical(value as unknown as JsonValue);
function compare(a: VersionOrder, b: VersionOrder): number {
  return a.hlc < b.hlc ? -1 : a.hlc > b.hlc ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
async function meta(s: SqlSession, key: string): Promise<string | null> {
  const [row] = await s.query<{ value: string }>('SELECT value FROM app_meta WHERE key=?', [key]);
  return row?.value ?? null;
}
async function putMeta(s: SqlSession, key: string, value: string): Promise<void> {
  await s.execute('INSERT INTO app_meta VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
}
async function observeHlc(s: SqlSession, hlc: string): Promise<void> {
  await s.execute("INSERT INTO local_settings VALUES('hlc',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE value<excluded.value", [hlc]);
}
async function clearedThrough(s: SqlSession, id: string): Promise<string | null> {
  const all = await meta(s, clearKey(null)), record = await meta(s, clearKey(id));
  return all && record ? (all > record ? all : record) : all ?? record;
}
async function cutoff(s: SqlSession, id: string): Promise<VersionOrder | null> {
  const value = await meta(s, cutoffKey(id));
  return value ? JSON.parse(value) as VersionOrder : null;
}

/** Call inside the same transaction as records/HLC/journal. Never prune by calendar age. */
export async function trimHistory(s: SqlSession, recordId: string): Promise<void> {
  const [evicted] = await s.query<VersionOrder>(
    'SELECT hlc,id FROM record_versions WHERE record_id=? ORDER BY hlc DESC,id DESC LIMIT 1 OFFSET 20', [recordId]);
  if (!evicted) return;
  const previous = await cutoff(s, recordId);
  if (!previous || compare(evicted, previous) > 0) await putMeta(s, cutoffKey(recordId), JSON.stringify(evicted));
  await s.execute('DELETE FROM record_versions WHERE record_id=? AND (hlc<? OR (hlc=? AND id<=?))',
    [recordId, evicted.hlc, evicted.hlc, evicted.id]);
}

export async function readHistory(s: SqlSession, recordId: string): Promise<HistoryState> {
  requireId(recordId);
  const rows = await s.query<StoredVersion>('SELECT * FROM record_versions WHERE record_id=? ORDER BY hlc DESC,id DESC LIMIT 20', [recordId]);
  return {
    record_id: recordId,
    versions: rows.map(row => ({ ...row, snapshot: JSON.parse(row.snapshot) as Entry })),
    trimmed_through: await cutoff(s, recordId),
    cleared_through: await clearedThrough(s, recordId),
  };
}

/** A monotonic, synchronizable HLC watermark. Concurrent versions above it survive. */
export async function applyHistoryClear(s: SqlSession, marker: HistoryClear): Promise<void> {
  if (marker.record_id !== null) requireId(marker.record_id);
  assertHlc(marker.hlc);
  await observeHlc(s, marker.hlc);
  const key = clearKey(marker.record_id), previous = await meta(s, key);
  const hlc = previous && previous > marker.hlc ? previous : marker.hlc;
  await putMeta(s, key, hlc);
  await s.execute(`DELETE FROM record_versions WHERE hlc<=?${marker.record_id === null ? '' : ' AND record_id=?'}`,
    marker.record_id === null ? [hlc] : [hlc, marker.record_id]);
}

/** History-only merge primitive for local protocol/archive integration, not a sync transport. */
export async function mergeHistory(s: SqlSession, state: HistoryState): Promise<void> {
  requireId(state.record_id);
  if (state.cleared_through) await applyHistoryClear(s, { record_id: state.record_id, hlc: state.cleared_through });
  let floor = await cutoff(s, state.record_id);
  if (state.trimmed_through) {
    assertHlc(state.trimmed_through.hlc); requireId(state.trimmed_through.id);
    await observeHlc(s, state.trimmed_through.hlc);
    if (!floor || compare(state.trimmed_through, floor) > 0) {
      floor = state.trimmed_through;
      await putMeta(s, cutoffKey(state.record_id), JSON.stringify(floor));
    }
  }
  const clear = await clearedThrough(s, state.record_id);
  if (floor) await s.execute('DELETE FROM record_versions WHERE record_id=? AND (hlc<? OR (hlc=? AND id<=?))',
    [state.record_id, floor.hlc, floor.hlc, floor.id]);
  for (const version of state.versions) {
    requireId(version.id); requireId(version.device_id); assertHlc(version.hlc);
    if (version.record_id !== state.record_id || version.snapshot.id !== state.record_id ||
        version.snapshot.hlc !== version.hlc || version.snapshot.device_id !== version.device_id ||
        !version.hlc.endsWith(`-${version.device_id}`) || !Number.isFinite(Date.parse(version.saved_at)))
      throw new AppError('invalidHistory');
    await observeHlc(s, version.hlc);
    if ((clear && version.hlc <= clear) || (floor && compare(version, floor) <= 0)) continue;
    const [old] = await s.query<StoredVersion>('SELECT * FROM record_versions WHERE id=?', [version.id]);
    if (old) {
      if (encode({ ...old, snapshot: JSON.parse(old.snapshot) as Entry }) !== encode(version)) throw new AppError('immutableVersion');
      continue;
    }
    await s.execute('INSERT INTO record_versions VALUES(?,?,?,?,?,?)',
      [version.id, state.record_id, version.hlc, version.device_id, version.saved_at, canonical({ ...version.snapshot })]);
  }
  await trimHistory(s, state.record_id);
}
