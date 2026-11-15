import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { csvRecords, exportCsv, parseCsv } from '../../src/core/csv';
import type { Entry, EntryCursor, EntryQuery } from '../../src/core/model';

describe.each(adapters)('%s search and CSV', (kind) => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => {
    await f?.cleanup();
  });
  async function setup() {
    f = await fixture(kind);
    const api = f.api!;
    const library = await api.createLibrary('Личное'),
      collection = await api.createCollection(library.id, 'Вещи', 'Название');
    const count = await api.createField(collection.id, 'Число', 'integer', { indexed: true });
    const notes = await api.createField(collection.id, 'Описание', 'multiline');
    const day = await api.createField(collection.id, 'Дата', 'date');
    return { api, library, collection, count, notes, day };
  }
  it('searches case-insensitive Unicode prefixes across enabled fields and scopes', async () => {
    const { api, library, collection, notes } = await setup();
    const a = await api.saveEntry(collection.id, {
      [collection.primary_field_id]: 'Красный блокнот',
      [notes.id]: 'Большая ЁЛКА',
    });
    await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Другой', [notes.id]: 'блокнот' });
    expect(
      (await api.queryEntries({ search: 'КРАС БОЛЬШ', library_id: library.id })).items.map((x) => x.id)
    ).toEqual([a.id]);
    expect((await api.queryEntries({ search: 'КРАС', library_id: library.id })).items[0]).toMatchObject({ title: 'Красный блокнот', collection_name: 'Вещи' });
    expect((await api.queryEntries({ search: 'ёлк' })).items).toHaveLength(1);
    await api.updateField(notes.id, { config: { fts: false } });
    expect((await api.queryEntries({ search: 'ёлк' })).items).toHaveLength(0);
    await api.setDeleted('library', library.id, true);
    expect((await api.queryEntries({ search: 'крас' })).items).toHaveLength(0);
    await api.setDeleted('library', library.id, false);
    expect((await api.queryEntries({ search: 'крас' })).items).toHaveLength(1);
  });
  it('paginates tied and missing typed keys in both directions and rejects stale cursors', async () => {
    const { api, collection, count } = await setup();
    for (const value of [null, 2, 1, null, 2, 0])
      await api.saveEntry(collection.id, { [collection.primary_field_id]: 'A', [count.id]: value });
    for (const direction of ['asc', 'desc'] as const) {
      const entries: Entry[] = [];
      let cursor: EntryCursor | null | undefined;
      do {
        const page = await api.queryEntries({
          collection_id: collection.id,
          sort_field: count.id,
          direction,
          limit: 2,
          cursor,
        });
        entries.push(...page.items);
        cursor = page.next;
      } while (cursor);
      expect(new Set(entries.map((e) => e.id)).size).toBe(6);
      expect(entries.map((e) => e.data[count.id])).toEqual(
        direction === 'asc' ? [0, 1, 2, 2, null, null] : [2, 2, 1, 0, null, null]
      );
    }
    const page = await api.queryEntries({ collection_id: collection.id, limit: 1 });
    await expect(
      api.queryEntries({ collection_id: collection.id, search: 'A', cursor: page.next })
    ).rejects.toThrow('invalidCursor');
    expect(
      (
        await api.queryEntries({
          collection_id: collection.id,
          filters: [{ field_id: count.id, op: 'eq', value: 0 }],
        })
      ).items
    ).toHaveLength(1);
    expect(
      (
        await api.queryEntries({
          collection_id: collection.id,
          filters: [{ field_id: count.id, op: 'empty' }],
        })
      ).items
    ).toHaveLength(2);
  });
  it('orders Russian text and grouping with the same derived keys as its expression indexes', async () => {
    const { api, collection, count } = await setup();
    for (const name of ['ёж', 'Я', 'елка', 'Ева', 'жук', 'ЕВА'])
      await api.saveEntry(collection.id, {
        [collection.primary_field_id]: name,
        [count.id]: name === 'Я' ? 0 : 1,
      });
    const query: EntryQuery = {
      collection_id: collection.id,
      sort_field: collection.primary_field_id,
      direction: 'asc',
    };
    expect(
      (await api.queryEntries(query)).items.map((e) =>
        String(e.data[collection.primary_field_id]).toLocaleLowerCase('ru')
      )
    ).toEqual(['ева', 'ева', 'елка', 'ёж', 'жук', 'я']);
    await api.saveUiConfig(collection.id, 'list', {
      fields: [],
      list: { sort_field: collection.primary_field_id, direction: 'asc', group_field: count.id },
    });
    expect((await api.queryEntries({ collection_id: collection.id })).items[0]?.data[count.id]).toBe(0);
  });
  it('imports quoted multiline CSV atomically and exports a consistent roundtrip', async () => {
    const { api, collection, count, notes, day } = await setup();
    const fields = await api.listFields(collection.id);
    const doc = parseCsv(
      '\uFEFFНазвание;Число;Описание;Дата\r\n"А;Б";1 234;"Строка\n""Два""";29.02.2024\r\n'
    );
    const mapping = [collection.primary_field_id, count.id, notes.id, day.id];
    expect(await api.importEntries(collection.id, csvRecords(doc, mapping, fields, 'ru'))).toBe(1);
    const entry = (await api.queryEntries({ collection_id: collection.id })).items[0]!;
    expect(entry.data).toMatchObject({
      [count.id]: 1234,
      [notes.id]: 'Строка\n"Два"',
      [day.id]: '2024-02-29',
    });
    const invalid = parseCsv('Название;Число\nПервая;1\nОшибка;1.5\n');
    await expect(
      api.importEntries(collection.id, csvRecords(invalid, mapping.slice(0, 2), fields, 'ru'))
    ).rejects.toThrow('invalidInteger');
    expect((await api.queryEntries({ collection_id: collection.id })).items).toHaveLength(1);
    let output = '',
      finished = false;
    expect(
      await exportCsv(api, { collection_id: collection.id }, fields, 'ru', ';', {
        async write(text) {
          output += text;
        },
        async finish() {
          finished = true;
        },
        async abort() {
          throw new Error('unexpected abort');
        },
      })
    ).toBe(1);
    expect(finished).toBe(true);
    expect(
      [
        ...csvRecords(
          parseCsv(output),
          fields.map((f) => f.id),
          fields,
          'ru'
        ),
      ][0]
    ).toEqual(entry.data);
    const versions = await f.db.read((s) => s.query('SELECT * FROM record_versions'));
    expect(versions).toHaveLength(1);
  });
  it('validates required/default form rules during preview and reports CSV row/field', async () => {
    const { api, collection, count } = await setup();
    await api.saveUiConfig(collection.id, 'form', {
      fields: [{ field_id: count.id, visible: true, required: true }],
    });
    const fields = await api.listFields(collection.id);
    const doc = parseCsv('Название;Число\nПервая;0\nВторая;\n');
    await expect(
      api.previewImport(collection.id, csvRecords(doc, [collection.primary_field_id, count.id], fields, 'ru'))
    ).rejects.toMatchObject({ row: 3, field: 'Число', code: 'requiredField' });
    expect((await api.queryEntries({ collection_id: collection.id })).items).toHaveLength(0);
  });
  it('normalizes Unicode FTS documents and tolerates deleted fields in saved list settings', async () => {
    const { api, collection, notes } = await setup();
    const entry = await api.saveEntry(collection.id, {
      [collection.primary_field_id]: 'ＡＢＣ',
      [notes.id]: 'Е\u0308лка',
    });
    expect((await api.queryEntries({ search: 'abc ёл' })).items[0]?.id).toBe(entry.id);
    await api.saveUiConfig(collection.id, 'list', {
      fields: [],
      list: { sort_field: notes.id, filters: [{ field_id: notes.id, op: 'filled' }] },
    });
    await api.setDeleted('field', notes.id, true);
    expect((await api.queryEntries({ collection_id: collection.id })).items).toHaveLength(1);
    expect((await api.getUiConfig(collection.id, 'list')).list?.filters).toEqual([]);
    await api.setDeleted('field', notes.id, false);
    expect((await api.queryEntries({ collection_id: collection.id, search: 'ёл' })).items).toHaveLength(1);
  });
  it('rolls back a later import batch and HLC on failure and aborts failed exports', async () => {
    const { api, collection } = await setup();
    const before = await f.db.read((s) => s.query("SELECT * FROM local_settings WHERE key='hlc'"));
    const rows = Array.from({ length: 130 }, (_, i) => ({
      [collection.primary_field_id]: i === 125 ? '' : String(i),
    }));
    await expect(api.importEntries(collection.id, rows)).rejects.toThrow('requiredText');
    expect((await api.queryEntries({ collection_id: collection.id })).items).toHaveLength(0);
    expect(await f.db.read((s) => s.query("SELECT * FROM local_settings WHERE key='hlc'"))).toEqual(before);
    expect(await f.db.read((s) => s.query('SELECT * FROM record_versions'))).toHaveLength(0);
    let aborted = false;
    await expect(
      exportCsv(api, { collection_id: collection.id }, await api.listFields(collection.id), 'en', ',', {
        async write() {
          throw new Error('disk full');
        },
        async finish() {
          throw new Error('unexpected finish');
        },
        async abort() {
          aborted = true;
        },
      })
    ).rejects.toThrow('disk full');
    expect(aborted).toBe(true);
  });
});
