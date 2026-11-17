import type { Repository } from '../../src/core/repository';

/** Universal user-defined fields; no nutrition rules belong to production Core. */
export async function createNutritionFixture(api: Repository) {
  const library = await api.createLibrary('Питание (dev/CI)');
  const products = await api.createCollection(library.id, 'Продукты', 'Название');
  const meals = await api.createCollection(library.id, 'Приёмы пищи', 'Название');
  const portions = await api.createCollection(library.id, 'Позиции приёма', 'Название');
  const date = await api.createField(meals.id, 'Дата', 'date');
  const time = await api.createField(meals.id, 'Время', 'time');
  const productRef = await api.createField(portions.id, 'Продукт', 'relation', { target_collection_id: products.id });
  const mealRef = await api.createField(portions.id, 'Приём', 'relation', { target_collection_id: meals.id });
  const grams = await api.createField(portions.id, 'Вес, г', 'decimal', { decimal_min: '0', step: '0.25', required: true });
  const done = await api.createField(portions.id, 'Готово', 'boolean', { default: false });
  const reverse = await api.createField(meals.id, 'Позиции', 'backlink', { source_field_id: mealRef.id });
  const nutrients = [];
  for (const [name, amount] of [['Ккал', '123.45678'], ['Белки', '7.25'], ['Жиры', '2.1'], ['Углеводы', '18.75']] as const) {
    const source = await api.createField(products.id, name + ' / 100 г', 'decimal');
    const formula = await api.createField(portions.id, name, 'formula', { formula: `[${grams.id}]*[${productRef.id}].[${source.id}]/100` });
    const total = await api.createField(meals.id, name + ' всего', 'aggregate', { formula: `SUM([${reverse.id}].[${formula.id}])` });
    nutrients.push({ source, formula, total, amount });
  }
  const product = await api.saveEntry(products.id, { [products.primary_field_id]: 'Крупа', ...Object.fromEntries(nutrients.map(n => [n.source.id, n.amount])) });
  const meal = await api.saveEntry(meals.id, { [meals.primary_field_id]: 'Завтрак', [date.id]: '2026-11-17', [time.id]: '08:30' });
  const portion = await api.saveEntry(portions.id, { [portions.primary_field_id]: 'Крупа на завтрак', [grams.id]: '12.5', [productRef.id]: product.id, [mealRef.id]: meal.id });
  const actions = [{ field_id: grams.id, control: 'counter' as const }, { field_id: done.id, control: 'toggle' as const }];
  await api.saveUiConfig(portions.id, 'list', { fields: [portions.primary_field_id, grams.id, nutrients[0]!.formula.id].map(field_id => ({ field_id, visible: true })), quick_actions: actions });
  await api.saveUiConfig(portions.id, 'card', { fields: [portions.primary_field_id, grams.id, ...nutrients.map(n => n.formula.id)].map(field_id => ({ field_id, visible: true })), quick_actions: actions });
  return { library, products, meals, portions, date, time, productRef, mealRef, grams, done, nutrients, product, meal, portion };
}
