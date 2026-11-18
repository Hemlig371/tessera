import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { projectCollection } from '../../src/core/collection-projection';

describe.each(adapters)('%s M3 mode query projections', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('counts every filtered row across SQL pages and keeps mode changes free of source writes', async () => {
    f = await fixture(kind); const api = f.api!, library = await api.createLibrary('Режимы'), collection = await api.createCollection(library.id, 'Задачи', 'Название');
    const option = { id: crypto.randomUUID(), label: 'Новая' }, status = await api.createField(collection.id, 'Статус', 'select', { options: [option] });
    const due = await api.createField(collection.id, 'Срок', 'date'), parent = await api.createField(collection.id, 'Родитель', 'relation', { target_collection_id: collection.id });
    const hidden = await api.createField(collection.id, 'Большой текст', 'multiline'),secret = await api.createField(collection.id, 'Секрет', 'secret');
    const computedDate = await api.createField(collection.id, 'Срок формула', 'formula', { formula: 'DATE(2026,11,17)',result_type: 'date' });
    const root = await api.saveEntry(collection.id, { [collection.primary_field_id]: 'Корень' });
    await api.importEntries(collection.id, Array.from({ length: 211 }, (_, i) => ({ [collection.primary_field_id]: 'Задача ' + i, [status.id]: option.id, [due.id]: '2026-11-17', [parent.id]: root.id,[hidden.id]: 'Скрытый большой текст',[secret.id]: 'private' })));
    const snapshot = () => f.db.read(async s => ({ rows: await s.query('SELECT id,data,hlc FROM records ORDER BY id'), versions: await s.query('SELECT * FROM record_versions ORDER BY id') }));
    const before = await snapshot(), query = { collection_id: collection.id, limit: 1 };
    const board = await f.db.transaction(s => projectCollection(s, query, { mode: 'kanban', mode_field: status.id }));
    if (board.mode !== 'kanban') throw new Error('wrong projection');
    const column = board.columns.find(column => column.value === option.id)!;
    expect(column.count).toBe(211); expect(column.entries).toHaveLength(20);
    const calendar = await f.db.transaction(s => projectCollection(s, query, { mode: 'calendar', mode_field: due.id }, '2026-11'));
    if (calendar.mode !== 'calendar') throw new Error('wrong projection');
    const day = calendar.days.find(day => day.date === '2026-11-17')!;
    expect(day.count).toBe(211); expect(day.entries).toHaveLength(5);
    const computedCalendar = await f.db.transaction(s => projectCollection(s,query,{ mode: 'calendar',mode_field: computedDate.id },'2026-11'));
    if (computedCalendar.mode !== 'calendar') throw new Error('wrong projection');
    expect(computedCalendar.days.find(day => day.date === '2026-11-17')!.count).toBe(212);
    const tree = await f.db.transaction(s => projectCollection(s, { ...query, filters: [{ field_id: status.id, op: 'eq', value: option.id }] }, { mode: 'tree', mode_field: parent.id }));
    if (tree.mode !== 'tree') throw new Error('wrong projection');
    expect(tree.rows).toHaveLength(211); expect(tree.rows.every(row => row.missing_parent && row.depth === 0)).toBe(true);
    const compact = await f.db.transaction(s => projectCollection(s,query,{ mode: 'tree',mode_field: parent.id },undefined,undefined,[due.id,secret.id]));
    if (compact.mode !== 'tree') throw new Error('wrong projection');
    const child = compact.rows.find(row => row.entry.id !== root.id)!;
    expect(child.entry.data).toEqual({ [parent.id]: root.id,[due.id]: '2026-11-17' });
    expect(child.entry.data).not.toHaveProperty(hidden.id);expect(child.entry.data).not.toHaveProperty(secret.id);
    expect(await snapshot()).toEqual(before);
  });
});
