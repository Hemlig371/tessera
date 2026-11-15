import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { migrations } from '../../src/core/schema';

it('preserves the migration checksum shipped in Tessera stage 1', () => {
  const checksum = createHash('sha256').update(migrations[0].statements.join('\n')).digest('hex');
  expect(checksum).toBe('3adba7668c58d0ba84cbc51beb8efcc070ba96d9eb9caad313570bb5c23c4bf1');
});
