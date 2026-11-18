import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { normalizeLibrarySummary, type LibrarySummaryDefinition } from '../../src/core/library-summary';

describe.each(adapters)('%s M3 summary definitions', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('normalizes canonical widget formulas and rejects secrets, foreign collections and duplicate widget IDs', async () => {
    f = await fixture(kind); const api = f.api!, library = await api.createLibrary('Сводка'), collection = await api.createCollection(library.id,'Записи','Название');
    const amount = await api.createField(collection.id,'Сумма','decimal'), secret = await api.createField(collection.id,'Секрет','secret');
    const widget = { id: crypto.randomUUID(), title: '  Метрика  ', width: 1 as const, collection_id: collection.id, kind: 'metric' as const, formula: `sum([${amount.id}])` };
    const validate = (input: LibrarySummaryDefinition) => f.db.read(s => normalizeLibrarySummary(s,library.id,input));
    expect((await validate({ widgets: [widget] })).widgets[0]).toMatchObject({ title: 'Метрика', formula: `SUM([${amount.id}])` });
    await expect(validate({ widgets: [widget,widget] })).rejects.toThrow('invalidUiConfig');
    await expect(validate({ widgets: [{ ...widget,formula: `COUNTA([${secret.id}])` }] })).rejects.toThrow('formulaReference');
    await expect(validate({ widgets: [{ ...widget,kind: 'table',field_ids: [secret.id],limit: 5 }] })).rejects.toThrow('invalidSecret');
    const foreign = await api.createLibrary('Другая'), other = await api.createCollection(foreign.id,'Записи','Название');
    await expect(validate({ widgets: [{ ...widget,collection_id: other.id }] })).rejects.toThrow('notFound');
    await expect(validate({ widgets: [{ ...widget,kind: 'progress',goal: '0' }] })).rejects.toThrow('invalidUiConfig');
    expect((await validate({ widgets: [{ ...widget,kind: 'progress',goal: '001.50000' }] })).widgets[0]).toMatchObject({ goal: '1.5' });
  });
});
