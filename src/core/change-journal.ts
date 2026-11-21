import { AppError } from './errors';
import type { SqlSession } from './ports';
import { requireId } from './validation';

export type SyncMode = 'never_configured' | 'active' | 'paused' | 'detached';
export interface JournalCheckpoint { dataset_id: string; seq: number }
export interface JournalChange {
  seq: number; id: string; entity_type: string; entity_id: string;
  hlc: string; device_id: string; payload: string;
}
const modeKey = 'sync_mode', floorKey = 'sync_journal_floor', peerPrefix = 'sync_peer:';
export async function syncMode(s: SqlSession): Promise<SyncMode> {
  const [row] = await s.query<{ value: string }>('SELECT value FROM local_settings WHERE key=?', [modeKey]);
  const mode = row?.value ?? 'never_configured';
  if (!['never_configured', 'active', 'paused', 'detached'].includes(mode)) throw new AppError('invalidSyncState');
  return mode as SyncMode;
}
export async function journalEnabled(s: SqlSession): Promise<boolean> {
  const mode = await syncMode(s);
  return mode === 'active' || mode === 'paused';
}
async function set(s: SqlSession, key: string, value: string): Promise<void> {
  await s.execute('INSERT INTO local_settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
}
async function floor(s: SqlSession): Promise<number> {
  const [row] = await s.query<{ value: string }>('SELECT value FROM local_settings WHERE key=?', [floorKey]);
  const value = Number(row?.value ?? 0);
  if (!Number.isSafeInteger(value) || value < 0) throw new AppError('invalidSyncState');
  return value;
}
export async function journalCheckpoint(s: SqlSession): Promise<JournalCheckpoint> {
  const [dataset] = await s.query<{ value: string }>("SELECT value FROM app_meta WHERE key='dataset_id'");
  if (!dataset) throw new AppError('invalidSyncState');
  const [last] = await s.query<{ seq: number }>('SELECT coalesce(max(seq),0) AS seq FROM change_log');
  return { dataset_id: dataset.value, seq: Math.max(last!.seq, await floor(s)) };
}
async function check(s: SqlSession, checkpoint: JournalCheckpoint): Promise<void> {
  const current = await journalCheckpoint(s);
  if (checkpoint.dataset_id !== current.dataset_id) throw new AppError('datasetMismatch');
  if (!Number.isSafeInteger(checkpoint.seq) || checkpoint.seq < await floor(s) || checkpoint.seq > current.seq)
    throw new AppError('journalGap');
}
export async function readChanges(s: SqlSession, after: JournalCheckpoint, limit: number): Promise<JournalChange[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new AppError('invalidLimit');
  await check(s, after);
  return s.query<JournalChange>('SELECT * FROM change_log WHERE seq>? ORDER BY seq LIMIT ?', [after.seq, limit]);
}
/** Only verified protocol/application checkpoints may advance a peer. Never infer receipt from sending. */
export async function acknowledgeChanges(s: SqlSession, peerId: string, checkpoint: JournalCheckpoint): Promise<void> {
  requireId(peerId); await check(s, checkpoint);
  if (!await journalEnabled(s)) throw new AppError('invalidSyncState');
  const key = peerPrefix + peerId;
  const [old] = await s.query<{ value: string }>('SELECT value FROM local_settings WHERE key=?', [key]);
  if (old && Number(old.value) > checkpoint.seq) throw new AppError('invalidSyncState');
  await set(s, key, String(checkpoint.seq));
}
/** Cut only the prefix acknowledged by every connected peer, with a durable gap boundary. */
export async function compactChanges(s: SqlSession): Promise<void> {
  if (!await journalEnabled(s)) throw new AppError('invalidSyncState');
  const peers = await s.query<{ value: string }>("SELECT value FROM local_settings WHERE key LIKE 'sync_peer:%'");
  if (!peers.length) return;
  const through = Math.min(...peers.map(peer => Number(peer.value)));
  await check(s, { ...(await journalCheckpoint(s)), seq: through });
  await s.execute('DELETE FROM change_log WHERE seq<=?', [through]);
  await set(s, floorKey, String(through));
}
/** Existing inactive dev logs are disposable only before initial snapshot or after explicit detach. */
export async function compactInactiveChanges(s: SqlSession): Promise<void> {
  if (await journalEnabled(s)) return;
  const checkpoint = await journalCheckpoint(s);
  await s.execute(`DELETE FROM change_log WHERE seq<=? AND NOT EXISTS (
    SELECT 1 FROM local_settings WHERE key=? AND value IN ('active','paused'))`, [checkpoint.seq, modeKey]);
  await set(s, floorKey, String(checkpoint.seq));
}
export async function activateJournal(s: SqlSession): Promise<void> {
  const mode = await syncMode(s);
  if (mode === 'active' || mode === 'paused') throw new AppError('invalidSyncState');
  await compactInactiveChanges(s);
  await set(s, modeKey, 'active');
}
export async function pauseJournal(s: SqlSession, paused: boolean): Promise<void> {
  if (!await journalEnabled(s)) throw new AppError('invalidSyncState');
  await set(s, modeKey, paused ? 'paused' : 'active');
}
export async function detachJournal(s: SqlSession): Promise<string> {
  const datasetId = crypto.randomUUID();
  await set(s, modeKey, 'detached');
  await compactInactiveChanges(s);
  await s.execute("DELETE FROM local_settings WHERE key LIKE 'sync_peer:%' OR key LIKE 'sync_rx:%' OR key LIKE 'sync_guard:%'");
  // A detached dataset has no peer cursors: its fresh baseline restarts at sequence 1.
  await s.execute("DELETE FROM sqlite_sequence WHERE name='change_log'");
  await set(s, floorKey, '0');
  await s.execute("UPDATE app_meta SET value=? WHERE key='dataset_id'", [datasetId]);
  return datasetId;
}
