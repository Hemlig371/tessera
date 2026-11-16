import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Native/build contracts trigger the complete matrix; product checkpoints can request it explicitly. */
export function ciScope(event, files = []) {
  if (event.name === 'workflow_dispatch') return { native: event.fullNative !== false, reason: 'manual' };
  if (!['push', 'pull_request'].includes(event.name)) throw new Error('Unsupported CI event');
  if (event.tag) return { native: true, reason: 'tag' };
  if (/\[(?:full|native) ci\]/i.test(event.message ?? '')) return { native: true, reason: 'checkpoint' };
  const critical = /^(?:\.github\/workflows\/|android\/|src-tauri\/|src\/platform\/|src\/core\/(?:schema|migrate|ports|sqlite-check)\.ts$|scripts\/|tests\/native\/|tests\/support\/(?:android-main|sqlite-contract|rust-database|.*-scenario|draft-fixture|scale)\.tsx?$|tests\/fixtures\/|package(?:-lock)?\.json$|capacitor\.config\.ts$|vite(?:\.[\w-]+)?\.config\.ts$|vitest\.config\.ts$|tsconfig[^/]*\.json$)/;
  return { native: files.some(path => !/\.md$/i.test(path) && critical.test(path)), reason: 'changed-paths' };
}
async function main() {
  const payload = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const name = process.env.GITHUB_EVENT_NAME;
  let files = [];
  if (name !== 'workflow_dispatch') {
    const head = process.env.GITHUB_SHA, base = name === 'pull_request' ? payload.pull_request?.base?.sha : payload.before;
    if (!/^[a-f0-9]{40}$/i.test(head ?? '') || !/^[a-f0-9]{40}$/i.test(base ?? '')) throw new Error('Invalid CI comparison');
    const args = /^0+$/.test(base) ? ['ls-tree', '-r', '--name-only', '-z', head] : ['diff', '--name-only', '-z', base, head];
    files = execFileSync('git', args, { encoding: 'utf8' }).split('\0').filter(Boolean);
  }
  const result = ciScope({ name, tag: process.env.GITHUB_REF?.startsWith('refs/tags/'), fullNative: String(payload.inputs?.full_native ?? 'true') === 'true', message: payload.head_commit?.message }, files);
  await appendFile(process.env.GITHUB_OUTPUT, `native=${result.native}\n`);
  console.log(`Native matrix: ${result.native}; selection: ${result.reason}`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
