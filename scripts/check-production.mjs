import { readdir, readFile } from 'node:fs/promises';
for (const file of (await readdir('dist/assets')).filter(n => n.endsWith('.js'))) {
  const source = await readFile('dist/assets/' + file, 'utf8');
  for (const marker of ['acceptance.quick', 'acceptance.inbox', '__test-sqlite', 'acceptance_probe', 'Bridge roundtrip', 'node:sqlite', 'sqlite-test-driver', 'Scale fixture', 'acceptance.stage2', 'acceptance.stage3', 'Связи этапа 3', 'STAGE2_SCALE', 'STAGE3_SCALE']) {
    if (source.includes(marker)) throw new Error(`Test code leaked into production bundle: ${file}: ${marker}`);
  }
}
console.log('PASS: production JavaScript contains no test bridge or acceptance suite');
