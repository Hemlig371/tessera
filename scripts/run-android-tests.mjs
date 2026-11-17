import { spawn, spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';

// Scope to the application. Unqualified connectedDebugAndroidTest also launches
// empty instrumentation APKs of transitive Android library projects.
const dataClasses = ['SqliteLifecycleTest','BinaryStoreTest','ReplacementStoreTest','CsvStagingTest',
  'SqliteBridgeTest#sharedTrashRestoresPurgesAndKeepsRetentionAcrossRecreation'].map(name => 'app.tessera.personal.' + name);
const selection = process.env.TESSERA_ANDROID_FULL_UI === '1' ? [] : ['-Pandroid.testInstrumentationRunnerArguments.class=' + dataClasses.join(',')];
console.log('Android acceptance: ' + (selection.length ? 'native data contracts and Activity recovery; broad UI deferred' : 'full instrumentation/UI'));
const child = spawn(process.execPath, ['scripts/gradle.mjs', ':app:connectedDebugAndroidTest', '-Pacceptance', '-Pandroid.testInstrumentationRunnerArguments.notAnnotation=androidx.test.filters.LargeTest', ...selection], { stdio: ['inherit', 'pipe', 'pipe'] });
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
  // connectedDebugAndroidTest uninstalls its APKs on completion. Reinstall the same
  // acceptance artifacts before host-controlled, separate-process lifecycle phases.
  adb(['install', '-r', '-t', 'android/app/build/outputs/apk/debug/app-debug.apk']);
  adb(['install', '-r', '-t', 'android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk']);
  const target = 'app.tessera.personal.acceptance';
  const runner = adb(['shell', 'pm', 'list', 'instrumentation']).split(/\r?\n/).find(line => line.includes(`(target=${target})`))?.match(/instrumentation:(\S+)/)?.[1];
  if (!runner) throw new Error('Acceptance instrumentation runner not found');
  let report = '';
  try {
    for (const [testClass, phase] of [
      ['SqliteBridgeTest', 'preparePersistentDraft'], ['SqliteBridgeTest', 'verifyPersistentDraft'],
      ['CsvStagingTest', 'prepareInterruptedCsv'], ['CsvStagingTest', 'verifyInterruptedCsv'],
      ['ReplacementStoreTest', 'prepareInterruptedReplacement'], ['ReplacementStoreTest', 'verifyInterruptedReplacement'],
      ['BinaryStoreTest', 'prepareInterruptedBinary'], ['BinaryStoreTest', 'verifyInterruptedBinary'],
    ]) {
      adb(['shell', 'am', 'force-stop', target]);
      const output = adb(['shell', 'am', 'instrument', '-w', '-e', 'class', `app.tessera.personal.${testClass}#${phase}`, runner]);
      report += `\n${phase}\n${output}\n`; process.stdout.write(output);
      if (!/OK \(1 test\)/.test(output) || /FAILURES!!!|INSTRUMENTATION_FAILED/.test(output)) throw new Error('Native process acceptance failed: ' + phase);
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
