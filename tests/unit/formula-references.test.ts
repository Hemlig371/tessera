import { describe, expect, it } from 'vitest';
import { canonicalizeFormula, localizeFormula, formulaReferenceLabel } from '../../src/ui/formula-references';
import type { Field } from '../../src/core/model';
const make = (name: string,collection_id = 'collection',type = 'decimal',config = {}) => ({ id: crypto.randomUUID(),name,collection_id,type,config: JSON.stringify(config) } as Field);
describe('M3 localized widget references', () => {
  it('roundtrips canonical functions and stable IDs independently of names and locale', () => {
    const field = make('Сумма'),fields = [field],canonical = `SUM([${field.id}],0.1)`;
    const localized = localizeFormula(canonical,'ru',fields);
    expect(localized).toBe('СУММ([Сумма];0,1)');expect(canonicalizeFormula(localized,'ru','collection',fields)).toBe(canonical);
    field.name = 'Цена';expect(localizeFormula(canonical,'en',fields)).toBe('SUM([Цена],0.1)');expect(canonical).toBe(`SUM([${field.id}],0.1)`);
  });
  it('disambiguates unsafe/duplicate names and resolves related fields in their own collection', () => {
    const one = make('Имя'),two = make('Имя'),unsafe = make('Поле [внутри]'),link = make('Товар','collection','relation',{ target_collection_id: 'products' }),price = make('Цена','products');
    const fields = [one,two,unsafe,link,price];
    expect(formulaReferenceLabel(one,fields)).toBe('Имя #'+one.id.slice(0,8));expect(formulaReferenceLabel(unsafe,fields)).toBe(unsafe.id);
    expect(canonicalizeFormula('СУММ([Товар].[Цена])','ru','collection',fields)).toBe(`SUM([${link.id}].[${price.id}])`);
    expect(() => canonicalizeFormula('СУММ([Имя])','ru','collection',fields)).toThrow('formulaReference');
  });
});
