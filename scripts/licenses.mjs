import { spawnSync } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ls', '--omit=dev', '--all', '--parseable'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (result.status !== 0) throw new Error(result.stderr);
let text = 'Tessera 0.3.0 — third-party notices\nGenerated from installed production npm dependencies.\n\n';
for (const path of [...new Set(result.stdout.trim().split(/\r?\n/))].filter(p => p !== resolve('.')).sort()) {
  const pkg = JSON.parse(await readFile(join(path, 'package.json'), 'utf8'));
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type;
  if (!license || !/MIT|Apache-2.0|BSD|ISC|0BSD|Unlicense|CC0|Unicode/.test(license)) throw new Error(`Review license: ${pkg.name} ${license}`);
  text += `\n===== ${pkg.name}@${pkg.version} (${license}) =====\n`;
  const files = (await readdir(path)).filter(f => /^(licen[sc]e|notice|copying)(\.|$)/i.test(f));
  if (!files.length && pkg.name.startsWith('@rollup/rollup-')) {
    text += await readFile('scripts/rollup-license.txt', 'utf8');
    continue;
  }
  if (!files.length && pkg.name === 'isarray') {
    const readme = await readFile(join(path, 'README.md'), 'utf8');
    if (!readme.includes('Permission is hereby granted')) throw new Error('isarray license missing');
    text += readme.slice(readme.indexOf('## License')); continue;
  }
  if (!files.length) throw new Error(`License file missing: ${pkg.name}`);
  for (const file of files) text += '\n' + await readFile(join(path, file), 'utf8') + '\n';
}
text += await readFile('scripts/native-notices.txt', 'utf8');
text += '\n===== SQLCipher Community license =====\n' + await readFile('scripts/sqlcipher-license.txt', 'utf8');
await writeFile('THIRD_PARTY_NOTICES.txt', text);
await mkdir('public', { recursive: true });
await writeFile('public/THIRD_PARTY_NOTICES.txt', text);
console.log('Production npm licenses verified and notices generated.');
