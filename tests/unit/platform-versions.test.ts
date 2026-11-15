import { expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

it('rejects the JS/Rust dialog mismatch that passes typecheck and cargo test', async () => {
  const root = await mkdtemp(join(tmpdir(), 'tessera-version-check-'));
  try {
    for (const name of ['api', 'plugin-dialog']) await mkdir(join(root, 'node_modules/@tauri-apps', name), { recursive: true });
    await mkdir(join(root, 'src-tauri'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { '@tauri-apps/api': '2.12.4', '@tauri-apps/plugin-dialog': '2.6.0' } }));
    await writeFile(join(root, 'node_modules/@tauri-apps/api/package.json'), JSON.stringify({ version: '2.12.4' }));
    await writeFile(join(root, 'node_modules/@tauri-apps/plugin-dialog/package.json'), JSON.stringify({ version: '2.6.0' }));
    await writeFile(join(root, 'src-tauri/Cargo.lock'), '[[package]]\nname = "tauri"\nversion = "2.12.5"\n\n[[package]]\nname = "tauri-plugin-dialog"\nversion = "2.8.4"\n'.replaceAll('\n', '\r\n'));
    const result = spawnSync(process.execPath, [resolve('scripts/check-platform-versions.mjs')], { cwd: root, encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Tauri major/minor mismatch: @tauri-apps/plugin-dialog 2.6.0, tauri-plugin-dialog 2.8.4');
  } finally { await rm(root, { recursive: true, force: true }); }
});
