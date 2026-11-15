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

it('preserves the migration checksum shipped in Tessera 0.4.0', () => {
  expect(createHash('sha256').update(migrations[3].statements.join('\n')).digest('hex')).toBe('45f54f2259cfd075a516666bb0e6faefd8ca6144e36f5ecc724affe0bd632129');
});

it('preserves the migration checksum shipped in Tessera 0.5.0', () => {
  expect(createHash('sha256').update(migrations[4].statements.join('\n')).digest('hex')).toBe('3fc585ab04ee8e141712f5f420a3591ca9de659c1ac5a84463eef07a0de58658');
});

it('preserves the migration checksum shipped in Tessera 0.7.0', () => {
  expect(createHash('sha256').update(migrations[5].statements.join('\n')).digest('hex')).toBe('3d5d15beb65aea04326389acdd3cdf11bd44dc4c12880817368615064cbb03b6');
});

it('preserves the migration checksum shipped in Tessera 0.8.0', () => {
  expect(createHash('sha256').update(migrations[6].statements.join('\n')).digest('hex')).toBe('992b2e2153711b81a182de58b288ddd261dfa083f36ecf59f9d3b8ab2d9c3af0');
});
