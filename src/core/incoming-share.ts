import { AppError } from './errors';
import { UUID_RE } from './model';

export interface IncomingSharedFile { index: number; name: string; mime: string; size: number }
export interface IncomingSharedText { id: string; text: string; files: IncomingSharedFile[] }

/** Boundary validation for the durable native Share queue. File-only Shares have no text. */
export function validateIncomingShare(value: unknown): IncomingSharedText {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AppError('invalidSharedText');
  const item = value as Record<string, unknown>;
  if (typeof item.id !== 'string' || !UUID_RE.test(item.id) ||
      typeof item.text !== 'string' || item.text.length > 65536) throw new AppError('invalidSharedText');
  const files = item.files ?? [];
  if (!Array.isArray(files) || files.length > 16 ||
      files.some((file, index) => !file || typeof file !== 'object' || file.index !== index ||
        typeof file.name !== 'string' || !file.name.trim() || file.name.length > 240 ||
        // eslint-disable-next-line no-control-regex
        /[\u0000-\u001f\u007f]/.test(file.name) || typeof file.mime !== 'string' ||
        !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(file.mime) ||
        !Number.isSafeInteger(file.size) || file.size < 0 || file.size > 2 * 1024 * 1024 * 1024))
    throw new AppError('invalidSharedFile');
  if (!item.text.trim() && files.length === 0) throw new AppError('invalidSharedText');
  return { id: item.id, text: item.text, files: files as IncomingSharedFile[] };
}
