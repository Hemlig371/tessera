import { expect, it } from 'vitest';
import { exportFileName } from '../../src/core/attachments';

it('keeps the extension and complete Unicode characters within portable filename limits', () => {
  const name = exportFileName('Материалы 🦔 '.repeat(40) + '.pdf');
  expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(240);
  expect(name.endsWith('.pdf')).toBe(true);
  expect([...name].every(char => { const code = char.codePointAt(0)!; return code < 0xd800 || code > 0xdfff; })).toBe(true);
});
it('sanitizes device names, path separators and empty names without changing metadata', () => {
  expect(exportFileName('CON.txt')).toBe('_CON.txt');
  expect(exportFileName('../a\\b:*.bin')).toBe('.._a_b__.bin');
  expect(exportFileName('...')).toBe('file');
});
