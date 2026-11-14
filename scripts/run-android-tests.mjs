import { spawn } from 'node:child_process';

// Scope to the application. Unqualified connectedDebugAndroidTest also launches
// empty instrumentation APKs of transitive Android library projects.
const child = spawn(process.execPath, ['scripts/gradle.mjs', ':app:connectedDebugAndroidTest', '-Pacceptance'], { stdio: ['inherit', 'pipe', 'pipe'] });
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
}
