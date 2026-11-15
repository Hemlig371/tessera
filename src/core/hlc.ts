import { UUID_RE } from './model';
const pattern = /^(\d{16})-(\d{10})-([0-9a-f-]{36})$/;
function parse(value: string) {
  const match = pattern.exec(value);
  if (!match || !UUID_RE.test(match[3]!)) throw new Error('invalidHlc');
  return { physical: Number(match[1]), logical: Number(match[2]) };
}
export function assertHlc(value: string): void {
  const parsed = parse(value);
  if (!Number.isSafeInteger(parsed.physical)) throw new Error('invalidHlc');
}
/** Lexically ordered HLC: physical UTC, logical counter, UUID device tie-break. */
export function nextHlc(device: string, now: number, previous?: string, remote?: string): string {
  if (!UUID_RE.test(device) || !Number.isSafeInteger(now) || now < 0) throw new Error('invalidHlc');
  const a = previous ? parse(previous) : { physical: 0, logical: -1 };
  const b = remote ? parse(remote) : { physical: 0, logical: -1 };
  const physical = Math.max(now, a.physical, b.physical);
  const logical = Math.max(physical === a.physical ? a.logical : -1, physical === b.physical ? b.logical : -1) + 1;
  if (!Number.isSafeInteger(physical) || logical > 9_999_999_999) throw new Error('invalidHlc');
  return `${String(physical).padStart(16, '0')}-${String(logical).padStart(10, '0')}-${device.toLowerCase()}`;
}
