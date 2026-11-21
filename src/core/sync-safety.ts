import { AppError } from './errors';
import { syncMode, pauseJournal, journalCheckpoint, type SyncMode } from './change-journal';
import type { SqlSession } from './ports';
import { requireId } from './validation';

export interface LocalSyncSafety {
  mode: SyncMode;
  reason: 'stale' | 'missingPackets' | null;
  enabled_at: string | null;
  last_success_at: string | null;
}
const ninetyDays = 90 * 24 * 60 * 60 * 1000;
const key = (name: string) => 'sync_guard:' + name;
async function get(s: SqlSession, name: string) {
  const [row] = await s.query<{ value: string }>('SELECT value FROM local_settings WHERE key=?', [key(name)]);
  return row?.value ?? null;
}
async function set(s: SqlSession, name: string, value: string) {
  await s.execute('INSERT INTO local_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key(name),value]);
}
function checkDate(value: string | null) {
  if (value === null) return;
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new AppError('invalidSyncState');
}
/** Called before a send/receive cycle. The 90-day safety decision is durable even after restart. */
export async function checkLocalSyncSafety(s: SqlSession, now: Date): Promise<LocalSyncSafety> {
  if (!Number.isFinite(now.getTime())) throw new AppError('invalidDate');
  let mode = await syncMode(s);
  if (mode !== 'active' && mode !== 'paused') return { mode, reason:null, enabled_at:null, last_success_at:null };
  let enabled = await get(s,'enabled_at');
  const last = await get(s,'last_success_at');
  if (enabled === null) {
    enabled = now.toISOString(); await set(s,'enabled_at',enabled);
  }
  checkDate(enabled); checkDate(last);
  let reason = await get(s,'reason');
  if (reason !== null && reason !== 'stale' && reason !== 'missingPackets') throw new AppError('invalidSyncState');
  // A backward clock shift must not be interpreted as a missed 90-day exchange.
  const age = now.getTime() - Date.parse(last ?? enabled);
  if (age > ninetyDays && reason === null) {
    await pauseJournal(s,true);
    await set(s,'reason','stale');
    mode = 'paused'; reason = 'stale';
  }
  if (reason !== null && mode === 'active') {
    await pauseJournal(s,true);
    mode = 'paused';
  }
  return { mode, reason:reason as LocalSyncSafety['reason'], enabled_at: enabled, last_success_at:last };
}
/** An exchange is successful only after sending was ACKed AND remote inbound applied. */
export async function markLocalExchangeComplete(s: SqlSession, peerId: string, now: Date): Promise<void> {
  requireId(peerId);
  if (!Number.isFinite(now.getTime()) || await syncMode(s) !== 'active' || await get(s,'reason'))
    throw new AppError('invalidSyncState');
  const [tx] = await s.query<{ value: string }>('SELECT value FROM local_settings WHERE key=?', ['sync_peer:' + peerId]);
  const [rx] = await s.query<{ value: string }>('SELECT value FROM local_settings WHERE key=?', ['sync_rx:' + peerId]);
  const checkpoint = await journalCheckpoint(s);
  if (!tx || !rx || !Number.isSafeInteger(Number(tx.value)) || Number(tx.value) < checkpoint.seq ||
      !Number.isSafeInteger(Number(rx.value)) || Number(rx.value) < 1) throw new AppError('invalidSyncState');
  await set(s,'last_success_at',now.toISOString());
}
/** Explicitly pause after confirming that a missing interval cannot be recovered. */
export async function suspendLocalSyncForGap(s: SqlSession): Promise<void> {
  if (await syncMode(s) !== 'active') throw new AppError('invalidSyncState');
  await pauseJournal(s,true);
  await set(s,'reason','missingPackets');
}
