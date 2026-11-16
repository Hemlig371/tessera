import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DraftStore, DraftSession, draftPath } from '../../src/core/drafts';
import { nodeFiles, TestLifecycle } from '../support/node-files';

let directory: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'tessera-drafts-')); vi.useFakeTimers(); });
afterEach(async () => { vi.useRealTimers(); await rm(directory, { force: true, recursive: true }); });
function setup() {
  const files = nodeFiles(directory), lifecycle = new TestLifecycle(), store = new DraftStore(files, lifecycle);
  const scope = { dataset_id: crypto.randomUUID(), library_id: crypto.randomUUID(), collection_id: crypto.randomUUID() };
  const text = { id: crypto.randomUUID(), type: 'text' }, secret = { id: crypto.randomUUID(), type: 'secret' }, unknown = crypto.randomUUID();
  const action = { kind: 'save' as const, create_id: crypto.randomUUID() };
  const error = vi.fn(), session = new DraftSession(store, scope, action, [text, secret], error);
  return { files, lifecycle, store, scope, text, secret, unknown, action, error, session };
}
it('debounces for three seconds, excludes secret/unclassified values and persists Unicode only in its own collection', async () => {
  const s = setup();
  s.session.change({ [s.text.id]: 'Первая', [s.secret.id]: 'DO_NOT_WRITE_THIS', [s.unknown]: 'unclassified' });
  await vi.advanceTimersByTimeAsync(2000);
  s.session.change({ [s.text.id]: 'Последняя 🦔', [s.secret.id]: 'DO_NOT_WRITE_THIS' });
  await vi.advanceTimersByTimeAsync(2999);
  expect(await s.store.load(s.scope)).toBeNull();
  await vi.advanceTimersByTimeAsync(1); await s.session.flush();
  expect((await s.store.load(s.scope))?.data).toEqual({ [s.text.id]: 'Последняя 🦔' });
  expect(new TextDecoder().decode((await s.files.read(draftPath(s.scope)))!)).not.toContain('DO_NOT_WRITE_THIS');
  for (const key of ['dataset_id', 'library_id', 'collection_id'] as const) expect(await s.store.load({ ...s.scope, [key]: crypto.randomUUID() })).toBeNull();
  s.session.dispose();
});
it('flushes on inactive and close, then removes only after successful record save without a late write recreating it', async () => {
  const s = setup(); s.session.change({ [s.text.id]: 'Свернули' }); s.lifecycle.emit('inactive'); await s.session.flush();
  expect((await s.store.load(s.scope))?.data[s.text.id]).toBe('Свернули');
  await s.session.close(); await vi.advanceTimersByTimeAsync(10000);
  expect((await s.store.load(s.scope))?.data[s.text.id]).toBe('Свернули');
  await s.session.finish(); expect(await s.store.load(s.scope)).toBeNull();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const delayedStore = new DraftStore({ ...s.files, writeAtomic: async (path, bytes) => { await gate; await s.files.writeAtomic(path, bytes); } }, s.lifecycle);
  const session = new DraftSession(delayedStore, s.scope, s.action, [s.text], s.error);
  session.change({ [s.text.id]: 'Гонка записи и закрытия' }); const write = session.flush(); await Promise.resolve(); await Promise.resolve();
  const close = session.close(); release(); await Promise.all([write, close]);
  expect((await delayedStore.load(s.scope))?.data[s.text.id]).toBe('Гонка записи и закрытия');
  await session.finish(); await vi.advanceTimersByTimeAsync(10000); expect(await s.files.read(draftPath(s.scope))).toBeNull();
});
it('retains values of removed fields, excludes fields now marked secret and preserves a damaged file without overwriting it', async () => {
  const s = setup(); s.session.change({ [s.text.id]: 'Не терять' }); await s.session.flush(); s.session.dispose();
  const previous = (await s.store.load(s.scope))!;
  const restored = new DraftSession(s.store, s.scope, previous.action, [], s.error, previous);
  restored.change(previous.data); await restored.flush(); expect((await s.store.load(s.scope))?.data).toEqual(previous.data); restored.dispose();
  const reclassified = new DraftSession(s.store, s.scope, previous.action, [{ ...s.text, type: 'secret' }], s.error, previous);
  reclassified.change(previous.data); await reclassified.flush(); expect((await s.store.load(s.scope))?.data).toEqual({}); reclassified.dispose();
  const bytes = new TextEncoder().encode('{broken'); await s.files.writeAtomic(draftPath(s.scope), bytes);
  await expect(s.store.load(s.scope)).rejects.toThrow('invalidDraft'); expect(await s.files.read(draftPath(s.scope))).toEqual(bytes);
});
it('reports failed writes and retries the latest input while retaining the previously committed file', async () => {
  const s = setup(); s.session.change({ [s.text.id]: 'До сбоя' }); await s.session.flush(); s.session.dispose();
  let failing = true;
  const store = new DraftStore({ ...s.files, writeAtomic: async (path, bytes) => { if (failing) throw new Error('disk full'); await s.files.writeAtomic(path, bytes); } }, s.lifecycle);
  const session = new DraftSession(store, s.scope, s.action, [s.text], s.error);
  session.change({ [s.text.id]: 'После сбоя' }); await expect(session.flush()).rejects.toThrow('disk full');
  expect((await s.store.load(s.scope))?.data[s.text.id]).toBe('До сбоя');
  failing = false; s.lifecycle.emit('inactive'); await session.flush(); expect((await store.load(s.scope))?.data[s.text.id]).toBe('После сбоя'); session.dispose();
});

