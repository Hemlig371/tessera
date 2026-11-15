import type { CsvWriter } from '../../src/core/csv';
/** Test-only file destination; production always uses a native system picker. */
export async function chooseCsvWriter(name: string): Promise<CsvWriter> {
  let parts: string[] = [];
  return { async write(text) { parts.push(text); }, async finish() {
    const url = URL.createObjectURL(new Blob(parts, { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); parts = [];
  }, async abort() { parts = []; } };
}
