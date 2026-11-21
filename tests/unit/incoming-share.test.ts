import { describe, expect, it } from 'vitest';
import { validateIncomingShare } from '../../src/core/incoming-share';
const id = '12345678-1234-4123-8123-123456789abc';

describe('Android Share envelope', () => {
  it('accepts plain text and URL without files', () => {
    expect(validateIncomingShare({ id, text: 'https://example.org' })).toEqual({ id, text: 'https://example.org', files: [] });
  });
  it('accepts a file-only Share and mixed text plus multiple files', () => {
    const files = [{ index: 0, name: 'photo.png', mime: 'image/png', size: 4 }];
    expect(validateIncomingShare({ id, text: '', files }).files).toEqual(files);
    expect(validateIncomingShare({ id, text: 'caption', files }).text).toBe('caption');
  });
  it('rejects empty, malicious, out-of-order or oversized payloads', () => {
    expect(() => validateIncomingShare({ id, text: '' })).toThrow('invalidSharedText');
    expect(() => validateIncomingShare({ id: '../bad', text: 'abc' })).toThrow('invalidSharedText');
    expect(() => validateIncomingShare({ id, text: '', files: [{ index: 1, name: 'f', mime: 'text/plain', size: 1 }] })).toThrow('invalidSharedFile');
    expect(() => validateIncomingShare({ id, text: '', files: [{ index: 0, name: '../evil', mime: 'application/octet-stream', size: 1 }] })).toThrow('invalidSharedFile');
    expect(() => validateIncomingShare({ id, text: '', files: [{ index: 0, name: 'file.bin', mime: 'application/octet-stream', size: 2 * 1024 * 1024 * 1024 + 1 }] })).toThrow('invalidSharedFile');
  });
});
