import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { quickLayout } from '../../src/core/quick-forms';
import { layoutRows } from '../../src/core/ui-definition';
import { Repository } from '../../src/core/repository';
import type { UiDefinition } from '../../src/core/model';

describe.each(adapters)('%s adaptive layout rows', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('interprets legacy widths without writes, persists independent row layouts, and leaves records/versions intact', async () => {
    f = await fixture(kind); const api = f.api!, library = await api.createLibrary('Rows');
    const collection = await api.createCollection(library.id, 'Records', 'Title');
    const number = await api.createField(collection.id, 'Number', 'integer', { default: 0 });
    const flag = await api.createField(collection.id, 'Flag', 'boolean', { default: false });
    const body = await api.createField(collection.id, 'Body', 'markdown');
    const fields = await api.listFields(collection.id), primary = collection.primary_field_id;
    const unknown = crypto.randomUUID();
    const record = await api.saveEntry(collection.id, { [primary]: 'Keep', [unknown]: { untouched: ['old', false, 0] }, [body.id]: '# Raw\r\n' });
    const legacy: UiDefinition = { fields: fields.map(field => ({ field_id: field.id, visible: true, width: field.id === body.id ? 'full' : 'half', group: 'Group' })) };
    await api.saveUiConfig(collection.id, 'form', legacy);
    const snapshot = () => f.db.read(async s => ({ records: await s.query('SELECT * FROM records ORDER BY id'), versions: await s.query('SELECT * FROM record_versions ORDER BY id') }));
    const unchanged = await snapshot();
    const stored = await f.db.read(s => s.query("SELECT * FROM ui_configs WHERE collection_id=? AND kind='form'", [collection.id]));
    expect(layoutRows(await api.getUiConfig(collection.id, 'form'), fields)).toEqual([
      { id: primary, columns: 2, field_ids: [primary, number.id], group: 'Group' },
      { id: flag.id, columns: 2, field_ids: [flag.id], group: 'Group' },
      { id: body.id, columns: 1, field_ids: [body.id], group: 'Group' },
    ]);
    expect(await f.db.read(s => s.query("SELECT * FROM ui_configs WHERE collection_id=? AND kind='form'", [collection.id]))).toEqual(stored);
    const form: UiDefinition = { fields: legacy.fields.map(item => ({ ...item, collapsed: item.field_id === body.id })), rows: [
      { id: crypto.randomUUID(), columns: 3, field_ids: [primary, number.id, flag.id], group: 'Three' },
      { id: crypto.randomUUID(), columns: 1, field_ids: [body.id], group: 'Markdown' },
    ] };
    const card: UiDefinition = { fields: legacy.fields, rows: [{ id: crypto.randomUUID(), columns: 2, field_ids: [body.id, primary] }] };
    const quick: UiDefinition = { fields: fields.map(field => ({ field_id: field.id, visible: field.id === primary || field.id === body.id })), rows: [{ id: crypto.randomUUID(), columns: 2, field_ids: [primary, body.id] }] };
    expect(quickLayout(form, quick, fields).fields.find(item => item.field_id === body.id)?.collapsed).toBeUndefined();
    await api.saveUiConfig(collection.id, 'form', form); await api.saveUiConfig(collection.id, 'card', card); await api.saveQuickForm(collection.id, quick);
    expect(await snapshot()).toEqual(unchanged);
    const reopened = await f.reopen();
    try {
      const again = await Repository.open(reopened);
      expect(await again.getUiConfig(collection.id, 'form')).toEqual(form);
      expect(await again.getUiConfig(collection.id, 'card')).toEqual(card);
      expect(await again.getQuickForm(collection.id)).toEqual(quick);
      expect((await again.getEntry(record.id))!.data[unknown]).toEqual({ untouched: ['old', false, 0] });
    } finally { await reopened.close(); }
    const clock = await f.db.read(s => s.query("SELECT * FROM local_settings WHERE key='hlc'"));
    const changes = await f.db.read(s => s.query('SELECT * FROM change_log ORDER BY seq'));
    for (const rows of [
      [{ id: crypto.randomUUID(), columns: 2, field_ids: [primary, primary] }],
      [{ id: crypto.randomUUID(), columns: 1, field_ids: [primary, number.id] }],
      [{ id: crypto.randomUUID(), columns: 1, field_ids: [unknown] }],
    ]) await expect(api.saveUiConfig(collection.id, 'form', { ...form, rows } as UiDefinition)).rejects.toThrow('invalidUiConfig');
    expect(await api.getUiConfig(collection.id, 'form')).toEqual(form);
    expect(await f.db.read(s => s.query("SELECT * FROM local_settings WHERE key='hlc'"))).toEqual(clock);
    expect(await f.db.read(s => s.query('SELECT * FROM change_log ORDER BY seq'))).toEqual(changes);
    expect(await snapshot()).toEqual(unchanged);
    // A missing assignment or a colliding legacy row id never hides a known field.
    const partial: UiDefinition = { fields: legacy.fields, rows: [{ id: body.id, columns: 1, field_ids: [primary] }] };
    const derived = layoutRows(partial, fields);
    expect(new Set(derived.map(row => row.id)).size).toBe(derived.length);
    expect(derived.flatMap(row => row.field_ids).sort()).toEqual(fields.map(field => field.id).sort());
  });
});
