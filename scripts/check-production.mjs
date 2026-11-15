import { readdir, readFile } from 'node:fs/promises';
for (const file of (await readdir('dist/assets')).filter(n => n.endsWith('.js'))) {
  const source = await readFile('dist/assets/' + file, 'utf8');
  for (const marker of ['__test-sqlite', 'acceptance_probe', 'Bridge roundtrip', 'node:sqlite', 'sqlite-test-driver', 'Scale fixture', 'acceptance.stage2', 'STAGE2_SCALE']) {
    if (source.includes(marker)) throw new Error(`Test code leaked into production bundle: ${file}: ${marker}`);
  }
}
console.log('PASS: production JavaScript contains no test bridge or acceptance suite');
