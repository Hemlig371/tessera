import type { ByteSource } from './attachments';
import { fileChunkSize } from './attachments';
import { AppError } from './errors';
import { checkCancelled } from './operations';

// ZIP STORE + ZIP64. No compression/encryption, executable paths, libraries or platform code.
export interface ArchiveWriter { write(bytes: Uint8Array): Promise<void>; finish(): Promise<void>; abort(): Promise<void> }
const bad = () => new AppError('invalidArchive');
const utf8 = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true }), max32 = 0xffffffff;
const crcTable = Array.from({ length: 256 }, (_, n) => { for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); return n >>> 0; });
function crcUpdate(crc: number, bytes: Uint8Array) { for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]!; return crc >>> 0; }
function block(size: number) { const bytes = new Uint8Array(size); return { bytes, view: new DataView(bytes.buffer) }; }
function u64(view: DataView, offset: number, value: number) { view.setBigUint64(offset, BigInt(value), true); }
function get64(view: DataView, offset: number) { const n = Number(view.getBigUint64(offset, true)); if (!Number.isSafeInteger(n) || n < 0) throw bad(); return n; }
const validName = (name: string) => /^(manifest\.json|data\/[0-9]{8}\.ndjson|attachments\/[0-9a-f-]{36}|placeholders\/[0-9a-f-]{36}\.json)$/.test(name);
interface Entry { name: string; size: number; offset: number; crc: number; dataOffset?: number }

export class ZipWriter {
  private offset = 0;
  private entries: Entry[] = [];
  private names = new Set<string>();
  constructor(private readonly writer: ArchiveWriter, private readonly signal?: AbortSignal) {}
  private async write(bytes: Uint8Array) { checkCancelled(this.signal); await this.writer.write(bytes); this.offset += bytes.length; }
  async entry(name: string, size: number, read: (offset: number, length: number) => Promise<Uint8Array>) {
    if (!validName(name) || this.names.has(name) || !Number.isSafeInteger(size) || size < 0) throw bad();
    this.names.add(name); const nameBytes = utf8.encode(name), big = size >= max32, extra = big ? 20 : 0, offset = this.offset;
    const h = block(30 + nameBytes.length + extra), v = h.view;
    v.setUint32(0, 0x04034b50, true); v.setUint16(4, big ? 45 : 20, true); v.setUint16(6, 0x808, true);
    v.setUint16(12, 0x21, true); // Deterministic valid DOS date: 1980-01-01.
    v.setUint32(18, big ? max32 : size, true); v.setUint32(22, big ? max32 : size, true);
    v.setUint16(26, nameBytes.length, true); v.setUint16(28, extra, true); h.bytes.set(nameBytes, 30);
    if (big) { const at = 30 + nameBytes.length; v.setUint16(at, 1, true); v.setUint16(at + 2, 16, true); u64(v, at + 4, size); u64(v, at + 12, size); }
    await this.write(h.bytes); let crc = max32;
    for (let at = 0; at < size;) {
      checkCancelled(this.signal); const count = Math.min(fileChunkSize, size - at), bytes = await read(at, count);
      if (bytes.length !== count) throw new AppError('fileCorrupt');
      crc = crcUpdate(crc, bytes); await this.write(bytes); at += count;
    }
    crc = (crc ^ max32) >>> 0;
    const d = block(big ? 24 : 16); d.view.setUint32(0, 0x08074b50, true); d.view.setUint32(4, crc, true);
    if (big) { u64(d.view, 8, size); u64(d.view, 16, size); } else { d.view.setUint32(8, size, true); d.view.setUint32(12, size, true); }
    await this.write(d.bytes); this.entries.push({ name, size, offset, crc });
  }
  async bytes(name: string, bytes: Uint8Array) { await this.entry(name, bytes.length, async (offset, count) => bytes.slice(offset, offset + count)); }
  async finish() {
    const start = this.offset;
    for (const entry of this.entries) {
      const name = utf8.encode(entry.name), bigSize = entry.size >= max32, bigOffset = entry.offset >= max32;
      const extraSize = (bigSize ? 16 : 0) + (bigOffset ? 8 : 0), extra = extraSize ? extraSize + 4 : 0;
      const h = block(46 + name.length + extra), v = h.view;
      v.setUint32(0, 0x02014b50, true); v.setUint16(4, 45, true); v.setUint16(6, bigSize || bigOffset ? 45 : 20, true);
      v.setUint16(8, 0x808, true); v.setUint16(14, 0x21, true); v.setUint32(16, entry.crc, true);
      v.setUint32(20, bigSize ? max32 : entry.size, true); v.setUint32(24, bigSize ? max32 : entry.size, true);
      v.setUint16(28, name.length, true); v.setUint16(30, extra, true); v.setUint32(42, bigOffset ? max32 : entry.offset, true); h.bytes.set(name, 46);
      if (extra) {
        let at = 46 + name.length; v.setUint16(at, 1, true); v.setUint16(at + 2, extraSize, true); at += 4;
        if (bigSize) { u64(v, at, entry.size); u64(v, at + 8, entry.size); at += 16; } if (bigOffset) u64(v, at, entry.offset);
      }
      await this.write(h.bytes);
    }
    const size = this.offset - start, count = this.entries.length, big = count >= 65535 || start >= max32 || size >= max32;
    if (big) {
      const position = this.offset, end = block(56), v = end.view;
      v.setUint32(0, 0x06064b50, true); u64(v, 4, 44); v.setUint16(12, 45, true); v.setUint16(14, 45, true);
      u64(v, 24, count); u64(v, 32, count); u64(v, 40, size); u64(v, 48, start); await this.write(end.bytes);
      const locator = block(20); locator.view.setUint32(0, 0x07064b50, true); u64(locator.view, 8, position); locator.view.setUint32(16, 1, true); await this.write(locator.bytes);
    }
    const end = block(22), v = end.view; v.setUint32(0, 0x06054b50, true);
    v.setUint16(8, big ? 65535 : count, true); v.setUint16(10, big ? 65535 : count, true);
    v.setUint32(12, big ? max32 : size, true); v.setUint32(16, big ? max32 : start, true); await this.write(end.bytes);
    checkCancelled(this.signal); await this.writer.finish();
  }
}

