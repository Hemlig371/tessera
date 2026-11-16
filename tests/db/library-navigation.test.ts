import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { Repository } from '../../src/core/repository';

describe.each(adapters)('%s library navigation', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  async function setup() {
    f = await fixture(kind); const api = f.api!, library = await api.createLibrary('Библиотека', { icon: '◇' });
    const collection = await api.createCollection(library.id, 'Коллекция', 'Название');
    const profile = await api.createDisplayProfile(collection.id, 'Профиль');
    return { api, library, collection, profile };
  }
  it('defaults to collections, persists a configured start and rejects foreign/deleted targets atomically', async () => {
    const { api, library, collection, profile } = await setup();
    expect(await api.resolveLibraryStart(library.id)).toEqual({ kind: 'collections' });
    const value = { start: { kind: 'collection' as const, collection_id: collection.id, profile_id: profile.id }, collections_layout: 'list' as const };
    await api.saveLibraryNavigation(library.id, value);
    expect(await api.resolveLibraryStart(library.id)).toEqual(value.start);
    expect(await api.getLibraryNavigation(library.id)).toEqual(value);
    await api.updateLibrary(library.id, { name: 'Переименована', appearance: { color: '#123456' } });
    expect(await api.getLibraryNavigation(library.id)).toEqual(value);
    const other = await api.createLibrary('Другая'), foreign = await api.createCollection(other.id, 'Чужая', 'Название');
    await expect(api.saveLibraryNavigation(library.id, { ...value, start: { kind: 'collection', collection_id: foreign.id } })).rejects.toThrow('invalidLibraryNavigation');
    await expect(api.saveLibraryNavigation(library.id, { ...value, start: { kind: 'collection', collection_id: foreign.id, profile_id: profile.id } })).rejects.toThrow('invalidLibraryNavigation');
    expect(await api.getLibraryNavigation(library.id)).toEqual(value);
    await api.deleteDisplayProfile(profile.id);
    expect(await api.resolveLibraryStart(library.id)).toEqual({ kind: 'collections' });
    expect(await api.getLibraryNavigation(library.id)).toEqual(value);
    await expect(api.saveLibraryNavigation(library.id, value)).rejects.toThrow('invalidLibraryNavigation');
    await api.saveLibraryNavigation(library.id, { ...value, start: { kind: 'collection', collection_id: collection.id } });
    await api.setDeleted('collection', collection.id, true);
    expect(await api.resolveLibraryStart(library.id)).toEqual({ kind: 'collections' });
  });
  it('remembers a local browse section without changing HLC, user versions or the transport journal', async () => {
    const { api, library, collection, profile } = await setup();
    await api.saveLibraryNavigation(library.id, { start: { kind: 'last' }, collections_layout: 'cards' });
    await api.startLocalSync();
    const snapshot = () => f.db.read(async s => ({ libraries: await s.query('SELECT * FROM libraries'), history: await s.query('SELECT * FROM record_versions'),
      log: await s.query('SELECT * FROM change_log ORDER BY seq'), clock: await s.query("SELECT * FROM local_settings WHERE key='hlc'") }));
    const before = await snapshot();
    const location = { kind: 'collection' as const, collection_id: collection.id, profile_id: profile.id };
    await api.rememberLibraryLocation(library.id, location); await api.rememberLibraryLocation(library.id, location);
    expect(await api.resolveLibraryStart(library.id)).toEqual(location); expect(await snapshot()).toEqual(before);
    const again = await Repository.open(f.db); expect(await again.resolveLibraryStart(library.id)).toEqual(location);
    await api.deleteDisplayProfile(profile.id);
    expect(await api.resolveLibraryStart(library.id)).toEqual({ kind: 'collections' });
    const beforeCatalog = await snapshot();
    await api.rememberLibraryLocation(library.id, { kind: 'collections' });
    expect(await api.resolveLibraryStart(library.id)).toEqual({ kind: 'collections' });
    expect(await snapshot()).toEqual(beforeCatalog);
  });
  it('preserves settings after a journal failure and uses the catalog for malformed/unknown local targets', async () => {
    const { api, library } = await setup(); await api.startLocalSync();
    const before = await api.getLibraryNavigation(library.id);
    await f.db.transaction(s => s.execute("CREATE TRIGGER reject_start BEFORE INSERT ON change_log BEGIN SELECT RAISE(ABORT,'navigation failure'); END"));
    await expect(api.saveLibraryNavigation(library.id, { start: { kind: 'last' }, collections_layout: 'list' })).rejects.toThrow('navigation failure');
    expect(await api.getLibraryNavigation(library.id)).toEqual(before);
    await f.db.transaction(s => s.execute('DROP TRIGGER reject_start'));
    await api.saveLibraryNavigation(library.id, { start: { kind: 'last' }, collections_layout: 'cards' });
    await f.db.transaction(s => s.execute('INSERT INTO local_settings VALUES(?,?)', [`library_last:${library.id}`, '{"kind":"last"}']));
    expect(await api.resolveLibraryStart(library.id)).toEqual({ kind: 'collections' });
    await f.db.transaction(s => s.execute('UPDATE local_settings SET value=? WHERE key=?', ['broken', `library_last:${library.id}`]));
    expect(await api.resolveLibraryStart(library.id)).toEqual({ kind: 'collections' });
  });
});
