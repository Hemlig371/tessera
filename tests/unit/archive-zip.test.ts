import { describe, expect, it } from 'vitest';
import { ZipReader, ZipWriter } from '../../src/core/archive-zip';
function sink() {
  const chunks: Uint8Array[] = [];
  return { chunks, writer: { write: async (bytes: Uint8Array) => { chunks.push(bytes); }, finish: async () => {}, abort: async () => {} },
    source: () => { const bytes = Uint8Array.from(Buffer.concat(chunks)); return { name: 'db.zip', mime: 'application/zip', size: bytes.length, read: async (offset: number, size: number) => bytes.slice(offset, offset + size) }; } };
}
describe('open STORE ZIP container', () => {
  it('reads standard ZIP files produced independently of the implementation', async () => {
    // Python stdlib zipfile, ZIP_STORED; no descriptor. Two entries, one empty.
    const bytes = Uint8Array.from(Buffer.from('UEsDBBQAAAAAAAAAIQBDv6ajAgAAAAIAAAANAAAAbWFuaWZlc3QuanNvbnt9UEsDBBQAAAAAAAAAIQAAAAAAAAAAAAAAAAAUAAAAZGF0YS8wMDAwMDAwMC5uZGpzb25QSwECFAMUAAAAAAAAACEAQ7+mowIAAAACAAAADQAAAAAAAAAAAAAAgAEAAAAAbWFuaWZlc3QuanNvblBLAQIUAxQAAAAAAAAAIQAAAAAAAAAAAAAAAAAUAAAAAAAAAAAAAACAAS0AAABkYXRhLzAwMDAwMDAwLm5kanNvblBLBQYAAAAAAgACAH0AAABfAAAAAAA='.replaceAll(' ', ''), 'base64'));
    const source = { name: 'external.zip', mime: '', size: bytes.length, read: async (offset: number, count: number) => bytes.slice(offset, offset + count) };
    const zip = await ZipReader.open(source);
    expect(new TextDecoder().decode(await zip.bytes('manifest.json'))).toBe('{}'); expect(await zip.bytes('data/00000000.ndjson')).toHaveLength(0);
  });
  it('round-trips bounded binary chunks/CRC including empty entries and rejects corruption/truncation', async () => {
    const output = sink(), zip = new ZipWriter(output.writer), bytes = new Uint8Array(700000).map((_, i) => i % 251);
    await zip.bytes('data/00000000.ndjson', bytes); await zip.bytes('manifest.json', new Uint8Array()); await zip.finish();
    const source = output.source(), read = await ZipReader.open(source);
    expect(await read.bytes('data/00000000.ndjson')).toEqual(bytes);
    expect(output.chunks.every(chunk => chunk.length <= 256 * 1024)).toBe(true);
    const damaged = Uint8Array.from(Buffer.concat(output.chunks)); damaged[100] = damaged[100]! ^ 8;
    const broken = await ZipReader.open({ ...source, read: async (offset, size) => damaged.slice(offset, offset + size) });
    await expect(broken.bytes('data/00000000.ndjson')).rejects.toThrow('invalidArchive');
    await expect(ZipReader.open({ ...source, size: source.size - 1 })).rejects.toThrow('invalidArchive');
  });
  it.each(['../manifest.json', '/manifest.json', 'attachments/../../escape', 'unknown.json'])('rejects unsafe or unknown entry %s', async name => {
    const output = sink(); await expect(new ZipWriter(output.writer).bytes(name, new Uint8Array())).rejects.toThrow('invalidArchive');
  });
  it('supports ZIP64 entry counts without loading file contents', async () => {
    const output = sink(), writer = new ZipWriter(output.writer);
    for (let i = 0; i < 65535; i++) await writer.bytes(`data/${String(i).padStart(8, '0')}.ndjson`, new Uint8Array());
    await writer.bytes('manifest.json', new Uint8Array()); await writer.finish();
    expect((await ZipReader.open(output.source())).entries.size).toBe(65536);
  });
});
