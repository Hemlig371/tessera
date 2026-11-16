import type { BinaryFileAdapter, FileFacts } from '../../src/core/ports';
/** Explicit test-only HTTP bridge to real Node filesystem bytes. Never built into production. */
export function openBinaryFiles(): BinaryFileAdapter {
  async function request<T>(operation: string, file: object): Promise<T> {
    const response = await fetch('/__test-sqlite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'binary-' + operation, file }) });
    const result = await response.json() as { value: T; error?: string };
    if (!response.ok || result.error) throw new Error(result.error ?? 'fileError'); return result.value;
  }
  return {
    begin: id => request('begin', { id }),
    write: (id, offset, bytes) => { let value = ''; for (let i = 0; i < bytes.length; i += 8192) value += String.fromCharCode(...bytes.subarray(i, i + 8192)); return request('write', { id, offset, data: btoa(value) }); },
    finish: (id, size, sha256) => request<FileFacts>('finish', { id, size, sha256 }),
    stat: id => request('stat', { id }),
    inspect: id => request('inspect', { id }),
    read: async (id, offset, length) => Uint8Array.from(atob(await request<string>('read', { id, offset, length })), value => value.charCodeAt(0)),
    remove: (id, staged) => request('remove', { id, staged }),
    export: async (id, name, mime, expected) => {
      const saved = await request<boolean>('export', { id, name, mime, ...expected });
      if (saved) { const anchor = document.createElement('a'); anchor.href = '/__test-file-export?id=' + encodeURIComponent(id); anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); }
      return saved;
    },
  };
}
