import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const root = 'android/app/build';
const files = await readdir(root, { recursive: true });
const decode = text => text.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const annotation = text => console.error('::error::' + text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'));
let reported = false;
for (const file of files.filter(f => f.endsWith('.xml') && /androidTest-results|test-results/.test(f))) {
  const xml = await readFile(join(root, file), 'utf8');
  for (const failure of xml.matchAll(/<(?:failure|error)\b[^>]*>([\s\S]*?)<\/(?:failure|error)>/g)) {
    annotation('Android instrumentation: ' + decode(failure[1]).slice(0, 10000));
    reported = true;
  }
}
if (!reported) annotation('Android instrumentation failed without a JUnit failure body; inspect the emulator/Gradle step.');
