import { afterEach, describe, expect, it } from 'vitest';
import { Repository } from '../../src/core/repository';
import { journalCheckpoint } from '../../src/core/change-journal';
import { adapters, fixture } from '../support/fixture';

describe.each(adapters)('%s UI transport types', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  async function setup() {
    f = await fixture(kind);
    const api = f.api!, library = await api.createLibrary('UI types');
    const collection = await api.createCollection(library.id, 'Records', 'Title');
    await api.saveUiConfig(collection.id, 'form', { fields: [] });
    await api.saveQuickForm(collection.id, { fields: [{ field_id: collection.primary_field_id, visible: true }] });
    const [form] = await f.db.read(s => s.query<{ id: string }>("SELECT id FROM ui_configs WHERE collection_id=? AND kind='form'", [collection.id]));
    const [quick] = await f.db.read(s => s.query<{ id: string }>('SELECT id FROM quick_forms WHERE collection_id=?', [collection.id]));
    return { api, collection, form: form!, quick: quick! };
  }
  it('uses distinct receiver routes for form/card/list configs, quick forms and profiles in baseline and later saves', async () => {
    const { api, collection, form, quick } = await setup();
    await api.startLocalSync();
    await api.saveUiConfig(collection.id, 'form', { fields: [{ field_id: collection.primary_field_id, visible: true }] });
    await api.saveQuickForm(collection.id, { fields: [{ field_id: collection.primary_field_id, visible: true, width: 'full' }] });
    const events = await f.db.read(s => s.query<{ entity_type: string; entity_id: string; payload: string }>('SELECT entity_type,entity_id,payload FROM change_log ORDER BY seq'));
    expect(events.filter(event => event.entity_id === form.id).map(event => event.entity_type)).toEqual(['ui_config', 'ui_config']);
    expect(events.filter(event => event.entity_id === quick.id).map(event => event.entity_type)).toEqual(['quick_form', 'quick_form']);
    expect(events.some(event => event.entity_type === 'display_profile')).toBe(true);
    expect(events.filter(event => event.entity_type === 'ui_config').every(event => ['form', 'card', 'list'].includes(JSON.parse(event.payload).kind))).toBe(true);
  });
  it('repairs pending legacy quick events in paused journals without changing IDs, payloads, clocks, acks or sequence numbers', async () => {
    const { api, collection, form, quick } = await setup();
    const entry = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Keep data' });
    const checkpoint = await api.startLocalSync();
    await api.acknowledgeLocalChanges(crypto.randomUUID(), checkpoint);
    await api.pauseLocalSync(true);
    await f.db.transaction(s => s.execute("UPDATE change_log SET entity_type='ui_config' WHERE entity_id=?", [quick.id]));
    const before = await f.db.read(async s => ({ events: await s.query('SELECT * FROM change_log ORDER BY seq'),
      settings: await s.query('SELECT * FROM local_settings ORDER BY key') }));
    const reopened = await Repository.open(f.db);
    expect(await reopened.getSyncMode()).toBe('paused');
    expect(await f.db.read(journalCheckpoint)).toEqual(checkpoint);
    const after = await f.db.read(async s => ({ events: await s.query('SELECT * FROM change_log ORDER BY seq'),
      settings: await s.query('SELECT * FROM local_settings ORDER BY key') }));
    expect(after).toEqual({ ...before, events: before.events.map(event => event.entity_id === quick.id ? { ...event, entity_type: 'quick_form' } : event) });
    expect(after.events.find(event => event.entity_id === form.id)!.entity_type).toBe('ui_config');
    expect(await reopened.getEntry(entry.id)).toEqual(entry);
    await Repository.open(f.db);
    expect(await f.db.read(s => s.query('SELECT * FROM change_log ORDER BY seq'))).toEqual(after.events);
  });
});
