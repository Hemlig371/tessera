import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { migrations } from '../../src/core/schema';

it('preserves the migration checksum shipped in Tessera stage 1', () => {
  const checksum = createHash('sha256').update(migrations[0].statements.join('\n')).digest('hex');
  expect(checksum).toBe('3adba7668c58d0ba84cbc51beb8efcc070ba96d9eb9caad313570bb5c23c4bf1');
});

it('preserves the migration checksum shipped in Tessera stage 2', () => {
  expect(createHash('sha256').update(migrations[1].statements.join('\n')).digest('hex')).toBe('25661a24a575bfaffd029de7b35303acd5cf9b72ddffea3297ed65ba2016a0da');
});

it('preserves the migration checksum shipped in Tessera 0.3.0', () => {
  expect(createHash('sha256').update(migrations[2].statements.join('\n')).digest('hex')).toBe('b7fb3d660156f22e6466ae74a7bf22eb0153aa4ad00e09ef0bd476f5f19faed6');
});
