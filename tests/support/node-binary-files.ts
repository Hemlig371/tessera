import { open, mkdir, rename, unlink, stat, copyFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import type { BinaryFileAdapter, FileFacts } from '../../src/core/ports';
import { requireId } from '../../src/core/validation';

/** Dev/CI only: actual private files and streaming SHA-256. Not a browser/production fallback. */
export function nodeBinaryFiles(root: string): BinaryFileAdapter {
  const path = (id: string, staged = false) => { requireId(id); return staged ? join(root, 'operational/file-staging', id + '.part') : join(root, 'attachments', id.slice(0,2), id); };
  const inspect = async (id: string): Promise<FileFacts | null> => {
    const hash = createHash('sha256'); let size = 0;
    try { for await (const chunk of createReadStream(path(id), { highWaterMark: 256 * 1024 })) { hash.update(chunk); size += chunk.length; } }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
    return { size, sha256: hash.digest('hex') };
  };
  const adapter: BinaryFileAdapter = {
    begin: async id => {
      try { await stat(path(id)); throw new Error('fileExists'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      await mkdir(dirname(path(id, true)), { recursive: true }); const file = await open(path(id, true), 'wx'); await file.close();
    },
    write: async (id, offset, bytes) => {
      if (!bytes.length || bytes.length > 256 * 1024) throw new Error('invalidFileChunk');
      const file = await open(path(id, true), 'r+');
      try { if ((await file.stat()).size !== offset) throw new Error('invalidFileOffset'); let written = 0; while (written < bytes.length) { const result = await file.write(bytes, written, bytes.length - written, offset + written); if (!result.bytesWritten) throw new Error('fileError'); written += result.bytesWritten; } } finally { await file.close(); }
    },
    finish: async (id, size, sha256) => {
      const hash = createHash('sha256'); let actual = 0;
      for await (const chunk of createReadStream(path(id, true), { highWaterMark: 256 * 1024 })) { hash.update(chunk); actual += chunk.length; }
      const facts = { size: actual, sha256: hash.digest('hex') };
      if (actual !== size || (sha256 !== undefined && sha256 !== facts.sha256)) throw new Error('fileCorrupt');
      try { await stat(path(id)); throw new Error('fileExists'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const file = await open(path(id, true), 'a'); try { await file.sync(); } finally { await file.close(); }
      await mkdir(dirname(path(id)), { recursive: true }); await rename(path(id, true), path(id)); return facts;
    },
    stat: async id => { try { return (await stat(path(id))).size; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; } },
    inspect,
    read: async (id, offset, length) => {
      if (length < 1 || length > 256 * 1024) throw new Error('invalidFileChunk');
      const file = await open(path(id), 'r');
      try { const bytes = new Uint8Array(length); const result = await file.read(bytes, 0, length, offset); return bytes.slice(0, result.bytesRead); } finally { await file.close(); }
    },
    remove: async (id, staged) => { try { await unlink(path(id, staged)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; } },
    export: async (id, _name, _mime, facts) => {
      const actual = await inspect(id);
      if (actual?.size !== facts.size || actual.sha256 !== facts.sha256) throw new Error('fileCorrupt');
      const destination = join(root, 'exports', id); await mkdir(dirname(destination), { recursive: true });
      const temporary = destination + '.tmp';
      try {
        await copyFile(path(id), temporary); const file = await open(temporary, 'a'); try { await file.sync(); } finally { await file.close(); }
        await rename(temporary, destination);
      } finally { await rm(temporary, { force: true }); }
      return true;
    },
  };
  return adapter;
}
