import type { Repository } from '../../src/core/repository';
import { createNutritionFixture } from '../fixtures/nutrition';

export async function nutritionScenario(api: Repository) {
  const f = await createNutritionFixture(api), calories = f.nutrients[0]!;
  const check = (actual: unknown, expected: unknown, rule: string) => { if (actual !== expected) throw new Error('M2 nutrition ' + rule + ': ' + String(actual) + ' != ' + String(expected)); };
  const value = async (record: string, field: string) => (await api.getEntry(record))?.computed?.[field]?.value;
  check(await value(f.portion.id, calories.formula.id), '15.4321', 'exact portion');
  check(await value(f.meal.id, calories.total.id), '15.4321', 'reverse aggregate');
  const versions = (await api.getHistory(f.portion.id)).versions.length;
  const current = await api.quickAction(f.portion.id, f.grams.id, { kind: 'increment', direction: 1 }, f.portion.hlc);
  check(current.data[f.grams.id], '12.75', 'decimal counter');
  check((await api.getHistory(f.portion.id)).versions.length, versions, 'no quick history');
  check(await value(f.meal.id, calories.total.id), '15.74074', 'quick aggregate invalidation');
  await api.saveEntry(f.products.id, { [calories.source.id]: '200' }, f.product.id, f.product.hlc);
  check(await value(f.meal.id, calories.total.id), '25.5', 'related source invalidation');
  await api.updateField(f.grams.id, { name: 'Масса' });
  check(await value(f.meal.id, calories.total.id), '25.5', 'stable references after rename');
  const page = await api.queryEntries({ collection_id: f.meals.id, filters: [{ field_id: calories.total.id, op: 'gt', value: '25' }], sort_field: calories.total.id, limit: 1 });
  check(page.items[0]?.id, f.meal.id, 'formula SQL filter and sort');
  check((await api.getHistory(f.meal.id)).versions.length, 1, 'derived values do not create history');
  return f;
}
