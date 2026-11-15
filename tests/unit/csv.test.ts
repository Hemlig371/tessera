import { expect, it } from 'vitest';
import { csvLine, parseCsv } from '../../src/core/csv';
it('parses quoted separators, escaped quotes, CRLF, multiline, empty cells and BOM', () => {
  const text = '\uFEFFa,b,c\r\n"x,y","a""b",\r\n"line\nnext",0,false';
  expect(parseCsv(text).rows).toEqual([
    ['x,y', 'a"b', ''],
    ['line\nnext', '0', 'false'],
  ]);
  expect(parseCsv('a\tb\n1\t2\n').delimiter).toBe('\t');
  expect(csvLine(['a;b', '"', 'x\ny', ''], ';')).toBe('"a;b";"""";"x\ny";\r\n');
});
it('rejects unterminated quotes, data after quoted cells and mismatching columns', () => {
  for (const text of ['a,b\n"oops,2', 'a\n"x"y', 'a,b\n1', 'a\nb"c']) expect(() => parseCsv(text)).toThrow();
});
