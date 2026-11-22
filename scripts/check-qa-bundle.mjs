import { readdir, readFile } from 'node:fs/promises';
const scripts = await Promise.all((await readdir('dist/assets')).filter(name => name.endsWith('.js'))
  .map(name => readFile('dist/assets/' + name, 'utf8')));
const source = scripts.join('\n');
for (const marker of ['08 · Каталог типов полей (QA)', '05 · Личные финансы (QA)', 'QA_FAKE_NOT_A_PASSWORD']) {
  if (!source.includes(marker)) throw new Error('QA bundle is missing acceptance fixture: ' + marker);
}
for (const marker of ['__test-sqlite', '__test-archive', 'sqlite-test-driver', 'node:sqlite']) {
  if (source.includes(marker)) throw new Error('QA bundle contains a browser test bridge: ' + marker);
}
console.log('PASS: QA bundle includes manual acceptance fixtures and no test-only SQLite bridge');
