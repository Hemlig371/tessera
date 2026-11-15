import { AppError } from '../core/errors';
import { checkCancelled, yieldOperation } from '../core/operations';
import { parseCsvAsync } from '../core/csv';
export async function readCsvDocument(file: File, encoding: string, signal: AbortSignal,
  progress: (percent: number, phase: 'reading' | 'header' | 'rows') => void) {
  if (file.size > 100 * 1024 * 1024) throw new AppError('csvTooLarge');
  checkCancelled(signal);
  const decoder = new TextDecoder(encoding, { fatal: true }), reader = file.stream().getReader(), parts: string[] = [];
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort);
  let bytes = 0, yieldedBytes = 0;
  try {
    for (;;) {
      checkCancelled(signal); const chunk = await reader.read(); checkCancelled(signal);
      if (chunk.done) break;
      try { parts.push(decoder.decode(chunk.value, { stream: true })); } catch { throw new AppError('invalidCsvEncoding'); }
      bytes += chunk.value.byteLength; progress(Math.floor(bytes * 100 / Math.max(file.size, 1)), 'reading');
      if (bytes - yieldedBytes >= 1024 * 1024) { yieldedBytes = bytes; await yieldOperation(); }
    }
    try { parts.push(decoder.decode()); } catch { throw new AppError('invalidCsvEncoding'); }
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
  checkCancelled(signal); const text = parts.join(''); parts.length = 0;
  return parseCsvAsync(text, { signal, progress: (count, phase) => progress(Math.floor(count * 100 / Math.max(text.length, 1)), phase) });
}
