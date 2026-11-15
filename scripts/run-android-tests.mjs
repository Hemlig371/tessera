import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

// Scope to the application. Unqualified connectedDebugAndroidTest also launches
// empty instrumentation APKs of transitive Android library projects.
const child = spawn(process.execPath, ['scripts/gradle.mjs', ':app:connectedDebugAndroidTest', '-Pacceptance', '-Pandroid.testInstrumentationRunnerArguments.notAnnotation=androidx.test.filters.LargeTest'], { stdio: ['inherit', 'pipe', 'pipe'] });
let tail = '';
function capture(chunk, stream) {
  stream.write(chunk);
  tail = (tail + chunk.toString()).slice(-18000);
}
child.stdout.on('data', chunk => capture(chunk, process.stdout));
child.stderr.on('data', chunk => capture(chunk, process.stderr));
const code = await new Promise(resolve => {
  child.once('exit', value => resolve(value ?? 1));
  child.once('error', error => { tail += String(error); resolve(1); });
});
if (code !== 0) {
  await import('./android-test-report.mjs');
  console.error('::error::Android Gradle output: ' + tail.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'));
  process.exitCode = code;
} else {
  const adb = args => {
    const result = spawnSync('adb', args, { encoding: 'utf8', timeout: 1_200_000 });
    if (result.error || result.status !== 0) throw new Error('ADB failed: ' + String(result.error ?? result.stderr));
    return result.stdout;
  };
  const target = 'app.tessera.personal.acceptance';
  const runner = adb(['shell', 'pm', 'list', 'instrumentation']).split(/\r?\n/).find(line => line.includes(`(target=${target})`))?.match(/instrumentation:(\S+)/)?.[1];
  if (!runner) throw new Error('Acceptance instrumentation runner not found');
  let report = '';
  try {
    for (const phase of ['preparePersistentDraft', 'verifyPersistentDraft']) {
      adb(['shell', 'am', 'force-stop', target]);
      const output = adb(['shell', 'am', 'instrument', '-w', '-e', 'class', `app.tessera.personal.SqliteBridgeTest#${phase}`, runner]);
      report += `\n${phase}\n${output}\n`; process.stdout.write(output);
      if (!/OK \(1 test\)/.test(output) || /FAILURES!!!|INSTRUMENTATION_FAILED/.test(output)) throw new Error('Draft process acceptance failed: ' + phase);
    }
  } catch (error) {
    report += '\n' + String(error);
    console.error('::error::' + String(error).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A'));
    process.exitCode = 1;
  } finally {
    await mkdir('android/app/build/reports/androidTests', { recursive: true });
    await writeFile('android/app/build/reports/androidTests/drafts-process.txt', report);
  }
}
