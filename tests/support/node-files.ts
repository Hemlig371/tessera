import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { FileAdapter, PlatformLifecycleAdapter } from '../../src/core/ports';
export function nodeFiles(root: string): FileAdapter {
  const path = (id: string) => { if (id.split('/').some(p => !/^[A-Za-z0-9_.-]+$/.test(p) || p === '..' || p === '.')) throw new Error('fileError'); return resolve(root, id); };
  return {
    read: async id => { try { return new Uint8Array(await readFile(path(id))); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; } },
    writeAtomic: async (id, bytes) => { const target = path(id); await mkdir(dirname(target), { recursive: true }); const temp = target + '.' + crypto.randomUUID(); await writeFile(temp, bytes); await rename(temp, target); },
    remove: id => rm(path(id), { force: true }),
  };
}
export class TestLifecycle implements PlatformLifecycleAdapter {
  private listeners = new Set<(state: 'active' | 'inactive') => void>();
  subscribe(listener: (state: 'active' | 'inactive') => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  emit(state: 'active' | 'inactive') { this.listeners.forEach(listener => listener(state)); }
}
