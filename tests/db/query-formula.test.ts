import { afterEach, describe, expect, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { evaluateQueryFormula } from '../../src/core/query-formula';

describe.each(adapters)('%s M3 widget formulas over the full query', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('uses exact formula intermediates from every SQL page and refuses secrets and invalid scalar results', async () => {
    f = await fixture(kind); const api = f.api!, library = await api.createLibrary('Сводка'), collection = await api.createCollection(library.id, 'Значения', 'Название');
    const third = await api.createField(collection.id, 'Треть', 'formula', { formula: '1/3' });
    const bad = await api.createField(collection.id, 'Ошибка', 'formula', { formula: '1/0' });
    const secret = await api.createField(collection.id, 'Секрет', 'secret');
    await api.importEntries(collection.id, Array.from({ length: 211 }, (_, i) => ({ [collection.primary_field_id]: 'Строка ' + i })));
    const evaluate = (source: string) => f.db.transaction(s => evaluateQueryFormula(s, { collection_id: collection.id, limit: 1 }, source));
    expect(await evaluate(`SUM([${third.id}])*3`)).toBe('211');
    expect(await evaluate(`COUNT([${third.id}])`)).toBe('211');
    expect(await evaluate(`CONCAT("Всего: ",COUNTA([${collection.primary_field_id}]))`)).toBe('Всего: 211');
    await expect(evaluate(`[${third.id}]`)).rejects.toThrow('formulaType');
    await expect(evaluate(`COUNTA([${secret.id}])`)).rejects.toThrow('formulaReference');
    expect(await evaluate(`IF(TRUE,1,SUM([${bad.id}]))`)).toBe('1');
    await expect(evaluate(`SUM([${bad.id}])`)).rejects.toThrow('divisionByZero');
    await expect(evaluate('1/0')).rejects.toThrow('divisionByZero');
  });
  it('evaluates forward and reverse relation paths with the shared Calculator on every SQL page', async () => {
    f = await fixture(kind);
    const api = f.api!, library = await api.createLibrary('Сводка связей');
    const products = await api.createCollection(library.id, 'Товары', 'Название');
    const orders = await api.createCollection(library.id, 'Заказы', 'Название');
    const price = await api.createField(products.id, 'Цена', 'money');
    const secret = await api.createField(products.id, 'Секрет', 'secret');
    const product = await api.saveEntry(products.id, { [products.primary_field_id]: 'Один', [price.id]: '5.55', [secret.id]: 'private' });
    const reference = await api.createField(orders.id, 'Товар', 'relation', { target_collection_id: products.id });
    await api.importEntries(orders.id, Array.from({ length: 211 }, (_, index) => ({
      [orders.primary_field_id]: 'Заказ ' + index, [reference.id]: product.id,
    })));
    const source = `SUM([${reference.id}].[${price.id}])`;
    const query = { collection_id: orders.id, limit: 1 };
    expect(await f.db.transaction(s => evaluateQueryFormula(s, query, source))).toBe('1171.05');
    const widget = { id: crypto.randomUUID(), kind: 'metric' as const, title: 'По связям',
      collection_id: orders.id, width: 1 as const, formula: source };
    await api.saveLibrarySummary(library.id, { widgets: [widget] });
    expect(await api.readSummaryWidget(library.id, widget)).toEqual({ kind: 'metric', value: '1171.05' });
    await expect(api.saveLibrarySummary(library.id, { widgets: [{ ...widget, formula: `SUM([${reference.id}].[${secret.id}])` }] }))
      .rejects.toThrow('formulaReference');
  });

});
