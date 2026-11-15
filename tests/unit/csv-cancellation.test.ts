import { expect, it } from 'vitest';
import { parseCsvAsync } from '../../src/core/csv';
import { readCsvDocument } from '../../src/ui/csv-file';
const text = 'Название;Текст\r\n' + Array.from({ length: 10000 }, (_, index) => `Строка ${index};"текст;\r\n""ёж"""\r\n`).join('');
it('cooperatively parses quoted Unicode cells across yield boundaries without changing line endings', async () => {
  const events: number[] = [];
  const result = await parseCsvAsync(text, { progress: count => events.push(count) });
  expect(events.length).toBeGreaterThan(0); expect(result.headers).toEqual(['Название','Текст']);
  expect(result.rows).toHaveLength(10000); expect(result.rows[5000]).toEqual(['Строка 5000','текст;\r\n"ёж"']);
});
it('cancels parsing and streamed file reading; invalid encoding fails instead of replacing characters', async () => {
  const parsing = new AbortController();
  setTimeout(() => parsing.abort(), 0);
  await expect(parseCsvAsync(text, { signal: parsing.signal })).rejects.toThrow('operationCancelled');
  const reading = new AbortController();
  await expect(readCsvDocument(new File([text], 'sample.csv'), 'utf-8', reading.signal, () => reading.abort())).rejects.toThrow('operationCancelled');
  await expect(readCsvDocument(new File([new Uint8Array([255])], 'invalid.csv'), 'utf-8', new AbortController().signal, () => {})).rejects.toThrow('invalidCsvEncoding');
});