export class ZipReader {
  readonly entries = new Map<string, Entry>();
  private constructor(private readonly source: ByteSource, private readonly signal?: AbortSignal) {}
  private async read(offset: number, size: number) {
    checkCancelled(this.signal);
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0 || offset + size > this.source.size) throw bad();
    const bytes = await this.source.read(offset, size); if (bytes.length !== size) throw bad();
    return { bytes, view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength) };
  }
  static async open(source: ByteSource, signal?: AbortSignal) {
    if (!Number.isSafeInteger(source.size) || source.size < 22) throw bad();
    const zip = new ZipReader(source, signal), end = await zip.read(source.size - 22, 22), v = end.view;
    if (v.getUint32(0, true) !== 0x06054b50 || v.getUint16(4, true) || v.getUint16(6, true) || v.getUint16(20, true)) throw bad();
    let count = v.getUint16(10, true), size = v.getUint32(12, true), start = v.getUint32(16, true), boundary = source.size - 22;
    if (v.getUint16(8, true) !== count) throw bad();
    if (count === 65535 || size === max32 || start === max32) {
      const locator = (await zip.read(boundary - 20, 20)).view;
      if (locator.getUint32(0, true) !== 0x07064b50 || locator.getUint32(4, true) || locator.getUint32(16, true) !== 1) throw bad();
      const at = get64(locator, 8), large = (await zip.read(at, 56)).view;
      if (large.getUint32(0, true) !== 0x06064b50 || get64(large, 4) !== 44 || at + 56 !== boundary - 20 || large.getUint32(16, true) || large.getUint32(20, true)) throw bad();
      count = get64(large, 32); if (get64(large, 24) !== count) throw bad(); size = get64(large, 40); start = get64(large, 48); boundary = at;
    }
    if (start + size !== boundary || count > 1_000_000 || count < 2) throw bad();
    let at = start;
    for (let i = 0; i < count; i++) {
      const c = (await zip.read(at, 46)).view;
      if (c.getUint32(0, true) !== 0x02014b50 || (c.getUint16(8, true) & ~0x808) || c.getUint16(10, true) || c.getUint16(34, true)) throw bad();
      const nameLength = c.getUint16(28, true), extraLength = c.getUint16(30, true), comment = c.getUint16(32, true);
      const rest = await zip.read(at + 46, nameLength + extraLength + comment);
      let name: string; try { name = decoder.decode(rest.bytes.subarray(0, nameLength)); } catch { throw bad(); }
      if (!validName(name) || zip.entries.has(name)) throw bad();
      let uncompressed = c.getUint32(24, true), compressed = c.getUint32(20, true), offset = c.getUint32(42, true);
      const needs64 = uncompressed === max32 || compressed === max32 || offset === max32;
      let found64 = false;
      for (let e = nameLength; e < nameLength + extraLength;) {
        if (e + 4 > nameLength + extraLength) throw bad();
        const id = rest.view.getUint16(e, true), length = rest.view.getUint16(e + 2, true); e += 4;
        if (e + length > nameLength + extraLength) throw bad();
        if (id === 1) {
          if (found64) throw bad(); found64 = true; let p = e;
          for (const field of ['size', 'compressed', 'offset']) {
            if ((field === 'size' ? uncompressed : field === 'compressed' ? compressed : offset) !== max32) continue;
            if (p + 8 > e + length) throw bad(); const n = get64(rest.view, p); p += 8;
            if (field === 'size') uncompressed = n; else if (field === 'compressed') compressed = n; else offset = n;
          }
        }
        e += length;
      }
      if ((needs64 && !found64) || compressed !== uncompressed) throw bad();
      const local = (await zip.read(offset, 30)).view;
      if (local.getUint32(0, true) !== 0x04034b50 || local.getUint16(6, true) !== c.getUint16(8, true) || local.getUint16(8, true)) throw bad();
      const localName = await zip.read(offset + 30, local.getUint16(26, true));
      if (decoder.decode(localName.bytes) !== name) throw bad();
      const dataOffset = offset + 30 + local.getUint16(26, true) + local.getUint16(28, true), crc = c.getUint32(16, true);
      let last = dataOffset + uncompressed;
      if (local.getUint16(6, true) & 8) {
        const big = uncompressed >= max32, d = (await zip.read(last, big ? 24 : 16)).view;
        if (d.getUint32(0, true) !== 0x08074b50 || d.getUint32(4, true) !== crc ||
            (big ? get64(d, 8) : d.getUint32(8, true)) !== uncompressed || (big ? get64(d, 16) : d.getUint32(12, true)) !== uncompressed) throw bad();
        last += big ? 24 : 16;
      } else if (local.getUint32(14, true) !== crc) throw bad();
      if (last > start || offset < 0 || dataOffset > last) throw bad();
      zip.entries.set(name, { name, size: uncompressed, offset, crc, dataOffset }); at += 46 + nameLength + extraLength + comment;
    }
    if (at !== boundary) throw bad();
    const ranges = [...zip.entries.values()].sort((a, b) => a.offset - b.offset);
    let previousEnd = 0;
    for (const entry of ranges) {
      if (entry.offset !== previousEnd) throw bad();
      const flags = (await zip.read(entry.offset + 6, 2)).view.getUint16(0, true);
      previousEnd = entry.dataOffset! + entry.size + (flags & 8 ? entry.size >= max32 ? 24 : 16 : 0);
    }
    if (previousEnd !== start) throw bad();
    return zip;
  }
  async *chunks(name: string) {
    const entry = this.entries.get(name); if (!entry) throw bad(); let crc = max32;
    for (let offset = 0; offset < entry.size;) {
      const bytes = (await this.read(entry.dataOffset! + offset, Math.min(fileChunkSize, entry.size - offset))).bytes;
      crc = crcUpdate(crc, bytes); offset += bytes.length; yield bytes;
    }
    if (((crc ^ max32) >>> 0) !== entry.crc) throw bad();
  }
  async bytes(name: string, maximum = 64 * 1024 * 1024) {
    const entry = this.entries.get(name); if (!entry || entry.size > maximum) throw bad();
    const result = new Uint8Array(entry.size); let offset = 0;
    for await (const bytes of this.chunks(name)) { result.set(bytes, offset); offset += bytes.length; }
    return result;
  }
}
