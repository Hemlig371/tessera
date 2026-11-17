import { afterEach, describe, it } from 'vitest';
import { adapters, fixture } from '../support/fixture';
import { nutritionScenario } from '../support/nutrition-scenario';

describe.each(adapters)('%s M2 nutrition acceptance', kind => {
  let f: Awaited<ReturnType<typeof fixture>>;
  afterEach(async () => { await f?.cleanup(); });
  it('preserves exact typed values and refreshes related totals without history', async () => {
    f = await fixture(kind); await nutritionScenario(f.api!);
  });
});