it('preserves malformed bytes before creating a fresh draft, and retains recovery material after successful Save', async () => {
  const s = setup(); s.session.dispose();
  const damaged = new Uint8Array([255, 0, 123, 34, 7]);
  await s.files.writeAtomic(draftPath(s.scope), damaged);
  await expect(s.store.load(s.scope)).rejects.toThrow('invalidDraft');
  const result = await s.store.recoverCorrupt(s.scope);
  expect(result.draft).toBeNull(); expect(result.recovered_path).toMatch(/^draft-recovery\//);
  expect(await s.files.read(result.recovered_path!)).toEqual(damaged);
  expect(await s.store.load(s.scope)).toBeNull();
  const fresh = new DraftSession(s.store, s.scope, s.action, [s.text], s.error);
  fresh.change({ [s.text.id]: 'Новая запись' }); await fresh.close();
  expect((await s.store.load(s.scope))!.data[s.text.id]).toBe('Новая запись');
  await fresh.finish(); expect(await s.store.load(s.scope)).toBeNull();
  expect(await s.files.read(result.recovered_path!)).toEqual(damaged);
});

it.each(['write', 'verify', 'remove'] as const)('retains the original on recovery %s failure and safely retries the same copy', async failure => {
  const s = setup(); s.session.dispose(); const path = draftPath(s.scope), bytes = new TextEncoder().encode('{broken');
  await s.files.writeAtomic(path, bytes);
  let recoveryPath: string | null = null;
  const store = new DraftStore({ ...s.files,
    writeAtomic: async (id, value) => {
      recoveryPath = id;
      if (failure === 'write') throw new Error('disk error');
      await s.files.writeAtomic(id, failure === 'verify' ? value.slice(0, 1) : value);
    },
    remove: async id => { if (failure === 'remove') throw new Error('interrupted after copy'); await s.files.remove(id); },
  }, s.lifecycle);
  await expect(store.recoverCorrupt(s.scope)).rejects.toThrow('draftRecovery');
  expect(await s.files.read(path)).toEqual(bytes);
  const recovered = await s.store.recoverCorrupt(s.scope);
  expect(recovered.recovered_path).toBe(recoveryPath);
  expect(await s.files.read(recovered.recovered_path!)).toEqual(bytes);
  expect(await s.files.read(path)).toBeNull();
});

it('does not quarantine a valid draft that was written before recovery reached the serialized queue', async () => {
  const s = setup(); s.session.change({ [s.text.id]: 'Valid input' }); await s.session.close();
  const before = await s.store.load(s.scope);
  expect(await s.store.recoverCorrupt(s.scope)).toEqual({ draft: before, recovered_path: null });
  expect(await s.store.load(s.scope)).toEqual(before);
});

it('waits for an in-flight write before deleting the draft after successful Save', async () => {
  const s = setup(); s.session.dispose();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  const store = new DraftStore({ ...s.files, writeAtomic: async (path, bytes) => {
    started(); await gate; await s.files.writeAtomic(path, bytes);
  } }, s.lifecycle);
  const session = new DraftSession(store, s.scope, s.action, [s.text], s.error);
  session.change({ [s.text.id]: 'В полёте' }); const write = session.flush(); await writing;
  const finish = session.finish(); release(); await Promise.all([write, finish]);
  await vi.advanceTimersByTimeAsync(10000); expect(await store.load(s.scope)).toBeNull();
});

it('keeps a form open when closing overlaps a failed write, then retries the latest values', async () => {
  const s = setup(); s.session.dispose();
  let release!: () => void, started!: () => void, failing = true;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const writing = new Promise<void>(resolve => { started = resolve; });
  const store = new DraftStore({ ...s.files, writeAtomic: async (path, bytes) => {
    started(); await gate; if (failing) throw new Error('disk full'); await s.files.writeAtomic(path, bytes);
  } }, s.lifecycle);
  const session = new DraftSession(store, s.scope, s.action, [s.text], s.error);
  session.change({ [s.text.id]: 'Не терять' }); const write = session.flush(); await writing;
  const close = session.close(); release();
  expect((await Promise.allSettled([write, close])).map(result => result.status)).toEqual(['rejected', 'rejected']);
  failing = false; session.change({ [s.text.id]: 'Повторить актуальное' }); await session.close();
  expect((await store.load(s.scope))?.data[s.text.id]).toBe('Повторить актуальное');
});
it('does not restore older failed input after a newer write has already been queued', async () => {
  const s = setup(); s.session.dispose();
  let release!: () => void, started!: () => void, first = true;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const writing = new Promise<void>(resolve => { started = resolve; });
  const store = new DraftStore({ ...s.files, writeAtomic: async (path, bytes) => {
    if (first) { first = false; started(); await gate; throw new Error('disk full'); }
    await s.files.writeAtomic(path, bytes);
  } }, s.lifecycle);
  const session = new DraftSession(store, s.scope, s.action, [s.text], s.error);
  session.change({ [s.text.id]: 'Старое' }); const old = session.flush(); await writing;
  session.change({ [s.text.id]: 'Новое' }); const latest = session.flush(); release();
  expect((await Promise.allSettled([old, latest])).map(result => result.status)).toEqual(['rejected', 'fulfilled']);
  await session.close(); expect((await store.load(s.scope))?.data[s.text.id]).toBe('Новое');
});
